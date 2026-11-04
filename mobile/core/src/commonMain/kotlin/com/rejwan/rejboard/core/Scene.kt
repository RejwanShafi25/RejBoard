package com.rejwan.rejboard.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.math.max
import kotlin.math.min

/*
 * What to draw for a board, in board coordinates. The core decides how items look; each platform only rasterises these
 * primitives (Compose Canvas, SwiftUI Canvas, Direct2D). Phase 1 is a read-only preview: strokes are plain polylines and
 * images, graphs and unknown items are labelled boxes. Brush outlines come with the ink work in Phase 2.
 * Colours are 0xAARRGGBB.
 */
sealed class Prim

class ScenePolyline(val points: DoubleArray, val width: Double, val color: Long) : Prim()

class SceneRect(
    val x: Double, val y: Double, val w: Double, val h: Double,
    val stroke: Long, val fill: Long, val lineWidth: Double, val ellipse: Boolean,
) : Prim()

class SceneText(val x: Double, val y: Double, val size: Double, val color: Long, val text: String) : Prim()

class Scene(val background: Long, val prims: List<Prim>, val minX: Double, val minY: Double, val maxX: Double, val maxY: Double) {
    val isEmpty: Boolean get() = prims.isEmpty()
    val width: Double get() = maxX - minX
    val height: Double get() = maxY - minY

    /** Compact JSON for the C API (Windows): {"bg":..,"bounds":[x0,y0,x1,y1],"prims":[{"k":"line"|"rect"|"text", ...}]}. */
    fun toJson(): String = BoardJson.write(buildJsonObject {
        put("bg", background)
        put("bounds", buildJsonArray { listOf(minX, minY, maxX, maxY).forEach { add(JsonPrimitive(it)) } })
        put("prims", JsonArray(prims.map { p ->
            when (p) {
                is ScenePolyline -> buildJsonObject {
                    put("k", "line"); put("w", p.width); put("c", p.color)
                    put("p", JsonArray(p.points.map { JsonPrimitive(it) }))
                }
                is SceneRect -> buildJsonObject {
                    put("k", "rect"); put("x", p.x); put("y", p.y); put("w", p.w); put("h", p.h)
                    put("c", p.stroke); put("f", p.fill); put("lw", p.lineWidth); put("e", p.ellipse)
                }
                is SceneText -> buildJsonObject {
                    put("k", "text"); put("x", p.x); put("y", p.y); put("s", p.size); put("c", p.color); put("t", p.text)
                }
            }
        }))
    })

    companion object {
        fun of(board: Board): Scene = SceneBuilder(board).build()
    }
}

/** CSS colour (#rgb, #rgba, #rrggbb, #rrggbbaa, a few names) to 0xAARRGGBB; [fallback] when it cannot be read. */
object Colors {
    private val names: Map<String, Long> = mapOf(
        "black" to 0xFF000000, "white" to 0xFFFFFFFF, "red" to 0xFFFF0000, "green" to 0xFF008000, "blue" to 0xFF0000FF,
        "yellow" to 0xFFFFFF00, "orange" to 0xFFFFA500, "gray" to 0xFF808080, "grey" to 0xFF808080, "transparent" to 0x00000000L,
    )

    fun parse(css: String?, fallback: Long = 0xFF111111): Long {
        val s = css?.trim()?.lowercase() ?: return fallback
        names[s]?.let { return it }
        if (!s.startsWith("#")) return fallback
        val hex = s.substring(1)
        if (hex.any { it !in "0123456789abcdef" }) return fallback
        fun d(c: Char) = c.digitToInt(16).toLong()
        return when (hex.length) {
            3 -> 0xFF000000 or (d(hex[0]) * 17 shl 16) or (d(hex[1]) * 17 shl 8) or d(hex[2]) * 17
            4 -> (d(hex[3]) * 17 shl 24) or (d(hex[0]) * 17 shl 16) or (d(hex[1]) * 17 shl 8) or d(hex[2]) * 17
            6 -> 0xFF000000 or hex.toLong(16)
            8 -> (hex.substring(6).toLong(16) shl 24) or hex.substring(0, 6).toLong(16)
            else -> fallback
        }
    }

    /** [c] with its alpha multiplied by [opacity] (0..1). */
    fun withOpacity(c: Long, opacity: Double): Long {
        val a = ((c ushr 24) and 0xFF) * opacity.coerceIn(0.0, 1.0)
        return (a.toLong() shl 24) or (c and 0xFFFFFF)
    }
}

private class SceneBuilder(val board: Board) {
    val prims = mutableListOf<Prim>()
    var x0 = Double.POSITIVE_INFINITY
    var y0 = Double.POSITIVE_INFINITY
    var x1 = Double.NEGATIVE_INFINITY
    var y1 = Double.NEGATIVE_INFINITY
    val dark = Paper.isDark(board.background)
    val ink: Long = if (dark) 0xFFEEEEEE else 0xFF111111

    fun grow(x: Double, y: Double) {
        if (!x.isFinite() || !y.isFinite()) return
        x0 = min(x0, x); y0 = min(y0, y); x1 = max(x1, x); y1 = max(y1, y)
    }

    fun box(x: Double, y: Double, w: Double, h: Double) { grow(x, y); grow(x + w, y + h) }

