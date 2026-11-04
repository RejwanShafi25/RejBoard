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
        for (i in 0 until P.size - 1) smoothSegment(P, i, out)
        return out
    }

    /** Pen width at pressure p (wd in index.html). */
    fun width(size: Double, sens: Double, p: Double): Double = jsMax(.6, size * (1 - sens + sens * 2 * p))

    /** Math.max: NaN wins, as in JavaScript. */
    private fun jsMax(a: Double, b: Double): Double = if (a.isNaN() || b.isNaN()) Double.NaN else max(a, b)

    /** Draws a stored stroke item. */
    fun paint(c: Canvas2D, s: Item) {
        val st = StrokeStyle.of(s) ?: return
        paintRows(c, st, s.rows)
    }

    /** Draws a stroke from its style and point rows (the stroke being drawn uses this, with no JSON in between). */
    fun paintRows(c: Canvas2D, st: StrokeStyle, rows: List<DoubleArray>) {
        if (rows.isEmpty()) return
        val t = st.tool
        val P = if ((t == "fount" || t == "calli") && !st.sharp && rows.size > 2) smoothPts(rows) else rows
        val plan = Plan(st)
        plan.prelude(c)
        val z = st.size
        val color = plan.color
        val D = plan.distances(P)
        val opacity = st.opacity
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
            if (st.sharp) {
                for (q in pts) c.lineTo(q.v(0), q.v(1))
                return
            }
            for (i in 1 until pts.size - 1) {
                c.quadTo(pts[i].v(0), pts[i].v(1), (pts[i].v(0) + pts[i + 1].v(0)) / 2, (pts[i].v(1) + pts[i + 1].v(1)) / 2)
            }
            c.lineTo(pts[pts.size - 1].v(0), pts[pts.size - 1].v(1))
        }

        when {
            t == "ball" -> {
                c.setLineWidth(z)
                path()
                if (st.fillOn) {
                    c.save()
                    c.setFillColor(Colors.parse(st.fill))
                    c.fill()
                    c.restore()
                }
                c.stroke()
            }
            plan.segmented -> {
                plan.segmentPrelude(c)
                for (i in 1 until pts.size) plan.segment(c, pts, D, i)
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
            t == "hch" -> chisel(c, st.ang, pts, z)
            else -> { // the other highlighters
                c.setGlobalAlpha((opacity ?: 35.0) / 100)
                c.setLineWidth(z)
                if (t == "hsq") {
                    c.setLineCap(Canvas2D.CAP_SQUARE)
                    c.setLineJoin(Canvas2D.JOIN_MITER)
                }
                path()
                c.stroke()
            }
        }
        c.setLineDash(doubleArrayOf())
    }

    /**
     * How a stroke's style turns into canvas calls: the shared start (colours, caps, dashes) and, for the brushes drawn
     * segment by segment (fountain, calligraphy, tilt-shaded pencil and soft brush, unknown tools), one segment at a
     * time. [paintRows] and [WetStroke] both use it, so the stroke being drawn and the stored one come from the same code.
     */
    class Plan(val st: StrokeStyle) {
        val color: Long = Colors.parse(st.color)
        private val z = st.size
        private val t = st.tool
        private val pat: DoubleArray
        private val tot: Double
        private val seg: Boolean
        private val sharpCorners = (st.cornerType?.takeIf { it.isNotEmpty() } ?: "rounded") == "sharp"
        private val tilted = (t == "pencil" || t == "soft") && st.tl

        /** Drawn segment by segment: each segment depends only on its two end points. */
        val segmented: Boolean = tilted || !(t == "ball" || t == "pencil" || t == "soft" || t.startsWith("h"))

        /** Fountain and calligraphy pens are smoothed (Catmull-Rom) before drawing. */
        val smoothed: Boolean = (t == "fount" || t == "calli") && !st.sharp

        init {
            val lt = st.lineType?.takeIf { it.isNotEmpty() } ?: "solid"
            val dk = if (st.pl) jsMax(1.0, z / 4) else 1.0
            pat = (DASHES[lt] ?: doubleArrayOf()).map { it * dk }.toDoubleArray()
            tot = pat.sum()
            seg = st.pl && tot > 0 && (t == "fount" || t == "calli" || tilted)
        }

        /** Colour, caps, joins and dash (the start of the desktop's stroke()). */
        fun prelude(c: Canvas2D) {
            c.setFillColor(color)
            c.setStrokeColor(color)
            c.setLineCap(if (sharpCorners) Canvas2D.CAP_BUTT else Canvas2D.CAP_ROUND)
            c.setLineJoin(if (sharpCorners) Canvas2D.JOIN_MITER else Canvas2D.JOIN_ROUND)
            c.setLineDash(if (seg) doubleArrayOf() else pat)
        }

        /** Alpha, grain or glow before the segments of a tilt-shaded pencil or soft brush. */
        fun segmentPrelude(c: Canvas2D) {
            if (!tilted) return
            c.setGlobalAlpha(if (t == "soft") .8 else 1.0)
            if (t == "pencil") c.setStrokeGrain(color)
            if (t == "soft") c.setShadow(color, z * .6)
        }

        /** Distance along the points, for dash patterns. */
        fun distances(P: List<DoubleArray>): DoubleArray = distances(P, DoubleArray(0))

        /** [D] (distances of the first D.size points) extended to all of [P]. */
        fun distances(P: List<DoubleArray>, D: DoubleArray): DoubleArray {
            if (D.size >= P.size) return D
            val out = D.copyOf(P.size)
            if (seg) for (i in maxOf(1, D.size) until P.size) out[i] = out[i - 1] + hypot(P[i].v(0) - P[i - 1].v(0), P[i].v(1) - P[i - 1].v(1))
            return out
        }

        private val whole = listOf(doubleArrayOf(0.0, 1.0))

        private fun parts(D: DoubleArray, i: Int): List<DoubleArray> {
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

        /** Segment i (from point i - 1 to point i), exactly as one turn of the desktop's loop. */
        fun segment(c: Canvas2D, pts: List<DoubleArray>, D: DoubleArray, i: Int) {
            val p = pts[i - 1]
            val q = pts[i]
            if (tilted) {
                c.setLineWidth(z * (.5 + q.zr(3) * 1.6))
                for (r in parts(D, i)) line(c, p, q, r[0], r[1])
                return
            }
            val w0 = width(z, st.sens, p.v(2))
            val w1 = width(z, st.sens, q.v(2))
            if (t == "fount") {
                c.setLineWidth((w0 + w1) / 2)
                for (r in parts(D, i)) line(c, p, q, r[0], r[1])
                return
            }
            val ag = (st.ang ?: 135.0) * PI / 180
            val nx = cos(ag)
            val ny = sin(ag)
            for (r in parts(D, i)) {
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

        private fun line(c: Canvas2D, A: DoubleArray, B: DoubleArray, a: Double, b: Double) {
            c.beginPath()
            c.moveTo(A.v(0) + (B.v(0) - A.v(0)) * a, A.v(1) + (B.v(1) - A.v(1)) * a)
            c.lineTo(A.v(0) + (B.v(0) - A.v(0)) * b, A.v(1) + (B.v(1) - A.v(1)) * b)
            c.stroke()
        }
    }

    /** The points smoothPts adds for raw segment i (from P[i] to P[i + 1]), ending with P[i + 1]. */
    fun smoothSegment(P: List<DoubleArray>, i: Int, out: MutableList<DoubleArray>) {
        val n = P.size
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

    /** Chisel highlighter: the nib rectangle stamped at every point and swept along every segment, filled as one shape. */
    private fun chisel(c: Canvas2D, ang: Double?, P: List<DoubleArray>, z: Double) {
        val a = (ang ?: 45.0) * PI / 180
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

/** What [StrokePainter] reads from a stroke item (everything except its points). */
class StrokeStyle(
    val tool: String,
    val size: Double,
    val color: String?,
    /** pressure sensitivity (sens); NaN when missing, as the desktop would compute */
    val sens: Double,
    val ang: Double?,
    val opacity: Double?,
    val tl: Boolean,
    val pl: Boolean,
    val lineType: String?,
    val cornerType: String?,
    val sharp: Boolean,
    val fillOn: Boolean = false,
    val fill: String? = null,
) {
    companion object {
        fun of(s: Item): StrokeStyle? {
            val tool = s.string("tool") ?: return null
            return StrokeStyle(
                tool, s.number("size") ?: Double.NaN, s.string("color"), s.number("sens") ?: Double.NaN, s.number("ang"), s.number("opacity"),
                s["tl"].truthy(), s["pl"].truthy(), s["lineType"].stringOrNull(), s["cornerType"].stringOrNull(), s["sharp"].truthy(),
                s["fill"].truthy(), s.string("fill"),
            )
        }
    }
}
