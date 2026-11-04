package com.rejwan.rejboard.mobile.ink

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.PorterDuff
import android.os.Build
import android.view.MotionEvent
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.View
import androidx.annotation.RequiresApi
import androidx.graphics.lowlatency.CanvasFrontBufferedRenderer
import androidx.input.motionprediction.MotionEventPredictor
import com.rejwan.rejboard.core.ink.BoardEditor
import com.rejwan.rejboard.core.ink.DrawList
import com.rejwan.rejboard.core.ink.InkSample
import com.rejwan.rejboard.core.ink.InkTool
import kotlin.math.atan
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.sin
import kotlin.math.tan

/** What an ink view must be able to do for [InkInput]. */
interface InkHost {
    /** Draw the wet stroke (plus [predicted] samples) on top of the board right now. */
    fun drawWet(predicted: List<InkSample>)
    /** The stroke ended: show the board with it (dry ink). */
    fun commitDry()
    /** The board or the view changed: redraw everything. */
    fun redrawAll()
    /** Drop the wet stroke. */
    fun cancelWet()
}

/**
 * MotionEvent handling shared by both ink views.
 * - Stylus (S Pen, USI, Wacom): pressure, tilt and orientation, all historical samples, motion prediction, unbuffered dispatch.
 * - Eraser tip, or the side button (BUTTON_STYLUS_PRIMARY) held: erases (the core decides, from InkSample.tool / buttons).
 * - Palm rejection: once a stylus has been seen, fingers never draw: one finger pans, two fingers pan and zoom.
 *   Before that (no pen), one finger draws and two fingers pan / zoom. A cancelled pointer (FLAG_CANCELED, ACTION_CANCEL)
 *   drops the stroke.
 */
