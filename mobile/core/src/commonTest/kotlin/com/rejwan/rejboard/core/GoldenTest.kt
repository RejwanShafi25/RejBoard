package com.rejwan.rejboard.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Text of core/golden/<name>.json (written by golden/generate.js from the desktop JS). */
expect fun readGolden(name: String): String

private fun golden(name: String): JsonElement = BoardJson.parse(readGolden(name))
private fun JsonElement.obj(key: String): JsonObject = jsonObject[key]!!.jsonObject
private fun JsonElement.arr(key: String): JsonArray = jsonObject[key]!!.jsonArray
private fun JsonElement.int(key: String): Int = jsonObject[key]!!.jsonPrimitive.content.toInt()
private fun JsonElement.dbl(key: String): Double = jsonObject[key]!!.jsonPrimitive.content.toDouble()
private fun items(e: JsonElement?): List<Item> = (e as JsonArray).map { Item(it.jsonObject) }
private fun json(items: List<Item>): String = BoardJson.write(JsonArray(items.map { it.raw }))
private fun layerList(e: JsonElement?): List<Layer> = (e as JsonArray).map { Layer(it.jsonObject) }

/** The Kotlin core against fixtures produced by the desktop app's own board-core.js. */
class GoldenTest {
    @Test
    fun fnvMatchesTheFixtureHash() {
        for (c in golden("fnv").jsonArray) assertEquals(c.jsonObject["h"]!!.jsonPrimitive.content, fnv64(c.jsonObject["s"]!!.jsonPrimitive.content))
    }

    @Test
    fun rjwbFilesRoundTripByteForByte() {
        for (c in golden("rjwb").jsonArray) {
            val name = c.jsonObject["name"]!!.jsonPrimitive.content
            val rjwb = c.jsonObject["rjwb"]!!.jsonPrimitive.content
            val json = c.jsonObject["json"]!!.jsonPrimitive.content
            assertEquals(json, Rjwb.decodeJson(rjwb), "$name: decoded JSON")
            val board = Rjwb.decode(rjwb)
            assertEquals(json, board.toJson(), "$name: JSON written back unchanged")
            assertEquals(rjwb, Rjwb.encode(board), "$name: .rjwb written back unchanged")
            // with white space in the base64, as atob() allows
            assertEquals(json, Rjwb.decode(rjwb.chunked(76).joinToString("\r\n")).toJson(), "$name: wrapped base64")
        }
    }

    @Test
    fun rjwbFieldsAreRead() {
        val full = Rjwb.decode(golden("rjwb").jsonArray.first { it.jsonObject["name"]!!.jsonPrimitive.content == "full" }.jsonObject["rjwb"]!!.jsonPrimitive.content)
        assertEquals("Every item type ✓", full.title)
        assertEquals("lines", full.pattern)
        assertEquals("a4", full.page.size)
        assertEquals(3, full.page.count)
        assertEquals(listOf(1, 2), full.layers.map { it.id })
        assertFalse(full.layers[1].visible)
        assertTrue(full.layers[1].locked)
        assertEquals(
            listOf(ItemType.STROKE, ItemType.STROKE, ItemType.TEXT, ItemType.LINK, ItemType.IMAGE, ItemType.MATH, ItemType.TAPE,
                ItemType.SHAPE, ItemType.TABLE, ItemType.GRAPH, ItemType.CHECKLIST, ItemType.UNKNOWN),
            full.items.map { it.type },
        )
        assertEquals("héllo wörld 👋 日本語", full.items[2].text)
        assertEquals(12, full.items[0].points!!.count)
        assertEquals("zz", full.items.last().code)
        assertEquals("b_123", full.sourceId)
        assertFalse(full.isProtected)

        // an edit keeps every unknown field, at its place
        val edited = full.withItems(full.items.map { if (it.type == ItemType.TEXT) it.with("text", JsonPrimitive("changed")) else it })
        val back = BoardJson.parse(edited.toJson()).jsonObject
        assertEquals(full.raw.keys.toList(), back.keys.toList())
        assertEquals(full.raw["futureTopLevel"], back["futureTopLevel"])
        assertEquals(full.items.last().raw, back["items"]!!.jsonArray.last())
        assertEquals(full.items[2].raw.keys.toList(), back["items"]!!.jsonArray[2].jsonObject.keys.toList())

        val locked = Rjwb.decode(golden("rjwb").jsonArray.first { it.jsonObject["name"]!!.jsonPrimitive.content == "locked" }.jsonObject["rjwb"]!!.jsonPrimitive.content)
        assertTrue(locked.isProtected)
        val linked = Rjwb.decode(golden("rjwb").jsonArray.first { it.jsonObject["name"]!!.jsonPrimitive.content == "linked" }.jsonObject["rjwb"]!!.jsonPrimitive.content)
        assertEquals(listOf("b_x"), linked.linked.map { it.raw["id"]!!.jsonPrimitive.content })
    }

