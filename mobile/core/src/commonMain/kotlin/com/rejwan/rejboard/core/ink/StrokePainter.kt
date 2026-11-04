package com.rejwan.rejboard.core.ink

import com.rejwan.rejboard.core.Colors
import com.rejwan.rejboard.core.Item
import com.rejwan.rejboard.core.numberOrNull
import com.rejwan.rejboard.core.stringOrNull
import com.rejwan.rejboard.core.truthy
import kotlinx.serialization.json.JsonArray
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/**
 * Draws one pen / highlighter stroke exactly as the desktop app's `stroke()` (index.html) does: the same brushes
 * (fount, calli, soft, ball, pencil, hsq, hch, hrd), Catmull-Rom smoothing for fountain and calligraphy pens, pressure
 * widths, tilt shading, dash patterns and the chisel highlighter's swept outline. The golden tests compare its
 * [Canvas2D] calls with the desktop's canvas calls.
 *
 * Like the desktop it leaves alpha, shadow and caps set on the canvas afterwards: callers wrap it in save()/restore().
 * Values the desktop leaves undefined (a missing pressure, size or sens) come out as NaN, as in JavaScript; a canvas
 * ignores a non-finite line width and keeps the previous one, and [Canvas2D] implementations do the same.
 */
object StrokePainter {
    private val DASHES = mapOf(
        "solid" to doubleArrayOf(), "dashed" to doubleArrayOf(10.0, 7.0), "dotted" to doubleArrayOf(2.0, 7.0),
        "dashdot" to doubleArrayOf(10.0, 5.0, 2.0, 5.0), "longdash" to doubleArrayOf(18.0, 7.0), "shortdash" to doubleArrayOf(5.0, 5.0),
    )

    /** A point's k-th value, NaN when missing (JavaScript `undefined` in arithmetic). */
    private fun DoubleArray.v(k: Int): Double = if (k < size) this[k] else Double.NaN
    /** `p[k] || 0` */
    private fun DoubleArray.zr(k: Int): Double = v(k).let { if (it.isNaN() || it == 0.0) 0.0 else it }

    /** The stroke's points as the desktop stores them (rows may differ in length; non-numbers become NaN). */
    fun points(s: Item): List<DoubleArray> =
        (s["pts"] as? JsonArray)?.map { q -> (q as? JsonArray)?.let { r -> DoubleArray(r.size) { r[it].numberOrNull() ?: Double.NaN } } ?: DoubleArray(0) }
            ?: emptyList()

    /** Catmull-Rom resample (smoothPts in index.html): render-only, the stored points are untouched. */
    fun smoothPts(P: List<DoubleArray>): List<DoubleArray> {
        val out = ArrayList<DoubleArray>(P.size * 3)
        out.add(P[0])
        val n = P.size
        for (i in 0 until n - 1) {
            val p0 = if (i > 0) P[i - 1] else P[i]
            val p1 = P[i]
            val p2 = P[i + 1]
            val p3 = if (i + 2 < n) P[i + 2] else P[i + 1]
            val len = hypot(p2.v(0) - p1.v(0), p2.v(1) - p1.v(1))
            val k = min(8.0, floor(len / 2.5)).let { if (it.isNaN()) 0 else it.toInt() }
            for (j in 1..k) {
                val t = j.toDouble() / (k + 1)
                val t2 = t * t
                val t3 = t2 * t
                fun f(a: Double, b: Double, c: Double, d: Double) =
                    .5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
                out.add(doubleArrayOf(
                    f(p0.v(0), p1.v(0), p2.v(0), p3.v(0)),
                    f(p0.v(1), p1.v(1), p2.v(1), p3.v(1)),
                    p1.v(2) + (p2.v(2) - p1.v(2)) * t,
                    p1.zr(3) + (p2.zr(3) - p1.zr(3)) * t,
                ))
            }
            out.add(p2)
        }
        return out
    }

    /** Pen width at pressure p (wd in index.html). */
    fun width(size: Double, sens: Double, p: Double): Double = jsMax(.6, size * (1 - sens + sens * 2 * p))

    /** Math.max: NaN wins, as in JavaScript. */
    private fun jsMax(a: Double, b: Double): Double = if (a.isNaN() || b.isNaN()) Double.NaN else max(a, b)

