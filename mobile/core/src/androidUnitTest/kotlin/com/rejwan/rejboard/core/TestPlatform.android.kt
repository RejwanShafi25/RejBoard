package com.rejwan.rejboard.core

import app.cash.sqldelight.db.SqlDriver
import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.rejwan.rejboard.core.db.RejBoardDb
import java.io.File

actual fun readGolden(name: String): String = File(GOLDEN_DIR, "$name.json").readText()

actual fun testDriver(): SqlDriver = JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { RejBoardDb.Schema.create(it) }
