package com.rejwan.rejboard.core.ink

import com.rejwan.rejboard.core.Board
import com.rejwan.rejboard.core.Colors
import com.rejwan.rejboard.core.Paper
import kotlin.math.PI
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.tan

/** Paper settings of a board (S.bg, S.pat, S.gs, S.gd, S.pg in index.html). */
class PaperSpec(
    val background: String,
    val pattern: String,
    val gridSize: Double,
    val gridDot: Double,
    val pageSize: String = "inf",
    val orientation: String = "p",
    val pageCount: Int = 1,
    val pdfWidth: Double? = null,
    val pdfHeight: Double? = null,
) {
    companion object {
        fun of(b: Board): PaperSpec = b.page.let { pg ->
            PaperSpec(b.background, b.pattern, b.gridSize, b.gridDot, pg.size, pg.orientation, pg.count, pg.width, pg.height)
        }
    }
}

/**
 * Paper patterns and pages, ported from index.html (bgfx, bgAll, staffClef, pdim). Draws in screen space: [ox], [oy] is
 * where board point (0, 0) is on screen and [z] the zoom, like the desktop's S.ox, S.oy, S.z.
 */
object PaperPainter {
    const val PAGE_GAP = 40.0
    private val PAGE_SIZES = mapOf("a4" to doubleArrayOf(794.0, 1123.0), "a5" to doubleArrayOf(559.0, 794.0), "a3" to doubleArrayOf(1123.0, 1587.0), "letter" to doubleArrayOf(816.0, 1056.0))
    private val CLEF = arrayOf(
        .22 to .58, -.32 to .46, -.52 to -.02, -.2 to -.58, .42 to -.58, .74 to .04, .46 to .8, -.24 to 1.02, -.92 to .52,
        -1.02 to -.38, -.52 to -1.38, .22 to -2.28, .52 to -3.08, .38 to -3.72, .04 to -3.62, -.16 to -2.92, -.06 to -1.4,
        .12 to .4, .22 to 1.7, .08 to 2.32, -.3 to 2.38,
    )

    /** Page width and height in board units (pdim). */
    fun pageSize(p: PaperSpec): DoubleArray {
        if (p.pageSize == "pdf") return doubleArrayOf(p.pdfWidth?.takeIf { it != 0.0 } ?: 800.0, p.pdfHeight?.takeIf { it != 0.0 } ?: 1100.0)
        val d = PAGE_SIZES[p.pageSize] ?: PAGE_SIZES.getValue("a4")
        return if (p.orientation == "l") doubleArrayOf(d[1], d[0]) else d
    }

    /** Top-left corner of page [i] in board units (pages stack downwards, 40 apart). */
    fun pageTop(p: PaperSpec, i: Int): Double = i * (pageSize(p)[1] + PAGE_GAP)

    /** bgAll(): the whole background of a W x H view. */
    fun paint(c: Canvas2D, p: PaperSpec, W: Double, H: Double, ox: Double, oy: Double, z: Double) {
        if (p.pageSize == "inf") return pattern(c, p, W, H, ox, oy, z)
        val (pw, ph) = pageSize(p).let { it[0] to it[1] }
        val pitch = ph + PAGE_GAP
        c.setFillColor(Colors.parse(if (Paper.isDark(p.background)) "#0b0b0d" else "#d9d4de"))
        c.fillRect(0.0, 0.0, W, H)
        for (i in 0 until p.pageCount) {
            val y = oy + i * pitch * z
            if (y > H || y + ph * z < 0) continue
            c.save()
            c.setShadow(Colors.parse("#0004"), 14.0)
            c.setFillColor(Colors.parse("#fff"))
            c.fillRect(ox, y, pw * z, ph * z)
            c.restore()
            c.save()
            c.beginPath()
            c.rect(ox, y, pw * z, ph * z)
            c.clip()
            pattern(c, p, W, H, ox, y, z)
            c.restore()
        }
    }

