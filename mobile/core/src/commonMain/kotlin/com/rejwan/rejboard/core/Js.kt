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

    /* Not json.encodeToString: kotlinx re-formats every number through Double.toString ("1.5e-7" -> "1.5E-7", "2e+21" -> "2.0E21"),
       which breaks byte-for-byte round trips. This writer keeps parsed number text as it was and escapes strings like JSON.stringify. */
    fun write(element: JsonElement): String = StringBuilder().also { writeTo(it, element) }.toString()

    private fun writeTo(sb: StringBuilder, e: JsonElement) {
        when (e) {
            JsonNull -> sb.append("null")
            is JsonPrimitive -> if (e.isString) quote(sb, e.content) else sb.append(jsNumberText(e.content))
            is JsonArray -> {
                sb.append('[')
                e.forEachIndexed { i, x -> if (i > 0) sb.append(','); writeTo(sb, x) }
                sb.append(']')
            }
            is JsonObject -> {
                sb.append('{')
                var first = true
                for ((k, v) in e) { if (!first) sb.append(','); first = false; quote(sb, k); sb.append(':'); writeTo(sb, v) }
                sb.append('}')
            }
        }
    }

    private const val HEX = "0123456789abcdef"
    private fun hex4(sb: StringBuilder, c: Int) { sb.append("\\u"); for (s in intArrayOf(12, 8, 4, 0)) sb.append(HEX[(c shr s) and 15]) }

    /** JSON.stringify string quoting: short escapes, other control characters and lone surrogates as lowercase \u escapes. */
    private fun quote(sb: StringBuilder, s: String) {
        sb.append('"')
        var i = 0
        while (i < s.length) {
            val c = s[i]
            when {
                c == '"' -> sb.append("\\\"")
                c == '\\' -> sb.append("\\\\")
                c == '\b' -> sb.append("\\b")
                c == '\u000C' -> sb.append("\\f")
                c == '\n' -> sb.append("\\n")
                c == '\r' -> sb.append("\\r")
                c == '\t' -> sb.append("\\t")
                c.code < 0x20 -> hex4(sb, c.code)
                c.isHighSurrogate() && i + 1 < s.length && s[i + 1].isLowSurrogate() -> { sb.append(c).append(s[i + 1]); i++ }
                c.isSurrogate() -> hex4(sb, c.code)
                else -> sb.append(c)
            }
            i++
        }
        sb.append('"')
    }
}

/** Number text as JavaScript writes it. Text parsed from a file is kept; Kotlin-made text ("1.0E7", "2.0", "1.5E-7") is rewritten. */
internal fun jsNumberText(c: String): String {
    if (c.indexOf('E') < 0 && !c.endsWith(".0")) return c
    val d = c.toDoubleOrNull() ?: return c
    return jsFormat(d)
}

/** JavaScript Number.prototype.toString() for a finite double, from the shortest digits Kotlin prints. */
internal fun jsFormat(d: Double): String {
    if (d.isNaN()) return "NaN"
    if (d.isInfinite()) return if (d > 0) "Infinity" else "-Infinity"
    if (d == 0.0) return "0"
    val neg = d < 0
    val s = kotlin.math.abs(d).toString()
    val ePos = s.indexOfFirst { it == 'E' || it == 'e' }
    val mant = if (ePos < 0) s else s.substring(0, ePos)
    val exp = if (ePos < 0) 0 else s.substring(ePos + 1).toInt()
    val dot = mant.indexOf('.')
    val intPart = if (dot < 0) mant else mant.substring(0, dot)
    val all = intPart + (if (dot < 0) "" else mant.substring(dot + 1))
    val lead = all.indexOfFirst { it != '0' }
    if (lead < 0) return "0"
    val digits = all.substring(lead).trimEnd('0')
    val n = intPart.length + exp - lead // value = 0.digits × 10^n
    val k = digits.length
    val out = when {
        n in k..21 -> digits + "0".repeat(n - k)
        n in 1..21 -> digits.substring(0, n) + "." + digits.substring(n)
        n in -5..0 -> "0." + "0".repeat(-n) + digits
        else -> {
            val e = n - 1
            (if (k == 1) digits else digits[0] + "." + digits.substring(1)) + "e" + (if (e < 0) "-" else "+") + kotlin.math.abs(e)
        }
    }
    return if (neg) "-$out" else out
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
