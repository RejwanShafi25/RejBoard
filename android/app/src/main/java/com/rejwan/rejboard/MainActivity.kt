package com.rejwan.rejboard

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.BitmapFactory
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.provider.Settings
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.MimeTypeMap
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.ActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import com.rejwan.rejboard.features.BackupStore
import com.rejwan.rejboard.features.BrowserOverlay
import com.rejwan.rejboard.features.DocRender
import com.rejwan.rejboard.features.LanShare
import com.rejwan.rejboard.features.LiveView
import com.rejwan.rejboard.features.NetFeatures
import com.rejwan.rejboard.features.Notifier
import com.rejwan.rejboard.features.PublicBackups
import com.rejwan.rejboard.features.SyncFolder
import com.rejwan.rejboard.features.Updater
import org.json.JSONObject
import java.io.File
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

/**
 * RejBoard for Android. Hosts the very same UI as the desktop (Electron) app - index.html and its modules, bundled in the APK - in a
 * full-screen WebView, and implements everything Electron's main process does for it natively (see Bridge and features/).
 */
class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private lateinit var bridge: Bridge
    private lateinit var overlay: BrowserOverlay
    private lateinit var lan: LanShare
    private lateinit var notifier: Notifier
    private lateinit var backups: BackupStore
    private lateinit var stage: FrameLayout
    private lateinit var fsLayer: FrameLayout
    private var splash: View? = null
    private var mainShown = false
    private val main = Handler(Looper.getMainLooper())
    private var lastBack = 0L

    /* ---- activity results, usable from bridge threads ---- */
    private val resultLock = Any()
    @Volatile private var pendingResult: CompletableFuture<ActivityResult?>? = null
    private val resultLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r -> pendingResult?.complete(r); pendingResult = null }
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private val fileLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val cb = fileCallback; fileCallback = null
        cb?.onReceiveValue(if (r.resultCode == RESULT_OK) urisOf(r.data) else null)
    }
    private var permCallback: ((Map<String, Boolean>) -> Unit)? = null
    private val permLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { r -> val cb = permCallback; permCallback = null; cb?.invoke(r) }
    private var fsCallback: WebChromeClient.CustomViewCallback? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)

        /* layout: [outer [root (insets) [stage [web][in-app browser layer]] [splash]] [fullscreen layer]] */
        val outer = FrameLayout(this)
        val root = FrameLayout(this)
        stage = FrameLayout(this)
        web = InkWebView(this)
        val browserLayer = FrameLayout(this)
        fsLayer = FrameLayout(this).apply { visibility = View.GONE; setBackgroundColor(Color.BLACK) }
        stage.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        stage.addView(browserLayer, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(stage, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.setBackgroundColor(ContextCompat.getColor(this, R.color.rb_bg))
        outer.addView(root, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        outer.addView(fsLayer, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(outer)
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            WindowInsetsCompat.CONSUMED
        }
        showSplash(root)

        /* ---- native bridge (window.wb) ---- */
        bridge = Bridge(web)
        backups = BackupStore(File(filesDir, "backups"))
        // a copy outside the app's private storage, so clearing the app's storage or uninstalling never takes the backups too
        backups.onSaved = { f, keep -> PublicBackups.mirror(applicationContext, f, keep) }
        notifier = Notifier(this) { p -> askPermissionsBlocking(arrayOf(p))[p] == true }
        overlay = BrowserOverlay(this, browserLayer, bridge) { v, cb -> setFullscreen(v, cb) }
        lan = LanShare(this, bridge, ::hostName)
        NetFeatures.register(bridge, this)
        backups.register(bridge, ::shareBackups)
        SyncFolder(this, { awaitResult(Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION))?.takeIf { it.resultCode == RESULT_OK }?.data?.data }, ::hostName).register(bridge)
        LiveView.register(bridge)
        lan.register(bridge)
        Updater(this, bridge).register(bridge)
        overlay.register(bridge)
        notifier.register(bridge)
        bridge.handle("app:ready") { runOnUiThread { showMain() }; null }
        bridge.handle("app:board") { a ->
            val t = (Json.str(a, 0) ?: "").take(80)
            try { File(filesDir, "last-board.json").writeText(JSONObject().put("title", t).toString()) } catch (_: Exception) {}
            null
        }
        bridge.handle("file:save") { a -> saveFile(Json.str(a, 0) ?: "download", Json.str(a, 1) ?: "", Json.str(a, 2) ?: "") }
        bridge.install()
        overlay.clearData() // what websites stored in the in-app browser never outlives a session (the app may have been killed last time)

        /* ---- the WebView ---- */
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        val assets = WebViewAssetLoader.Builder().setDomain(WebAssets.HOST).addPathHandler("/", WebAssets(this, { bridge }, ::bootJson)).build()
        DocRender(this, stage, assets).register(bridge) // Word / PowerPoint -> pages
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            @Suppress("DEPRECATION") databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            setSupportZoom(false); builtInZoomControls = false; displayZoomControls = false
            textZoom = 100
            useWideViewPort = true; loadWithOverviewMode = false
            setSupportMultipleWindows(true); javaScriptCanOpenWindowsAutomatically = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            offscreenPreRaster = true
        }
        web.setBackgroundColor(ContextCompat.getColor(this, R.color.rb_bg))
        web.overScrollMode = View.OVER_SCROLL_NEVER
        web.isVerticalScrollBarEnabled = false; web.isHorizontalScrollBarEnabled = false
        web.setLayerType(View.LAYER_TYPE_HARDWARE, null)
        if (Build.VERSION.SDK_INT >= 33) web.isAutoHandwritingEnabled = false // a stylus draws on the board, it does not type into a focused box
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, req: WebResourceRequest): WebResourceResponse? =
                if (req.url.host == WebAssets.HOST) assets.shouldInterceptRequest(req.url) else null
            override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
                if (req.url.host == WebAssets.HOST && req.url.scheme == "https") return false
                openExternal(req.url); return true // like setWindowOpenHandler -> shell.openExternal
            }
            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) { bridge.reset() }
            override fun onReceivedError(view: WebView, req: WebResourceRequest, err: WebResourceError) { if (req.isForMainFrame) showMain() }
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                Log.e(TAG, "renderer gone (crash=${detail.didCrash()}), restarting")
                recreate(); return true
            }
        }
        web.webChromeClient = MainChrome()
        web.setDownloadListener { url, _, _, _, _ -> openExternal(Uri.parse(url)) }
        main.postDelayed({ showMain() }, 12000) // never leave the user without the app, even if the page never reports in
        web.loadUrl(WebAssets.START_URL)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = onBack()
        })
        handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); handleIntent(intent) }
    private fun handleIntent(i: Intent?) {
        val id = i?.getIntExtra(Notifier.EXTRA_ID, -1) ?: -1
        if (id >= 0) { i?.removeExtra(Notifier.EXTRA_ID); main.postDelayed({ bridge.emit("notify:click", id) }, 300) }
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        val dark = (newConfig.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        WindowInsetsControllerCompat(window, window.decorView).apply { isAppearanceLightStatusBars = !dark; isAppearanceLightNavigationBars = !dark }
    }

    override fun onDestroy() {
        try { LiveView.stop() } catch (_: Exception) {}
        try { lan.stop() } catch (_: Exception) {}
        try { overlay.destroyAll() } catch (_: Exception) {}
        bridge.shutdown()
        (web.parent as? ViewGroup)?.removeView(web)
        web.destroy()
        super.onDestroy()
    }

    /* ---- the start-up screen: splash.html's look, naming the board being opened (remembered from last time) ---- */
    private fun showSplash(root: FrameLayout) {
        val dp = { v: Float -> TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, resources.displayMetrics).toInt() }
        val last = try { JSONObject(File(filesDir, "last-board.json").readText()).optString("title").take(80) } catch (_: Exception) { "" }
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER
            setBackgroundColor(ContextCompat.getColor(context, R.color.rb_bg))
            isClickable = true
        }
        box.addView(ImageView(this).apply {
            try { setImageBitmap(assets.open("web/icon-192.png").use { BitmapFactory.decodeStream(it) }) } catch (_: Exception) { setImageResource(R.mipmap.ic_launcher) }
        }, LinearLayout.LayoutParams(dp(68f), dp(68f)))
        box.addView(TextView(this).apply {
            text = getString(R.string.app_name); setTextColor(ContextCompat.getColor(context, R.color.rb_fg))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f); typeface = android.graphics.Typeface.DEFAULT_BOLD; gravity = Gravity.CENTER
            setPadding(0, dp(10f), 0, 0)
        })
        box.addView(TextView(this).apply {
            text = if (last.isNotEmpty()) "Opening “$last”…" else "Starting…"
            setTextColor(ContextCompat.getColor(context, R.color.rb_fg)); alpha = .8f
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f); maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END; gravity = Gravity.CENTER
            setPadding(dp(24f), dp(6f), dp(24f), 0)
        })
        box.addView(ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            isIndeterminate = true
            indeterminateTintList = android.content.res.ColorStateList.valueOf(ContextCompat.getColor(context, R.color.rb_accent))
            progressBackgroundTintList = android.content.res.ColorStateList.valueOf(ContextCompat.getColor(context, R.color.rb_track))
        }, LinearLayout.LayoutParams(dp(150f), dp(6f)).apply { topMargin = dp(12f) })
        root.addView(box, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        splash = box
    }

    private fun showMain() {
        if (mainShown) return
        mainShown = true
        val s = splash ?: return
        splash = null
        s.animate().alpha(0f).setDuration(160).withEndAction { (s.parent as? ViewGroup)?.removeView(s) }.start()
    }

    /* ---- back button: leave fullscreen, go back in the in-app browser, else close the top-most dialog (Escape) ---- */
    private fun onBack() {
        if (fsCallback != null) { fsCallback?.onCustomViewHidden(); setFullscreen(null, null); return }
        if (overlay.back()) return
        val now = System.currentTimeMillis()
        if (now - lastBack < 1800) { moveTaskToBack(true); return }
        lastBack = now
        bridge.emit("app:back", null)
        Toast.makeText(this, R.string.press_back_again, Toast.LENGTH_SHORT).show()
    }

    /* ---- fullscreen (presentation mode, fullscreen videos) ---- */
    private fun setFullscreen(v: View?, cb: WebChromeClient.CustomViewCallback?) {
        val ctl = WindowInsetsControllerCompat(window, window.decorView)
        fsLayer.removeAllViews()
        if (v != null) {
            fsCallback = cb
            fsLayer.addView(v, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            fsLayer.visibility = View.VISIBLE
            ctl.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            ctl.hide(WindowInsetsCompat.Type.systemBars())
        } else {
            fsCallback = null
            fsLayer.visibility = View.GONE
            ctl.show(WindowInsetsCompat.Type.systemBars())
        }
    }

    private inner class MainChrome : WebChromeClient() {
        override fun onShowFileChooser(view: WebView, cb: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = cb
            val accepts = params.acceptTypes.flatMap { it.split(',') }.map { it.trim().lowercase() }.filter { it.isNotEmpty() }
            // extensions such as .rjwb or .json have no reliable MIME type on Android: then let every file be picked (the page checks the type)
            val mimes = if (accepts.isEmpty() || accepts.any { !it.contains('/') }) listOf("*/*") else accepts
            val i = Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            if (mimes.size == 1) i.type = mimes[0] else { i.type = "*/*"; i.putExtra(Intent.EXTRA_MIME_TYPES, mimes.toTypedArray()) }
            if (params.mode == FileChooserParams.MODE_OPEN_MULTIPLE) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            return try { fileLauncher.launch(i); true } catch (_: ActivityNotFoundException) { fileCallback = null; false }
        }

        /** microphone (voice recordings) and camera (document scanner) for the app's own page only */
        override fun onPermissionRequest(req: PermissionRequest) {
            if (req.origin.host != WebAssets.HOST) { req.deny(); return }
            val want = req.resources.mapNotNull {
                when (it) {
                    PermissionRequest.RESOURCE_AUDIO_CAPTURE -> Manifest.permission.RECORD_AUDIO
                    PermissionRequest.RESOURCE_VIDEO_CAPTURE -> Manifest.permission.CAMERA
                    else -> null
                }
            }.distinct()
            askPermissions(want.toTypedArray()) { granted ->
                val res = req.resources.filter {
                    (it == PermissionRequest.RESOURCE_AUDIO_CAPTURE && granted[Manifest.permission.RECORD_AUDIO] == true) ||
                        (it == PermissionRequest.RESOURCE_VIDEO_CAPTURE && granted[Manifest.permission.CAMERA] == true)
                }
                if (res.isEmpty()) req.deny() else req.grant(res.toTypedArray())
            }
        }

        /** window.open / target=_blank: open in the system browser, as Electron's shell.openExternal does */
        override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
            val tmp = WebView(this@MainActivity)
            tmp.webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest): Boolean { openExternal(r.url); v.destroy(); return true }
            }
            (resultMsg.obj as WebView.WebViewTransport).webView = tmp
            resultMsg.sendToTarget()
            return true
        }

        override fun onShowCustomView(view: View?, callback: CustomViewCallback?) = setFullscreen(view, callback)
        override fun onHideCustomView() = setFullscreen(null, null)

        override fun onConsoleMessage(m: ConsoleMessage): Boolean {
            if (BuildConfig.DEBUG || m.messageLevel() == ConsoleMessage.MessageLevel.ERROR) Log.println(
                if (m.messageLevel() == ConsoleMessage.MessageLevel.ERROR) Log.ERROR else Log.DEBUG, "RejBoardPage", "${m.message()} (${m.sourceId()}:${m.lineNumber()})")
            return true
        }
    }

    private fun urisOf(data: Intent?): Array<Uri>? {
        if (data == null) return null
        val clip = data.clipData
        if (clip != null && clip.itemCount > 0) return Array(clip.itemCount) { clip.getItemAt(it).uri }
        return data.data?.let { arrayOf(it) }
    }

    /* ---- helpers for bridge threads ---- */
    fun awaitResult(intent: Intent): ActivityResult? = synchronized(resultLock) {
        val f = CompletableFuture<ActivityResult?>()
        runOnUiThread {
            pendingResult = f
            try { resultLauncher.launch(intent) } catch (_: Exception) { pendingResult = null; f.complete(null) }
        }
        try { f.get(30, TimeUnit.MINUTES) } catch (_: Exception) { null }
    }

    private fun askPermissions(perms: Array<String>, cb: (Map<String, Boolean>) -> Unit) {
        val missing = perms.filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isEmpty()) { cb(perms.associateWith { true }); return }
        permCallback = { r -> cb(perms.associateWith { p -> r[p] ?: (ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED) }) }
        try { permLauncher.launch(missing.toTypedArray()) } catch (_: Exception) { permCallback = null; cb(perms.associateWith { false }) }
    }

    private fun askPermissionsBlocking(perms: Array<String>): Map<String, Boolean> {
        val f = CompletableFuture<Map<String, Boolean>>()
        runOnUiThread { askPermissions(perms) { f.complete(it) } }
        return try { f.get(10, TimeUnit.MINUTES) } catch (_: Exception) { emptyMap() }
    }

    /** <a download> from the page: the system "Save as" picker, like Electron's save dialog for downloads */
    private fun saveFile(name: String, mimeIn: String, key: String): Boolean {
        val bytes = bridge.takeBytes(key) ?: ByteArray(0)
        val ext = name.substringAfterLast('.', "").lowercase()
        val mime = mimeIn.ifEmpty { MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream" }
        val r = awaitResult(Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(mime).putExtra(Intent.EXTRA_TITLE, name))
        val uri = r?.takeIf { it.resultCode == RESULT_OK }?.data?.data ?: return false
        return try {
            contentResolver.openOutputStream(uri, "wt")!!.use { it.write(bytes) }
            runOnUiThread { Toast.makeText(this, "Saved $name", Toast.LENGTH_SHORT).show() }
            true
        } catch (e: Exception) {
            runOnUiThread { Toast.makeText(this, "Could not save $name", Toast.LENGTH_LONG).show() }
            false
        }
    }

    /** Settings → "Open backups folder": Android has no folder window, so the backups are offered to the share sheet (Files, Drive, ...) */
    private fun shareBackups(): Boolean {
        val files = backups.list().map { File(backups.dir, it.name) }.filter { it.exists() }
        if (files.isEmpty()) { runOnUiThread { Toast.makeText(this, "No automatic backups yet", Toast.LENGTH_SHORT).show() }; return true }
        val uris = ArrayList(files.map { FileProvider.getUriForFile(this, "$packageName.files", it) })
        val send = Intent(Intent.ACTION_SEND_MULTIPLE).setType("application/json").putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        runOnUiThread { try { startActivity(Intent.createChooser(send, "RejBoard backups")) } catch (_: Exception) {} }
        return true
    }

    private fun openExternal(u: Uri) {
        if (u.scheme !in listOf("http", "https", "mailto", "tel")) return
        try { startActivity(Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) {}
    }

    /** the name other devices see for this one (os.hostname() on the desktop) */
    fun hostName(): String {
        val n = try { Settings.Global.getString(contentResolver, Settings.Global.DEVICE_NAME) } catch (_: Exception) { null }
        return (n?.takeIf { it.isNotBlank() } ?: (Build.MANUFACTURER.replaceFirstChar { it.uppercase() } + " " + Build.MODEL)).take(48)
    }

    private fun bootJson(): String = JSONObject().put("notifications", notifier.permission()).put("version", BuildConfig.VERSION_NAME).toString()

    companion object { private const val TAG = "RejBoard" }
}
