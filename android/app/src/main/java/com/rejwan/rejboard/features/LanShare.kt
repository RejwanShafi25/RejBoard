package com.rejwan.rejboard.features

import android.content.Context
import android.net.wifi.WifiManager
import android.util.Base64
import com.rejwan.rejboard.Bridge
import com.rejwan.rejboard.Json
import org.bouncycastle.crypto.agreement.X25519Agreement
import org.bouncycastle.crypto.digests.SHA256Digest
import org.bouncycastle.crypto.generators.HKDFBytesGenerator
import org.bouncycastle.crypto.params.HKDFParameters
import org.bouncycastle.crypto.params.X25519PrivateKeyParameters
import org.bouncycastle.crypto.params.X25519PublicKeyParameters
import org.json.JSONArray
import org.json.JSONObject
import java.io.DataInputStream
import java.io.EOFException
import java.io.OutputStream
import java.net.ConnectException
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.nio.ByteBuffer
import java.security.SecureRandom
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Port of lan.js - local-network board sharing, wire-compatible with the Windows / macOS / Linux app:
 *  - Discovery: UDP broadcast of {app:'rejboard-lan', v:1, id, name, port} on port 41234 (only while "Receive" is on).
 *  - Transfer: TCP (41235). Fresh X25519 key exchange per transfer -> HKDF-SHA256 -> AES-256-GCM per direction.
 *  - The receiver confirms a 6-digit code that both screens show (defeats man-in-the-middle).
 *  - Encryption exists ONLY on the wire.
 */
class LanShare(private val ctx: Context, private val bridge: Bridge, private val myName: () -> String) {
    private val id = UUID.randomUUID().toString()
    @Volatile private var on = false
    @Volatile private var server: ServerSocket? = null
    @Volatile private var port = 0
    @Volatile private var udp: DatagramSocket? = null
    private var timer: ScheduledExecutorService? = null
    private val pool = Executors.newCachedThreadPool { r -> Thread(r, "rb-lan").apply { isDaemon = true } }
    private val peers = ConcurrentHashMap<String, Peer>()
    private val sessions = ConcurrentHashMap<String, Session>()
    @Volatile private var sig = ""
    private var mlock: WifiManager.MulticastLock? = null
    private val rnd = SecureRandom()

    private data class Peer(val id: String, val name: String, val host: String, val port: Int, val seen: Long)
    private class Session(val sock: Socket) { @Volatile var respond: ((Boolean) -> Unit)? = null }

    private fun emit(ch: String, d: Any?) = bridge.emit("lan:$ch", d)
    private fun clean(s: Any?): String = (s?.toString() ?: "").replace(Regex("[\\u0000-\\u001f]"), "").take(64)
    private fun fmtCode(n: Long): String { val s = n.toString().padStart(6, '0'); return s.substring(0, 3) + " " + s.substring(3) }

    private fun ipv4(): List<Pair<Inet4Address, Short>> {
        val o = ArrayList<Pair<Inet4Address, Short>>()
        try {
            for (ni in NetworkInterface.getNetworkInterfaces()) {
                if (!ni.isUp || ni.isLoopback) continue
                for (ia in ni.interfaceAddresses) { val a = ia.address; if (a is Inet4Address && !a.isLoopbackAddress) o.add(a to ia.networkPrefixLength) }
            }
        } catch (_: Exception) {}
        return o
    }
    private fun addrs() = ipv4().map { it.first.hostAddress!! }
    private fun bcast(): List<String> {
        val o = linkedSetOf("255.255.255.255")
        for ((a, prefix) in ipv4()) {
            val ip = ByteBuffer.wrap(a.address).int
            val mask = if (prefix <= 0) 0 else (-1 shl (32 - prefix))
            val b = ip or mask.inv()
            o.add(InetAddress.getByAddress(ByteBuffer.allocate(4).putInt(b).array()).hostAddress!!)
        }
        return o.toList()
    }

    /* ---- crypto ---- */
    private class Keys(val priv: X25519PrivateKeyParameters, val pub: ByteArray)
    private class Derived(val c2s: ByteArray, val s2c: ByteArray, val sas: Long)
    private fun newKeys(): Keys { val p = X25519PrivateKeyParameters(rnd); return Keys(p, p.generatePublicKey().encoded) }
    private fun derive(priv: X25519PrivateKeyParameters, theirRaw: ByteArray, pubC: ByteArray, pubS: ByteArray): Derived {
        if (theirRaw.size != 32) throw IllegalStateException("Bad key")
        val secret = ByteArray(32)
        X25519Agreement().apply { init(priv) }.calculateAgreement(X25519PublicKeyParameters(theirRaw, 0), secret, 0)
        val salt = pubC + pubS
        fun k(info: String, n: Int): ByteArray {
            val g = HKDFBytesGenerator(SHA256Digest())
            g.init(HKDFParameters(secret, salt, "rejboard-lan-v1 $info".toByteArray()))
            return ByteArray(n).also { g.generateBytes(it, 0, n) }
        }
        val sas = (ByteBuffer.wrap(k("sas", 4)).int.toLong() and 0xffffffffL) % 1000000L
        return Derived(k("c2s", 32), k("s2c", 32), sas)
    }