    fun paint(c: Canvas2D, s: Item) {
        val t = s.string("tool") ?: return
        var P = s.rows
        if (P.isEmpty()) return
        val z = s.number("size") ?: Double.NaN
        val sharp = s["sharp"].truthy()
        if ((t == "fount" || t == "calli") && !sharp && P.size > 2) P = smoothPts(P)
        val color = Colors.parse(s.string("color"))
        c.setFillColor(color)
        c.setStrokeColor(color)
        val sharpCorners = (s["cornerType"].stringOrNull()?.takeIf { it.isNotEmpty() } ?: "rounded") == "sharp"
        c.setLineCap(if (sharpCorners) Canvas2D.CAP_BUTT else Canvas2D.CAP_ROUND)
        c.setLineJoin(if (sharpCorners) Canvas2D.JOIN_MITER else Canvas2D.JOIN_ROUND)
        val pl = s["pl"].truthy()
        val lt = s["lineType"].stringOrNull()?.takeIf { it.isNotEmpty() } ?: "solid"
        val dk = if (pl) jsMax(1.0, z / 4) else 1.0
        val pat = (DASHES[lt] ?: doubleArrayOf()).map { it * dk }.toDoubleArray()
        val tot = pat.sum()
        val tl = s["tl"].truthy()
        val seg = pl && tot > 0 && (t == "fount" || t == "calli" || ((t == "pencil" || t == "soft") && tl))
        c.setLineDash(if (seg) doubleArrayOf() else pat)

        val D = DoubleArray(P.size)
        if (seg) for (i in 1 until P.size) D[i] = D[i - 1] + hypot(P[i].v(0) - P[i - 1].v(0), P[i].v(1) - P[i - 1].v(1))
        val whole = listOf(doubleArrayOf(0.0, 1.0))
        fun parts(i: Int): List<DoubleArray> {
            if (!seg) return whole
            val d0 = D[i - 1]
            val d1 = D[i]
            val ln = d1 - d0
            if (!(ln > 0)) return whole
            val out = ArrayList<DoubleArray>()
            var b0 = floor(d0 / tot) * tot
            while (b0 < d1) {
                var a = b0
                for (j in pat.indices) {
                    val e = a + pat[j]
                    if (j % 2 == 0) {
                        val s0 = max(a, d0)
                        val s1 = min(e, d1)
                        if (s1 > s0) out.add(doubleArrayOf((s0 - d0) / ln, (s1 - d0) / ln))
                    }
                    a = e
                }
                b0 += tot
            }
            return out
        }
        val opacity = s.number("opacity")
        val highlighter = t[0] == 'h'

        if (P.size == 1) {
            c.setGlobalAlpha(if (highlighter) (opacity ?: 35.0) / 100 else 1.0)
            c.beginPath()
            c.arc(P[0].v(0), P[0].v(1), z / 2, 0.0, 7.0)
            c.fill()
            return
        }
        val pts = P
        fun path() {
            c.beginPath()
            c.moveTo(pts[0].v(0), pts[0].v(1))
            if (sharp) {
                for (q in pts) c.lineTo(q.v(0), q.v(1))
                return
            }
            for (i in 1 until pts.size - 1) {
                c.quadTo(pts[i].v(0), pts[i].v(1), (pts[i].v(0) + pts[i + 1].v(0)) / 2, (pts[i].v(1) + pts[i + 1].v(1)) / 2)
            }
            c.lineTo(pts[pts.size - 1].v(0), pts[pts.size - 1].v(1))
        }
        fun segment(i: Int, a: Double, b: Double) {
            val A = pts[i - 1]
            val B = pts[i]
            c.beginPath()
            c.moveTo(A.v(0) + (B.v(0) - A.v(0)) * a, A.v(1) + (B.v(1) - A.v(1)) * a)
            c.lineTo(A.v(0) + (B.v(0) - A.v(0)) * b, A.v(1) + (B.v(1) - A.v(1)) * b)
            c.stroke()
        }

        when {
            t == "ball" -> {
                c.setLineWidth(z)
                path()
                if (s["fill"].truthy()) {
                    c.save()
                    c.setFillColor(Colors.parse(s.string("fill")))
                    c.fill()
                    c.restore()
                }
                c.stroke()
            }
            (t == "pencil" || t == "soft") && tl -> {
                c.setGlobalAlpha(if (t == "soft") .8 else 1.0)
                if (t == "pencil") c.setStrokeGrain(color)
                if (t == "soft") c.setShadow(color, z * .6)
                for (i in 1 until pts.size) {
                    c.setLineWidth(z * (.5 + pts[i].zr(3) * 1.6))
                    for (p in parts(i)) segment(i, p[0], p[1])
                }
            }
            t == "pencil" -> {
                c.setGlobalAlpha(.5)
                c.setLineWidth(z * .9)
                path()
                c.stroke()
                c.setGlobalAlpha(1.0)
                c.setStrokeGrain(color)
                c.setLineWidth(z * 1.1)
                path()
                c.stroke()
                c.setStrokeColor(color)
            }
            t == "soft" -> {
                c.setGlobalAlpha((opacity ?: 70.0) / 100)
                c.setShadow(color, z * .9)
                c.setLineWidth(z)
                path()
                c.stroke()
            }
            t == "hch" -> chisel(c, s, pts, z)
            highlighter -> {
                c.setGlobalAlpha((opacity ?: 35.0) / 100)
                c.setLineWidth(z)
                if (t == "hsq") {
                    c.setLineCap(Canvas2D.CAP_SQUARE)
                    c.setLineJoin(Canvas2D.JOIN_MITER)
                }
                path()
                c.stroke()
            }
            else -> {
                val sens = s.number("sens") ?: Double.NaN
                for (i in 1 until pts.size) {
                    val p = pts[i - 1]
                    val q = pts[i]
                    val w0 = width(z, sens, p.v(2))
                    val w1 = width(z, sens, q.v(2))
                    if (t == "fount") {
                        c.setLineWidth((w0 + w1) / 2)
                        for (r in parts(i)) segment(i, r[0], r[1])
                    } else {
                        val ag = (s.number("ang") ?: 135.0) * PI / 180
                        val nx = cos(ag)
                        val ny = sin(ag)
                        for (r in parts(i)) {
                            val a = r[0]
                            val b = r[1]
                            val ax = p.v(0) + (q.v(0) - p.v(0)) * a
                            val ay = p.v(1) + (q.v(1) - p.v(1)) * a
                            val bx = p.v(0) + (q.v(0) - p.v(0)) * b
                            val by = p.v(1) + (q.v(1) - p.v(1)) * b
                            val wa = w0 + (w1 - w0) * a
                            val wb = w0 + (w1 - w0) * b
                            c.beginPath()
                            c.moveTo(ax + nx * wa / 2, ay + ny * wa / 2)
                            c.lineTo(bx + nx * wb / 2, by + ny * wb / 2)
                            c.lineTo(bx - nx * wb / 2, by - ny * wb / 2)
                            c.lineTo(ax - nx * wa / 2, ay - ny * wa / 2)
                            c.closePath()
                            c.fill()
                            c.setLineWidth(1.0)
                            c.stroke()
                        }
                    }
                }
            }
        }
        c.setLineDash(doubleArrayOf())
    }

