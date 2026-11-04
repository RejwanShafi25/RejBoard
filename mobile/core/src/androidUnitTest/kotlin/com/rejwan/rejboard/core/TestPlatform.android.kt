package com.rejwan.rejboard.core

import app.cash.sqldelight.db.SqlDriver
import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.rejwan.rejboard.core.db.RejBoardDb
import java.io.File

/** rb.goldenDir is set by the Gradle test task; otherwise look relative to the working directory (the module folder). */
private val goldenDir: File by lazy {
    System.getProperty("rb.goldenDir")?.takeIf { it.isNotEmpty() }?.let(::File)
        ?: listOf("golden", "core/golden", "mobile/core/golden").map(::File).firstOrNull { it.isDirectory }
        ?: error("cannot find the golden fixtures; set -Drb.goldenDir=mobile/core/golden")
}

actual fun readGolden(name: String): String = File(goldenDir, "$name.json").readText()

actual fun testDriver(): SqlDriver = JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { RejBoardDb.Schema.create(it) }
