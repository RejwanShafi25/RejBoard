package com.rejwan.rejboard.core

import app.cash.sqldelight.db.SqlDriver

/** Version of the shared core, shown in the apps' about text. */
const val CORE_VERSION: String = "0.1.0-phase1"

/** File name of the board database inside the app's own data folder. */
const val DB_NAME: String = "rejboard.db"

/** Makes the platform's SQLite driver (Android: Context; iOS: app container; Windows: package LocalState folder). */
expect class DriverFactory {
    fun create(): SqlDriver
}
