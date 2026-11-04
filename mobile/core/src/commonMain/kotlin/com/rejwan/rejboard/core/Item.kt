package com.rejwan.rejboard.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/** Item kinds of a desktop board (`t` field). Anything else is [UNKNOWN] and is still kept and written back unchanged. */
enum class ItemType(val code: String) {
    STROKE("s"),
    TEXT("t"),
    LINK("l"),
    IMAGE("i"),
    MATH("m"),
    TAPE("k"),
    SHAPE("sp"),
    TABLE("tb"),
    GRAPH("gr"),
    CHECKLIST("ck"),
    UNKNOWN("");

    companion object {
        private val byCode = entries.associateBy { it.code }
        fun of(code: String?): ItemType = code?.let { byCode[it] }?.takeIf { it != UNKNOWN } ?: UNKNOWN
    }
}

/**
 * One board item. It wraps the item's JSON object exactly as the desktop app stores it, so every field this code does not
 * know about (and every number's original text) survives a read and write. Items are immutable: an edit makes a new item,
 * which is what lets undo snapshots share items instead of copying them.
 */
class Item(val raw: JsonObject) {
    val type: ItemType get() = ItemType.of(raw["t"].stringOrNull())
    /** The raw `t` code, also for unknown kinds. */
    val code: String? get() = raw["t"].stringOrNull()

    operator fun get(key: String): JsonElement? = raw[key]
    fun string(key: String): String? = raw[key].stringOrNull()
    fun number(key: String): Double? = raw[key].numberOrNull()

    val x: Double get() = number("x") ?: 0.0
    val y: Double get() = number("y") ?: 0.0
    val w: Double get() = number("w") ?: 0.0
    val h: Double get() = number("h") ?: 0.0
    val rot: Double get() = number("rot") ?: 0.0
    /** Layer id (`ly`), 1 when missing. */
    val layer: Int get() = number("ly")?.let { jsInt32(it) } ?: 1
    val color: String? get() = string("color")
    val fill: String? get() = string("fill")
    /** Line width / font size. */
    val size: Double? get() = number("size")
    /** 0..100, 100 when missing. */
    val opacity: Double get() = number("opacity") ?: 100.0
    /** Brush of a stroke: fount, calli, soft, ball, pencil, hrd (highlighter) ... */
    val tool: String? get() = string("tool")
    /** Shape kind of a shape item (`shp`). */
    val shape: String? get() = string("shp")
    val text: String? get() = string("text")

    /** A stroke's points as stored, one row per point (rows may differ in length; non-numbers are NaN). Cached: items are immutable. */
    val rows: List<DoubleArray> by lazy { com.rejwan.rejboard.core.ink.StrokePainter.points(this) }

    /** Bounding box x0, y0, x1, y1 of [rows] (cached). */
    val box: DoubleArray by lazy { com.rejwan.rejboard.core.ink.InkGeometry.bounds(rows) }

    /** A stroke's points (null when the item has none or they are not clean numeric tuples). */
    val points: PackedPoints? by lazy { Points.flatten(raw["pts"]) }

    /** This item with one field set; an existing field keeps its position, a new one goes last (as in JavaScript). */
    fun with(key: String, value: JsonElement): Item = Item(JsonObject(LinkedHashMap(raw).apply { put(key, value) }))

    fun without(key: String): Item = if (key in raw) Item(JsonObject(LinkedHashMap(raw).apply { remove(key) })) else this

    fun toJson(): String = BoardJson.write(raw)

    override fun equals(other: Any?): Boolean = other is Item && other.raw == raw
    override fun hashCode(): Int = raw.hashCode()
    override fun toString(): String = "Item(${code ?: "?"})"

    companion object {
        fun parse(json: String): Item = Item(BoardJson.parse(json) as JsonObject)
        fun listFrom(array: JsonElement?): List<Item> = (array as? JsonArray)?.mapNotNull { (it as? JsonObject)?.let(::Item) } ?: emptyList()
    }
}

/** A board layer (`{id, name, vis, lock}`); unknown fields are kept. */
class Layer(val raw: JsonObject) {
    val id: Int get() = raw["id"].numberOrNull()?.let { jsInt32(it) } ?: 0
    val name: String get() = raw["name"].stringOrNull() ?: ""
    val visible: Boolean get() = raw["vis"].truthy()
    val locked: Boolean get() = raw["lock"].truthy()

    override fun equals(other: Any?): Boolean = other is Layer && other.raw == raw
    override fun hashCode(): Int = raw.hashCode()

    companion object {
        /** The layer a new desktop board starts with. */
        val DEFAULT: Layer = Layer(BoardJson.parse("""{"id":1,"name":"Layer 1","vis":1,"lock":0}""") as JsonObject)
    }
}
