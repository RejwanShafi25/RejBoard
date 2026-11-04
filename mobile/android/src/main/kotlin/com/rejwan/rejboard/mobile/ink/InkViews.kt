package com.rejwan.rejboard.mobile.ink

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.PorterDuff
import android.graphics.RenderNode
import android.os.Build
import android.view.Choreographer
import android.view.MotionEvent
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.View
import androidx.annotation.RequiresApi
import androidx.graphics.lowlatency.CanvasFrontBufferedRenderer
import androidx.graphics.surface.SurfaceControlCompat
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
    /** The pen's side button, as last reported while hovering or by ACTION_BUTTON_PRESS / RELEASE. */
    private var barrelHeld = false
    /** The current gesture came as Samsung's S Pen side-button actions (211-214). */
    private var spenButtonGesture = false
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
        if (stylusButton(e, toolType) || spenButtonGesture) buttons = buttons or InkSample.BUTTON_BARREL
        // AXIS_TILT is radians from upright, AXIS_ORIENTATION the direction it leans: as PointerEvent tiltX / tiltY degrees
        val tx = Math.toDegrees(atan(tan(tilt.toDouble()) * sin(orient.toDouble())))
        val ty = Math.toDegrees(atan(-tan(tilt.toDouble()) * cos(orient.toDouble())))
        val v = editor.view
        // a finger's "pressure" is contact size on most screens, nearly constant: send none, so the core uses the desktop's
        // speed-based pressure (as for a mouse); pens send their real pressure (AXIS_PRESSURE)
        val pressure = if (tool == InkTool.TOUCH) 0.0 else p.toDouble()
        return InkSample(v.toBoardX(x.toDouble()), v.toBoardY(y.toDouble()), pressure, tx, ty, orient.toDouble(), t.toDouble(), tool, buttons)
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

    /**
     * Is the pen's side button down? Phones and tablets report it differently: BUTTON_STYLUS_PRIMARY / SECONDARY (the
     * standard), BUTTON_SECONDARY (several Samsung devices map the S Pen button to it), or only while hovering / through
     * ACTION_BUTTON_PRESS, which [onGenericMotionEvent] remembers in [barrelHeld].
     */
    private fun stylusButton(e: MotionEvent, toolType: Int): Boolean {
        if (toolType != MotionEvent.TOOL_TYPE_STYLUS) return false
        val bits = MotionEvent.BUTTON_STYLUS_PRIMARY or MotionEvent.BUTTON_STYLUS_SECONDARY or MotionEvent.BUTTON_SECONDARY
        return (e.buttonState and bits) != 0 || barrelHeld
    }

    /** Hover and button events (the view forwards its onGenericMotionEvent here). */
    fun onGenericMotionEvent(e: MotionEvent): Boolean {
        val stylus = e.pointerCount > 0 && isStylus(e.getToolType(0))
        if (!stylus) return false
        when (e.actionMasked) {
            MotionEvent.ACTION_HOVER_ENTER, MotionEvent.ACTION_HOVER_MOVE -> {
                val bits = MotionEvent.BUTTON_STYLUS_PRIMARY or MotionEvent.BUTTON_STYLUS_SECONDARY or MotionEvent.BUTTON_SECONDARY
                barrelHeld = (e.buttonState and bits) != 0
            }
            MotionEvent.ACTION_HOVER_EXIT -> barrelHeld = barrelHeld && (e.buttonState != 0)
            MotionEvent.ACTION_BUTTON_PRESS -> barrelHeld = true
            MotionEvent.ACTION_BUTTON_RELEASE -> barrelHeld = false
        }
        return false
    }

    @SuppressLint("ClickableViewAccessibility")
    fun onTouchEvent(e: MotionEvent): Boolean {
        predictor.record(e)
        // Samsung S Pen with the side button held: the touch arrives as actions 211 (down), 212 (up), 213 (move), 214
        // (cancel) instead of the standard ones. Treat them as the standard actions with the button pressed (= eraser).
        val action = when (e.actionMasked) {
            SPEN_DOWN -> { spenButtonGesture = true; MotionEvent.ACTION_DOWN }
            SPEN_UP -> MotionEvent.ACTION_UP
            SPEN_MOVE -> MotionEvent.ACTION_MOVE
            SPEN_CANCEL -> MotionEvent.ACTION_CANCEL
            MotionEvent.ACTION_DOWN -> { spenButtonGesture = false; MotionEvent.ACTION_DOWN }
            MotionEvent.ACTION_BUTTON_PRESS -> { if (isStylus(e.getToolType(0))) barrelHeld = true; return true }
            MotionEvent.ACTION_BUTTON_RELEASE -> { if (isStylus(e.getToolType(0))) barrelHeld = false; return true }
            else -> e.actionMasked
        }
        when (action) {
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
                spenButtonGesture = false
            }
            MotionEvent.ACTION_CANCEL -> {
                if (inkPointer >= 0) finishInk(cancelled = true)
                panning = false
                spenButtonGesture = false
            }
        }
        return true
    }

    companion object {
        // Samsung S Pen actions while the side button is held (SPen SDK: ACTION_PEN_DOWN / UP / MOVE / CANCEL)
        const val SPEN_DOWN = 211
        const val SPEN_UP = 212
        const val SPEN_MOVE = 213
        const val SPEN_CANCEL = 214
    }
}