    fun build(): Scene {
        val hidden = board.layers.filter { !it.visible }.map { it.id }.toSet()
        for (i in board.items) if (i.layer !in hidden) add(i)
        val bg = Colors.parse(Paper.color(board.background), 0xFFFFFFFF)
        if (x0 > x1) { x0 = 0.0; y0 = 0.0; x1 = 800.0; y1 = 600.0 }
        return Scene(bg, prims, x0, y0, x1, y1)
    }

    fun color(i: Item, fallback: Long = ink): Long = Colors.withOpacity(Colors.parse(i.color, fallback), i.opacity / 100.0)

    fun add(i: Item) {
        when (i.type) {
            ItemType.STROKE -> {
                val p = i.points ?: return
                val xy = DoubleArray(p.count * 2)
                for (k in 0 until p.count) { xy[2 * k] = p.x(k); xy[2 * k + 1] = p.y(k); grow(p.x(k), p.y(k)) }
                val highlighter = i.tool?.startsWith("h") == true
                val opacity = (i.number("opacity") ?: if (highlighter) 35.0 else 100.0) / 100.0
                prims += ScenePolyline(xy, i.size ?: 3.0, Colors.withOpacity(Colors.parse(i.color, ink), opacity))
            }
            ItemType.TEXT, ItemType.LINK -> {
                val size = i.size ?: 24.0
                val text = i.text ?: return
                prims += SceneText(i.x, i.y, size, color(i, if (i.type == ItemType.LINK) 0xFF2563EB else ink), text)
                box(i.x, i.y, max(i.w, text.length * size * 0.55), max(i.h, size * 1.3))
            }
            ItemType.MATH -> {
                val size = i.size ?: 24.0
                val text = i.string("srcText")?.takeIf { it.isNotEmpty() } ?: i.string("latex") ?: return
                prims += SceneText(i.x, i.y, size, color(i), text)
                box(i.x, i.y, text.length * size * 0.55, size * 1.3)
            }
            ItemType.SHAPE -> {
                val ellipse = i.shape == "ell" || i.shape == "ellipse" || i.shape == "circle"
                prims += SceneRect(i.x, i.y, i.w, i.h, color(i), i.fill?.let { Colors.parse(it, 0L) } ?: 0L, i.size ?: 2.0, ellipse)
                i.string("label")?.takeIf { it.isNotEmpty() }?.let { prims += SceneText(i.x + 6, i.y + 6, 16.0, color(i), it) }
                box(i.x, i.y, i.w, i.h)
            }
            ItemType.TAPE -> {
                prims += SceneRect(i.x, i.y, i.w, i.h, 0L, Colors.withOpacity(Colors.parse(i.color, 0xFFFFD54F), 0.6), 0.0, false)
                box(i.x, i.y, i.w, i.h)
            }
            ItemType.TABLE -> addTable(i)
            ItemType.CHECKLIST -> {
                var y = i.y
                i.string("title")?.takeIf { it.isNotEmpty() }?.let { prims += SceneText(i.x, y, 20.0, color(i), it); y += 28 }
                (i["rows"] as? JsonArray)?.forEach { r ->
                    val row = r as? JsonObject ?: return@forEach
                    val done = row["done"].truthy()
                    prims += SceneText(i.x, y, 18.0, color(i), (if (done) "☑ " else "☐ ") + (row["text"].stringOrNull() ?: ""))
                    y += 26
                }
                box(i.x, i.y, max(i.w, 200.0), y - i.y)
            }
            ItemType.IMAGE, ItemType.GRAPH -> {
                val label = if (i.type == ItemType.IMAGE) "image" else
                    (i["fns"] as? JsonArray)?.mapNotNull { (it as? JsonObject)?.get("text").stringOrNull() }?.joinToString("; ") ?: "graph"
                prims += SceneRect(i.x, i.y, i.w, i.h, 0xFF9AA4B2, 0x1F9AA4B2L, 1.0, false)
                prims += SceneText(i.x + 6, i.y + 6, 14.0, 0xFF5B6575, label)
                box(i.x, i.y, i.w, i.h)
            }
            ItemType.UNKNOWN -> {}
        }
    }

    fun addTable(i: Item) {
        val cw = (i["cw"] as? JsonArray)?.map { it.numberOrNull() ?: 0.0 } ?: return
        val rh = (i["rh"] as? JsonArray)?.map { it.numberOrNull() ?: 0.0 } ?: return
        val w = cw.sum()
        val h = rh.sum()
        val line = color(i, 0xFF5B6575)
        prims += SceneRect(i.x, i.y, w, h, line, 0L, 1.0, false)
        var cx = i.x
        for (c in cw.dropLast(1)) { cx += c; prims += ScenePolyline(doubleArrayOf(cx, i.y, cx, i.y + h), 1.0, line) }
        var ry = i.y
        for (r in rh.dropLast(1)) { ry += r; prims += ScenePolyline(doubleArrayOf(i.x, ry, i.x + w, ry), 1.0, line) }
        val fs = i.number("fs") ?: 18.0
        val cells = i["cells"] as? JsonArray
        var y = i.y
        rh.forEachIndexed { r, hgt ->
            var x = i.x
            cw.forEachIndexed { c, wid ->
                val t = ((cells?.getOrNull(r) as? JsonArray)?.getOrNull(c)).stringOrNull()
                if (!t.isNullOrEmpty()) prims += SceneText(x + 4, y + 4, min(fs, hgt * 0.7), color(i), t)
                x += wid
            }
            y += hgt
        }
        box(i.x, i.y, w, h)
    }
}