class InkInput(
    private val view: View,
    private val editor: BoardEditor,
    private val host: InkHost,
    /** called after a finished stroke or erase changed the board */
    private val onChanged: () -> Unit,
) {
    /** Lets fingers draw while no stylus has been seen ("finger drawing" in the toolbar). */
    var fingerDraws = true
    var stylusSeen = false
        private set

    private val predictor: MotionEventPredictor = MotionEventPredictor.newInstance(view)
    private var inkPointer = -1
    private var panning = false
    private var lastCx = 0f
    private var lastCy = 0f
    private var lastSpan = 0f

    private fun isStylus(tool: Int) = tool == MotionEvent.TOOL_TYPE_STYLUS || tool == MotionEvent.TOOL_TYPE_ERASER

    private fun draws(tool: Int): Boolean = isStylus(tool) || tool == MotionEvent.TOOL_TYPE_MOUSE || (fingerDraws && !stylusSeen)

    private fun sample(e: MotionEvent, idx: Int, h: Int): InkSample {
        val cur = h < 0
        val x = if (cur) e.getX(idx) else e.getHistoricalX(idx, h)
        val y = if (cur) e.getY(idx) else e.getHistoricalY(idx, h)
        val p = if (cur) e.getPressure(idx) else e.getHistoricalPressure(idx, h)
        val tilt = if (cur) e.getAxisValue(MotionEvent.AXIS_TILT, idx) else e.getHistoricalAxisValue(MotionEvent.AXIS_TILT, idx, h)
        val orient = if (cur) e.getAxisValue(MotionEvent.AXIS_ORIENTATION, idx) else e.getHistoricalAxisValue(MotionEvent.AXIS_ORIENTATION, idx, h)
        val t = if (cur) e.eventTime else e.getHistoricalEventTime(h)
        val toolType = e.getToolType(idx)
        val tool = when (toolType) {
            MotionEvent.TOOL_TYPE_STYLUS -> InkTool.PEN
            MotionEvent.TOOL_TYPE_ERASER -> InkTool.ERASER
            MotionEvent.TOOL_TYPE_MOUSE -> InkTool.MOUSE
            else -> InkTool.TOUCH
        }
        var buttons = 0
        if ((e.buttonState and (MotionEvent.BUTTON_STYLUS_PRIMARY or MotionEvent.BUTTON_STYLUS_SECONDARY)) != 0) buttons = buttons or InkSample.BUTTON_BARREL
        // AXIS_TILT is radians from upright, AXIS_ORIENTATION the direction it leans: as PointerEvent tiltX / tiltY degrees
        val tx = Math.toDegrees(atan(tan(tilt.toDouble()) * sin(orient.toDouble())))
        val ty = Math.toDegrees(atan(-tan(tilt.toDouble()) * cos(orient.toDouble())))
        val v = editor.view
        return InkSample(v.toBoardX(x.toDouble()), v.toBoardY(y.toDouble()), p.toDouble(), tx, ty, orient.toDouble(), t.toDouble(), tool, buttons)
    }

    private fun samples(e: MotionEvent, idx: Int): List<InkSample> {
        val out = ArrayList<InkSample>(e.historySize + 1)
        for (h in 0 until e.historySize) out.add(sample(e, idx, h))
        out.add(sample(e, idx, -1))
        return out
    }

    private fun predicted(): List<InkSample> {
        val p = predictor.predict() ?: return emptyList()
        return try {
            val idx = p.findPointerIndex(inkPointer).takeIf { it >= 0 } ?: 0
            samples(p, idx)
        } finally {
            p.recycle()
        }
    }

    private fun startPan(e: MotionEvent) {
        panning = true
        centroid(e)
    }

    private fun centroid(e: MotionEvent) {
        var sx = 0f
        var sy = 0f
        val n = e.pointerCount
        val skip = if (e.actionMasked == MotionEvent.ACTION_POINTER_UP) e.actionIndex else -1
        var m = 0
        for (i in 0 until n) if (i != skip) { sx += e.getX(i); sy += e.getY(i); m++ }
        if (m == 0) return
        lastCx = sx / m
        lastCy = sy / m
        var span = 0f
        for (i in 0 until n) if (i != skip) span += hypot(e.getX(i) - lastCx, e.getY(i) - lastCy)
        lastSpan = span / m
    }

    private fun panMove(e: MotionEvent) {
        val ox = lastCx
        val oy = lastCy
        val os = lastSpan
        centroid(e)
        editor.view.pan((lastCx - ox).toDouble(), (lastCy - oy).toDouble())
        if (e.pointerCount > 1 && os > 0 && lastSpan > 0) editor.view.zoomAt((lastSpan / os).toDouble(), lastCx.toDouble(), lastCy.toDouble())
        host.redrawAll()
    }

    private fun finishInk(cancelled: Boolean) {
        inkPointer = -1
        if (cancelled) {
            editor.cancel()
            host.cancelWet()
            host.redrawAll()
            return
        }
        val changed = editor.end()
        host.commitDry()
        if (changed) onChanged()
    }

    @SuppressLint("ClickableViewAccessibility")
    fun onTouchEvent(e: MotionEvent): Boolean {
        predictor.record(e)
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                val tool = e.getToolType(0)
                if (isStylus(tool)) stylusSeen = true
                if (draws(tool)) {
                    view.requestUnbufferedDispatch(e)
                    if (editor.begin(sample(e, 0, -1))) {
                        inkPointer = e.getPointerId(0)
                        if (editor.isErasing) host.redrawAll() else host.drawWet(emptyList())
                    }
                } else startPan(e)
            }
            MotionEvent.ACTION_POINTER_DOWN -> {
                val tool = e.getToolType(e.actionIndex)
                if (isStylus(tool)) stylusSeen = true
                if (inkPointer >= 0) {
                    val inkTool = e.findPointerIndex(inkPointer).takeIf { it >= 0 }?.let { e.getToolType(it) }
                    // a second finger while a finger was drawing means pan / zoom; anything touching while a pen draws is a palm
                    if (inkTool != null && !isStylus(inkTool) && inkTool != MotionEvent.TOOL_TYPE_MOUSE) {
                        finishInk(cancelled = true)
                        startPan(e)
                    }
                } else if (panning) centroid(e)
            }
            MotionEvent.ACTION_MOVE -> {
                if (inkPointer >= 0) {
                    val idx = e.findPointerIndex(inkPointer)
                    if (idx >= 0) {
                        editor.move(samples(e, idx))
                        if (editor.isErasing) host.redrawAll() else host.drawWet(predicted())
                    }
                } else if (panning) panMove(e)
            }
            MotionEvent.ACTION_POINTER_UP -> {
                val id = e.getPointerId(e.actionIndex)
                // FLAG_CANCELED (0x20, API 33): the system decided this pointer was an accident, e.g. a palm
                if (id == inkPointer) finishInk(cancelled = (e.flags and 0x20) != 0)
                else if (panning) centroid(e)
            }
            MotionEvent.ACTION_UP -> {
                if (inkPointer >= 0) finishInk(cancelled = (e.flags and 0x20) != 0)
                panning = false
            }
            MotionEvent.ACTION_CANCEL -> {
                if (inkPointer >= 0) finishInk(cancelled = true)
                panning = false
            }
        }
        return true
    }
}

/** The wet stroke recorded on the UI thread, with the view it was drawn for (the renderer draws on its own thread). */
class WetFrame(val wet: DrawList, val ox: Double, val oy: Double, val zoom: Double)