/**
 * The wet stroke recorded on the UI thread, with the view it was drawn for (the renderer draws on its own thread).
 * [clear]: wipe the front buffer first (a new stroke, or a brush repainted whole); otherwise [wet] adds to what is there.
 */
class WetFrame(val wet: DrawList, val ox: Double, val oy: Double, val zoom: Double, val clear: Boolean)

/**
 * Paper, dry ink chunks and an overlay (the eraser ring), recorded on the UI thread. The lists are never changed afterwards,
 * so the render thread may replay them; [generation] tells it when cached chunk drawings are stale.
 */
class BoardFrame(
    val paper: DrawList,
    val chunks: List<DrawList>,
    val overlay: DrawList,
    val generation: Int,
    val ox: Double,
    val oy: Double,
    val zoom: Double,
)

/**
 * Low-latency ink (Android 10+): the wet stroke is drawn straight into the front buffer with androidx.graphics
 * CanvasFrontBufferedRenderer, the board (paper + dry ink) into the normal multi-buffered layer.
 * - The renderer calls back on a worker thread, so it only ever sees immutable recordings ([WetFrame], [BoardFrame]).
 * - Fountain and calligraphy strokes are added to the front buffer a segment at a time (not repainted whole per sample).
 * - Each dry-ink chunk is recorded once into a RenderNode on the render thread; a finished stroke only adds a chunk.
 * - Full redraws (pan, zoom, erasing) are coalesced: at most one is in flight, the newest view wins. Before this, every
 *   move queued a whole-board render and the screen fell seconds behind the pen.
 */
@RequiresApi(Build.VERSION_CODES.Q)
@SuppressLint("ViewConstructor")
class FrontBufferedInkView(context: Context, private val editor: BoardEditor, onChanged: () -> Unit) : SurfaceView(context), InkHost {
    val input = InkInput(this, editor, this, onChanged)
    private var fitted = false
    private var viewW = 0.0
    private var viewH = 0.0
    @Volatile private var frame: BoardFrame? = null
    private var wetGeneration = -1
    private var redrawScheduled = false
    private var redrawInFlight = false
    private var redrawPending = false
    private var wetNeedsFull = false

    // render thread only: one RenderNode per dry chunk
    private val nodes = java.util.IdentityHashMap<DrawList, RenderNode>()
    private var nodesGeneration = -1
    private var nodesZoom = 0.0

