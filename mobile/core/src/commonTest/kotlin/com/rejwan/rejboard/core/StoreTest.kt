package com.rejwan.rejboard.core

import app.cash.sqldelight.db.SqlDriver
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** A fresh in-memory database with the board schema. */
expect fun testDriver(): SqlDriver

class StoreTest {
    private fun goldenRjwb(name: String): String =
        BoardJson.parse(readGolden("rjwb")).jsonArray.first { it.jsonObject["name"]!!.jsonPrimitive.content == name }.jsonObject["rjwb"]!!.jsonPrimitive.content

    @Test
    fun importListLoadExport() {
        val store = BoardStore(testDriver())
        val full = goldenRjwb("full")
        val id = store.importRjwb(full, 1000)
        assertEquals("b_123", id, "keeps the desktop id")
        val big = store.importRjwb(goldenRjwb("big"), 2000)
        val locked = store.importRjwb(goldenRjwb("locked"), 500)
        assertEquals(listOf(big, id, locked), store.list().map { it.id }, "newest first")
        assertTrue(store.list().first { it.id == locked }.locked)
        assertEquals(12, store.list().first { it.id == id }.itemCount)
        assertEquals(full, store.exportRjwb(id), "stored boards export byte for byte")
        store.importRjwb(full, 3000)
        assertEquals(3L, store.size, "re-importing the same board replaces it")
        store.delete(big)
        assertNull(store.load(big))
    }

    @Test
    fun boardsWithoutAnIdGetOne() {
        val store = BoardStore(testDriver())
        val a = store.importRjwb(goldenRjwb("minimal"), 42)
        val b = store.importRjwb(goldenRjwb("minimal"), 42)
        assertTrue(a != b)
        assertEquals(2L, store.size)
    }

    @Test
    fun sampleBoardOnlyGoesIntoAnEmptyStore() {
        val store = BoardStore(testDriver())
        store.ensureSample(1)
        store.ensureSample(2)
        assertEquals(1L, store.size)
        val scene = Scene.of(store.load(store.list().single().id)!!)
        assertTrue(scene.prims.isNotEmpty())
        assertFailsWith<RjwbException> { store.importRjwb("not a board", 3) }
    }
}

class SceneTest {
    @Test
    fun everyKnownItemDrawsSomethingAndHiddenLayersDoNot() {
        val board = Rjwb.decode(BoardJson.parse(readGolden("rjwb")).jsonArray.first { it.jsonObject["name"]!!.jsonPrimitive.content == "full" }.jsonObject["rjwb"]!!.jsonPrimitive.content)
        val scene = Scene.of(board)
        // layer 2 is hidden in the fixture: its graph and checklist are not drawn
        assertTrue(scene.prims.none { it is SceneText && it.text.contains("milk") })
        assertTrue(scene.prims.any { it is SceneText && it.text == "héllo wörld 👋 日本語" })
        assertTrue(scene.prims.count { it is ScenePolyline } >= 2)
        assertTrue(scene.width > 0 && scene.height > 0)
        val json = BoardJson.parse(scene.toJson()).jsonObject
        assertEquals(scene.prims.size, json["prims"]!!.jsonArray.size)
    }

    @Test
    fun colors() {
        assertEquals(0xFF112233, Colors.parse("#123"))
        assertEquals(0xFF112233, Colors.parse("#112233"))
        assertEquals(0x80112233, Colors.parse("#11223380"))
        assertEquals(0xFFFFFFFF, Colors.parse("white"))
        assertEquals(0xFF010101, Colors.parse("nonsense", 0xFF010101))
        assertEquals(0x7FFFFFFFL, Colors.withOpacity(0xFFFFFFFF, 0.5))
    }
}