    /** bgfx(): paper colour and pattern. [bo] makes lines bolder (the desktop uses it for printing). */
    fun pattern(c: Canvas2D, p: PaperSpec, W: Double, H: Double, ox: Double, oy: Double, z: Double, bo: Double = 0.0) {
        c.setFillColor(Colors.parse(Paper.colors[p.background] ?: "#fff"))
        c.fillRect(0.0, 0.0, W, H)
        val gs = p.gridSize
        if (p.pattern == "plain" || gs * z < (if (bo != 0.0) 3.0 else 6.0)) return
        val g = gs * z
        val d = Paper.isDark(p.background)
        val col = if (d) Colors.rgba(255, 255, 255, .22 + bo) else Colors.rgba(0, 0, 0, .2 + bo)
        val sx = (ox % g + g) % g
        val sy = (oy % g + g) % g
        c.setStrokeColor(col)
        c.setFillColor(col)
        val lw = max(p.gridDot * .5 + .3, if (bo != 0.0) 1.3 else 0.0)
        c.setLineWidth(lw)
        val dotR = p.gridDot * max(.5, z)

        fun hLines(start: Double) { var y = start; while (y < H) { c.moveTo(0.0, y); c.lineTo(W, y); y += g } }
        fun vLines(start: Double) { var x = start; while (x < W) { c.moveTo(x, 0.0); c.lineTo(x, H); x += g } }

        when (p.pattern) {
            "grid" -> { c.beginPath(); vLines(sx); hLines(sy); c.stroke() }
            "dots" -> {
                var x = sx
                while (x < W) {
                    var y = sy
                    while (y < H) { c.beginPath(); c.arc(x, y, dotR, 0.0, 7.0); c.fill(); y += g }
                    x += g
                }
            }
            "cols" -> { c.beginPath(); vLines(sx); c.stroke() }
            "margin" -> {
                c.beginPath(); hLines(sy); c.stroke()
                c.setStrokeColor(Colors.parse("rgba(230,80,100,.6)"))
                c.beginPath(); c.moveTo(ox + 80 * z, 0.0); c.lineTo(ox + 80 * z, H); c.stroke()
            }
            "iso" -> {
                val r = g * .866
                var y = ((oy % r) + r) % r
                while (y < H) {
                    val k = floor((y - oy) / r + .5).toLong()
                    val o = if (((k % 2) + 2) % 2 != 0L) g / 2 else 0.0
                    var x = sx + o
                    while (x < W) { c.beginPath(); c.arc(x, y, dotR, 0.0, 7.0); c.fill(); x += g }
                    y += r
                }
            }
            "lines" -> { c.beginPath(); hLines(sy); c.stroke() }
            "music", "tab" -> staves(c, p.pattern == "music", W, H, ox, oy, g)
            "hand" -> {
                val P = g * 1.5
                var y = ((oy % P) + P) % P - P + g * .3
                while (y < H) {
                    c.beginPath(); c.moveTo(0.0, y); c.lineTo(W, y); c.moveTo(0.0, y + g * .66); c.lineTo(W, y + g * .66); c.stroke()
                    c.setLineDash(doubleArrayOf(6 * z, 5 * z))
                    c.beginPath(); c.moveTo(0.0, y + g * .33); c.lineTo(W, y + g * .33); c.stroke()
                    c.setLineDash(doubleArrayOf())
                    c.setGlobalAlpha(.45)
                    c.beginPath(); c.moveTo(0.0, y + g); c.lineTo(W, y + g); c.stroke()
                    c.setGlobalAlpha(1.0)
                    y += P
                }
            }
            "eng", "mm" -> {
                val en = p.pattern == "eng"
                val rgb = if (en) (if (d) intArrayOf(120, 220, 170) else intArrayOf(30, 140, 90)) else (if (d) intArrayOf(255, 170, 110) else intArrayOf(220, 100, 40))
                val steps = if (en) listOf(g / 5 to .18, g to .45) else listOf(g / 10 to .14, g / 2 to .28, g to .5)
                for ((st, a) in steps) {
                    if (st < 4) continue
                    val ax = (ox % st + st) % st
                    val ay = (oy % st + st) % st
                    c.setStrokeColor(Colors.rgba(rgb[0], rgb[1], rgb[2], a + bo))
                    c.setLineWidth(lw * (if (a > .4) 1.6 else if (a > .2) 1.0 else .7))
                    c.beginPath()
                    var x = ax
                    while (x < W) { c.moveTo(x, 0.0); c.lineTo(x, H); x += st }
                    var y = ay
                    while (y < H) { c.moveTo(0.0, y); c.lineTo(W, y); y += st }
                    c.stroke()
                }
            }
            "hex" -> {
                val r = g / 2
                if (r < 7) return
                val hw = r * 1.7320508
                val rh = r * 1.5
                val ay = ((oy % (2 * rh)) + 2 * rh) % (2 * rh) - 2 * rh
                val ax = ((ox % hw) + hw) % hw - hw
                c.beginPath()
                var j = 0
                var y = ay
                while (y < H + r) {
                    val o = if (j % 2 != 0) hw / 2 else 0.0
                    var x = ax + o - hw
                    while (x < W + hw) {
                        c.moveTo(x, y - r); c.lineTo(x + hw / 2, y - r / 2); c.lineTo(x + hw / 2, y + r / 2); c.lineTo(x, y + r)
                        x += hw
                    }
                    j++
                    y += rh
                }
                c.stroke()
            }
            "slant" -> {
                val P = g * 1.5
                val t = tan(PI * 35 / 180)
                val dx = H * t
                val s0 = ((ox + oy * t) % g + g) % g
                val y0 = ((oy % P) + P) % P - P
                c.beginPath()
                var y = y0
                while (y < H) { c.moveTo(0.0, y); c.lineTo(W, y); c.moveTo(0.0, y + g); c.lineTo(W, y + g); y += P }
                c.stroke()
                c.setLineDash(doubleArrayOf(5 * z, 5 * z))
                c.beginPath()
                y = y0
                while (y < H) { c.moveTo(0.0, y + g * .45); c.lineTo(W, y + g * .45); y += P }
                c.stroke()
                c.setLineDash(doubleArrayOf())
                c.setGlobalAlpha(.45)
                c.beginPath()
                var x = s0 - g
                while (x < W + dx + g) { c.moveTo(x, 0.0); c.lineTo(x - dx, H); x += g }
                c.stroke()
                c.setGlobalAlpha(1.0)
            }
            else -> { // Cornell notes (and any pattern this version does not know)
                c.save()
                c.translate(ox, oy)
                c.scale(z, z)
                c.beginPath()
                var y = 90 + gs
                while (y < 1050) { c.moveTo(0.0, y); c.lineTo(900.0, y); y += gs }
                c.stroke()
                c.setLineWidth(2.0)
                c.setStrokeColor(Colors.parse(if (d) "rgba(255,255,255,.5)" else "rgba(0,0,0,.45)"))
                c.beginPath()
                c.rect(0.0, 0.0, 900.0, 1250.0)
                c.moveTo(0.0, 90.0); c.lineTo(900.0, 90.0)
                c.moveTo(260.0, 90.0); c.lineTo(260.0, 1050.0)
                c.moveTo(0.0, 1050.0); c.lineTo(900.0, 1050.0)
                c.stroke()
                c.restore()
            }
        }
    }

