package com.rejwan.rejboard.features

import com.rejwan.rejboard.Bridge
import com.rejwan.rejboard.Json
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.security.SecureRandom
import java.util.Calendar
import java.util.GregorianCalendar

/**
 * Port of backup-store.js: automatic daily backups into <app files>/backups, same file names
 * ("RejBoard backup 2026-10-22 1405.json"), same begin/chunk/end/abort protocol and the same rotation
 * (newest 7 daily, 4 weekly and 6 monthly backups, never the newest one).
 */
class BackupStore(val dir: File) {
    private class Cur(val token: String, val tmp: File, val out: FileOutputStream, var bytes: Long, var last: Long)
    private var cur: Cur? = null
    private val lock = Any()

    data class Entry(val name: String, val size: Long, val t: Long)

    fun list(): List<Entry> {
        val names = dir.list() ?: return emptyList()
        return names.mapNotNull { n ->
            val t = timeOf(n) ?: return@mapNotNull null
            val f = File(dir, n)
            if (f.isFile) Entry(n, f.length(), t) else null
        }.sortedByDescending { it.t }
    }

    fun begin(): Map<String, Any?> = synchronized(lock) {
        val c = cur
        if (c != null && System.currentTimeMillis() - c.last < STALE_MS) return mapOf("ok" to false, "error" to "a backup is already being written")
        drop()
        dir.mkdirs()
        val token = ByteArray(16).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
        val tmp = File(dir, ".partial-$token.json")
        if (!tmp.createNewFile()) return mapOf("ok" to false, "error" to "could not start the backup")
        cur = Cur(token, tmp, FileOutputStream(tmp), 0, System.currentTimeMillis())
        mapOf("ok" to true, "token" to token)
    }

    fun chunk(token: String?, text: String?): Map<String, Any?> = synchronized(lock) {
        val c = own(token) ?: return mapOf("ok" to false, "error" to "no such backup")
        if (text == null) { drop(); return mapOf("ok" to false, "error" to "bad data") }
        val b = text.toByteArray(Charsets.UTF_8)
        if (b.size > MAX_CHUNK || c.bytes + b.size > MAX_TOTAL) { drop(); return mapOf("ok" to false, "error" to "backup too large") }
        try { c.out.write(b) } catch (e: IOException) {
            drop()
            return mapOf("ok" to false, "error" to if ((e.message ?: "").contains("ENOSPC")) "not enough disk space" else "could not write the backup")
        }
        c.bytes += b.size; c.last = System.currentTimeMillis()
        mapOf("ok" to true)
    }

    fun end(token: String?): Map<String, Any?> = synchronized(lock) {
        val c = own(token) ?: return mapOf("ok" to false, "error" to "no such backup")
        try { c.out.fd.sync(); c.out.close() } catch (_: IOException) { drop(); return mapOf("ok" to false, "error" to "could not write the backup") }
        cur = null
        var name = nameFor(System.currentTimeMillis())
        var k = 2
        while (File(dir, name).exists() && k < 1000) { name = name.replace(Regex("( \\(\\d+\\))?\\.json$"), " ($k).json"); k++ }
        if (!c.tmp.renameTo(File(dir, name))) { c.tmp.delete(); return mapOf("ok" to false, "error" to "could not save the backup") }
        val del = rotate(list().map { it.name })
        for (n in del) File(dir, n).delete()
        val saved = File(dir, name)
        try { onSaved?.invoke(saved, list().map { it.name }.toSet()) } catch (_: Exception) {}
        mapOf("ok" to true, "name" to name, "bytes" to c.bytes, "deleted" to del.size)
    }

    /** called after each saved backup with the file and the names rotation kept (Android: PublicBackups.mirror) */
    var onSaved: ((File, Set<String>) -> Unit)? = null

    fun abort(token: String?): Map<String, Any?> = synchronized(lock) { if (own(token) != null) drop(); mapOf("ok" to true) }

    /** only a name that list() returns can be read: no paths, no other files */
    fun read(name: String?): String? {
        if (name == null || list().none { it.name == name }) return null
        return try { File(dir, name).readText(Charsets.UTF_8) } catch (_: Exception) { null }
    }

    /** temp files left behind by a crash */
    fun cleanup() = synchronized(lock) {
        dir.listFiles()?.forEach { f -> if (PARTIAL_RE.matches(f.name) && f != cur?.tmp) f.delete() }
    }

