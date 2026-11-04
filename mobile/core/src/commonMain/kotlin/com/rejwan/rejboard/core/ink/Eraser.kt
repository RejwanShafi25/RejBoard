package com.rejwan.rejboard.core.ink

import com.rejwan.rejboard.core.Item
import kotlinx.serialization.json.JsonArray
import kotlin.math.ceil
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/** Geometry helpers shared by the eraser and hit-testing (ds / strokeNear in the desktop code). */
object InkGeometry {
    /** Distance from point (px, py) to the segment a-b. */
    fun segmentDistance(px: Double, py: Double, ax: Double, ay: Double, bx: Double, by: Double): Double {
        val dx = bx - ax
        val dy = by - ay
        val l = dx * dx + dy * dy
        val t = if (l != 0.0) max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / l)) else 0.0
        return hypot(px - ax - t * dx, py - ay - t * dy)
    }

    /** x0, y0, x1, y1 of a stroke's points (NaNs are skipped, as in the desktop's comparisons). */
    fun bounds(pts: List<DoubleArray>): DoubleArray {
        var x0 = 1e18; var y0 = 1e18; var x1 = -1e18; var y1 = -1e18
        for (q in pts) {
            val x = q.getOrElse(0) { Double.NaN }
            val y = q.getOrElse(1) { Double.NaN }
            if (x < x0) x0 = x
            if (x > x1) x1 = x
            if (y < y0) y0 = y
            if (y > y1) y1 = y
        }
        return doubleArrayOf(x0, y0, x1, y1)
    }

    /** board-core.js strokeNear(): could a circle of radius [r] at (px, py) touch this stroke? Never wrongly says no. */
    fun strokeNear(box: DoubleArray, size: Double?, px: Double, py: Double, r: Double): Boolean {
        val s = size?.takeIf { it != 0.0 && !it.isNaN() } ?: 4.0
        val m = r + s / 2 + 2
        return px >= box[0] - m && px <= box[2] + m && py >= box[1] - m && py <= box[3] + m
    }

    /** Index of the topmost stroke within [r] of (px, py), or -1. */
    fun strokeAt(items: List<Item>, px: Double, py: Double, r: Double): Int {
        for (k in items.indices.reversed()) {
            val i = items[k]
            if (i.code != "s") continue
            val P = i.rows
            if (P.isEmpty()) continue
            val reach = r + (i.size ?: 0.0) / 2
            if (P.size == 1) { if (hypot(P[0][0] - px, P[0][1] - py) < reach) return k; continue }
            for (j in 1 until P.size) if (segmentDistance(px, py, P[j - 1][0], P[j - 1][1], P[j][0], P[j][1]) < reach) return k
        }
        return -1
    }
}

/**
 * The pressure-sensitive eraser, ported from index.html (erase, eraseMove, erPress). It sweeps every input sample and the
 * gaps between them, so a fast swipe never skips ink; with a pen, harder pressure makes it wider (0.35x .. 1.65x).
 * Partial mode cuts strokes where it touches; [whole] removes whole strokes. Phase 2 erases ink strokes only: shapes,
 * tape and other items are left alone (the desktop's shape and tape hit-tests come with the editing phase).
 */
class Eraser(
    /** diameter (cfg.erase.size), 0.5..80 */
    var size: Double = 16.0,
    var whole: Boolean = false,
    /** "Only highlighter" (S.eraseOnly == 'hl') */
    var onlyHighlighter: Boolean = false,
    /** Settings > Pressure sensitivity */
    var pressureOn: Boolean = true,
) {
    private var lastX = 0.0
    private var lastY = 0.0
    private var hasLast = false
    private var lastPr = 0.0
    private var pr = 1.0

    /** Starts a new eraser gesture. */
    fun begin() {
        hasLast = false
        lastPr = 0.0
    }

    /** erPress(): eraser width factor for a sample. */
    fun pressureFactor(s: InkSample): Double =
        if ((s.tool == InkTool.PEN || s.tool == InkTool.ERASER) && pressureOn && s.pressure > 0) min(1.65, .35 + s.pressure * 1.3) else 1.0

    /** eraseMove(): erases along [samples] (the coalesced samples of one move). Returns true when the board changed. */
    fun move(items: MutableList<Item>, samples: List<InkSample>, editable: (Item) -> Boolean = { true }): Boolean {
        if (samples.isEmpty()) return false
        val prs = samples.map(::pressureFactor)
        var ax = lastX
        var ay = lastY
        var has = hasLast
        var pa = if (lastPr != 0.0) lastPr else prs[0]
        var changed = false
        for ((k, q) in samples.withIndex()) {
            val sx = if (has) ax else q.x
            val sy = if (has) ay else q.y
            val d = hypot(q.x - sx, q.y - sy)
            val pb = prs[k]
            val step = max(.3, size * .35 * min(pa, pb))
            val n = min(120.0, max(1.0, ceil(d / step))).toInt()
            for (i in 1..n) {
                val t = i.toDouble() / n
                pr = pa + (pb - pa) * t
                if (erase(items, sx + (q.x - sx) * t, sy + (q.y - sy) * t, editable)) changed = true
            }
            ax = q.x
            ay = q.y
            has = true
            pa = pb
        }
        lastX = ax
        lastY = ay
        hasLast = has
        lastPr = pa
        return changed
    }

    /** erase(): one eraser dab at (px, py) with the current pressure. [editable] is act() (visible, unlocked layer). */
    fun erase(items: MutableList<Item>, px: Double, py: Double, editable: (Item) -> Boolean = { true }): Boolean {
        val r = size / 2 * pr
        var changed = false
        val out = ArrayList<Item>(items.size + 4)
        for (i in items) {
            if (i.code != "s" || !editable(i) || (onlyHighlighter && i.tool?.startsWith("h") != true)) { out.add(i); continue }
            val P = i.rows
            if (P.isNotEmpty() && !InkGeometry.strokeNear(i.box, i.size, px, py, r)) { out.add(i); continue }
            val reach = r + (i.size ?: Double.NaN) / 2
            if (whole) {
                if (P.any { hypot(it[0] - px, it[1] - py) < reach }) changed = true else out.add(i)
                continue
            }
            if (P.size < 2) {
                if (P.isEmpty() || hypot(P[0][0] - px, P[0][1] - py) >= reach) out.add(i) else changed = true
                continue
            }
            val raw = i["pts"] as JsonArray
            var run = ArrayList<kotlinx.serialization.json.JsonElement>()
            var cut = false
            for (j in P.indices) {
                val q = P[j]
                val hitPoint = hypot(q[0] - px, q[1] - py) < reach
                val hitSeg = j > 0 && InkGeometry.segmentDistance(px, py, P[j - 1][0], P[j - 1][1], q[0], q[1]) < reach
                if (hitPoint || hitSeg) {
                    cut = true
                    if (run.isNotEmpty()) { out.add(i.with("pts", JsonArray(run))); run = ArrayList() }
                } else run.add(raw[j])
            }
            if (!cut) { out.add(i); continue }
            changed = true
            if (run.isNotEmpty()) out.add(i.with("pts", JsonArray(run)))
        }
        if (changed) {
            items.clear()
            items.addAll(out)
        }
        return changed
    }
}
