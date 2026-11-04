package com.rejwan.rejboard.mobile.ink

import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.DashPathEffect
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import com.rejwan.rejboard.core.ink.Canvas2D
import kotlin.math.PI
import kotlin.math.abs

/**
 * The core's [Canvas2D] on an Android [Canvas]: the desktop's canvas calls become Path / Paint calls.
 * [grainScale] is the view zoom, so the pencil grain stays about one device pixel like on the desktop.
 */
class AndroidCanvas2D(private val canvas: Canvas, private val grainScale: Float = 1f) : Canvas2D {
    private class State(
        var fill: Int = 0xFF000000.toInt(),
        var stroke: Int = 0xFF000000.toInt(),
        var grain: Boolean = false,
        var width: Float = 1f,
        var cap: Paint.Cap = Paint.Cap.BUTT,
        var join: Paint.Join = Paint.Join.MITER,
        var dash: FloatArray? = null,
        var alpha: Float = 1f,
        var shadowColor: Int = 0,
        var shadowBlur: Float = 0f,
    ) {
        fun copy() = State(fill, stroke, grain, width, cap, join, dash, alpha, shadowColor, shadowBlur)
    }

    private var st = State()
    private val stack = ArrayList<State>()
    private var path = Path()
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val oval = RectF()

    override fun save() {
        stack.add(st.copy())
        canvas.save()
    }

    override fun restore() {
        if (stack.isEmpty()) return
        st = stack.removeAt(stack.size - 1)
        canvas.restore()
    }

    override fun translate(x: Double, y: Double) = canvas.translate(x.toFloat(), y.toFloat())
    override fun scale(x: Double, y: Double) = canvas.scale(x.toFloat(), y.toFloat())
    override fun beginPath() { path = Path() }
    override fun moveTo(x: Double, y: Double) = path.moveTo(x.toFloat(), y.toFloat())
    override fun lineTo(x: Double, y: Double) = path.lineTo(x.toFloat(), y.toFloat())
    override fun quadTo(cx: Double, cy: Double, x: Double, y: Double) = path.quadTo(cx.toFloat(), cy.toFloat(), x.toFloat(), y.toFloat())
    override fun bezierTo(c1x: Double, c1y: Double, c2x: Double, c2y: Double, x: Double, y: Double) =
        path.cubicTo(c1x.toFloat(), c1y.toFloat(), c2x.toFloat(), c2y.toFloat(), x.toFloat(), y.toFloat())

    override fun arc(x: Double, y: Double, r: Double, a0: Double, a1: Double) {
        if (!(r > 0)) return
        if (abs(a1 - a0) >= 2 * PI) {
            path.addCircle(x.toFloat(), y.toFloat(), r.toFloat(), Path.Direction.CW)
            return
        }
        oval.set((x - r).toFloat(), (y - r).toFloat(), (x + r).toFloat(), (y + r).toFloat())
        path.arcTo(oval, Math.toDegrees(a0).toFloat(), Math.toDegrees(a1 - a0).toFloat(), false)
    }

    override fun rect(x: Double, y: Double, w: Double, h: Double) =
        path.addRect(x.toFloat(), y.toFloat(), (x + w).toFloat(), (y + h).toFloat(), Path.Direction.CW)

    override fun closePath() = path.close()

    private fun withAlpha(c: Int): Int {
        val a = ((c ushr 24) * st.alpha).toInt().coerceIn(0, 255)
        return (a shl 24) or (c and 0xFFFFFF)
    }

    private fun prepare(style: Paint.Style, color: Int) {
        paint.reset()
        paint.isAntiAlias = true
        paint.style = style
        paint.color = withAlpha(color)
        if (st.shadowBlur > 0) paint.setShadowLayer(st.shadowBlur / 2, 0f, 0f, withAlpha(st.shadowColor))
    }

    override fun fill() {
        prepare(Paint.Style.FILL, st.fill)
        canvas.drawPath(path, paint)
    }

