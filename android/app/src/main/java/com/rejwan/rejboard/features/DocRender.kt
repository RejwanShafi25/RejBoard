package com.rejwan.rejboard.features

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.pdf.PdfDocument
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.webkit.WebViewAssetLoader
import com.rejwan.rejboard.Bridge
import com.rejwan.rejboard.Json
import com.rejwan.rejboard.WebAssets
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.security.SecureRandom
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import kotlin.math.ceil
import kotlin.math.roundToInt

/**
 * main.js 'doc:toPdf' for Android: Word (.docx) and PowerPoint (.pptx) files become PDF pages, which the board imports exactly like a
 * PDF (the desktop app does the same with LibreOffice or Microsoft Office). The document is laid out by assets/web/android/doc/docrender.html
 * in a hidden WebView behind the board, then each page is drawn into an Android PdfDocument. Offline; the file never leaves the device.
 */
class DocRender(private val act: Activity, private val parent: FrameLayout, private val assets: WebViewAssetLoader) {
    private val docs = ConcurrentHashMap<String, ByteArray>()
    private val lock = Any()
    private val main = Handler(Looper.getMainLooper())

    fun register(b: Bridge) {
        b.handle("doc:toPdf") { a ->
            val name = Json.str(a, 0) ?: ""
            val ext = name.lowercase().substringAfterLast('.')
            when {
                ext !in DOC_EXT + SLIDE_EXT -> mapOf("ok" to false, "error" to "Unsupported document type")
                ext != "docx" && ext != "pptx" -> mapOf("ok" to false, "error" to "Only .docx and .pptx files can be shown as pages on Android. Save it as .docx, .pptx or PDF and import it again.")
                else -> {
                    val data = Json.bytes(a, 1) ?: return@handle mapOf("ok" to false, "error" to "The document could not be read")
                    try { synchronized(lock) { mapOf("ok" to true, "pdf" to render(ext, data)) } } // one document at a time keeps memory flat
                    catch (e: Exception) { mapOf("ok" to false, "error" to (e.message ?: "The document could not be rendered")) }
                }
            }
        }
    }

    private fun <T> onUi(timeoutS: Long = 20, block: (CompletableFuture<T>) -> Unit): T {
        val f = CompletableFuture<T>()
        main.post { try { block(f) } catch (e: Exception) { f.completeExceptionally(e) } }
        return f.get(timeoutS, TimeUnit.SECONDS)
    }

