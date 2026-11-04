package com.rejwan.rejboard.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject

/**
 * Screen-cache fingerprint, ported from board-core.js boardSig(): a cheap 32-bit hash of everything that changes how
 * the board looks. Equal fingerprints mean a cached picture of the board is still right. Gives the same number as the
 * desktop app for the same board, so caches and tests can be compared across platforms.
 */
object BoardSig {
    fun of(items: List<Item>, layers: List<Layer>?): Int = of(items.map { it.raw }, layers?.map { it.raw })

    fun of(items: List<JsonObject>, layers: List<JsonObject>?): Int {
        var h = items.size
        fun mix(n: Int) { h = h * 31 + n }
        fun num(v: Double): Int = jsInt32((if (v.isNaN()) 0.0 else v) * 1000)
        fun str(s: String) { mix(s.length); mix(s[s.length - 1].code); mix(s[0].code) }
        fun coord(p: JsonElement?, k: Int): Double = (p as? JsonArray)?.getOrNull(k).orZero()

        for (i in items) {
            val p = i["pts"]
            mix(if (i["t"].stringOrNull() == "s") 1 else 2)
            if (p is JsonArray && p.isNotEmpty()) {
                val a = p[0]; val b = p[p.size - 1]; val m = p[p.size shr 1]; val q = p[p.size shr 2]
                mix(p.size)
                mix(num(coord(a, 0) * 7 + coord(a, 1) * 13 + coord(b, 0) * 17 + coord(b, 1) * 19 + coord(m, 0) * 23 + coord(m, 1) * 29 + coord(q, 0) * 31 + coord(q, 1) * 37))
            } else {
                mix(num(i["x"].orZero() * 7 + i["y"].orZero() * 13 + i["w"].orZero() * 17 + i["h"].orZero() * 19))
            }
            if (i["rot"].truthy()) mix(jsInt32(i["rot"].jsToNumber() * 1e4))
            for (key in STRING_KEYS) if (i[key].truthy()) i[key].stringOrNull()?.let(::str)
            mix(num(i["size"].jsToNumber()))
            mix(num(i["opacity"].jsToNumber()))
            i["ly"]?.let { if (it != JsonNull) mix(jsInt32(it.jsToNumber())) }
            i["html"].stringOrNull()?.let { mix(it.length) }
            i["text"].stringOrNull()?.let { mix(it.length) }
            i["src"].stringOrNull()?.let { mix(it.length) }
            (i["cells"] as? JsonArray)?.let { cells ->
                mix(cells.size)
                for (r in cells) if (r is JsonArray) {
                    mix(r.size)
                    for (c in r) c.stringOrNull()?.let { mix(it.length) }
                }
            }
            if (i["fns"] is JsonArray) {
                val js = BoardJson.write(JsonArray(listOf(i["fns"]!!, i["params"] ?: JsonNull, i["view"] ?: JsonNull, i["opt"] ?: JsonNull)))
                mix(js.length)
                for (ch in js) mix(ch.code)
            }
            (i["cw"] as? JsonArray)?.let { mix(num(sum(it))) }
            (i["rh"] as? JsonArray)?.let { mix(num(sum(it))) }
        }
        for (l in layers ?: emptyList()) {
            mix(jsInt32(l["id"].jsToNumber()) * 3 + if (l["vis"].truthy()) 1 else 0)
            mix(if (l["lock"].truthy()) 1 else 0)
        }
        return h
    }

    private val STRING_KEYS = listOf("color", "fill", "tool", "shp", "lineType")

    private fun sum(a: JsonArray): Double {
        var s = 0.0
        for (v in a) s += v.numberOrNull() ?: Double.NaN
        return s
    }
}
