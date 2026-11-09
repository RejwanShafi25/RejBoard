package com.rejwan.rejboard.features

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.rejwan.rejboard.BuildConfig
import com.rejwan.rejboard.Bridge
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * main.js "Secure in-app updates", for APK installs: the newest GitHub release is checked, its Android APK downloaded, its signing
 * certificate compared with the installed app's (a different signer is refused, like electron-updater's checksum check), and the
 * system installer started. Same statuses, events and channel names as the desktop app, so the Settings → Updates UI is unchanged.
 * Builds installed from Google Play update through Play instead (policy.enabled = false).
 */
class Updater(private val act: Activity, private val bridge: Bridge) {
    private val ctx: Context = act.applicationContext
    private val state = HashMap<String, Any?>()
    private var activity = mapOf("recording" to false, "lanTransfer" to false, "unsavedChanges" to false)
    @Volatile private var checking = false
    @Volatile private var ready = false
    private var apkUrl: String? = null
    private var apkFile: File? = null
    private val policy: Map<String, Any?> = computePolicy()

    init {
        state["status"] = "idle"; state["version"] = BuildConfig.VERSION_NAME; state["policy"] = policy; state["releasesUrl"] = RELEASES_URL
    }

    private fun computePolicy(): Map<String, Any?> {
        if (BuildConfig.DEBUG) return mapOf("enabled" to false, "reason" to "development", "releasesUrl" to RELEASES_URL)
        val installer = try {
            if (Build.VERSION.SDK_INT >= 30) ctx.packageManager.getInstallSourceInfo(ctx.packageName).installingPackageName
            else @Suppress("DEPRECATION") ctx.packageManager.getInstallerPackageName(ctx.packageName)
        } catch (_: Exception) { null }
        if (installer == "com.android.vending") return mapOf("enabled" to false, "reason" to "play-store", "releasesUrl" to RELEASES_URL)
        return mapOf("enabled" to true, "reason" to "apk")
    }

    private fun canInstallNow() = activity["recording"] != true && activity["lanTransfer"] != true && activity["unsavedChanges"] != true

    @Synchronized private fun status(patch: Map<String, Any?>) {
        state.putAll(patch)
        bridge.emit("updates:status", HashMap(state))
    }

