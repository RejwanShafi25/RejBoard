package com.rejwan.rejboard

import android.content.Context
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream
import java.io.FileNotFoundException
import java.io.InputStream
import java.util.Locale

/**
 * Serves the bundled web UI (APK assets/web/...) at https://appassets.androidplatform.net/ - a secure origin, so IndexedDB,
 * localStorage, the clipboard, getUserMedia and crypto.subtle all work exactly as in Electron's file:// window.
 *  - index.html gets one extra <script> (android/rb-bridge.js) before any of its own scripts
 *  - /__rb/pull/<key> hands big bridge replies to the page (see Bridge)
 */
class WebAssets(private val ctx: Context, private val bridge: () -> Bridge?, private val boot: () -> String) : WebViewAssetLoader.PathHandler {

    override fun handle(path: String): WebResourceResponse? {
        var p = path.substringBefore('?').substringBefore('#').trimStart('/')
        if (p.isEmpty()) p = "index.html"
        if (p.startsWith("__rb/pull/")) {
            val data = bridge()?.takePull(p.removePrefix("__rb/pull/")) ?: return notFound()
            return ok("application/json", ByteArrayInputStream(data), noStore = true)
        }
        if (p.split('/').any { it == ".." || it == "." }) return notFound()
        return try {
            when (p) {
                "index.html" -> {
                    val html = ctx.assets.open("web/index.html").use { it.readBytes().toString(Charsets.UTF_8) }
                    val tag = "<script src=\"android/rb-bridge.js\"></script>"
                    val i = html.indexOf("<meta charset=\"utf-8\">", ignoreCase = true).let { if (it >= 0) it + 22 else html.indexOf("<head>").let { h -> if (h >= 0) h + 6 else 0 } }
                    ok("text/html", ByteArrayInputStream((html.substring(0, i) + tag + html.substring(i)).toByteArray(Charsets.UTF_8)), noStore = true)
                }
                "android/rb-bridge.js" -> {
                    val js = ctx.assets.open("web/android/rb-bridge.js").use { it.readBytes().toString(Charsets.UTF_8) }
                        .replace("/*__RB_BOOT__*/ {}", boot())
                    ok("text/javascript", ByteArrayInputStream(js.toByteArray(Charsets.UTF_8)), noStore = true)
                }
                else -> ok(mimeOf(p), ctx.assets.open("web/$p"))
            }
        } catch (_: FileNotFoundException) {
            notFound()
        } catch (_: Exception) {
            notFound()
        }
    }

    private fun ok(mime: String, body: InputStream, noStore: Boolean = false): WebResourceResponse {
        val textual = mime.startsWith("text/") || mime.endsWith("json") || mime.endsWith("javascript") || mime.endsWith("xml")
        val headers = mutableMapOf("Access-Control-Allow-Origin" to ORIGIN, "X-Content-Type-Options" to "nosniff")
        headers["Cache-Control"] = if (noStore) "no-store" else "no-cache"
        return WebResourceResponse(mime, if (textual) "utf-8" else null, 200, "OK", headers, body)
    }

    private fun notFound() = WebResourceResponse("text/plain", "utf-8", 404, "Not Found", mapOf("Cache-Control" to "no-store"), ByteArrayInputStream(ByteArray(0)))

    companion object {
        /* NEVER CHANGE HOST (or the https scheme): every board, setting and recording lives in this origin's IndexedDB /
           localStorage. A different origin after an update would open an empty library, because the old data would belong
           to an origin the page no longer runs in. The same goes for the application id (com.rejwan.rejboard) and the
           release signing key: keep them, and updates keep everyone's notes. */
        const val HOST = "appassets.androidplatform.net"
        const val ORIGIN = "https://$HOST"
        const val START_URL = "$ORIGIN/index.html"

        fun mimeOf(p: String): String = when (p.substringAfterLast('.', "").lowercase(Locale.ROOT)) {
            "html", "htm" -> "text/html"
            "js", "mjs" -> "text/javascript"
            "css" -> "text/css"
            "json" -> "application/json"
            "wasm" -> "application/wasm"
            "svg" -> "image/svg+xml"
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "gif" -> "image/gif"
            "webp" -> "image/webp"
            "ico" -> "image/x-icon"
            "woff2" -> "font/woff2"
            "woff" -> "font/woff"
            "ttf" -> "font/ttf"
            "otf" -> "font/otf"
            "pdf" -> "application/pdf"
            "txt" -> "text/plain"
            "xml" -> "application/xml"
            "mp3" -> "audio/mpeg"
            "wav" -> "audio/wav"
            "mp4" -> "video/mp4"
            "webm" -> "video/webm"
            "traineddata", "onnx", "bin" -> "application/octet-stream"
            else -> "application/octet-stream"
        }
    }
}
