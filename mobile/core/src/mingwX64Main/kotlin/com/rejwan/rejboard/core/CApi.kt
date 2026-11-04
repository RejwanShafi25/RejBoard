@file:OptIn(ExperimentalForeignApi::class, ExperimentalNativeApi::class)

package com.rejwan.rejboard.core

import kotlinx.cinterop.ByteVar
import kotlinx.cinterop.CPointer
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.convert
import kotlinx.cinterop.reinterpret
import kotlinx.cinterop.set
import kotlinx.cinterop.toKString
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import platform.posix.free
import platform.posix.malloc
import kotlin.experimental.ExperimentalNativeApi
import kotlin.native.CName

/*
 * The C ABI of rejboard_core.dll, used by the Windows app (mobile/windows/RejBoardNative/rejboard_core.h declares the same).
 * All strings are UTF-8. Every returned string is malloc'ed here and must be released with rb_free; NULL means failure,
 * and rb_last_error then says why. Call from one thread (the UI thread).
 */

private var store: BoardStore? = null
private var lastError: String = ""

private fun cString(s: String): CPointer<ByteVar>? {
    val b = s.encodeToByteArray()
    val p = malloc((b.size + 1).convert())?.reinterpret<ByteVar>() ?: return null
    for (i in b.indices) p[i] = b[i]
    p[b.size] = 0
    return p
}

private inline fun guarded(block: () -> String?): CPointer<ByteVar>? = try {
    block()?.let(::cString)
} catch (e: Throwable) {
    lastError = e.message ?: e.toString()
    null
}

@CName("rb_version")
fun rbVersion(): CPointer<ByteVar>? = cString(CORE_VERSION)

@CName("rb_free")
fun rbFree(p: CPointer<ByteVar>?) {
    free(p)
}

@CName("rb_last_error")
fun rbLastError(): CPointer<ByteVar>? = cString(lastError)

/** Opens (or creates) the board database in [folder]; [nowMs] is the current time (ms since 1970). Returns 1 on success, 0 on failure. */
@CName("rb_store_open")
fun rbStoreOpen(folder: CPointer<ByteVar>?, nowMs: Long): Int = try {
    val dir = folder?.toKString() ?: error("no folder given")
    val s = BoardStore(DriverFactory(dir).create())
    s.ensureSample(nowMs)
    store = s
    1
} catch (e: Throwable) {
    lastError = e.message ?: e.toString()
    0
}

private fun openStore(): BoardStore = store ?: error("rb_store_open was not called")

/** JSON array of {id, title, updated, locked, items}, newest first. */
@CName("rb_store_list")
fun rbStoreList(): CPointer<ByteVar>? = guarded {
    BoardJson.write(JsonArray(openStore().list().map { b ->
        buildJsonObject { put("id", b.id); put("title", b.title); put("updated", b.updated); put("locked", b.locked); put("items", b.itemCount) }
    }))
}

/** Imports the text of a .rjwb file at time [nowMs]; returns the board id. */
@CName("rb_store_import")
fun rbStoreImport(text: CPointer<ByteVar>?, nowMs: Long): CPointer<ByteVar>? = guarded {
    openStore().importRjwb(text?.toKString() ?: error("no file text given"), nowMs)
}

/** The drawing scene of a board as JSON (see Scene.toJson), or NULL for a missing or password-protected board. */
@CName("rb_board_scene")
fun rbBoardScene(id: CPointer<ByteVar>?): CPointer<ByteVar>? = guarded {
    val board = openStore().load(id?.toKString() ?: error("no board id given")) ?: error("board not found")
    if (board.isProtected) error("This board is password-protected; opening it comes in a later version")
    Scene.of(board).toJson()
}

/** Title of a board. */
@CName("rb_board_title")
fun rbBoardTitle(id: CPointer<ByteVar>?): CPointer<ByteVar>? = guarded {
    openStore().load(id?.toKString() ?: error("no board id given"))?.title
}
