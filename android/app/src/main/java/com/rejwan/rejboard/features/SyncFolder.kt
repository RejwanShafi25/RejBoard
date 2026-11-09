package com.rejwan.rejboard.features

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.DocumentsContract.Document
import com.rejwan.rejboard.Bridge
import com.rejwan.rejboard.Json
import org.json.JSONObject

/**
 * main.js "shared sync folder": per-board .rjwb files plus a lock file in a folder that a sync app keeps in the cloud
 * (Google Drive, OneDrive, Dropbox, Nextcloud...). On Android the folder is picked with the system folder picker
 * (Storage Access Framework) and remembered with a persistable permission. The page never sends a path; names are validated
 * with the same rule as the desktop app.
 */
class SyncFolder(private val ctx: Context, private val pickTree: () -> Uri?, private val hostName: () -> String) {
    private val prefs = ctx.getSharedPreferences("syncfolder", Context.MODE_PRIVATE)
    private val cr get() = ctx.contentResolver

    private fun tree(): Uri? {
        val s = prefs.getString("tree", null) ?: return null
        val u = Uri.parse(s)
        val granted = cr.persistedUriPermissions.any { it.uri == u && it.isReadPermission && it.isWritePermission }
        return if (granted) u else null
    }

    /** a readable label for the folder, e.g. "Documents/RejBoard" or "Google Drive › RejBoard" */
    private fun label(u: Uri?): String {
        if (u == null) return ""
        return try {
            val id = DocumentsContract.getTreeDocumentId(u)
            val path = id.substringAfter(':', id)
            val root = id.substringBefore(':', "")
            val provider = u.authority ?: ""
            when {
                provider == "com.android.externalstorage.documents" -> if (root == "primary") "Internal storage/" + path else "$root/$path"
                provider.contains("google") -> "Google Drive › " + (displayName(u) ?: path)
                else -> (displayName(u) ?: path).ifEmpty { u.toString() }
            }.trimEnd('/')
        } catch (_: Exception) { u.toString() }
    }

    private fun displayName(tree: Uri): String? = try {
        val doc = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
        cr.query(doc, arrayOf(Document.COLUMN_DISPLAY_NAME), null, null, null)?.use { if (it.moveToFirst()) it.getString(0) else null }
    } catch (_: Exception) { null }

    private data class Child(val name: String, val uri: Uri, val size: Long, val mtime: Long)

    private fun children(t: Uri): List<Child> {
        val parent = DocumentsContract.getTreeDocumentId(t)
        val q = DocumentsContract.buildChildDocumentsUriUsingTree(t, parent)
        val out = ArrayList<Child>()
        cr.query(q, arrayOf(Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME, Document.COLUMN_SIZE, Document.COLUMN_LAST_MODIFIED, Document.COLUMN_MIME_TYPE), null, null, null)?.use { c ->
            while (c.moveToNext()) {
                if (c.getString(4) == Document.MIME_TYPE_DIR) continue
                out.add(Child(c.getString(1) ?: continue, DocumentsContract.buildDocumentUriUsingTree(t, c.getString(0)), if (c.isNull(2)) 0 else c.getLong(2), if (c.isNull(3)) 0 else c.getLong(3)))
            }
        }
        return out
    }

    private fun find(t: Uri, name: String) = children(t).firstOrNull { it.name == name }

    private fun info(): Map<String, Any?> = mapOf("dir" to label(tree()), "host" to hostName())

    fun register(b: Bridge) {
        b.handle("sync:get") { info() }
        b.handle("sync:choose") {
            val u = pickTree() ?: return@handle info()
            try { cr.takePersistableUriPermission(u, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION) } catch (_: SecurityException) {}
            // release the previous folder
            prefs.getString("tree", null)?.let { old -> if (old != u.toString()) try { cr.releasePersistableUriPermission(Uri.parse(old), Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION) } catch (_: Exception) {} }
            prefs.edit().putString("tree", u.toString()).apply()
            info()
        }
        b.handle("sync:list") {
            val t = tree() ?: return@handle null
            children(t).filter { it.name.endsWith(".rjwb", ignoreCase = true) }.map { mapOf("name" to it.name, "size" to it.size, "mtime" to it.mtime.toDouble()) }
        }
        b.handle("sync:read") { a ->
            val t = tree() ?: return@handle null
            val n = Json.str(a, 0)
            if (!validName(n)) return@handle null
            try { find(t, n!!)?.let { c -> cr.openInputStream(c.uri)?.use { it.readBytes().toString(Charsets.UTF_8) } } } catch (_: Exception) { null }
        }
        b.handle("sync:write") { a ->
            val t = tree() ?: return@handle false
            val n = Json.str(a, 0); val text = Json.str(a, 1)
            if (!validName(n) || text == null) return@handle false
            write(t, n!!, text.toByteArray(Charsets.UTF_8))
        }
        b.handle("sync:remove") { a ->
            val t = tree() ?: return@handle false
            val n = Json.str(a, 0); val owner = Json.str(a, 1)
            if (!validName(n)) return@handle false
            try {
                val c = find(t, n!!) ?: return@handle false
                if (!owner.isNullOrEmpty()) { // lock files: only delete our own, never one another device took over
                    val cur = try { JSONObject(cr.openInputStream(c.uri)!!.use { it.readBytes().toString(Charsets.UTF_8) }) } catch (_: Exception) { return@handle false }
                    if (cur.optString("id") != owner) return@handle false
                }
                DocumentsContract.deleteDocument(cr, c.uri)
            } catch (_: Exception) { false }
        }
    }

    /** write to a temp file first, then swap it in, so a sync client never uploads a half-written board */
    private fun write(t: Uri, name: String, data: ByteArray): Boolean {
        val parent = DocumentsContract.buildDocumentUriUsingTree(t, DocumentsContract.getTreeDocumentId(t))
        val tmpName = ".$name.tmp"
        try {
            find(t, tmpName)?.let { DocumentsContract.deleteDocument(cr, it.uri) }
            val tmp = DocumentsContract.createDocument(cr, parent, "application/octet-stream", tmpName)
            if (tmp != null) {
                val okWrite = try { cr.openOutputStream(tmp, "wt")!!.use { it.write(data) }; true } catch (_: Exception) { false }
                if (okWrite) {
                    find(t, name)?.let { DocumentsContract.deleteDocument(cr, it.uri) }
                    val renamed = try { DocumentsContract.renameDocument(cr, tmp, name) } catch (_: Exception) { null }
                    if (renamed != null && find(t, name) != null) return true
                }
                try { DocumentsContract.deleteDocument(cr, tmp) } catch (_: Exception) {}
            }
        } catch (_: Exception) {}
        // providers without rename (some cloud apps): write the file in place; they upload only after the stream is closed
        return try {
            val target = find(t, name)?.uri ?: DocumentsContract.createDocument(cr, parent, "application/octet-stream", name) ?: return false
            cr.openOutputStream(target, "wt")!!.use { it.write(data) }
            true
        } catch (_: Exception) { false }
    }

    companion object {
        private val BAD = Regex("[/:*?\"<>|\\u0000-\\u001f]")
        fun validName(n: String?): Boolean = n != null && n.isNotEmpty() && n.length < 200 && n != "." && n != ".." && !BAD.containsMatchIn(n) &&
            (n.endsWith(".rjwb", ignoreCase = true) || n == ".rejboard-lock.json")
    }
}
