package com.rejwan.rejboard.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/* JSON exactly as the desktop app (index.html, JSON.stringify) reads and writes it.
   Parsed numbers keep their original text, objects keep their key order, so parse -> write gives back the same bytes. */
object BoardJson {
    private val json = Json

    fun parse(text: String): JsonElement = json.parseToJsonElement(text)

    fun write(element: JsonElement): String = json.encodeToString(JsonElement.serializer(), element)
}

/* Small pieces of JavaScript semantics the ported logic depends on (truthiness, ToNumber, ToInt32). */

/** A JSON number (not a string, boolean or null). */
internal fun JsonElement?.isJsNumber(): Boolean =
    this is JsonPrimitive && this !is JsonNull && !isString && content != "true" && content != "false"

/** The value when this is a JSON number, else null. */
internal fun JsonElement?.numberOrNull(): Double? = if (isJsNumber()) (this as JsonPrimitive).content.toDoubleOrNull() else null

/** The value when this is a JSON string, else null. */
internal fun JsonElement?.stringOrNull(): String? = if (this is JsonPrimitive && isString) content else null

/** JavaScript truthiness of a JSON value; a missing value (null here) is `undefined`. */
internal fun JsonElement?.truthy(): Boolean = when (this) {
    null, JsonNull -> false
    is JsonPrimitive -> when {
        isString -> content.isNotEmpty()
        content == "true" -> true
        content == "false" -> false
        else -> content.toDoubleOrNull().let { it != null && it != 0.0 && !it.isNaN() }
    }
    else -> true
}

/** `x || 0` for a value used as a number. */
internal fun JsonElement?.orZero(): Double = numberOrNull()?.takeIf { it != 0.0 && !it.isNaN() } ?: 0.0

private val JS_DECIMAL = Regex("[+-]?(Infinity|(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?)")

/* The characters JavaScript's \s and String.prototype.trim treat as white space. */
internal const val JS_WS = "\\t\\n\\u000B\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff"
private val JS_TRIM = Regex("^[$JS_WS]+|[$JS_WS]+$")

internal fun jsTrim(s: String): String = s.replace(JS_TRIM, "")

/** JavaScript `+v` (ToNumber). A missing value (null here) is `undefined`, which is NaN. */
internal fun JsonElement?.jsToNumber(): Double = when (this) {
    null -> Double.NaN
    JsonNull -> 0.0
    is JsonPrimitive -> when {
        isString -> jsStringToNumber(content)
        content == "true" -> 1.0
        content == "false" -> 0.0
        else -> content.toDoubleOrNull() ?: Double.NaN
    }
    is JsonArray -> jsStringToNumber(jsString(this))
    is JsonObject -> Double.NaN
}

internal fun jsStringToNumber(s: String): Double {
    val t = jsTrim(s)
    if (t.isEmpty()) return 0.0
    if (t.length > 2 && t[0] == '0' && (t[1] == 'x' || t[1] == 'X')) return t.substring(2).toLongOrNull(16)?.toDouble() ?: Double.NaN
    if (!JS_DECIMAL.matches(t)) return Double.NaN
    return when (t) {
        "Infinity", "+Infinity" -> Double.POSITIVE_INFINITY
        "-Infinity" -> Double.NEGATIVE_INFINITY
        else -> t.toDoubleOrNull() ?: Double.NaN
    }
}

/** JavaScript `String(v)` for JSON values (numbers keep the text they were written with). */
internal fun jsString(e: JsonElement?): String = when (e) {
    null -> "undefined"
    JsonNull -> "null"
    is JsonPrimitive -> e.content
    is JsonArray -> e.joinToString(",") { if (it == JsonNull) "" else jsString(it) }
    is JsonObject -> "[object Object]"
}

/** JavaScript `v | 0` (ToInt32): truncate, wrap modulo 2^32, NaN and infinities become 0. */
internal fun jsInt32(d: Double): Int {
    if (d.isNaN() || d.isInfinite()) return 0
    val t = if (d < 0) kotlin.math.ceil(d) else kotlin.math.floor(d)
    return (t % 4294967296.0).toLong().toInt()
}

/** FNV-1a 64 over UTF-16 code units as 16 hex digits; the golden fixtures use it to pin down long JSON texts. */
internal fun fnv64(s: String): String {
    var h = 0xcbf29ce484222325UL
    for (c in s) {
        h = h xor c.code.toULong()
        h *= 0x100000001b3UL
    }
    return h.toString(16).padStart(16, '0')
}
