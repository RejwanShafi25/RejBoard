package com.rejwan.rejboard.core.ink

/**
 * A recorded sequence of [Canvas2D] calls: opcodes, their number arguments and their strings in three flat arrays.
 * Platforms that cannot implement [Canvas2D] cheaply in Kotlin (Swift, the Windows C++ app) get a DrawList and replay it;
 * see [ops], [args], [texts] and the opcode table below. Recording is also how the core caches a board's dry ink.
 *
 * Argument count per opcode: SAVE 0, RESTORE 0, TRANSLATE 2, SCALE 2, BEGIN 0, MOVE 2, LINE 2, QUAD 4, BEZIER 6, ARC 5,
 * RECT 4, CLOSE 0, FILL 0, STROKE 0, CLIP 0, FILL_RECT 4, FILL_COLOR 1, STROKE_COLOR 1, STROKE_GRAIN 1, LINE_WIDTH 1,
 * LINE_CAP 1, LINE_JOIN 1, LINE_DASH 1+n (n, then n lengths), ALPHA 1, SHADOW 2 (argb, blur), TEXT 6 (x, y, size, font,
 * align, baseline; the string is the next entry of [texts]). Colours are stored as doubles holding the 32-bit ARGB value.
 */
class DrawList : Canvas2D {
    private var opBuf = IntArray(256)
    private var argBuf = DoubleArray(1024)
    private var nOps = 0
    private var nArgs = 0
    private val textList = ArrayList<String>()

    val opCount: Int get() = nOps
    val argCount: Int get() = nArgs
    val ops: IntArray get() = opBuf.copyOf(nOps)
    val args: DoubleArray get() = argBuf.copyOf(nArgs)
    val texts: List<String> get() = textList

    fun clear() {
        nOps = 0
        nArgs = 0
        textList.clear()
    }

    private fun op(code: Int) {
        if (nOps == opBuf.size) opBuf = opBuf.copyOf(nOps * 2)
        opBuf[nOps++] = code
    }

    private fun a(v: Double) {
        if (nArgs == argBuf.size) argBuf = argBuf.copyOf(nArgs * 2)
        argBuf[nArgs++] = v
    }

    override fun save() = op(SAVE)
    override fun restore() = op(RESTORE)
    override fun translate(x: Double, y: Double) { op(TRANSLATE); a(x); a(y) }
    override fun scale(x: Double, y: Double) { op(SCALE); a(x); a(y) }
    override fun beginPath() = op(BEGIN)
    override fun moveTo(x: Double, y: Double) { op(MOVE); a(x); a(y) }
    override fun lineTo(x: Double, y: Double) { op(LINE); a(x); a(y) }
    override fun quadTo(cx: Double, cy: Double, x: Double, y: Double) { op(QUAD); a(cx); a(cy); a(x); a(y) }
    override fun bezierTo(c1x: Double, c1y: Double, c2x: Double, c2y: Double, x: Double, y: Double) {
        op(BEZIER); a(c1x); a(c1y); a(c2x); a(c2y); a(x); a(y)
    }
    override fun arc(x: Double, y: Double, r: Double, a0: Double, a1: Double) { op(ARC); a(x); a(y); a(r); a(a0); a(a1) }
    override fun rect(x: Double, y: Double, w: Double, h: Double) { op(RECT); a(x); a(y); a(w); a(h) }
    override fun closePath() = op(CLOSE)
    override fun fill() = op(FILL)
    override fun stroke() = op(STROKE)
    override fun clip() = op(CLIP)
    override fun fillRect(x: Double, y: Double, w: Double, h: Double) { op(FILL_RECT); a(x); a(y); a(w); a(h) }
    override fun setFillColor(argb: Long) { op(FILL_COLOR); a(argb.toDouble()) }
    override fun setStrokeColor(argb: Long) { op(STROKE_COLOR); a(argb.toDouble()) }
    override fun setStrokeGrain(argb: Long) { op(STROKE_GRAIN); a(argb.toDouble()) }
    override fun setLineWidth(w: Double) { op(LINE_WIDTH); a(w) }
    override fun setLineCap(cap: Int) { op(LINE_CAP); a(cap.toDouble()) }
    override fun setLineJoin(join: Int) { op(LINE_JOIN); a(join.toDouble()) }
    override fun setLineDash(dash: DoubleArray) { op(LINE_DASH); a(dash.size.toDouble()); for (d in dash) a(d) }
    override fun setGlobalAlpha(alpha: Double) { op(ALPHA); a(alpha) }
    override fun setShadow(argb: Long, blur: Double) { op(SHADOW); a(argb.toDouble()); a(blur) }
    override fun fillText(text: String, x: Double, y: Double, size: Double, font: Int, align: Int, baseline: Int) {
        op(TEXT); a(x); a(y); a(size); a(font.toDouble()); a(align.toDouble()); a(baseline.toDouble())
        textList.add(text)
    }