    @Test
    fun badFilesAreRejected() {
        for (bad in listOf("", "hello", "RJWB1:@@@", "RJWB1:" + "WzEsMl0=" /* [1,2] */, "RJWB1:" + "e30" /* {} without padding */)) {
            val ok = runCatching { Rjwb.decode(bad) }
            if (bad.endsWith("e30")) assertTrue(ok.isSuccess, "missing padding is accepted like atob()") else assertTrue(ok.exceptionOrNull() is RjwbException, bad)
        }
    }

    @Test
    fun flattenAndInflateMatchDesktop() {
        for (c in golden("flatten").jsonArray) {
            val got = Points.flatten(c.jsonObject["input"])
            val want = c.jsonObject["out"]
            if (want == null || want == JsonNull) assertNull(got, "${c.jsonObject["input"]}")
            else {
                assertEquals(want.int("w"), got!!.width)
                assertContentEquals(want.arr("f").map { it.jsonPrimitive.content.toDouble() }.toDoubleArray(), got.values)
            }
        }
        for (c in golden("inflate").jsonArray) {
            val f = c.arr("f").map { it.jsonPrimitive.content.toDouble() }.toDoubleArray()
            val got = Points.inflate(f, c.int("w"))
            val want = c.jsonObject["out"]
            if (want == null || want == JsonNull) assertNull(got)
            else assertEquals(want.jsonArray.map { q -> q.jsonArray.map { it.jsonPrimitive.content.toDouble() } }, got!!.map { it.toList() })
        }
    }

    @Test
    fun undoRedoReplaysTheDesktopTimeline() {
        for (c in golden("history").arr("cases")) {
            val seed = c.int("seed")
            val s = BoardState(items(c.jsonObject["initial"]))
            val h = History(c.dbl("budget"))
            val timeline = c.arr("timeline").map { it.jsonPrimitive.content }
            assertEquals(timeline[0], fnv64(json(s.items)), "seed $seed initial")
            c.arr("ops").forEachIndexed { k, op ->
                val o = op.jsonObject
                when (o["op"]!!.jsonPrimitive.content) {
                    "add" -> h.addStroke(s, Item(o["item"]!!.jsonObject))
                    "delete" -> { h.pushDeep(s); s.items.removeAt(op.int("index")) }
                    "replace" -> { h.pushDeep(s); s.items[op.int("index")] = Item(o["item"]!!.jsonObject) }
                    "split" -> { h.pushDeep(s); val at = op.int("index"); s.items.removeAt(at); s.items.addAll(at, listOf(Item(o["a"]!!.jsonObject), Item(o["b"]!!.jsonObject))) }
                    else -> h.pushDeep(s)
                }
                assertEquals(timeline[k + 1], fnv64(json(s.items)), "seed $seed step ${k + 1}")
            }
            assertEquals(c.int("histLen"), h.undoCount, "seed $seed history length")
            assertEquals(json(items(c.jsonObject["last"])), json(s.items), "seed $seed final board")
            val n = timeline.size - 1
            for (k in n downTo 1) {
                assertTrue(h.undo(s), "seed $seed undo $k")
                assertEquals(timeline[k - 1], fnv64(json(s.items)), "seed $seed undo to ${k - 1}")
            }
            assertFalse(h.undo(s), "nothing left to undo")
            for (k in 1..n) {
                assertTrue(h.redo(s), "seed $seed redo $k")
                assertEquals(timeline[k], fnv64(json(s.items)), "seed $seed redo to $k")
            }
            assertFalse(h.redo(s), "nothing left to redo")
        }
    }

    @Test
    fun orphanedAddEntryIsSkipped() {
        val o = golden("history").obj("orphan")
        val s = BoardState(items(o["initial"]))
        val h = History()
        h.addStroke(s, Item(o["added"]!!.jsonObject))
        val n = o["removePtsLength"]!!.jsonPrimitive.content.toInt()
        s.replaceItems(s.items.filter { it.code != "s" || (it["pts"] as JsonArray).size != n })
        assertEquals(json(items(o["after"])), json(s.items))
        assertEquals(o["undone"]!!.jsonPrimitive.content.toBoolean(), h.undo(s))
        assertEquals(json(items(o["final"])), json(s.items))
    }

