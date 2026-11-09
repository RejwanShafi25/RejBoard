package com.rejwan.rejboard.features

import android.content.Context
import android.util.Base64
import com.rejwan.rejboard.Bridge
import com.rejwan.rejboard.BridgeError
import com.rejwan.rejboard.Json
import com.rejwan.rejboard.RawJson
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

/** main.js: 'hw', 'image:fetch-remote', 'i18n:fetch' */
object NetFeatures {
    private const val HW_URL = "https://inputtools.google.com/request?ime=handwriting&app=mobilesearch&cs=1&oe=UTF-8"
    private const val PACK_BASE = "https://raw.githubusercontent.com/RejwanShafi25/RejBoard/main/locales/"
    private const val MAX_IMAGE = 12 * 1024 * 1024
    private val PACK_RE = Regex("^(index|[a-z]{2,3}(-[A-Za-z]{2,4})?)\\.json$")

    fun register(b: Bridge, ctx: Context) {
        b.handle("hw") { a -> recognize(a.optJSONObject(0) ?: JSONObject()) }
        b.handle("image:fetch-remote") { a -> fetchImage(Json.str(a, 0) ?: "") }
        b.handle("i18n:fetch") { a -> i18n(ctx, a.opt(0)?.toString() ?: "") }
        // 'doc:toPdf' (Word / PowerPoint -> pages) is DocRender
    }

    /** Online handwriting recognition (the "Online" engine): same unofficial endpoint and request as main.js. */
    private fun recognize(d: JSONObject): String {
        val lang = d.optString("lang", "en")
        val body = JSONObject()
            .put("options", "enable_pre_space")
            .put("requests", JSONArray().put(JSONObject()
                .put("writing_guide", JSONObject().put("writing_area_width", d.opt("w")).put("writing_area_height", d.opt("h")))
                .put("ink", d.opt("ink"))
                .put("language", if (lang == "zh") "zh_CN" else lang)))
        val c = (URL(HW_URL).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"; doOutput = true; connectTimeout = 15000; readTimeout = 20000
            setRequestProperty("Content-Type", "application/json")
        }
        try {
            c.outputStream.use { it.write(body.toString().toByteArray()) }
            val j = JSONTokener(c.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }).nextValue() as? JSONArray ?: return ""
            if (j.optString(0) != "SUCCESS") return ""
            return j.getJSONArray(1).getJSONArray(0).getJSONArray(1).getString(0)
        } finally { c.disconnect() }
    }

    private fun fetchImage(raw: String): Map<String, Any?> {
        try {
            val u = URL(raw)
            if (u.protocol != "http" && u.protocol != "https") return mapOf("ok" to false)
            val c = (u.openConnection() as HttpURLConnection).apply { connectTimeout = 12000; readTimeout = 12000; instanceFollowRedirects = true }
            try {
                if (c.responseCode !in 200..299) return mapOf("ok" to false)
                val type = (c.contentType ?: "").substringBefore(';').trim().lowercase()
                if (!type.startsWith("image/")) return mapOf("ok" to false)
                if (c.contentLengthLong > MAX_IMAGE) return mapOf("ok" to false)
                val bytes = readCapped(c.inputStream, MAX_IMAGE) ?: return mapOf("ok" to false)
                if (bytes.isEmpty()) return mapOf("ok" to false)
                return mapOf("ok" to true, "type" to type, "data" to Base64.encodeToString(bytes, Base64.NO_WRAP))
            } finally { c.disconnect() }
        } catch (_: Exception) { return mapOf("ok" to false) }
    }

    /** Language packs: the copy bundled in the APK first (works offline), else GitHub, else null. */
    private fun i18n(ctx: Context, file: String): Any? {
        if (!PACK_RE.matches(file)) throw BridgeError("bad file")
        try { return RawJson(JSONTokener(ctx.assets.open("web/locales/$file").use { it.readBytes().toString(Charsets.UTF_8) }).nextValue().toString()) } catch (_: Exception) {}
        try {
            val c = (URL(PACK_BASE + file).openConnection() as HttpURLConnection).apply { connectTimeout = 15000; readTimeout = 20000 }
            try { if (c.responseCode == 200) return RawJson(JSONTokener(c.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }).nextValue().toString()) } finally { c.disconnect() }
        } catch (_: Exception) {}
        return null
    }

    fun readCapped(input: InputStream, max: Int): ByteArray? = input.use { s ->
        val out = ByteArrayOutputStream()
        val buf = ByteArray(64 * 1024)
        while (true) {
            val n = s.read(buf)
            if (n < 0) break
            if (out.size() + n > max) return null
            out.write(buf, 0, n)
        }
        out.toByteArray()
    }
}
