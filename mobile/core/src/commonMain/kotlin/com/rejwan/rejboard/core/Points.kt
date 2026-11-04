package com.rejwan.rejboard.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement

/** A stroke's points in one flat array: [x, y, pressure, tilt, ...] repeated, `width` values per point. */
class PackedPoints(val values: DoubleArray, val width: Int) {
    val count: Int get() = values.size / width
    fun x(i: Int): Double = values[i * width]
    fun y(i: Int): Double = values[i * width + 1]
    /** Pressure of point i (third value), or [default] for strokes recorded without it. */
    fun pressure(i: Int, default: Double = 0.5): Double = if (width > 2) values[i * width + 2] else default
}

/** Point packing, ported from board-core.js (flatten / inflate). */
object Points {
    const val MAX_W = 8 // widest point tuple the desktop app packs

    /** The stroke's points, or null when [pts] is not a clean array of equal-length numeric tuples (same rules as board-core.js). */
    fun flatten(pts: JsonElement?): PackedPoints? {
        if (pts !is JsonArray || pts.isEmpty() || pts[0] !is JsonArray) return null
        val w = (pts[0] as JsonArray).size
        if (w <= 0 || w > MAX_W) return null
        val f = DoubleArray(pts.size * w)
        var o = 0
        for (q in pts) {
            if (q !is JsonArray || q.size != w) return null
            for (v in q) f[o++] = v.numberOrNull() ?: return null
        }
        return PackedPoints(f, w)
    }

    /** Inverse of [flatten]: null for data that cannot be a valid packed stroke. */
    fun inflate(f: DoubleArray?, w: Int): List<DoubleArray>? {
        if (w <= 0 || w > MAX_W || f == null || f.size % w != 0) return null
        return List(f.size / w) { j -> f.copyOfRange(j * w, j * w + w) }
    }
}