    /**
     * x0, y0, x1, y1 covering everything the list draws (path points grown by the widest line and arc radii), in the
     * list's own coordinates, or null when it draws nothing. Transforms inside the list are not applied (painters of wet
     * ink use none). Callers use it to clear only the part of a layer the list touched.
     */
    fun bounds(): DoubleArray? {
        var x0 = Double.POSITIVE_INFINITY
        var y0 = Double.POSITIVE_INFINITY
        var x1 = Double.NEGATIVE_INFINITY
        var y1 = Double.NEGATIVE_INFINITY
        var grow = 1.0
        fun add(x: Double, y: Double, r: Double = 0.0) {
            if (!x.isFinite() || !y.isFinite()) return
            if (x - r < x0) x0 = x - r
            if (y - r < y0) y0 = y - r
            if (x + r > x1) x1 = x + r
            if (y + r > y1) y1 = y + r
        }
        var k = 0
        val g = argBuf
        for (i in 0 until nOps) when (opBuf[i]) {
            TRANSLATE, SCALE, MOVE, LINE -> { if (opBuf[i] == MOVE || opBuf[i] == LINE) add(g[k], g[k + 1]); k += 2 }
            QUAD -> { add(g[k], g[k + 1]); add(g[k + 2], g[k + 3]); k += 4 }
            BEZIER -> { add(g[k], g[k + 1]); add(g[k + 2], g[k + 3]); add(g[k + 4], g[k + 5]); k += 6 }
            ARC -> { add(g[k], g[k + 1], g[k + 2]); k += 5 }
            RECT, FILL_RECT -> { add(g[k], g[k + 1]); add(g[k] + g[k + 2], g[k + 1] + g[k + 3]); k += 4 }
            FILL_COLOR, STROKE_COLOR, STROKE_GRAIN, LINE_CAP, LINE_JOIN, ALPHA -> k += 1
            LINE_WIDTH -> { if (g[k].isFinite() && g[k] > grow) grow = g[k]; k += 1 }
            LINE_DASH -> k += 1 + g[k].toInt()
            SHADOW -> { if (g[k + 1].isFinite() && g[k + 1] > grow) grow = g[k + 1]; k += 2 }
            TEXT -> k += 6
            else -> {}
        }
        if (x0 > x1) return null
        return doubleArrayOf(x0 - grow, y0 - grow, x1 + grow, y1 + grow)
    }

    /** Plays the recording into [c]. */
    fun replay(c: Canvas2D) {
        var k = 0
        var t = 0
        val g = argBuf
        fun n(): Double = g[k++]
        fun c32(): Long = n().toLong()
        for (i in 0 until nOps) when (opBuf[i]) {
            SAVE -> c.save()
            RESTORE -> c.restore()
            TRANSLATE -> c.translate(n(), n())
            SCALE -> c.scale(n(), n())
            BEGIN -> c.beginPath()
            MOVE -> c.moveTo(n(), n())
            LINE -> c.lineTo(n(), n())
            QUAD -> c.quadTo(n(), n(), n(), n())
            BEZIER -> c.bezierTo(n(), n(), n(), n(), n(), n())
            ARC -> c.arc(n(), n(), n(), n(), n())
            RECT -> c.rect(n(), n(), n(), n())
            CLOSE -> c.closePath()
            FILL -> c.fill()
            STROKE -> c.stroke()
            CLIP -> c.clip()
            FILL_RECT -> c.fillRect(n(), n(), n(), n())
            FILL_COLOR -> c.setFillColor(c32())
            STROKE_COLOR -> c.setStrokeColor(c32())
            STROKE_GRAIN -> c.setStrokeGrain(c32())
            LINE_WIDTH -> c.setLineWidth(n())
            LINE_CAP -> c.setLineCap(n().toInt())
            LINE_JOIN -> c.setLineJoin(n().toInt())
            LINE_DASH -> { val m = n().toInt(); c.setLineDash(DoubleArray(m) { n() }) }
            ALPHA -> c.setGlobalAlpha(n())
            SHADOW -> c.setShadow(c32(), n())
            TEXT -> { val x = n(); val y = n(); val s = n(); val f = n().toInt(); val al = n().toInt(); val bl = n().toInt(); c.fillText(textList[t++], x, y, s, f, al, bl) }
        }
    }

    companion object {
        const val SAVE = 0
        const val RESTORE = 1
        const val TRANSLATE = 2
        const val SCALE = 3
        const val BEGIN = 4
        const val MOVE = 5
        const val LINE = 6
        const val QUAD = 7
        const val BEZIER = 8
        const val ARC = 9
        const val RECT = 10
        const val CLOSE = 11
        const val FILL = 12
        const val STROKE = 13
        const val CLIP = 14
        const val FILL_RECT = 15
        const val FILL_COLOR = 16
        const val STROKE_COLOR = 17
        const val STROKE_GRAIN = 18
        const val LINE_WIDTH = 19
        const val LINE_CAP = 20
        const val LINE_JOIN = 21
        const val LINE_DASH = 22
        const val ALPHA = 23
        const val SHADOW = 24
        const val TEXT = 25
    }
}