    /** Music staves (5 lines, treble clef) or guitar tab (6 lines, T-A-B). */
    private fun staves(c: Canvas2D, mu: Boolean, W: Double, H: Double, ox: Double, oy: Double, g: Double) {
        val n = if (mu) 5 else 6
        val s = g / (if (mu) 6 else 8)
        val P = g * (if (mu) 1.75 else 1.5)
        val y0 = ((oy % P) + P) % P - P + g * .4
        c.beginPath()
        var y = y0
        while (y < H) {
            for (k in 0 until n) { c.moveTo(0.0, y + k * s); c.lineTo(W, y + k * s) }
            y += P
        }
        c.stroke()
        if (s < 4) return
        val x0 = ox + g * .45
        if (!(x0 > -g * 2 && x0 < W)) return
        c.save()
        c.setLineCap(Canvas2D.CAP_ROUND)
        c.setLineJoin(Canvas2D.JOIN_ROUND)
        y = y0
        while (y < H + P) {
            val h = (n - 1) * s
            c.setLineWidth(max(1.0, s * .12))
            c.beginPath(); c.moveTo(x0, y); c.lineTo(x0, y + h); c.stroke()
            if (mu) clef(c, x0 + s * 1.45, y + 3 * s, s)
            else listOf("T", "A", "B").forEachIndexed { k, ch ->
                c.fillText(ch, x0 + s * 1.3, y + h / 6 + k * h / 3, (h / 3) * .92, Canvas2D.FONT_SERIF_BOLD, 1, 1)
            }
            y += P
        }
        c.restore()
    }

    /** staffClef(): a treble clef drawn with Bezier curves. */
    private fun clef(c: Canvas2D, x: Double, y: Double, s: Double) {
        val P = CLEF.map { (u, v) -> doubleArrayOf(x + u * s, y + v * s) }
        c.save()
        c.setLineWidth(max(1.0, s * .2))
        c.beginPath()
        c.moveTo(P[0][0], P[0][1])
        for (i in 0 until P.size - 1) {
            val p0 = P[max(0, i - 1)]
            val p1 = P[i]
            val p2 = P[i + 1]
            val p3 = P[minOf(P.size - 1, i + 2)]
            c.bezierTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1])
        }
        c.stroke()
        c.beginPath()
        c.arc(x - .3 * s, y + 2.1 * s, s * .3, 0.0, 7.0)
        c.fill()
        c.restore()
    }
}
