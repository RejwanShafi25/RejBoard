@file:OptIn(ExperimentalForeignApi::class)

package com.rejwan.rejboard.core

import app.cash.sqldelight.db.SqlDriver
import app.cash.sqldelight.driver.native.NativeSqliteDriver
import com.rejwan.rejboard.core.db.RejBoardDb
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.addressOf
import kotlinx.cinterop.convert
import kotlinx.cinterop.usePinned
import platform.posix.fclose
import platform.posix.fopen
import platform.posix.fread

actual fun readGolden(name: String): String {
    val path = "$GOLDEN_DIR/$name.json"
    val f = fopen(path, "rb") ?: error("cannot open $path")
    try {
        val out = ArrayList<ByteArray>()
        var total = 0
        while (true) {
            val buf = ByteArray(1 shl 16)
            val n = buf.usePinned { fread(it.addressOf(0), 1.convert(), buf.size.convert(), f) }.toInt()
            if (n <= 0) break
            out += if (n == buf.size) buf else buf.copyOf(n)
            total += n
        }
        val all = ByteArray(total)
        var o = 0
        for (b in out) { b.copyInto(all, o); o += b.size }
        return all.decodeToString()
    } finally {
        fclose(f)
    }
}

private var dbCounter = 0

actual fun testDriver(): SqlDriver = NativeSqliteDriver(RejBoardDb.Schema, "test-${dbCounter++}.db", onConfiguration = { it.copy(inMemory = true) })
