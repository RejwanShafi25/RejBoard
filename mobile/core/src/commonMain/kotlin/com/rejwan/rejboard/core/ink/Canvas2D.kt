package com.rejwan.rejboard.core.ink

/**
 * The drawing calls the desktop app makes on its HTML canvas, as an interface. The ink code in the core (brush strokes,
 * paper patterns, board items) is a direct port of index.html written against this interface, so it issues the same
 * calls with the same numbers as the desktop (the golden tests compare the two call logs).
 *
 * Each platform implements it once over its own 2D API (Android Canvas, Core Graphics, Direct2D), or replays a
 * recorded [DrawList]. Semantics follow CanvasRenderingContext2D: one current path, current transform, state stack.
 * Colours are 0xAARRGGBB.
 */
interface Canvas2D {
    fun save()
    fun restore()
    fun translate(x: Double, y: Double)
    fun scale(x: Double, y: Double)

    fun beginPath()
    fun moveTo(x: Double, y: Double)
    fun lineTo(x: Double, y: Double)
    fun quadTo(cx: Double, cy: Double, x: Double, y: Double)
    fun bezierTo(c1x: Double, c1y: Double, c2x: Double, c2y: Double, x: Double, y: Double)
    /** Circle arc; the desktop draws full circles as arc(x, y, r, 0, 7). */
    fun arc(x: Double, y: Double, r: Double, a0: Double, a1: Double)
    fun rect(x: Double, y: Double, w: Double, h: Double)
    fun closePath()

    /** Fills the current path (non-zero winding). */
    fun fill()
    fun stroke()
    fun clip()
    fun fillRect(x: Double, y: Double, w: Double, h: Double)

    fun setFillColor(argb: Long)
    fun setStrokeColor(argb: Long)
    /** Pencil graphite: strokes use a fine speckle of [argb] (the desktop's pencilGrain pattern). */
    fun setStrokeGrain(argb: Long)
    fun setLineWidth(w: Double)
    fun setLineCap(cap: Int)
    fun setLineJoin(join: Int)
    /** Dash lengths in user units; empty = solid. */
    fun setLineDash(dash: DoubleArray)
    fun setGlobalAlpha(a: Double)
    /** Shadow under everything drawn next (the desktop uses it as a soft glow: offset 0). blur 0 = none. */
    fun setShadow(argb: Long, blur: Double)

    /** Text at (x, y) in the fill colour. [font]: 0 sans, 1 serif bold. [align]: 0 left, 1 centre. [baseline]: 0 top, 1 middle. */
    fun fillText(text: String, x: Double, y: Double, size: Double, font: Int, align: Int, baseline: Int)

    companion object {
        const val CAP_BUTT = 0
        const val CAP_ROUND = 1
        const val CAP_SQUARE = 2
        const val JOIN_MITER = 0
        const val JOIN_ROUND = 1
        const val FONT_SANS = 0
        const val FONT_SERIF_BOLD = 1
    }
}
