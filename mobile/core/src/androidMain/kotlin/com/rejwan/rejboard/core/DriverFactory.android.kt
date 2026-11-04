package com.rejwan.rejboard.core

import android.content.Context
import app.cash.sqldelight.db.SqlDriver
import app.cash.sqldelight.driver.android.AndroidSqliteDriver
import com.rejwan.rejboard.core.db.RejBoardDb

actual class DriverFactory(private val context: Context) {
    actual fun create(): SqlDriver = AndroidSqliteDriver(RejBoardDb.Schema, context, DB_NAME)
}
