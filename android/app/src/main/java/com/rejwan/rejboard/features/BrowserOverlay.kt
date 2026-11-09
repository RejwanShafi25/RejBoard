package com.rejwan.rejboard.features

import android.annotation.SuppressLint
import android.app.Activity
import android.app.DownloadManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Environment
import android.view.View
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.PopupMenu
import android.widget.Toast
import com.rejwan.rejboard.Bridge
import com.rejwan.rejboard.Json
import com.rejwan.rejboard.RawJson
import com.rejwan.rejboard.WebAssets
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * The Electron <webview> used by the in-app browser and the video panel (YouTube, Udemy...), as real Android WebViews kept exactly
 * over the page's <rb-webview> element (rb-bridge.js sends its box every frame it changes). Like the desktop app's
 * 'rejboard-ephemeral' partition, what websites store is wiped when the panel is closed and when the app exits.
 * Long-press gives the same menu as the desktop right-click menu, including "Add image to board".
 */
class BrowserOverlay(
    private val act: Activity,
    private val layer: FrameLayout,
    private val bridge: Bridge,
    private val fullscreen: (View?, WebChromeClient.CustomViewCallback?) -> Unit
) {
    private val views = HashMap<Int, WebView>()
    private val origins = HashSet<String>()
    /** the origin that holds every board (WebAssets.HOST): the in-app browser never opens it and never clears its storage */
    private fun isAppOrigin(u: Uri) = u.host.equals(WebAssets.HOST, ignoreCase = true)

    private fun ui(block: () -> Unit) = act.runOnUiThread(block)
    private fun event(id: Int, w: WebView, type: String, url: String? = null, title: String? = null) {
        bridge.emit("wv:event", mapOf("id" to id, "type" to type, "url" to (url ?: w.url), "title" to title, "canBack" to w.canGoBack(), "canFwd" to w.canGoForward()))
    }

    fun register(b: Bridge) {
        b.handle("wv:create") { a -> val id = a.optInt(0); ui { create(id) }; null }
        b.handle("wv:destroy") { a -> val id = a.optInt(0); ui { destroy(id) }; null }
        b.handle("wv:rect") { a ->
            val id = a.optInt(0); val x = a.optInt(1); val y = a.optInt(2); val w = a.optInt(3); val h = a.optInt(4); val vis = a.optInt(5) == 1
            ui { views[id]?.let { v ->
                val lp = (v.layoutParams as? FrameLayout.LayoutParams) ?: FrameLayout.LayoutParams(w, h)
                if (lp.width != w || lp.height != h || lp.leftMargin != x || lp.topMargin != y) { lp.width = w; lp.height = h; lp.leftMargin = x; lp.topMargin = y; v.layoutParams = lp }
                v.visibility = if (vis) View.VISIBLE else View.INVISIBLE
            } }
            null
        }
        b.handle("wv:load") { a -> val id = a.optInt(0); val u = Json.str(a, 1) ?: ""; ui { if (URLUtil.isNetworkUrl(u) && !isAppOrigin(Uri.parse(u))) views[id]?.loadUrl(u) }; null }
        b.handle("wv:back") { a -> val id = a.optInt(0); ui { views[id]?.let { if (it.canGoBack()) it.goBack() } }; null }
        b.handle("wv:forward") { a -> val id = a.optInt(0); ui { views[id]?.let { if (it.canGoForward()) it.goForward() } }; null }
        b.handle("wv:reload") { a -> val id = a.optInt(0); ui { views[id]?.reload() }; null }
        b.handle("wv:stop") { a -> val id = a.optInt(0); ui { views[id]?.stopLoading() }; null }
        b.handle("wv:focus") { a -> val id = a.optInt(0); ui { views[id]?.requestFocus() }; null }
        b.handle("wv:exec") { a ->
            val id = a.optInt(0); val code = Json.str(a, 1) ?: ""
            val latch = CountDownLatch(1); var result: String? = null
            ui { val v = views[id]; if (v == null) latch.countDown() else v.evaluateJavascript(code) { r -> result = r; latch.countDown() } }
            latch.await(15, TimeUnit.SECONDS)
            result?.takeIf { it.isNotEmpty() }?.let { RawJson(it) }
        }
        b.handle("browser:clear") { val l = CountDownLatch(1); ui { clearData(); l.countDown() }; l.await(5, TimeUnit.SECONDS); true }
    }

    /** true when a visible in-app browser page took the back press */
    fun back(): Boolean {
        val v = views.values.firstOrNull { it.visibility == View.VISIBLE && it.canGoBack() } ?: return false
        v.goBack(); return true
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun create(id: Int) {
        if (views.containsKey(id)) return
        val w = WebView(act)
        w.settings.apply {
            javaScriptEnabled = true; domStorageEnabled = true; mediaPlaybackRequiresUserGesture = false
            setSupportMultipleWindows(false) // allowpopups=false: target=_blank opens here
            allowFileAccess = false; allowContentAccess = false
            builtInZoomControls = true; displayZoomControls = false
            useWideViewPort = true; loadWithOverviewMode = true
        }
        w.setBackgroundColor(0xffffffff.toInt())
        w.visibility = View.INVISIBLE
        w.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
                val u = req.url
                if (isAppOrigin(u)) return true // the app's own storage origin is never a web page here
                if (u.scheme == "http" || u.scheme == "https") return false
                try { act.startActivity(Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) {}
                return true
            }
            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                url?.let { Uri.parse(it) }?.let { if (it.scheme != null && it.host != null && !isAppOrigin(it)) origins.add(it.scheme + "://" + it.host + (if (it.port > 0) ":" + it.port else "")) }
            }
            override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) { event(id, view, "did-navigate", url) }
            override fun onPageCommitVisible(view: WebView, url: String?) { event(id, view, "dom-ready", url) }
            override fun onPageFinished(view: WebView, url: String?) { event(id, view, "did-stop-loading", url) }
        }
        w.webChromeClient = object : WebChromeClient() {
            override fun onReceivedTitle(view: WebView, title: String?) { if (!title.isNullOrEmpty()) event(id, view, "page-title-updated", title = title) }
            override fun onShowCustomView(view: View?, callback: CustomViewCallback?) = fullscreen(view, callback)
            override fun onHideCustomView() = fullscreen(null, null)
        }
        w.setDownloadListener { url, _, disposition, mime, _ -> download(url, URLUtil.guessFileName(url, disposition, mime), mime) }
        w.setOnLongClickListener { v -> menu(v as WebView) }
        layer.addView(w, FrameLayout.LayoutParams(1, 1))
        views[id] = w
    }

    private fun destroy(id: Int) {
        val w = views.remove(id) ?: return
        layer.removeView(w)
        w.stopLoading(); w.loadUrl("about:blank"); w.destroy()
    }

    /** like the desktop app's context menu for the webview */
    private fun menu(w: WebView): Boolean {
        val hit = w.hitTestResult
        val extra = hit.extra
        val isImg = hit.type == WebView.HitTestResult.IMAGE_TYPE || hit.type == WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE
        val link = if (hit.type == WebView.HitTestResult.SRC_ANCHOR_TYPE) extra else null
        val pm = PopupMenu(act, w)
        val m = pm.menu
        if (link != null && URLUtil.isNetworkUrl(link)) {
            m.add("Open link here").setOnMenuItemClickListener { w.loadUrl(link); true }
            m.add("Copy link address").setOnMenuItemClickListener { copy(link); true }
        }
        if (isImg && extra != null) {
            if (URLUtil.isNetworkUrl(extra)) m.add("Add image to board").setOnMenuItemClickListener { bridge.emit("browser:add-image", extra); true }
            if (URLUtil.isNetworkUrl(extra)) m.add("Copy image address").setOnMenuItemClickListener { copy(extra); true }
            if (URLUtil.isNetworkUrl(extra)) m.add("Save image as…").setOnMenuItemClickListener { download(extra, URLUtil.guessFileName(extra, null, null), null); true }
        }
        // text, selection and editing keep Android's own long-press handles and Copy / Paste / Select all toolbar
        if (m.size() == 0) return false
        m.add("Back").setEnabled(w.canGoBack()).setOnMenuItemClickListener { w.goBack(); true }
        m.add("Forward").setEnabled(w.canGoForward()).setOnMenuItemClickListener { w.goForward(); true }
        m.add("Reload").setOnMenuItemClickListener { w.reload(); true }
        pm.show()
        return true
    }

    private fun copy(s: String) {
        (act.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("link", s))
    }

    private fun download(url: String, name: String, mime: String?) {
        if (!URLUtil.isNetworkUrl(url)) return
        try {
            val r = DownloadManager.Request(Uri.parse(url))
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
            mime?.let { r.setMimeType(it) }
            CookieManager.getInstance().getCookie(url)?.let { r.addRequestHeader("Cookie", it) }
            (act.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(r)
            Toast.makeText(act, "Downloading $name", Toast.LENGTH_SHORT).show()
        } catch (_: Exception) {
            Toast.makeText(act, "Could not download $name", Toast.LENGTH_SHORT).show()
        }
    }

    /** the 'rejboard-ephemeral' partition: cookies, site storage and cache of the in-app browser (the app's own data is untouched) */
    fun clearData() {
        try { CookieManager.getInstance().removeAllCookies(null); CookieManager.getInstance().flush() } catch (_: Exception) {}
        val ws = WebStorage.getInstance()
        // WebStorage is shared by every WebView in the app: never delete the origin that holds the boards
        for (o in origins) if (!isAppOrigin(Uri.parse(o))) try { ws.deleteOrigin(o) } catch (_: Exception) {}
        origins.clear()
        views.values.firstOrNull()?.clearCache(true) ?: try { WebView(act).apply { clearCache(true); destroy() } } catch (_: Exception) {}
    }

    fun destroyAll() {
        for (id in views.keys.toList()) destroy(id)
        clearData()
    }
}