/** Paper and dry ink recorded on the UI thread. The lists are never changed afterwards, so the render thread may replay them. */
class BoardFrame(val paper: DrawList, val dry: DrawList, val ox: Double, val oy: Double, val zoom: Double)

/**
 * Low-latency ink (Android 10+): the wet stroke is drawn straight into the front buffer with androidx.graphics
 * CanvasFrontBufferedRenderer, the board (paper + dry ink) into the normal multi-buffered layer.
 * The renderer calls back on a worker thread, so it only ever sees immutable recordings ([WetFrame], [BoardFrame]),
 * never the live editor.
 */
@RequiresApi(Build.VERSION_CODES.Q)
@SuppressLint("ViewConstructor")
class FrontBufferedInkView(context: Context, private val editor: BoardEditor, onChanged: () -> Unit) : SurfaceView(context), InkHost {
    val input = InkInput(this, editor, this, onChanged)
    private var fitted = false
    private var viewW = 0.0
    private var viewH = 0.0
    @Volatile private var frame: BoardFrame? = null

    private val renderer = CanvasFrontBufferedRenderer(this, object : CanvasFrontBufferedRenderer.Callback<WetFrame> {
        override fun onDrawFrontBufferedLayer(canvas: Canvas, bufferWidth: Int, bufferHeight: Int, param: WetFrame) {
            canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)
            val c = AndroidCanvas2D(canvas, param.zoom.toFloat())
            c.save()
            c.translate(param.ox, param.oy)
            c.scale(param.zoom, param.zoom)
            param.wet.replay(c)
            c.restore()
        }

        override fun onDrawMultiBufferedLayer(canvas: Canvas, bufferWidth: Int, bufferHeight: Int, params: Collection<WetFrame>) {
            val f = frame ?: return
            val c = AndroidCanvas2D(canvas, f.zoom.toFloat())
            f.paper.replay(c)
            c.save()
            c.translate(f.ox, f.oy)
            c.scale(f.zoom, f.zoom)
            f.dry.replay(c)
            c.restore()
        }
    })

    init {
        holder.addCallback(object : SurfaceHolder.Callback {
            override fun surfaceCreated(holder: SurfaceHolder) {}
            override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
                viewW = width.toDouble()
                viewH = height.toDouble()
                if (!fitted && width > 0 && height > 0) {
                    editor.fitView(viewW, viewH)
                    fitted = true
                }
                redrawAll()
            }
            override fun surfaceDestroyed(holder: SurfaceHolder) {}
        })
    }

    private fun snapshot(): BoardFrame {
        val paper = DrawList()
        editor.paintPaper(paper, viewW, viewH)
        val v = editor.view
        return BoardFrame(paper, editor.dryInk(), v.ox, v.oy, v.zoom)
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean = input.onTouchEvent(event)

    override fun drawWet(predicted: List<InkSample>) {
        val d = DrawList()
        editor.paintWet(d, predicted)
        val v = editor.view
        renderer.renderFrontBufferedLayer(WetFrame(d, v.ox, v.oy, v.zoom))
    }

    override fun commitDry() {
        frame = snapshot()
        renderer.commit()
    }

    override fun redrawAll() {
        frame = snapshot()
        renderer.renderMultiBufferedLayer(emptyList())
    }

    override fun cancelWet() = renderer.cancel()

    override fun onDetachedFromWindow() {
        renderer.release(true)
        super.onDetachedFromWindow()
    }
}

/** Ink for Android 8 and 9: an ordinary hardware-accelerated View that redraws on every sample. */
@SuppressLint("ViewConstructor")
class SimpleInkView(context: Context, private val editor: BoardEditor, onChanged: () -> Unit) : View(context), InkHost {
    val input = InkInput(this, editor, this, onChanged)
    private var predicted: List<InkSample> = emptyList()
    private var fitted = false

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        if (!fitted && w > 0 && h > 0) {
            editor.fitView(w.toDouble(), h.toDouble())
            fitted = true
        }
    }

    override fun onDraw(canvas: Canvas) {
        editor.paintFrame(AndroidCanvas2D(canvas, editor.view.zoom.toFloat()), width.toDouble(), height.toDouble(), predicted)
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean = input.onTouchEvent(event)

    override fun drawWet(predicted: List<InkSample>) { this.predicted = predicted; invalidate() }
    override fun commitDry() { predicted = emptyList(); invalidate() }
    override fun redrawAll() = invalidate()
    override fun cancelWet() { predicted = emptyList(); invalidate() }
}
