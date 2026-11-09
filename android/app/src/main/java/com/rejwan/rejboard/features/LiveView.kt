package com.rejwan.rejboard.features

import com.rejwan.rejboard.Bridge
import com.rejwan.rejboard.Json
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.OutputStream
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.URI
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.Executors

/**
 * Port of liveview.js ("Open on your phone"): a read-only, live view of the open board for devices on the same Wi-Fi.
 * Opt-in and temporary, random 128-bit key in the URL, GET only, same page, script, headers and CSP as the desktop app.
 */
object LiveView {
    private const val PORT = 41236
    private const val MAX_PAGES = 60
    private const val MAX_PAGE_BYTES = 24 * 1024 * 1024
    @Volatile private var server: ServerSocket? = null
    @Volatile private var key = ""
    @Volatile private var ver = 0
    @Volatile private var title = ""
    @Volatile private var pages: List<ByteArray> = emptyList()
    @Volatile private var at = 0L
    private var pool = Executors.newCachedThreadPool()

    fun register(b: Bridge) {
        b.handle("view:start") { start() }
        b.handle("view:update") { a -> update(a.optJSONObject(0)) }
        b.handle("view:stop") { stop() }
        b.handle("view:info") { info() }
    }

    /** the address a phone on the same Wi-Fi reaches: a private IPv4 if there is one */
    fun lanAddress(): String {
        val all = ArrayList<Pair<String, String>>()
        try {
            for (ni in NetworkInterface.getNetworkInterfaces()) {
                if (!ni.isUp || ni.isLoopback) continue
                for (ad in ni.inetAddresses) if (ad is Inet4Address && !ad.isLoopbackAddress) all.add(ni.name to ad.hostAddress!!)
            }
        } catch (_: Exception) {}
        val priv = Regex("^(10\\.|192\\.168\\.|172\\.(1[6-9]|2\\d|3[01])\\.)")
        val virt = Regex("tun|ppp|rmnet|ccmni|dummy|v4-", RegexOption.IGNORE_CASE)
        val pick = all.firstOrNull { priv.containsMatchIn(it.second) && it.first.startsWith("wlan") }
            ?: all.firstOrNull { priv.containsMatchIn(it.second) && !virt.containsMatchIn(it.first) }
            ?: all.firstOrNull { priv.containsMatchIn(it.second) } ?: all.firstOrNull()
        return pick?.second ?: "127.0.0.1"
    }

    @Synchronized fun start(): Map<String, Any?> {
        if (server != null) return info()
        key = ByteArray(16).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
        ver = 0; pages = emptyList(); title = ""
        val s = ServerSocket()
        s.reuseAddress = true
        try { s.bind(InetSocketAddress(InetAddress.getByName("0.0.0.0"), PORT)) } catch (_: Exception) { s.bind(InetSocketAddress(InetAddress.getByName("0.0.0.0"), 0)) }
        server = s
        if (pool.isShutdown) pool = Executors.newCachedThreadPool()
        pool.execute {
            while (!s.isClosed) {
                val c = try { s.accept() } catch (_: Exception) { break }
                pool.execute { serve(c) }
            }
        }
        return info()
    }

    fun info(): Map<String, Any?> {
        val s = server ?: return mapOf("on" to false)
        return mapOf("on" to true, "url" to "http://${lanAddress()}:${s.localPort}/v/$key/", "port" to s.localPort)
    }

    /** the app sends {title, pages: [Uint8Array png, ...]} whenever the board changes */
    fun update(d: JSONObject?): Boolean {
        if (server == null || d == null) return false
        val arr = d.optJSONArray("pages")
        val list = ArrayList<ByteArray>()
        if (arr != null) for (i in 0 until minOf(arr.length(), MAX_PAGES)) {
            val p = Json.bytesOf(arr.opt(i)) ?: continue
            if (p.size > 8 && p.size <= MAX_PAGE_BYTES && p[0] == 0x89.toByte() && p[1] == 0x50.toByte()) list.add(p)
        }
        title = d.optString("title", "RejBoard").ifEmpty { "RejBoard" }.take(120)
        pages = list; ver++; at = System.currentTimeMillis()
        return true
    }

    @Synchronized fun stop(): Map<String, Any?> {
        try { server?.close() } catch (_: Exception) {}
        server = null; key = ""; pages = emptyList()
        return mapOf("on" to false)
    }

