package com.rejwan.rejboard.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/** Searchable text of a board: [q] is everything typed, [pq] the text of imported PDF pages. */
data class SearchText(val q: String, val pq: String)

/** Board index helpers, ported from board-core.js (searchText, metaOf, pickStart). */
object BoardIndex {
    const val Q_MAX = 20000
    const val PQ_MAX = 40000

    private val runs = Regex("[$JS_WS]+")
    private fun squash(s: String): String = jsTrim(s.replace(runs, " "))

    /**
     * Text, sticky notes, LaTeX, shape labels, table cells, graph formulas and checklists go to q; PDF page text to pq.
     * Kept apart so a long PDF never pushes the board's own notes out of the index.
     */
    fun searchText(items: JsonElement?): SearchText {
        val q = mutableListOf<String>()
        val pq = mutableListOf<String>()
        var nq = 0
        var np = 0
        fun add(a: MutableList<String>, s: JsonElement?, cap: Int, n: Int): Int {
            if (s == null || s == kotlinx.serialization.json.JsonNull || n >= cap) return n
            val t = squash(jsString(s))
            if (t.isEmpty()) return n
            a.add(t)
            return n + t.length + 1
        }
        for (e in items as? JsonArray ?: JsonArray(emptyList())) {
            val i = e as? JsonObject ?: continue
            nq = add(q, listOf(i["srcText"], i["text"]).firstOrNull { it.truthy() } ?: i["latex"], Q_MAX, nq)
            if (i["label"].truthy()) nq = add(q, i["label"], Q_MAX, nq)
            (i["cells"] as? JsonArray)?.forEach { r -> (r as? JsonArray)?.forEach { c -> c.stringOrNull()?.takeIf { it.isNotEmpty() }?.let { nq = add(q, c, Q_MAX, nq) } } }
            (i["fns"] as? JsonArray)?.forEach { f -> if (f.truthy() && (f as? JsonObject)?.get("text").truthy()) nq = add(q, (f as JsonObject)["text"], Q_MAX, nq) }
            if (i["t"].stringOrNull() == "ck") {
                if (i["title"].truthy()) nq = add(q, i["title"], Q_MAX, nq)
                (i["rows"] as? JsonArray)?.forEach { r -> if (r.truthy() && (r as? JsonObject)?.get("text").truthy()) nq = add(q, (r as JsonObject)["text"], Q_MAX, nq) }
            }
            i["txt"].stringOrNull()?.let { np = add(pq, i["txt"], PQ_MAX, np) }
        }
        return SearchText(q.joinToString(" ").take(Q_MAX), pq.joinToString(" ").take(PQ_MAX))
    }

    fun searchText(items: List<Item>): SearchText = searchText(JsonArray(items.map { it.raw }))

    /** The small board-index record: everything except `items` and `enc`, plus the ids of linked boards. */
    fun metaOf(rec: JsonObject, links: JsonElement? = null): JsonObject {
        val m = LinkedHashMap<String, JsonElement>()
        for ((k, v) in rec) if (k != "items" && k != "enc") m[k] = v
        if (links.truthy()) m["lk"] = links!!
        return JsonObject(m)
    }

    /** Board to open at start-up: the last one if still usable, else the most recently changed usable one. */
    fun pickStart(lastId: String?, metas: List<JsonObject>): String? {
        fun usable(r: JsonObject?) = r != null && !r["folder"].truthy() && !r["del"].truthy() && !r["locked"].truthy()
        if (!lastId.isNullOrEmpty()) {
            val r = metas.firstOrNull { it["id"].stringOrNull() == lastId }
            if (usable(r)) return lastId
        }
        var best: JsonObject? = null
        for (r in metas) if (usable(r) && (best == null || r["t"].orZero() > best["t"].orZero())) best = r
        return best?.get("id")?.let(::jsString)
    }
}
