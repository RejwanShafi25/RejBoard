package com.rejwan.rejboard.core.ink

import com.rejwan.rejboard.core.Board
import com.rejwan.rejboard.core.Item
import com.rejwan.rejboard.core.SceneBuilder
import com.rejwan.rejboard.core.ScenePolyline
import com.rejwan.rejboard.core.SceneRect
import com.rejwan.rejboard.core.SceneText
import kotlin.math.max
import kotlin.math.min

/** The visible part of the board: board point (x, y) is drawn at screen (ox + x * zoom, oy + y * zoom), like S.ox / S.oy / S.z. */
class Viewport(var ox: Double = 0.0, var oy: Double = 0.0, var zoom: Double = 1.0) {
    fun toBoardX(sx: Double): Double = (sx - ox) / zoom
    fun toBoardY(sy: Double): Double = (sy - oy) / zoom

    fun pan(dx: Double, dy: Double) {
        ox += dx
        oy += dy
    }

    /** Zooms by [factor] keeping screen point (cx, cy) over the same board point. */
    fun zoomAt(factor: Double, cx: Double, cy: Double) {
        val z = (zoom * factor).coerceIn(MIN_ZOOM, MAX_ZOOM)
        ox = cx - (cx - ox) * (z / zoom)
        oy = cy - (cy - oy) * (z / zoom)
        zoom = z
    }

    /** Shows board rectangle x0..x1, y0..y1 in a W x H view with [margin] pixels around it. */
    fun fit(x0: Double, y0: Double, x1: Double, y1: Double, W: Double, H: Double, margin: Double = 24.0) {
        val bw = max(1.0, x1 - x0)
        val bh = max(1.0, y1 - y0)
        zoom = min((W - 2 * margin) / bw, (H - 2 * margin) / bh).coerceIn(.05, 4.0)
        ox = margin - x0 * zoom
        oy = margin - y0 * zoom
    }

    companion object {
        /** ZMIN in index.html */
        const val MIN_ZOOM = .01
        const val MAX_ZOOM = 20.0
    }
}

/**
 * Paints board items in board coordinates: ink strokes with [StrokePainter] (the desktop's brushes), everything else with
 * the Phase 1 scene shapes (text, shapes, tables, checklists, labelled boxes for images and graphs). Items on hidden
 * layers are skipped. Each item is drawn inside save()/restore(), so one stroke's alpha or glow never leaks into the next.
 */
object BoardPainter {
    fun paint(c: Canvas2D, board: Board, items: List<Item>) {
        val hidden = board.layers.filter { !it.visible }.map { it.id }.toSet()
        val scene = SceneBuilder(board)
        for (i in items) {
            if (i.layer in hidden) continue
            paintItem(c, i, scene)
        }
    }

    internal fun paintItem(c: Canvas2D, i: Item, scene: SceneBuilder) {
        c.save()
        if (i.code == "s") StrokePainter.paint(c, i)
        else {
            scene.prims.clear()
            scene.add(i)
            for (p in scene.prims) prim(c, p)
        }
        c.restore()
    }

    private fun prim(c: Canvas2D, p: com.rejwan.rejboard.core.Prim) {
        when (p) {
            is ScenePolyline -> {
                val a = p.points
                if (a.size < 2) return
                c.setStrokeColor(p.color)
                c.setLineWidth(p.width)
                c.setLineCap(Canvas2D.CAP_ROUND)
                c.setLineJoin(Canvas2D.JOIN_ROUND)
                c.beginPath()
                c.moveTo(a[0], a[1])
                var k = 2
                while (k + 1 < a.size) { c.lineTo(a[k], a[k + 1]); k += 2 }
                c.stroke()
            }
            is SceneRect -> {
                c.beginPath()
                if (p.ellipse) ellipse(c, p.x + p.w / 2, p.y + p.h / 2, p.w / 2, p.h / 2) else c.rect(p.x, p.y, p.w, p.h)
                if ((p.fill ushr 24) != 0L) { c.setFillColor(p.fill); c.fill() }
                if ((p.stroke ushr 24) != 0L && p.lineWidth > 0) { c.setStrokeColor(p.stroke); c.setLineWidth(p.lineWidth); c.stroke() }
            }
            is SceneText -> {
                c.setFillColor(p.color)
                c.fillText(p.text, p.x, p.y, p.size, Canvas2D.FONT_SANS, 0, 0)
            }
        }
    }

    /** An ellipse as four cubic Beziers (Canvas2D has only circular arcs). */
    private fun ellipse(c: Canvas2D, cx: Double, cy: Double, rx: Double, ry: Double) {
        val k = .5522847498
        c.moveTo(cx + rx, cy)
        c.bezierTo(cx + rx, cy + ry * k, cx + rx * k, cy + ry, cx, cy + ry)
        c.bezierTo(cx - rx * k, cy + ry, cx - rx, cy + ry * k, cx - rx, cy)
        c.bezierTo(cx - rx, cy - ry * k, cx - rx * k, cy - ry, cx, cy - ry)
        c.bezierTo(cx + rx * k, cy - ry, cx + rx, cy - ry * k, cx + rx, cy)
        c.closePath()
    }
}