    private fun esc(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&#39;")

    private fun page(): String {
        val t = esc(title.ifEmpty { "RejBoard" })
        return """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>$t</title>
<style>body{margin:0;background:#ecebf3;font:15px system-ui,sans-serif;color:#222}header{position:sticky;top:0;background:#fff;padding:10px 14px;box-shadow:0 1px 6px #0002;display:flex;gap:8px;align-items:center}
header b{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}header span{font-size:12px;opacity:.6}main{display:flex;flex-direction:column;align-items:center;gap:14px;padding:14px}
img{max-width:100%;height:auto;background:#fff;box-shadow:0 2px 10px #0002;border-radius:4px}footer{text-align:center;font-size:12px;opacity:.55;padding:10px 0 20px}</style></head>
<body><header><b id="t">$t</b><span id="s">Live · read-only</span></header><main id="m"></main><footer>Made with RejBoard</footer><script src="view.js"></script></body></html>"""
    }

    private const val SCRIPT = """(()=>{let v=-1;const m=document.getElementById('m'),t=document.getElementById('t'),s=document.getElementById('s');
async function tick(){try{const r=await fetch('state.json',{cache:'no-store'});if(!r.ok){s.textContent='Sharing stopped';return}const j=await r.json();
 if(j.ver!==v){v=j.ver;t.textContent=j.title;document.title=j.title;m.replaceChildren(...Array.from({length:j.pages},(_,k)=>{const i=new Image();i.alt='Page '+(k+1);i.src='p'+(k+1)+'.png?v='+j.ver;return i}))}
 s.textContent='Live · read-only · updated '+new Date(j.at).toLocaleTimeString();setTimeout(tick,2000)}catch(e){s.textContent='Not reachable, retrying…';setTimeout(tick,4000)}}tick()})();"""

    private const val CSP = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

    private fun serve(sock: Socket) {
        sock.use { c ->
            try {
                c.soTimeout = 15000
                val input = BufferedInputStream(c.getInputStream())
                val line = readLine(input) ?: return
                while (true) { val h = readLine(input) ?: return; if (h.isEmpty()) break } // headers are not needed
                val parts = line.split(' ')
                val out = c.getOutputStream()
                if (parts.size < 2) return
                if (parts[0] != "GET") return send(out, 405, "text/plain", "Read-only".toByteArray())
                val path = try { URI("http://x" + parts[1]).path ?: "/" } catch (_: Exception) { "/" }
                val seg = path.split('/').filter { it.isNotEmpty() }
                val k = key
                val ok = seg.size >= 2 && seg[0] == "v" && k.isNotEmpty() && seg[1].length == k.length &&
                    MessageDigest.isEqual(seg[1].toByteArray(), k.toByteArray()) // constant time
                if (!ok) return send(out, 404, "text/plain", "Not found".toByteArray())
                if (seg.size == 2 && !path.endsWith("/")) return send(out, 301, null, ByteArray(0), mapOf("Location" to "$path/"), plain = true)
                val f = seg.getOrNull(2) ?: ""
                when {
                    f.isEmpty() -> send(out, 200, "text/html; charset=utf-8", page().toByteArray())
                    f == "view.js" -> send(out, 200, "text/javascript; charset=utf-8", SCRIPT.toByteArray())
                    f == "state.json" -> send(out, 200, "application/json", JSONObject().put("ver", ver).put("title", title).put("pages", pages.size).put("at", if (at > 0) at else System.currentTimeMillis()).toString().toByteArray())
                    else -> {
                        val m = Regex("^p(\\d+)\\.png$").matchEntire(f)
                        val p = m?.groupValues?.get(1)?.toIntOrNull()?.let { pages.getOrNull(it - 1) }
                        if (p != null) send(out, 200, "image/png", p) else send(out, 404, "text/plain", "Not found".toByteArray())
                    }
                }
            } catch (_: Exception) {}
        }
    }

    private fun readLine(i: BufferedInputStream): String? {
        val sb = StringBuilder()
        while (true) {
            val b = i.read()
            if (b < 0) return if (sb.isEmpty()) null else sb.toString()
            if (b == '\n'.code) return sb.toString().trimEnd('\r')
            if (sb.length > 8192) return null
            sb.append(b.toChar())
        }
    }

    private fun send(out: OutputStream, code: Int, type: String?, body: ByteArray, extra: Map<String, String> = emptyMap(), plain: Boolean = false) {
        val reason = mapOf(200 to "OK", 301 to "Moved Permanently", 404 to "Not Found", 405 to "Method Not Allowed")[code] ?: "OK"
        val h = StringBuilder("HTTP/1.1 $code $reason\r\n")
        if (!plain) {
            h.append("Content-Type: $type\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\n")
            h.append("Content-Security-Policy: $CSP\r\n")
        }
        for ((k, v) in extra) h.append("$k: $v\r\n")
        h.append("Content-Length: ${body.size}\r\nConnection: close\r\n\r\n")
        out.write(h.toString().toByteArray())
        out.write(body)
        out.flush()
    }
}
