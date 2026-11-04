package com.rejwan.rejboard.core

import app.cash.sqldelight.db.SqlDriver
import app.cash.sqldelight.driver.native.NativeSqliteDriver
import com.rejwan.rejboard.core.db.RejBoardDb

/** The database goes in the app's own container (SQLiter's default folder). */
actual class DriverFactory {
    actual fun create(): SqlDriver = NativeSqliteDriver(RejBoardDb.Schema, DB_NAME)
}

/** Convenience for Swift: the store on the app's default database. */
fun openDefaultStore(): BoardStore = BoardStore(DriverFactory().create())