    /** Chisel highlighter: the nib rectangle stamped at every point and swept along every segment, filled as one shape. */
    private fun chisel(c: Canvas2D, s: Item, P: List<DoubleArray>, z: Double) {
        val a = (s.number("ang") ?: 45.0) * PI / 180
        val nx = cos(a) * z / 2
        val ny = sin(a) * z / 2
        val th = jsMax(min(2.0, z * .5).let { if (z.isNaN()) Double.NaN else it }, z * .22) / 2
        val mx = -sin(a) * th
        val my = cos(a) * th
        val C = arrayOf(doubleArrayOf(nx + mx, ny + my), doubleArrayOf(-nx + mx, -ny + my), doubleArrayOf(-nx - mx, -ny - my), doubleArrayOf(nx - mx, ny - my))
        val polys = ArrayList<Array<DoubleArray>>()
        fun poly(q: Array<DoubleArray>) {
            var ar = 0.0
            for (i in q.indices) {
                val u = q[i]
                val v = q[(i + 1) % q.size]
                ar += u[0] * v[1] - v[0] * u[1]
            }
            if (ar < 0) q.reverse()
            polys.add(q)
        }
        for ((i, p) in P.withIndex()) {
            poly(Array(4) { j -> doubleArrayOf(p.v(0) + C[j][0], p.v(1) + C[j][1]) })
            if (i > 0) {
                val o = P[i - 1]
                for (j in 0 until 4) {
                    val k = C[j]
                    val l = C[(j + 1) % 4]
                    poly(arrayOf(
                        doubleArrayOf(o.v(0) + k[0], o.v(1) + k[1]), doubleArrayOf(p.v(0) + k[0], p.v(1) + k[1]),
                        doubleArrayOf(p.v(0) + l[0], p.v(1) + l[1]), doubleArrayOf(o.v(0) + l[0], o.v(1) + l[1]),
                    ))
                }
            }
        }
        c.setGlobalAlpha(.35)
        c.beginPath()
        for (q in polys) {
            c.moveTo(q[0][0], q[0][1])
            for (i in 1 until q.size) c.lineTo(q[i][0], q[i][1])
            c.closePath()
        }
        c.fill()
    }
}