    @Test
    fun undoRestoresPagesAndLayers() {
        val e = golden("history").obj("extras")
        val s = BoardState(items(e["initial"]))
        val calls = mutableListOf<String>()
        val h = History(hooks = object : HistoryHooks {
            override fun pagesChanged() { calls += "pg" }
            override fun pageLinks(records: JsonElement, undoing: Boolean) { calls += "lk$undoing" }
            override fun layersChanged() { calls += "layers" }
        })
        h.pushDeep(s)
        val entry = e["entry"]!!
        (h.last as Snapshot).apply {
            pageCount = entry.int("pn")
            layers = LayerSnapshot(layerList(entry.jsonObject["layers"]), entry.int("activeLayer"))
            pageLinks = entry.jsonObject["lk"]
        }
        val before = e["before"]!!
        s.pageCount = before.int("pn"); s.layers = layerList(before.jsonObject["layers"]); s.activeLayer = before.int("activeLayer")
        h.undo(s)
        val u = e["afterUndo"]!!
        assertEquals(u.int("pn"), s.pageCount)
        assertEquals(layerList(u.jsonObject["layers"]), s.layers)
        assertEquals(u.int("activeLayer"), s.activeLayer)
        assertEquals(listOf("layers", "lktrue", "pg"), calls.sorted())
        h.redo(s)
        val r = e["afterRedo"]!!
        assertEquals(r.int("pn"), s.pageCount)
        assertEquals(layerList(r.jsonObject["layers"]), s.layers)
        assertEquals(r.int("activeLayer"), s.activeLayer)
    }

    @Test
    fun newActionAfterUndoClearsRedo() {
        val e = golden("history").arr("cases")[0]
        val ops = e.arr("ops").filter { it.jsonObject["op"]!!.jsonPrimitive.content == "add" }.map { Item(it.obj("item")) }
        val s = BoardState(items(e.jsonObject["initial"]))
        val h = History()
        h.addStroke(s, ops[0]); h.addStroke(s, ops[1])
        h.undo(s)
        assertEquals(1, h.redoCount)
        h.addStroke(s, ops[2])
        assertEquals(0, h.redoCount)
        assertFalse(h.pushAdd(s, Item.parse("""{"t":"t","text":"x"}""")))
        assertFalse(h.pushAdd(s, Item.parse("""{"t":"s","pts":[]}""")))
    }

    @Test
    fun trimAndCostMatchDesktop() {
        for (c in golden("trim").jsonArray) {
            val list = ArrayDeque(c.arr("costs").map { it.jsonPrimitive.content.toDouble() })
            trimHistory(list, c.dbl("budget")) { it }
            assertEquals(c.arr("kept").map { it.jsonPrimitive.content.toDouble() }, list.toList())
        }
        for (c in golden("cost").jsonArray) assertEquals(c.dbl("cost"), History.cost(items(c.jsonObject["items"])))
    }

    @Test
    fun boardSigMatchesDesktop() {
        for (c in golden("boardSig").jsonArray) {
            val got = BoardSig.of(c.arr("items").map { it.jsonObject }, c.arr("layers").map { it.jsonObject })
            assertEquals(c.int("sig"), got, c.jsonObject["name"]!!.jsonPrimitive.content)
        }
    }

    @Test
    fun searchTextMatchesDesktop() {
        for (c in golden("searchText").jsonArray) {
            val got = BoardIndex.searchText(c.jsonObject["items"])
            assertEquals(c.obj("out")["q"]!!.jsonPrimitive.content, got.q)
            assertEquals(c.obj("out")["pq"]!!.jsonPrimitive.content, got.pq)
        }
    }

    @Test
    fun boardIndexMatchesDesktop() {
        for (c in golden("pickStart").jsonArray) {
            val last = c.jsonObject["last"]!!.let { if (it == JsonNull) null else it.jsonPrimitive.content }
            val want = c.jsonObject["out"]!!.let { if (it == JsonNull) null else it.jsonPrimitive.content }
            assertEquals(want, BoardIndex.pickStart(last, c.arr("metas").map { it.jsonObject }), "last=$last")
        }
        for (c in golden("metaOf").jsonArray) {
            val got = BoardIndex.metaOf(c.obj("rec"), c.jsonObject["lk"])
            assertEquals(BoardJson.write(c.jsonObject["out"]!!), BoardJson.write(got))
        }
    }
}
