package com.rejwan.rejboard.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/** Page setup (`pg`): size is "inf" for an endless board, else "a4", "letter", "pdf" ...; o is "p" (portrait) or "l". */
class PageSetup(val raw: JsonObject?) {
    val size: String get() = raw?.get("size").stringOrNull() ?: "inf"
    val orientation: String get() = raw?.get("o").stringOrNull() ?: "p"
    val count: Int get() = raw?.get("n").numberOrNull()?.let { jsInt32(it) } ?: 1
    val width: Double? get() = raw?.get("w").numberOrNull()
    val height: Double? get() = raw?.get("h").numberOrNull()
    val isInfinite: Boolean get() = size == "inf"
}

/**
 * A whole board: the JSON object inside a .rjwb file (title, items, bg, pat, gs, gd, layers, tags, pg, recs, src, linked ...)
 * or a stored record. Every field, known or not, is kept in [raw] and written back unchanged.
 */
class Board(val raw: JsonObject) {
    val title: String get() = raw["title"].stringOrNull() ?: "Untitled"
    /** Items in drawing order (entries that are not objects are skipped here but still kept in [raw]). */
    val items: List<Item> by lazy { Item.listFrom(raw["items"]) }
    /** Paper colour name (white, cream, gray, mint, sky, blush, black, slate, navy, forest) or a CSS colour. */
    val background: String get() = raw["bg"].stringOrNull() ?: "white"
    /** Paper pattern: plain, lines, grid, dots, ... */
    val pattern: String get() = raw["pat"].stringOrNull() ?: "plain"
    val gridSize: Double get() = raw["gs"].numberOrNull()?.takeIf { it != 0.0 } ?: 28.0
    val gridDot: Double get() = raw["gd"].numberOrNull()?.takeIf { it != 0.0 } ?: 1.5
    val layers: List<Layer>
        get() = (raw["layers"] as? JsonArray)?.mapNotNull { (it as? JsonObject)?.let(::Layer) }?.takeIf { it.isNotEmpty() } ?: listOf(Layer.DEFAULT)
    val tags: String get() = raw["tags"].stringOrNull() ?: ""
    val page: PageSetup get() = PageSetup(raw["pg"] as? JsonObject)
    /** The id the board had in the app that wrote the file (`src`), if any. */
    val sourceId: String? get() = raw["src"].stringOrNull()?.takeIf { it.isNotEmpty() }
    /** Password-protected: the content is encrypted in `enc` (same test as VaultCore.isProtected). */
    val isProtected: Boolean get() = raw["enc"] is JsonObject
    /** Boards that travelled with this one in the file (`linked`). */
    val linked: List<Board> get() = (raw["linked"] as? JsonArray)?.mapNotNull { (it as? JsonObject)?.let(::Board) } ?: emptyList()

    /** This board with one top-level field set (existing fields keep their position). */
    fun with(key: String, value: JsonElement): Board = Board(JsonObject(LinkedHashMap(raw).apply { put(key, value) }))

    fun withItems(items: List<Item>): Board = with("items", JsonArray(items.map { it.raw }))

    fun toJson(): String = BoardJson.write(raw)

    override fun equals(other: Any?): Boolean = other is Board && other.raw == raw
    override fun hashCode(): Int = raw.hashCode()

    companion object {
        fun parse(json: String): Board =
            Board(BoardJson.parse(json) as? JsonObject ?: throw RjwbException("A board must be a JSON object"))
    }
}

/** Paper colours of the desktop app (PAP in index.html). */
object Paper {
    val colors: Map<String, String> = mapOf(
        "white" to "#ffffff", "cream" to "#fbf5e6", "gray" to "#dfe3e8", "mint" to "#e6f4ea", "sky" to "#e5effa",
        "blush" to "#fbe8ee", "black" to "#111111", "slate" to "#1e2430", "navy" to "#14213d", "forest" to "#173027",
    )
    private val dark = setOf("black", "slate", "navy", "forest")

    fun color(bg: String): String = colors[bg] ?: bg
    fun isDark(bg: String): Boolean = bg in dark
}