    private val renderer = CanvasFrontBufferedRenderer(this, object : CanvasFrontBufferedRenderer.Callback<WetFrame> {
        override fun onDrawFrontBufferedLayer(canvas: Canvas, bufferWidth: Int, bufferHeight: Int, param: WetFrame) {
            if (param.clear) canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)
            val c = AndroidCanvas2D(canvas, param.zoom.toFloat())
            c.save()
            c.translate(param.ox, param.oy)
            c.scale(param.zoom, param.zoom)
            param.wet.replay(c)
            c.restore()
        }

        override fun onDrawMultiBufferedLayer(canvas: Canvas, bufferWidth: Int, bufferHeight: Int, params: Collection<WetFrame>) {
            drawDry(canvas)
        }

        // the dry frame is now on screen and the front layer hidden (render thread): tell the UI thread
        override fun onMultiBufferedLayerRenderComplete(
            frontBufferedLayerSurfaceControl: SurfaceControlCompat,
            multiBufferedLayerSurfaceControl: SurfaceControlCompat,
            transaction: SurfaceControlCompat.Transaction,
        ) {
            post { onRedrawDone() }
        }
    })

    /** A redraw that never reports back (surface recreated, renderer not ready) must not block every later one. */
    private val redrawWatchdog = Runnable {
        if (redrawInFlight) {
            redrawInFlight = false
            if (redrawPending) {
                redrawPending = false
                redrawAll()
            }
        }
    }

    private fun onRedrawDone() {
        removeCallbacks(redrawWatchdog)
        redrawInFlight = false
        // presenting the dry frame hid the front layer: if a stroke is being drawn, paint it again in full
        if (editor.isDrawing) {
            wetNeedsFull = true
            drawWet(emptyList())
        }
        if (redrawPending) {
            redrawPending = false
            redrawAll()
        }
    }

    /** The dry layer: paper, then the cached ink chunks, then the overlay (render thread). */
    private fun drawDry(canvas: Canvas) {
        run {
            val f = frame ?: return@run
            f.paper.replay(AndroidCanvas2D(canvas, f.zoom.toFloat()))
            // the pencil grain is scaled for one zoom: re-record the chunks when the zoom changed a lot
            val zoomChanged = nodesZoom == 0.0 || f.zoom / nodesZoom > 1.5 || nodesZoom / f.zoom > 1.5
            if (f.generation != nodesGeneration || zoomChanged) {
                for (n in nodes.values) n.discardDisplayList()
                nodes.clear()
                nodesGeneration = f.generation
                nodesZoom = f.zoom
            }
            val live = java.util.Collections.newSetFromMap(java.util.IdentityHashMap<DrawList, Boolean>())
            live.addAll(f.chunks)
            val it = nodes.entries.iterator()
            while (it.hasNext()) {
                val e = it.next()
                if (e.key !in live) { e.value.discardDisplayList(); it.remove() }
            }
            canvas.save()
            canvas.translate(f.ox.toFloat(), f.oy.toFloat())
            canvas.scale(f.zoom.toFloat(), f.zoom.toFloat())
            for (chunk in f.chunks) {
                val node = nodes.getOrPut(chunk) {
                    RenderNode("rejboard-ink").also { n ->
                        n.setPosition(0, 0, 1 shl 24, 1 shl 24)
                        n.setClipToBounds(false)
                        val rc = n.beginRecording()
                        chunk.replay(AndroidCanvas2D(rc, nodesZoom.toFloat()))
                        n.endRecording()
                    }
                }
                canvas.drawRenderNode(node)
            }
            f.overlay.replay(AndroidCanvas2D(canvas, f.zoom.toFloat()))
            canvas.restore()
        }
    }

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
            override fun surfaceDestroyed(holder: SurfaceHolder) {
                // whatever was in flight will not report back on this surface
                removeCallbacks(redrawWatchdog)
                redrawInFlight = false
                redrawPending = false
            }
        })
    }

    private fun snapshot(): BoardFrame {
        val paper = DrawList()
        editor.paintPaper(paper, viewW, viewH)
        val overlay = DrawList()
        editor.paintEraserRing(overlay)
        val chunks = editor.dryChunks()
        val v = editor.view
        return BoardFrame(paper, chunks, overlay, editor.dryGeneration, v.ox, v.oy, v.zoom)
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean = input.onTouchEvent(event)

    override fun onGenericMotionEvent(event: MotionEvent): Boolean = input.onGenericMotionEvent(event) || super.onGenericMotionEvent(event)

    // hover (with the S Pen's button state) arrives here, not in onGenericMotionEvent
    override fun onHoverEvent(event: MotionEvent): Boolean { input.onGenericMotionEvent(event); return super.onHoverEvent(event) }

    override fun drawWet(predicted: List<InkSample>) {
        val d = DrawList()
        val clear: Boolean
        if (wetNeedsFull && editor.wetIncremental) {
            // the front layer was hidden by a dry frame: bring the incremental painter up to date and paint the whole stroke
            wetNeedsFull = false
            clear = true
            wetGeneration = editor.wetGeneration
            editor.paintWetNew(DrawList())
            editor.paintWet(d)
        } else if (editor.wetIncremental) {
            // a front buffer keeps its pixels: add the new segments and the provisional end (no prediction: it could not be taken back)
            clear = editor.wetGeneration != wetGeneration
            wetGeneration = editor.wetGeneration
            editor.paintWetNew(d)
            editor.paintWetTail(d)
        } else {
            clear = true
            editor.paintWet(d, predicted)
        }
        val v = editor.view
        renderer.renderFrontBufferedLayer(WetFrame(d, v.ox, v.oy, v.zoom, clear))
    }

    /**
     * The stroke ended: draw the dry frame (with the stroke) through the same path as every other redraw. The front layer
     * keeps showing the wet stroke until that frame is presented, so the ink never blinks out.
     * renderer.commit() is not used: it renders only while its internal commit count is 0, and a render that never
     * completed (surface recreated) left that count stuck, so later strokes were saved but never drawn.
     */
    override fun commitDry() {
        wetNeedsFull = false
        redrawAll()
    }

    /** Coalesced full redraw: once per display frame at most, and never more than one waiting on the render thread. */
    override fun redrawAll() {
        if (redrawScheduled) return
        redrawScheduled = true
        Choreographer.getInstance().postFrameCallback {
            redrawScheduled = false
            if (redrawInFlight) {
                redrawPending = true
                return@postFrameCallback
            }
            redrawInFlight = true
            frame = snapshot() // always a fresh snapshot: a finished stroke is in it
            renderer.renderMultiBufferedLayer(emptyList()) // onMultiBufferedLayerRenderComplete posts onRedrawDone()
            postDelayed(redrawWatchdog, 400)
        }
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

    override fun onGenericMotionEvent(event: MotionEvent): Boolean = input.onGenericMotionEvent(event) || super.onGenericMotionEvent(event)

    // hover (with the S Pen's button state) arrives here, not in onGenericMotionEvent
    override fun onHoverEvent(event: MotionEvent): Boolean { input.onGenericMotionEvent(event); return super.onHoverEvent(event) }

    override fun drawWet(predicted: List<InkSample>) { this.predicted = predicted; invalidate() }
    override fun commitDry() { predicted = emptyList(); invalidate() }
    override fun redrawAll() = invalidate()
    override fun cancelWet() { predicted = emptyList(); invalidate() }
}