    private data class Page(val x: Int, val y: Int, val w: Int, val h: Int)

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    private fun render(ext: String, data: ByteArray): ByteArray {
        val key = ByteArray(16).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
        docs[key] = data
        val laidOut = CompletableFuture<String>()
        var view: WebView? = null
        try {
            view = onUi<WebView> { f ->
                val w = WebView(act)
                w.settings.javaScriptEnabled = true
                w.settings.allowFileAccess = false
                w.settings.textZoom = 100
                // exactly one CSS pixel per density-independent pixel: no overview zoom, no automatic font enlarging
                w.settings.useWideViewPort = false; w.settings.loadWithOverviewMode = false
                w.settings.layoutAlgorithm = android.webkit.WebSettings.LayoutAlgorithm.NORMAL
                w.settings.setSupportZoom(false); w.settings.minimumFontSize = 1; w.settings.minimumLogicalFontSize = 1
                w.setInitialScale(0)
                w.setBackgroundColor(Color.WHITE)
                w.isVerticalScrollBarEnabled = false; w.isHorizontalScrollBarEnabled = false
                w.addJavascriptInterface(object {
                    @JavascriptInterface fun done(s: String) { laidOut.complete(s) }
                    @JavascriptInterface fun fail(s: String) { laidOut.completeExceptionally(Exception("The document could not be rendered ($s)")) }
                }, "RBDoc")
                w.webViewClient = object : WebViewClient() {
                    override fun shouldInterceptRequest(v: WebView, req: WebResourceRequest): WebResourceResponse? {
                        if (req.url.host != WebAssets.HOST) return WebResourceResponse("text/plain", "utf-8", 403, "Forbidden", emptyMap(), ByteArrayInputStream(ByteArray(0)))
                        val p = req.url.path ?: ""
                        if (p.startsWith("/__rb/doc/")) {
                            val d = docs.remove(p.removePrefix("/__rb/doc/")) ?: return WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), ByteArrayInputStream(ByteArray(0)))
                            return WebResourceResponse("application/octet-stream", null, 200, "OK", mapOf("Cache-Control" to "no-store"), ByteArrayInputStream(d))
                        }
                        return assets.shouldInterceptRequest(req.url)
                    }
                    override fun shouldOverrideUrlLoading(v: WebView, req: WebResourceRequest) = true // links inside documents go nowhere
                }
                // behind the board (index 0): laid out and drawn, never seen
                parent.addView(w, 0, FrameLayout.LayoutParams(1200, 1600))
                w.loadUrl("${WebAssets.ORIGIN}/android/doc/docrender.html?k=$ext#$key")
                f.complete(w)
            }
            val info = JSONObject(laidOut.get(180, TimeUnit.SECONDS))
            val j = info.getJSONArray("pages")
            val pages = (0 until j.length()).map { val o = j.getJSONObject(it); Page(o.getInt("x"), o.getInt("y"), o.getInt("w"), o.getInt("h")) }
            // device pixels per CSS pixel as the page itself measured it (normally the screen density)
            val density = (info.optDouble("dpr", act.resources.displayMetrics.density.toDouble()) * info.optDouble("scale", 1.0)).toFloat().coerceIn(1f, 4f)
            android.util.Log.i("RejBoardDoc", "rendered ${pages.size} pages, dpr=${info.optDouble("dpr")} scale=${info.optDouble("scale")} iw=${info.optDouble("iw")} density=${act.resources.displayMetrics.density}")
            val pdf = PdfDocument()
            val paint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
            try {
                pages.forEachIndexed { i, p ->
                    val pw = ceil(p.w * density).toInt(); val ph = ceil(p.h * density).toInt()
                    // size the view to the page and scroll the page into it, then wait until that state is on screen
                    onUi<Unit> { f ->
                        val w = view!!
                        w.layoutParams = FrameLayout.LayoutParams(pw, ph)
                        w.post {
                            w.evaluateJavascript("scrollTo(${p.x},${p.y})") {
                                w.postVisualStateCallback(i.toLong(), object : WebView.VisualStateCallback() {
                                    override fun onComplete(requestId: Long) { main.postDelayed({ f.complete(Unit) }, 60) }
                                })
                            }
                        }
                    }
                    val bmp = onUi<Bitmap> { f ->
                        val b = Bitmap.createBitmap(pw, ph, Bitmap.Config.ARGB_8888)
                        val c = Canvas(b); c.drawColor(Color.WHITE)
                        val w = view!!
                        c.translate(-w.scrollX.toFloat(), -w.scrollY.toFloat()) // a WebView draws its content at its scroll position
                        w.draw(c)
                        f.complete(b)
                    }
                    // CSS pixels (96 per inch) -> PDF points (72 per inch); the page keeps the full-resolution picture
                    val page = pdf.startPage(PdfDocument.PageInfo.Builder((p.w * 0.75f).roundToInt().coerceAtLeast(1), (p.h * 0.75f).roundToInt().coerceAtLeast(1), i + 1).create())
                    page.canvas.scale(0.75f / density, 0.75f / density)
                    page.canvas.drawBitmap(bmp, 0f, 0f, paint)
                    pdf.finishPage(page)
                    bmp.recycle()
                }
                return ByteArrayOutputStream().also { pdf.writeTo(it) }.toByteArray()
            } finally { pdf.close() }
        } finally {
            docs.remove(key)
            view?.let { w -> main.post { parent.removeView(w); w.destroy() } }
        }
    }

    companion object {
        private val DOC_EXT = listOf("docx", "doc", "odt", "rtf")
        private val SLIDE_EXT = listOf("pptx", "ppt", "odp")
    }
}