    /** length-prefixed frames; AES-256-GCM with a 64-bit big-endian counter nonce once keys are set (lan.js Chan) */
    private class Chan(val sock: Socket) {
        private val input = DataInputStream(sock.getInputStream().buffered())
        private val out: OutputStream = sock.getOutputStream().buffered(1 shl 16)
        var sk: ByteArray? = null
        var rk: ByteArray? = null
        private var sn = 0L
        private var rn = 0L
        var max = 4096
        private fun nonce(n: Long) = ByteBuffer.allocate(12).putInt(0).putLong(n).array()
        fun read(): ByteArray {
            val n = input.readInt()
            if (n < 0 || n > max) throw IllegalStateException("Frame too large")
            val body = ByteArray(n).also { input.readFully(it) }
            val k = rk ?: return body
            if (body.size < 16) throw IllegalStateException("short")
            return try {
                Cipher.getInstance("AES/GCM/NoPadding").run {
                    init(Cipher.DECRYPT_MODE, SecretKeySpec(k, "AES"), GCMParameterSpec(128, nonce(rn++)))
                    doFinal(body)
                }
            } catch (e: Exception) { throw IllegalStateException("Decryption failed — data was tampered with or the keys do not match") }
        }
        @Synchronized fun raw(b: ByteArray) {
            out.write(ByteBuffer.allocate(4).putInt(b.size).array()); out.write(b); out.flush()
        }
        fun send(p: ByteArray) {
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.ENCRYPT_MODE, SecretKeySpec(sk!!, "AES"), GCMParameterSpec(128, nonce(sn++)))
            raw(c.doFinal(p)) // ciphertext || 16-byte tag, as in lan.js
        }
    }
    private fun ctrl(o: JSONObject) = byteArrayOf(1) + o.toString().toByteArray()
    private fun parseCtrl(m: ByteArray): JSONObject { if (m.isEmpty() || m[0] != 1.toByte()) throw IllegalStateException("Unexpected message"); return JSONObject(String(m, 1, m.size - 1, Charsets.UTF_8)) }

    /* ---- receiving ---- */
    private fun onConn(sock: Socket) {
        if (!on || sessions.size >= 3) { try { sock.close() } catch (_: Exception) {}; return }
        val sid = UUID.randomUUID().toString()
        val sess = Session(sock)
        sessions[sid] = sess
        pool.execute {
            try {
                sock.soTimeout = 20000
                val ch = Chan(sock); val keys = newKeys()
                var stage = 0; var size = 0L; var got = 0L; var name = ""
                val chunks = java.io.ByteArrayOutputStream()
                while (true) {
                    val m = try { ch.read() } catch (e: SocketTimeoutException) { if (synchronized(sess) { stage } == 2) sess.respond?.invoke(false); break } catch (_: EOFException) { break }
                    when (synchronized(sess) { stage }) {
                        0 -> { // client hello (plain: public key only)
                            val h = JSONObject(String(m, Charsets.UTF_8))
                            if (h.optInt("v") != 1) throw IllegalStateException("Version")
                            val theirPub = Base64.decode(h.optString("pub"), Base64.DEFAULT)
                            name = clean(h.opt("name")).ifEmpty { sock.inetAddress.hostAddress ?: "" }
                            val k = derive(keys.priv, theirPub, theirPub, keys.pub)
                            val code = fmtCode(k.sas)
                            ch.raw(JSONObject().put("v", 1).put("pub", Base64.encodeToString(keys.pub, Base64.NO_WRAP)).toString().toByteArray())
                            ch.sk = k.s2c; ch.rk = k.c2s; ch.max = FRAME_MAX; stage = 1
                            sess.respond = null
                            // keep the code for the offer
                            sockCodes[sid] = code
                        }
                        1 -> { // encrypted offer
                            val o = parseCtrl(m)
                            size = o.optLong("size", -1)
                            if (o.optString("t") != "offer" || !(size > 0 && size <= MAX_BYTES)) throw IllegalStateException("Bad offer")
                            synchronized(sess) { stage = 2 }
                            sess.respond = { ok ->
                                synchronized(sess) {
                                    if (stage == 2) {
                                        if (!ok) { try { ch.send(ctrl(JSONObject().put("t", "reject"))) } catch (_: Exception) {}; stage = 9; try { sock.shutdownOutput() } catch (_: Exception) {}; try { sock.close() } catch (_: Exception) {} }
                                        else { stage = 3; sock.soTimeout = 60000; ch.send(ctrl(JSONObject().put("t", "accept"))) }
                                    }
                                }
                            }
                            sock.soTimeout = 120000
                            emit("incoming", mapOf("sid" to sid, "name" to name, "code" to sockCodes[sid], "count" to o.optLong("count", 0).coerceIn(0L, 100000L),
                                "size" to size, "host" to (sock.inetAddress.hostAddress ?: "")))
                        }
                        3 -> { // encrypted data chunks
                            if (m.isEmpty() || m[0] != 2.toByte()) throw IllegalStateException("Unexpected message")
                            got += m.size - 1
                            if (got > size) throw IllegalStateException("Too much data")
                            chunks.write(m, 1, m.size - 1)
                            emit("progress", mapOf("role" to "recv", "sid" to sid, "name" to name, "sent" to got, "total" to size))
                            if (got == size) {
                                stage = 4
                                val payload = chunks.toString("UTF-8"); chunks.reset()
                                emit("received", mapOf("from" to name, "payload" to payload))
                                ch.send(ctrl(JSONObject().put("t", "done")))
                                break
                            }
                        }
                        else -> throw IllegalStateException("Unexpected message")
                    }
                }
            } catch (_: Exception) {
            } finally {
                sessions.remove(sid); sockCodes.remove(sid)
                try { sock.close() } catch (_: Exception) {}
            }
        }
    }
    private val sockCodes = ConcurrentHashMap<String, String>()

    /* ---- sending ---- */
    private fun send(peer: JSONObject?, payload: String, count: Int): Map<String, Any?> {
        val host = peer?.optString("host") ?: ""
        if (!Regex("^[A-Za-z0-9.\\-]{1,253}$").matches(host)) return mapOf("ok" to false, "error" to "Invalid address.")
        val data = payload.toByteArray(Charsets.UTF_8)
        if (data.size > MAX_BYTES) return mapOf("ok" to false, "error" to "Too much data to send at once (limit 1 GB).")
        val p = peer!!.optInt("port", 0).let { if (it > 0) it else TCP_PORT }
        val sock = Socket()
        var stage = 0
        try {
            try { sock.connect(InetSocketAddress(host, p), 10000) }
            catch (e: ConnectException) { return mapOf("ok" to false, "error" to "That computer is not receiving. Turn on “Receive boards” there.") }
            catch (e: SocketTimeoutException) { return mapOf("ok" to false, "error" to "Could not reach that computer (timed out). Is “Receive boards” on there, and is a firewall blocking the app?") }
            sock.soTimeout = 10000
            val ch = Chan(sock); val keys = newKeys()
            ch.raw(JSONObject().put("v", 1).put("pub", Base64.encodeToString(keys.pub, Base64.NO_WRAP)).put("name", myName().take(48)).toString().toByteArray())
            while (true) {
                val m = try { ch.read() } catch (e: SocketTimeoutException) {
                    return mapOf("ok" to false, "error" to when (stage) { 0 -> "Could not reach that computer (timed out). Is “Receive boards” on there, and is a firewall blocking the app?"; 1 -> "The other computer did not respond in time."; else -> "Transfer timed out." })
                } catch (e: EOFException) {
                    return mapOf("ok" to false, "error" to if (stage >= 3) "Connection closed before the transfer finished." else "The other computer closed the connection.")
                }
                if (stage == 0) { // server hello
                    val h = JSONObject(String(m, Charsets.UTF_8))
                    val theirPub = Base64.decode(h.optString("pub"), Base64.DEFAULT)
                    val k = derive(keys.priv, theirPub, keys.pub, theirPub)
                    ch.sk = k.c2s; ch.rk = k.s2c; ch.max = FRAME_MAX; stage = 1
                    sock.soTimeout = 150000
                    emit("sas", mapOf("code" to fmtCode(k.sas)))
                    ch.send(ctrl(JSONObject().put("t", "offer").put("size", data.size).put("count", count)))
                    continue
                }
                val c = parseCtrl(m)
                when (c.optString("t")) {
                    "reject" -> return mapOf("ok" to false, "error" to "The other computer declined the boards.")
                    "done" -> return mapOf("ok" to true, "count" to count)
                    "accept" -> if (stage == 1) {
                        stage = 3; sock.soTimeout = 60000
                        emit("progress", mapOf("role" to "send", "sent" to 0, "total" to data.size))
                        var o = 0
                        while (o < data.size) {
                            val end = minOf(o + CHUNK, data.size)
                            val frame = ByteArray(1 + end - o); frame[0] = 2; System.arraycopy(data, o, frame, 1, end - o)
                            ch.send(frame)
                            emit("progress", mapOf("role" to "send", "sent" to end, "total" to data.size))
                            o = end
                        }
                    }
                }
            }
        } catch (e: Exception) {
            return mapOf("ok" to false, "error" to (e.message ?: if (stage >= 3) "Connection closed before the transfer finished." else "The other computer closed the connection."))
        } finally { try { sock.close() } catch (_: Exception) {} }
    }

    /* ---- discovery ---- */
    private fun announce() {
        val now = System.currentTimeMillis(); var changed = false
        for ((k, pe) in peers) if (now - pe.seen > 7000) { peers.remove(k); changed = true }
        val msg = JSONObject().put("app", "rejboard-lan").put("v", 1).put("id", id).put("name", myName().take(48)).put("port", port).toString().toByteArray()
        val u = udp ?: return
        for (a in bcast()) try { u.send(DatagramPacket(msg, msg.size, InetAddress.getByName(a), DISC_PORT)) } catch (_: Exception) {}
        pushPeers(changed)
    }
    private fun peerList() = peers.values.sortedBy { it.name }.map { mapOf("id" to it.id, "name" to it.name, "host" to it.host, "port" to it.port) }
    private fun pushPeers(force: Boolean = false) {
        val l = peerList(); val s = JSONArray(l.map { JSONObject(it) }).toString()
        if (force || s != sig) { sig = s; emit("peers", l) }
    }
    private fun startUdp() {
        val u = DatagramSocket(null).apply { reuseAddress = true; broadcast = true; bind(InetSocketAddress(DISC_PORT)) }
        udp = u
        pool.execute {
            val buf = ByteArray(2048)
            while (!u.isClosed) {
                val pk = DatagramPacket(buf, buf.size)
                try { u.receive(pk) } catch (_: Exception) { if (u.isClosed) break else continue }
                try {
                    val d = JSONObject(String(pk.data, pk.offset, pk.length, Charsets.UTF_8))
                    val pid = d.optString("id"); val pp = d.optInt("port", 0)
                    if (d.optString("app") != "rejboard-lan" || pid == id || pid.isEmpty() || pp !in 1..65535) continue
                    val host = pk.address.hostAddress ?: continue
                    peers[pid] = Peer(pid, clean(d.opt("name")).ifEmpty { host }, host, pp, System.currentTimeMillis())
                    pushPeers()
                } catch (_: Exception) {}
            }
        }
        timer = Executors.newSingleThreadScheduledExecutor().also { it.scheduleWithFixedDelay({ try { announce() } catch (_: Exception) {} }, 0, 2, TimeUnit.SECONDS) }
    }

    private fun info(extra: Map<String, Any?> = emptyMap()) = mapOf("on" to on, "name" to myName().take(48), "addrs" to addrs(), "port" to port) + extra

    @Synchronized fun start(): Map<String, Any?> {
        if (on) return info()
        val srv = ServerSocket().apply { reuseAddress = true }
        try { srv.bind(InetSocketAddress(TCP_PORT)) } catch (_: Exception) {
            try { srv.bind(InetSocketAddress(0)) } catch (e2: Exception) { return info(mapOf("error" to "Could not open a network port: " + e2.message)) }
        }
        server = srv; port = srv.localPort; on = true
        try {
            val wm = ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            mlock = wm.createMulticastLock("rejboard-lan").apply { setReferenceCounted(false); acquire() } // lets broadcasts in on Wi-Fi
        } catch (_: Exception) {}
        pool.execute { while (!srv.isClosed) { val c = try { srv.accept() } catch (_: Exception) { break }; onConn(c) } }
        try { startUdp() } catch (_: Exception) {}
        return info()
    }

    @Synchronized fun stop(): Map<String, Any?> {
        on = false
        timer?.shutdownNow(); timer = null
        for (s in sessions.values) try { s.sock.close() } catch (_: Exception) {}
        sessions.clear()
        try { server?.close() } catch (_: Exception) {}
        try { udp?.close() } catch (_: Exception) {}
        try { mlock?.release() } catch (_: Exception) {}
        server = null; udp = null; mlock = null; port = 0; peers.clear(); sig = ""
        return info()
    }

    fun register(b: Bridge) {
        b.handle("lan:info") { info() }
        b.handle("lan:start") { start() }
        b.handle("lan:stop") { stop() }
        b.handle("lan:peers") { peerList() }
        b.handle("lan:send") { a -> send(a.optJSONObject(0), a.opt(1)?.toString() ?: "", a.optInt(2, 0)) }
        b.handle("lan:respond") { a -> sessions[Json.str(a, 0) ?: ""]?.respond?.invoke(a.optBoolean(1)); null }
    }

    companion object {
        private const val DISC_PORT = 41234
        private const val TCP_PORT = 41235
        private const val MAX_BYTES = 1024L * 1024 * 1024
        private const val CHUNK = 256 * 1024
        private const val FRAME_MAX = 4 * 1024 * 1024
    }
}