    override fun stroke() {
        prepare(Paint.Style.STROKE, st.stroke)
        paint.strokeWidth = st.width
        paint.strokeCap = st.cap
        paint.strokeJoin = st.join
        st.dash?.let { if (it.isNotEmpty()) paint.pathEffect = DashPathEffect(if (it.size % 2 == 0) it else it + it, 0f) }
        if (st.grain) {
            val shader = BitmapShader(Grain.tile(st.stroke), Shader.TileMode.REPEAT, Shader.TileMode.REPEAT)
            shader.setLocalMatrix(Matrix().apply { setScale(1f / grainScale, 1f / grainScale) })
            paint.shader = shader
            paint.color = withAlpha(0xFF000000.toInt()) // the tile carries the colour; the paint only adds global alpha
        }
        canvas.drawPath(path, paint)
    }

    override fun clip() {
        canvas.clipPath(path)
    }

    override fun fillRect(x: Double, y: Double, w: Double, h: Double) {
        prepare(Paint.Style.FILL, st.fill)
        canvas.drawRect(x.toFloat(), y.toFloat(), (x + w).toFloat(), (y + h).toFloat(), paint)
    }

    override fun setFillColor(argb: Long) { st.fill = argb.toInt() }
    override fun setStrokeColor(argb: Long) { st.stroke = argb.toInt(); st.grain = false }
    override fun setStrokeGrain(argb: Long) { st.stroke = argb.toInt(); st.grain = true }
    override fun setLineWidth(w: Double) { if (w.isFinite() && w > 0) st.width = w.toFloat() }
    override fun setLineCap(cap: Int) { st.cap = when (cap) { Canvas2D.CAP_ROUND -> Paint.Cap.ROUND; Canvas2D.CAP_SQUARE -> Paint.Cap.SQUARE; else -> Paint.Cap.BUTT } }
    override fun setLineJoin(join: Int) { st.join = if (join == Canvas2D.JOIN_ROUND) Paint.Join.ROUND else Paint.Join.MITER }
    override fun setLineDash(dash: DoubleArray) { st.dash = if (dash.isEmpty() || dash.any { !it.isFinite() || it < 0 }) null else FloatArray(dash.size) { dash[it].toFloat() } }
    override fun setGlobalAlpha(a: Double) { if (a.isFinite()) st.alpha = a.toFloat().coerceIn(0f, 1f) }
    override fun setShadow(argb: Long, blur: Double) {
        st.shadowColor = argb.toInt()
        st.shadowBlur = if (blur.isFinite()) blur.toFloat().coerceAtLeast(0f) else 0f
    }

    override fun fillText(text: String, x: Double, y: Double, size: Double, font: Int, align: Int, baseline: Int) {
        if (!(size > 0)) return
        prepare(Paint.Style.FILL, st.fill)
        paint.textSize = size.toFloat()
        paint.typeface = if (font == Canvas2D.FONT_SERIF_BOLD) Typeface.create(Typeface.SERIF, Typeface.BOLD) else Typeface.SANS_SERIF
        paint.textAlign = if (align == 1) Paint.Align.CENTER else Paint.Align.LEFT
        val fm = paint.fontMetrics
        val by = if (baseline == 1) y - (fm.ascent + fm.descent) / 2 else y - fm.ascent
        canvas.drawText(text, x.toFloat(), by.toFloat(), paint)
    }
}

/** The desktop's pencil grain (pencilGrain in index.html): a seeded 64 x 64 speckle tile in the stroke colour. */
internal object Grain {
    private val cache = HashMap<Int, Bitmap>()

    fun tile(color: Int): Bitmap = synchronized(cache) { cache.getOrPut(color or 0xFF000000.toInt()) {
        val n = 64
        val px = IntArray(n * n)
        var r = 12345L
        for (k in 0 until n * n) {
            r = (r * 1664525 + 1013904223) and 0xFFFFFFFFL
            val v = r / 4294967296.0
            val a = if (v < .28) 35 else Math.round(120 + v * 135).toInt()
            px[k] = (a shl 24) or (color and 0xFFFFFF)
        }
        Bitmap.createBitmap(px, n, n, Bitmap.Config.ARGB_8888)
    } }
}
