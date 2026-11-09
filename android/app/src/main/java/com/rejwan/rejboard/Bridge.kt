package com.rejwan.rejboard

import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.io.ByteArrayOutputStream
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong

/** A value that is already JSON text (sent as is, never re-encoded). */
class RawJson(val text: String)

/** Thrown by a handler to reject the page's promise with this message (like a throwing ipcMain.handle). */
class BridgeError(message: String) : Exception(message)

/**
 * The native half of `window.wb` (see assets/web/android/rb-bridge.js for the wire format).
 * Every channel name is the same as the Electron ipcMain channel it replaces.
 */
class Bridge(private val web: WebView) {
    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newCachedThreadPool { r -> Thread(r, "rb-bridge").apply { isDaemon = true } }
    private val handlers = HashMap<String, (JSONArray) -> Any?>()
    private val textParts = ConcurrentHashMap<String, StringBuilder>()
    private val binParts = ConcurrentHashMap<String, ByteArrayOutputStream>()
    private val pulls = ConcurrentHashMap<String, ByteArray>()
    private val pullSeq = AtomicLong()
    @Volatile private var proxy: JavaScriptReplyProxy? = null

    fun handle(channel: String, fn: (JSONArray) -> Any?) { handlers[channel] = fn }

    /** Installs the channel on the WebView: only https://appassets.androidplatform.net (the bundled UI) can reach it. */
    fun install() {
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "RBNative", setOf(WebAssets.ORIGIN)) { _, message: WebMessageCompat, sourceOrigin: Uri, isMainFrame, replyProxy ->
                if (!isMainFrame || sourceOrigin.toString().trimEnd('/') != WebAssets.ORIGIN) return@addWebMessageListener
                proxy = replyProxy
                message.data?.let { onMessage(it) }
            }
        } else {
            // Very old WebView: classic interface, answered with evaluateJavascript. The page is only ever our own origin (see MainActivity).
            web.addJavascriptInterface(JsInterface(), "RBNative")
        }
    }

    inner class JsInterface {
        @JavascriptInterface fun postMessage(s: String) = onMessage(s)
    }

    private fun onMessage(s: String) {
        if (s.length < 3 || s[1] != '|') return
        try {
            when (s[0]) {
                'C' -> {
                    val a = s.indexOf('|', 2); val b = s.indexOf('|', a + 1)
                    dispatch(s.substring(2, a).toInt(), s.substring(a + 1, b), s.substring(b + 1))
                }
                'S' -> {
                    val a = s.indexOf('|', 2); val b = s.indexOf('|', a + 1)
                    val args = textParts.remove(s.substring(b + 1))?.toString() ?: "[]"
                    dispatch(s.substring(2, a).toInt(), s.substring(a + 1, b), args)
                }
                'P' -> {
                    val a = s.indexOf('|', 2)
                    val sb = textParts.getOrPut(s.substring(2, a)) { StringBuilder() }
                    synchronized(sb) { sb.append(s, a + 1, s.length) }
                }
                'B' -> {
                    val a = s.indexOf('|', 2)
                    val out = binParts.getOrPut(s.substring(2, a)) { ByteArrayOutputStream() }
                    val bytes = Base64.decode(s.substring(a + 1), Base64.DEFAULT)
                    synchronized(out) { out.write(bytes) }
                }
            }
        } catch (e: Exception) { Log.w(TAG, "bad message", e) }
    }

    /** Binary data the page staged with B| messages (e.g. a file to save). */
    fun takeBytes(key: String): ByteArray? = binParts.remove(key)?.toByteArray()

    /** Served at /__rb/pull/<key> once (see WebAssets). */
    fun takePull(key: String): ByteArray? = pulls.remove(key)

    private fun dispatch(id: Int, channel: String, args: String) {
        io.execute {
            try {
                val h = handlers[channel] ?: throw BridgeError("No handler registered for '$channel'")
                val r = h(JSONArray(args))
                reply(id, true, Json.encode(r))
            } catch (e: BridgeError) {
                reply(id, false, JSONObject.quote(e.message ?: "Error"))
            } catch (e: Throwable) {
                Log.w(TAG, "handler $channel failed", e)
                reply(id, false, JSONObject.quote("Error invoking remote method '$channel': ${e.message ?: e.javaClass.simpleName}"))
            }
        }
    }

    private fun reply(id: Int, ok: Boolean, json: String) {
        val flag = if (ok) "1" else "0"
        if (json.length > INLINE_MAX) post("L|$id|$flag|" + stash(json)) else post("D|$id|$flag|$json")
    }

    /** Sends an event to the page (ipcRenderer.on in preload.js). */
    fun emit(channel: String, value: Any?) {
        val json = Json.encode(value)
        if (json.length > INLINE_MAX) post("M|$channel|" + stash(json)) else post("E|$channel|$json")
    }

    private fun stash(json: String): String {
        val key = "p" + pullSeq.incrementAndGet() + "x" + java.lang.Long.toHexString(System.nanoTime())
        pulls[key] = json.toByteArray(Charsets.UTF_8)
        return key
    }

    private fun post(msg: String) {
        main.post {
            val p = proxy
            try {
                if (p != null) p.postMessage(msg)
                else web.evaluateJavascript("window.__rbRecv&&window.__rbRecv(" + JSONObject.quote(msg) + ")", null)
            } catch (e: Exception) { Log.w(TAG, "post failed", e) }
        }
    }

    /** A new page load: forget the old page's channel and staged data. */
    fun reset() { proxy = null; textParts.clear(); binParts.clear(); pulls.clear() }

    fun shutdown() { io.shutdownNow() }

    companion object {
        private const val TAG = "RejBoardBridge"
        private const val INLINE_MAX = 1 shl 20
    }
}

object Json {
    fun encode(v: Any?): String = when (v) {
        is RawJson -> v.text
        else -> when (val j = wrap(v)) {
            JSONObject.NULL -> "null"
            is String -> JSONObject.quote(j)
            else -> j.toString()
        }
    }

    fun wrap(v: Any?): Any = when (v) {
        null, Unit -> JSONObject.NULL
        is RawJson -> JSONTokener(v.text).nextValue() ?: JSONObject.NULL
        is JSONObject, is JSONArray, is String, is Boolean, is Int, is Long, is Double -> v
        is Float -> v.toDouble()
        is Number -> v.toDouble()
        is ByteArray -> JSONObject().put("__b64", Base64.encodeToString(v, Base64.NO_WRAP))
        is Map<*, *> -> JSONObject().also { o -> for ((k, x) in v) o.put(k.toString(), wrap(x)) }
        is Iterable<*> -> JSONArray().also { a -> for (x in v) a.put(wrap(x)) }
        is Array<*> -> JSONArray().also { a -> for (x in v) a.put(wrap(x)) }
        else -> v.toString()
    }

    /** Arguments the page sent as Uint8Array / ArrayBuffer ({"__b64": ...}). */
    fun bytes(a: JSONArray, i: Int): ByteArray? = bytesOf(a.opt(i))
    fun bytesOf(v: Any?): ByteArray? {
        val o = v as? JSONObject ?: return null
        if (!o.has("__b64")) return null
        return Base64.decode(o.optString("__b64"), Base64.DEFAULT)
    }

    /** A string argument, or null when it is missing / not a string (Electron handlers check typeof === 'string'). */
    fun str(a: JSONArray, i: Int): String? = a.opt(i) as? String
}
