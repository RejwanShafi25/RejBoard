package com.rejwan.rejboard.core

import app.cash.sqldelight.db.SqlDriver
import app.cash.sqldelight.driver.native.NativeSqliteDriver
import com.rejwan.rejboard.core.db.RejBoardDb

/** [folder]: where the database file goes. The Windows app passes its MSIX package LocalState folder, nothing else. */
actual class DriverFactory(private val folder: String) {
    actual fun create(): SqlDriver = NativeSqliteDriver(RejBoardDb.Schema, DB_NAME, onConfiguration = { c ->
        c.copy(extendedConfig = c.extendedConfig.copy(basePath = folder))
    })
}
