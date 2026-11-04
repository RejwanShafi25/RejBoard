package com.rejwan.rejboard.core.ink

/**
 * The stroke being drawn, painted a piece at a time onto a wet layer that keeps its pixels between frames (Android's
 * front buffer, an iOS bitmap, a Direct2D bitmap). Repainting the whole stroke on every pen sample made long fountain and
 * calligraphy strokes lag; this paints each segment once.
 *
 * Only brushes drawn segment by segment ([incremental]: fountain, calligraphy, tilt-shaded pencil and soft brush) work
 * this way. A smoothed segment is final once the point after it is known (Catmull-Rom looks one point ahead), so
 * [paintNew] paints the final segments and [paintTail] the provisional rest, which callers draw on a layer they clear
 * every frame (or, on a layer that keeps pixels, accept until the stroke is committed and redrawn exactly).
 * Other brushes (ballpoint, pencil, soft brush, highlighters) are one path with one alpha: repaint them whole with
 * [StrokePainter.paintRows], which is cheap for a single path.
 */
class WetStroke(val style: StrokeStyle) {
    private val plan = StrokePainter.Plan(style)
    private val pts = ArrayList<DoubleArray>()
    private var D = DoubleArray(0)
    private var rawDone = 0
    private var painted = 1

    val incremental: Boolean get() = plan.segmented

    /** Number of segments painted so far (for tests). */
    val paintedSegments: Int get() = painted - 1

    private fun convert(raw: List<DoubleArray>, ended: Boolean) {
        val n = raw.size
        if (n == 0) return
        if (pts.isEmpty()) pts.add(raw[0])
        val smooth = plan.smoothed && n > 2
        // raw segment i (raw[i] -> raw[i + 1]) is final when its points are: smoothing also needs raw[i + 2]
        val last = when {
            ended -> n - 2
            plan.smoothed -> n - 3
            else -> n - 2
        }
        if (plan.smoothed && !smooth && !ended) return // the desktop smooths only strokes of 3+ points: wait for the third
        while (rawDone <= last) {
            if (smooth) StrokePainter.smoothSegment(raw, rawDone, pts) else pts.add(raw[rawDone + 1])
            rawDone++
        }
        D = plan.distances(pts, D)
    }

    /** Paints the segments that became final since the last call ([ended]: the pen has lifted, everything is final). */
    fun paintNew(c: Canvas2D, raw: List<DoubleArray>, ended: Boolean = false) {
        if (!incremental) return
        convert(raw, ended)
        if (painted >= pts.size) return
        c.save()
        plan.prelude(c)
        plan.segmentPrelude(c)
        for (i in painted until pts.size) plan.segment(c, pts, D, i)
        c.restore()
        painted = pts.size
    }

    /** Paints the provisional end of the stroke: from the last final point through the newest points and [extra] rows. */
    fun paintTail(c: Canvas2D, raw: List<DoubleArray>, extra: List<DoubleArray> = emptyList()) {
        if (!incremental || raw.isEmpty()) return
        val tail = ArrayList<DoubleArray>()
        tail.add(if (pts.isEmpty()) raw[0] else pts[pts.size - 1])
        for (k in rawDone + 1 until raw.size) tail.add(raw[k])
        tail.addAll(extra)
        if (tail.size < 2) return
        val d0 = if (D.isEmpty()) 0.0 else D[D.size - 1]
        val TD = plan.distances(tail, doubleArrayOf(d0))
        c.save()
        plan.prelude(c)
        plan.segmentPrelude(c)
        for (i in 1 until tail.size) plan.segment(c, tail, TD, i)
        c.restore()
    }
}