    fun register(b: Bridge) {
        b.handle("updates:version") { BuildConfig.VERSION_NAME }
        b.handle("updates:renderer-ready") { bridge.emit("updates:status", HashMap(state) + mapOf("policy" to policy, "releasesUrl" to RELEASES_URL)); null }
        b.handle("updates:activity") { a ->
            val o = a.optJSONObject(0) ?: JSONObject()
            activity = mapOf("recording" to o.optBoolean("recording"), "lanTransfer" to o.optBoolean("lanTransfer"), "unsavedChanges" to o.optBoolean("unsavedChanges"))
            canInstallNow()
        }
        b.handle("updates:check") {
            if (policy["enabled"] != true) return@handle mapOf("ok" to false, "reason" to policy["reason"], "releasesUrl" to RELEASES_URL)
            if (checking) return@handle mapOf("ok" to true, "status" to state["status"])
            checking = true
            try { check(); mapOf("ok" to true) } catch (_: Exception) { mapOf("ok" to false, "reason" to "failed") } finally { checking = false }
        }
        b.handle("updates:download") {
            if (policy["enabled"] != true) return@handle mapOf("ok" to false, "reason" to policy["reason"], "releasesUrl" to RELEASES_URL)
            try { download(); mapOf("ok" to true) } catch (_: Exception) { mapOf("ok" to false, "reason" to "failed") }
        }
        b.handle("updates:install") {
            val f = apkFile
            if (!ready || f == null || !f.exists()) return@handle mapOf("ok" to false, "reason" to "not-ready")
            if (!canInstallNow()) return@handle mapOf("ok" to false, "reason" to "busy")
            if (Build.VERSION.SDK_INT >= 26 && !ctx.packageManager.canRequestPackageInstalls()) {
                act.runOnUiThread { try { act.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.packageName))) } catch (_: Exception) {} }
                return@handle mapOf("ok" to false, "reason" to "permission")
            }
            bridge.emit("updates:flush-save", null) // flush autosave before the installer replaces the app
            Thread.sleep(350)
            if (!canInstallNow()) return@handle mapOf("ok" to false, "reason" to "busy")
            val uri = FileProvider.getUriForFile(ctx, ctx.packageName + ".files", f)
            act.runOnUiThread {
                try {
                    act.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK))
                } catch (_: Exception) {}
            }
            mapOf("ok" to true)
        }
    }

    private fun reasonOf(e: Exception, code: Int = 0): String {
        val msg = e.message ?: ""
        return when {
            code == 403 || code == 429 || Regex("rate.?limit", RegexOption.IGNORE_CASE).containsMatchIn(msg) -> "rate-limit"
            Regex("checksum|signature|digest", RegexOption.IGNORE_CASE).containsMatchIn(msg) -> "checksum"
            e is java.net.UnknownHostException || e is java.net.SocketTimeoutException || e is java.net.ConnectException -> "offline"
            else -> "failed"
        }
    }

    private fun check() {
        status(mapOf("status" to "checking"))
        var code = 0
        try {
            val c = (URL(API_LATEST).openConnection() as HttpURLConnection).apply {
                connectTimeout = 15000; readTimeout = 20000
                setRequestProperty("Accept", "application/vnd.github+json")
                setRequestProperty("User-Agent", "RejBoard-Android")
            }
            val list = try { code = c.responseCode; if (code != 200) throw RuntimeException("HTTP $code"); JSONArray(c.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }) } finally { c.disconnect() }
            // Android versions are published as their own releases (tag android-vX.Y.Z), apart from the desktop installers:
            // take the newest published one
            var j: JSONObject? = null
            for (i in 0 until list.length()) {
                val r = list.getJSONObject(i)
                if (r.optBoolean("draft") || r.optBoolean("prerelease") || !r.optString("tag_name").startsWith(TAG_PREFIX)) continue
                if (j == null || newer(r.optString("tag_name").removePrefix(TAG_PREFIX), j.optString("tag_name").removePrefix(TAG_PREFIX))) j = r
            }
            if (j == null) { status(mapOf("status" to "up-to-date")); return }
            val tag = j.optString("tag_name").removePrefix(TAG_PREFIX)
            val assets = j.optJSONArray("assets")
            var url: String? = null
            if (assets != null) for (i in 0 until assets.length()) {
                val a = assets.getJSONObject(i); val n = a.optString("name")
                if (n.endsWith(".apk", true) && !n.contains("debug", true)) { url = a.optString("browser_download_url"); if (n.contains("android", true)) break }
            }
            if (url != null && newer(tag, BuildConfig.VERSION_NAME)) { apkUrl = url; status(mapOf("status" to "available", "availableVersion" to tag)) }
            else status(mapOf("status" to "up-to-date"))
        } catch (e: Exception) {
            status(mapOf("status" to "error", "reason" to reasonOf(e, code)))
            throw e
        }
    }

    private fun download() {
        val url = apkUrl ?: run { check(); apkUrl } ?: throw IllegalStateException("no update")
        val dir = File(ctx.cacheDir, "updates").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        val f = File(dir, "RejBoard-update.apk")
        try {
            var c = URL(url).openConnection() as HttpURLConnection
            c.instanceFollowRedirects = true; c.connectTimeout = 15000; c.readTimeout = 30000
            c.setRequestProperty("User-Agent", "RejBoard-Android")
            val total = c.contentLengthLong
            var got = 0L; var last = -1
            c.inputStream.use { input -> FileOutputStream(f).use { out ->
                val buf = ByteArray(128 * 1024)
                while (true) {
                    val n = input.read(buf); if (n < 0) break
                    out.write(buf, 0, n); got += n
                    val pct = if (total > 0) ((got * 100) / total).toInt().coerceIn(0, 100) else 0
                    if (pct != last) { last = pct; status(mapOf("status" to "downloading", "percent" to pct)) }
                }
            } }
            c.disconnect()
            verify(f)
            apkFile = f; ready = true
            status(mapOf("status" to "ready", "availableVersion" to state["availableVersion"]))
        } catch (e: Exception) {
            f.delete()
            status(mapOf("status" to "error", "reason" to reasonOf(e)))
            throw e
        }
    }

    /** the APK must be this app, newer, and signed with the same certificate as the installed one */
    @Suppress("DEPRECATION")
    private fun verify(f: File) {
        val pm = ctx.packageManager
        val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        val archive: PackageInfo = pm.getPackageArchiveInfo(f.path, flags) ?: throw SecurityException("checksum: not an APK")
        if (archive.packageName != ctx.packageName) throw SecurityException("checksum: wrong package")
        val installed = pm.getPackageInfo(ctx.packageName, flags)
        fun certs(p: PackageInfo): Set<String> = if (Build.VERSION.SDK_INT >= 28) {
            val si = p.signingInfo ?: return emptySet()
            (if (si.hasMultipleSigners()) si.apkContentsSigners else si.signingCertificateHistory).map { it.toCharsString() }.toSet()
        } else (p.signatures ?: emptyArray()).map { it.toCharsString() }.toSet()
        val a = certs(archive); val b = certs(installed)
        if (a.isEmpty() || a.intersect(b).isEmpty()) throw SecurityException("signature mismatch")
        val av = if (Build.VERSION.SDK_INT >= 28) archive.longVersionCode else archive.versionCode.toLong()
        val iv = if (Build.VERSION.SDK_INT >= 28) installed.longVersionCode else installed.versionCode.toLong()
        if (av <= iv) throw SecurityException("checksum: not newer")
    }

    companion object {
        /** Android releases only (the latest release on GitHub is the desktop one) */
        const val RELEASES_URL = "https://github.com/RejwanShafi25/RejBoard/releases?q=android"
        private const val API_LATEST = "https://api.github.com/repos/RejwanShafi25/RejBoard/releases?per_page=30"
        private const val TAG_PREFIX = "android-v"
        fun newer(a: String, b: String): Boolean {
            val x = a.split('.', '-').map { it.toIntOrNull() ?: 0 }; val y = b.split('.', '-').map { it.toIntOrNull() ?: 0 }
            for (i in 0 until maxOf(x.size, y.size)) { val p = x.getOrElse(i) { 0 }; val q = y.getOrElse(i) { 0 }; if (p != q) return p > q }
            return false
        }
    }
}
