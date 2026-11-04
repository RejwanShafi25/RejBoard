package com.rejwan.rejboard.core

import app.cash.sqldelight.db.SqlDriver
import com.rejwan.rejboard.core.db.RejBoardDb

/** One row of the board list. */
data class BoardSummary(val id: String, val title: String, val updated: Long, val locked: Boolean, val itemCount: Int)

/**
 * Board storage on every platform (SQLDelight, one schema). Each platform makes the [SqlDriver] with its DriverFactory;
 * on Windows the database lives only in the MSIX package's LocalState folder.
 */
class BoardStore(driver: SqlDriver) {
    private val q = RejBoardDb(driver).boardRecordQueries
    private var seq = 0

    fun list(): List<BoardSummary> = q.listSummaries { id, title, updated, locked, itemCount ->
        BoardSummary(id, title, updated, locked != 0L, itemCount.toInt())
    }.executeAsList()

    val size: Long get() = q.countAll().executeAsOne()

    @Throws(Exception::class)
    fun load(id: String): Board? = q.bodyOf(id).executeAsOneOrNull()?.let(Board::parse)

    fun save(id: String, board: Board, updated: Long) {
        q.upsert(id, board.title, updated, if (board.isProtected) 1L else 0L, board.items.size.toLong(), BoardIndex.searchText(board.items).q, board.toJson())
    }

    fun delete(id: String) {
        q.remove(id)
    }

    /**
     * Imports a .rjwb file and returns the new board's id. The board keeps the id it had on the desktop (`src`), so importing
     * the same file again replaces the earlier copy instead of making a duplicate. Boards that travelled with it (`linked`)
     * stay inside it untouched.
     */
    @Throws(Exception::class)
    fun importRjwb(text: String, now: Long): String {
        val board = Rjwb.decode(text)
        val id = board.sourceId ?: newId(now)
        save(id, board, now)
        return id
    }

    fun exportRjwb(id: String): String? = load(id)?.let(Rjwb::encode)

    /** Puts a small example board in an empty store, so a fresh install has something to open. */
    fun ensureSample(now: Long) {
        if (size == 0L) importRjwb(Rjwb.encodeJson(SAMPLE_BOARD_JSON), now)
    }

    private fun newId(now: Long): String {
        var id: String
        do {
            id = "n" + now.toString(36) + (seq++).toString(36)
        } while (q.countById(id).executeAsOne() > 0)
        return id
    }
}

/** The board a fresh install starts with (desktop board format). */
internal const val SAMPLE_BOARD_JSON: String =
    """{"title":"Welcome to RejBoard Native","items":[""" +
        """{"t":"t","x":40,"y":40,"w":520,"h":40,"text":"RejBoard Native (preview)","color":"#111111","size":30,"ly":1},""" +
        """{"t":"t","x":40,"y":96,"w":560,"h":30,"text":"Open a .rjwb file from the desktop app to view it here.","color":"#444444","size":18,"ly":1},""" +
        """{"t":"sp","shp":"rect","x":40,"y":150,"w":220,"h":120,"rot":0,"size":3,"color":"#2563eb","fill":"#dbeafe","lineType":"solid","label":"Shapes","ly":1},""" +
        """{"t":"sp","shp":"ell","x":300,"y":150,"w":160,"h":120,"rot":0,"size":3,"color":"#16a34a","ly":1},""" +
        """{"t":"s","tool":"fount","color":"#dc2626","size":4,"sens":0.6,"ang":135,"opacity":100,"pts":[[60,330,0.5],[120,300,0.5],[180,340,0.5],[240,300,0.5],[300,340,0.5],[360,300,0.5],[420,330,0.5]],"tl":false,"ly":1},""" +
        """{"t":"ck","x":40,"y":380,"w":300,"h":0,"title":"Phase 1","rows":[{"text":"Board list","done":true},{"text":"Read-only viewer","done":true},{"text":"Pen input","done":false}],"ly":1}""" +
        """],"bg":"white","pat":"plain","gs":28,"gd":1.5,"layers":[{"id":1,"name":"Layer 1","vis":1,"lock":0}],"tags":"","pg":{"size":"inf","o":"p","n":1},"src":"sample-welcome"}"""
