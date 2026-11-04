@file:OptIn(ExperimentalForeignApi::class)

package com.rejwan.rejboard.core

import app.cash.sqldelight.db.SqlDriver
import app.cash.sqldelight.driver.native.NativeSqliteDriver
import com.rejwan.rejboard.core.db.RejBoardDb
import kotlinx.cinterop.CPointer
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.addressOf
import kotlinx.cinterop.convert
import kotlinx.cinterop.toKString
import kotlinx.cinterop.usePinned
import platform.Foundation.NSBundle
import platform.Foundation.NSProcessInfo
import platform.posix.FILE
import platform.posix.fclose
import platform.posix.fopen
import platform.posix.fread
import platform.posix.getenv

/** Folders to look in: RB_GOLDEN_DIR (set by the Gradle test task), then `golden` next to every folder above the test binary
    (the simulator gets neither the task's environment nor the Mac's /tmp, but the binary lives in core/build/bin/...),
    then paths relative to the working directory. */
private fun goldenDirs(): List<String> {
    val up = ArrayList<String>()
    val exe = NSBundle.mainBundle.executablePath ?: (NSProcessInfo.processInfo.arguments.firstOrNull() as? String)
    var d = exe?.substringBeforeLast('/')
    while (!d.isNullOrEmpty() && up.size < 8) { up += "$d/golden"; d = d.substringBeforeLast('/', "") }
    return listOfNotNull(getenv("RB_GOLDEN_DIR")?.toKString()?.takeIf { it.isNotEmpty() }) + up +
        listOf("golden", "core/golden", "mobile/core/golden", "../golden")
}

actual fun readGolden(name: String): String {
    var f: CPointer<FILE>? = null
    for (d in goldenDirs()) {
        f = fopen("$d/$name.json", "rb")
        if (f != null) break
    }
    val file: CPointer<FILE> = f ?: error("cannot find golden fixture $name.json (looked in ${goldenDirs()}); set RB_GOLDEN_DIR to mobile/core/golden")
    try {
        val out = ArrayList<ByteArray>()
        var total = 0
        while (true) {
            val buf = ByteArray(1 shl 16)
            val n = buf.usePinned { fread(it.addressOf(0), 1.convert(), buf.size.convert(), file) }.toInt()
            if (n <= 0) break
            out += if (n == buf.size) buf else buf.copyOf(n)
            total += n
        }
        val all = ByteArray(total)
        var o = 0
        for (b in out) { b.copyInto(all, o); o += b.size }
        return all.decodeToString()
    } finally {
        fclose(file)
    }
}

private var dbCounter = 0

actual fun testDriver(): SqlDriver = NativeSqliteDriver(RejBoardDb.Schema, "test-${dbCounter++}.db", onConfiguration = { it.copy(inMemory = true) })
