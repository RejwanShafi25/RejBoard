package com.rejwan.rejboard.features

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.provider.MediaStore
import android.util.Log
import java.io.File

/**
 * A copy of every automatic daily backup in the phone's shared Documents/RejBoard backups folder.
 *
 * The boards themselves (and BackupStore's own copies) live in the app's private storage, which Android deletes when the app is
 * uninstalled or its storage is cleared (Settings > Apps > RejBoard > Clear storage). These copies are outside it, so they survive
 * both: after reinstalling, Home > Restore reads one back. Same names and the same rotation (7 daily, 4 weekly, 6 monthly) as the
 * private backups. Android 10 and later (no permission needed); on older versions the private backups are the only copies.
 */
object PublicBackups {
    private const val TAG = "RejBoardBackups"
    const val FOLDER = "Documents/RejBoard backups/"

    /** copies [file] into Documents/RejBoard backups and removes the copies this install made that rotation dropped ([keep] = names to keep) */
    fun mirror(ctx: Context, file: File, keep: Set<String>) {
        if (Build.VERSION.SDK_INT < 29) return
        val cr = ctx.contentResolver
        val coll = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        try {
            val v = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, file.name)
                put(MediaStore.MediaColumns.MIME_TYPE, "application/json")
                put(MediaStore.MediaColumns.RELATIVE_PATH, FOLDER)
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
            val uri = cr.insert(coll, v) ?: return
            try {
                cr.openOutputStream(uri, "w")!!.use { out -> file.inputStream().use { it.copyTo(out, 1 shl 16) } }
                cr.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
            } catch (e: Exception) {
                cr.delete(uri, null, null); throw e
            }
            // rotation: only files this install created are visible here, so another install's backups are never touched
            cr.query(coll, arrayOf(MediaStore.MediaColumns._ID, MediaStore.MediaColumns.DISPLAY_NAME),
                "${MediaStore.MediaColumns.RELATIVE_PATH}=?", arrayOf(FOLDER), null)?.use { c ->
                while (c.moveToNext()) {
                    val name = c.getString(1) ?: continue
                    if (BackupStore.timeOf(name) != null && name !in keep)
                        cr.delete(android.content.ContentUris.withAppendedId(coll, c.getLong(0)), null, null)
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "could not copy the backup to $FOLDER", e) // the private backup is already saved
        }
    }
}