    private fun own(t: String?): Cur? { val c = cur; return if (c != null && t != null && t.length == 32 && t == c.token) c else null }
    private fun drop() { val c = cur ?: return; try { c.out.close() } catch (_: Exception) {}; c.tmp.delete(); cur = null }

    fun register(b: Bridge, open: () -> Boolean) {
        cleanup()
        b.handle("backup:begin") { try { begin() } catch (_: Exception) { mapOf("ok" to false, "error" to "could not start the backup") } }
        b.handle("backup:chunk") { a -> chunk(Json.str(a, 0), Json.str(a, 1)) }
        b.handle("backup:end") { a -> end(Json.str(a, 0)) }
        b.handle("backup:abort") { a -> abort(Json.str(a, 0)) }
        b.handle("backup:list") { list().map { mapOf("name" to it.name, "size" to it.size, "t" to it.t) } }
        b.handle("backup:read") { a -> read(Json.str(a, 0)) }
        b.handle("backup:open") { dir.mkdirs(); open() }
    }

    companion object {
        private const val PREFIX = "RejBoard backup "
        private val NAME_RE = Regex("^RejBoard backup (\\d{4})-(\\d{2})-(\\d{2}) (\\d{2})(\\d{2})(?: \\((\\d{1,3})\\))?\\.json$")
        private val PARTIAL_RE = Regex("^\\.partial-[0-9a-f]{32}\\.json$")
        const val MAX_CHUNK = 64L * 1048576
        const val MAX_TOTAL = 8L * 1024 * 1048576
        private const val STALE_MS = 10 * 60_000L
        private val KEEP = Triple(7, 4, 6)

        private fun pad(n: Int) = n.toString().padStart(2, '0')
        fun nameFor(ms: Long): String {
            val d = GregorianCalendar().apply { timeInMillis = ms }
            return PREFIX + d.get(Calendar.YEAR) + "-" + pad(d.get(Calendar.MONTH) + 1) + "-" + pad(d.get(Calendar.DAY_OF_MONTH)) + " " +
                pad(d.get(Calendar.HOUR_OF_DAY)) + pad(d.get(Calendar.MINUTE)) + ".json"
        }

        /** backup file name -> local time in ms, or null for anything that is not one of ours */
        fun timeOf(name: String): Long? {
            val m = NAME_RE.matchEntire(name) ?: return null
            val g = m.groupValues
            val y = g[1].toInt(); val mo = g[2].toInt() - 1; val da = g[3].toInt()
            val d = GregorianCalendar(y, mo, da, g[4].toInt(), g[5].toInt())
            d.isLenient = true
            return if (d.get(Calendar.YEAR) == y && d.get(Calendar.MONTH) == mo && d.get(Calendar.DAY_OF_MONTH) == da)
                d.timeInMillis + (g[6].toIntOrNull() ?: 0) else null
        }

        private fun cal(t: Long) = GregorianCalendar().apply { timeInMillis = t }
        private fun dayKey(t: Long) = cal(t).let { "${it.get(Calendar.YEAR)}-${it.get(Calendar.MONTH)}-${it.get(Calendar.DAY_OF_MONTH)}" }
        private fun weekKey(t: Long) = cal(t).let {
            it.set(Calendar.HOUR_OF_DAY, 0); it.set(Calendar.MINUTE, 0); it.set(Calendar.SECOND, 0); it.set(Calendar.MILLISECOND, 0)
            val dow = it.get(Calendar.DAY_OF_WEEK) - 1 // JS getDay(): Sunday = 0
            it.add(Calendar.DAY_OF_MONTH, -((dow + 6) % 7))
            "w" + it.timeInMillis
        }
        private fun monthKey(t: Long) = cal(t).let { "m${it.get(Calendar.YEAR)}-${it.get(Calendar.MONTH)}" }

        /** names: backup file names (others are ignored). Returns the names to delete. */
        fun rotate(names: List<String>): List<String> {
            val v = names.mapNotNull { n -> timeOf(n)?.let { n to it } }.sortedByDescending { it.second }
            val kept = HashSet<String>()
            if (v.isNotEmpty()) kept.add(v[0].first)
            for ((key, limit) in listOf<Pair<(Long) -> String, Int>>(::dayKey to KEEP.first, ::weekKey to KEEP.second, ::monthKey to KEEP.third)) {
                val seen = HashSet<String>()
                for ((n, t) in v) {
                    val k = key(t)
                    if (k in seen) continue
                    seen.add(k)
                    if (seen.size > limit) break
                    kept.add(n)
                }
            }
            return v.filter { it.first !in kept }.map { it.first }
        }
    }
}
