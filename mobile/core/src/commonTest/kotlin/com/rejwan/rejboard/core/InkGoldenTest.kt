package com.rejwan.rejboard.core

import com.rejwan.rejboard.core.ink.BoardEditor
import com.rejwan.rejboard.core.ink.Brush
import com.rejwan.rejboard.core.ink.BrushSize
import com.rejwan.rejboard.core.ink.Canvas2D
import com.rejwan.rejboard.core.ink.DrawList
import com.rejwan.rejboard.core.ink.Eraser
import com.rejwan.rejboard.core.ink.InkSample
import com.rejwan.rejboard.core.ink.InkTool
import com.rejwan.rejboard.core.ink.PaperPainter
import com.rejwan.rejboard.core.ink.PaperSpec
import com.rejwan.rejboard.core.ink.PressureCurve
import com.rejwan.rejboard.core.ink.StrokeBuilder
import com.rejwan.rejboard.core.ink.StrokePainter
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.math.abs
import kotlin.math.max
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** Writes [Canvas2D] calls down in the same shape as the desktop recorder in golden/ink-fixtures.js. */
class LogCanvas : Canvas2D {
    val log = ArrayList<List<Any>>()
    private fun add(vararg v: Any) { log.add(v.toList()) }
    private fun col(c: Long): Double = c.toDouble()
    override fun save() = add("save")
    override fun restore() = add("restore")
    override fun translate(x: Double, y: Double) = add("translate", x, y)
    override fun scale(x: Double, y: Double) = add("scale", x, y)
    override fun beginPath() = add("beginPath")
    override fun moveTo(x: Double, y: Double) = add("moveTo", x, y)
    override fun lineTo(x: Double, y: Double) = add("lineTo", x, y)
    override fun quadTo(cx: Double, cy: Double, x: Double, y: Double) = add("quadTo", cx, cy, x, y)
    override fun bezierTo(c1x: Double, c1y: Double, c2x: Double, c2y: Double, x: Double, y: Double) = add("bezierTo", c1x, c1y, c2x, c2y, x, y)
    override fun arc(x: Double, y: Double, r: Double, a0: Double, a1: Double) = add("arc", x, y, r, a0, a1)
    override fun rect(x: Double, y: Double, w: Double, h: Double) = add("rect", x, y, w, h)
    override fun closePath() = add("closePath")
    override fun fill() = add("fill")
    override fun stroke() = add("stroke")
    override fun clip() = add("clip")
    override fun fillRect(x: Double, y: Double, w: Double, h: Double) = add("fillRect", x, y, w, h)
    override fun setFillColor(argb: Long) = add("fillStyle", col(argb))
    override fun setStrokeColor(argb: Long) = add("strokeStyle", col(argb))
    override fun setStrokeGrain(argb: Long) = add("strokeGrain", col(argb))
    override fun setLineWidth(w: Double) = add("lineWidth", w)
    override fun setLineCap(cap: Int) = add("lineCap", listOf("butt", "round", "square")[cap])
    override fun setLineJoin(join: Int) = add("lineJoin", listOf("miter", "round")[join])
    override fun setLineDash(dash: DoubleArray) { log.add(listOf<Any>("setLineDash") + dash.toList()) }
    override fun setGlobalAlpha(a: Double) = add("globalAlpha", a)
    override fun setShadow(argb: Long, blur: Double) { add("shadowColor", col(argb)); add("shadowBlur", blur) }
    override fun fillText(text: String, x: Double, y: Double, size: Double, font: Int, align: Int, baseline: Int) = add("fillText", text, x, y)
}

private fun golden(name: String): JsonElement = BoardJson.parse(readGolden(name))
private fun JsonElement.num(): Double = if (this == JsonNull) Double.NaN else jsonPrimitive.content.toDouble()
private fun JsonElement.str(key: String): String = jsonObject[key]!!.jsonPrimitive.content
private fun JsonElement.dbl(key: String): Double = jsonObject[key]!!.num()

/** The desktop's log with CSS colours turned into ARGB numbers, the shape LogCanvas writes. */
private fun normalize(e: JsonElement): List<Any> {
    val a = e.jsonArray
    val name = a[0].jsonPrimitive.content
    if ((name == "fillStyle" || name == "strokeStyle" || name == "shadowColor") && a[1] is JsonPrimitive && (a[1] as JsonPrimitive).isString) {
        val v = a[1].jsonPrimitive.content
        if (v.startsWith("grain:")) return listOf("strokeGrain", Colors.parse(v.substring(6)).toDouble())
        return listOf(name, Colors.parse(v).toDouble())
    }
    return listOf<Any>(name) + a.drop(1).map { v -> if (v is JsonPrimitive && v.isString) v.content else v.num() }
}

private fun same(a: Any, b: Any): Boolean = when {
    a is Double && b is Double -> (a.isNaN() && b.isNaN()) || a == b || abs(a - b) <= 1e-9 * max(1.0, abs(a))
    else -> a == b
}

private fun assertSameLog(want: JsonArray, got: List<List<Any>>, what: String) {
    val w = want.map(::normalize)
    for (k in 0 until minOf(w.size, got.size)) {
        val x = w[k]
        val y = got[k]
        if (x.size != y.size || x.indices.any { !same(x[it], y[it]) }) fail("$what: call $k differs\n desktop: $x\n kotlin:  $y")
    }
    assertEquals(w.size, got.size, "$what: number of canvas calls")
}

/** Ink against the desktop app's own drawing and input code (golden/ink-fixtures.js). */
class InkGoldenTest {
    @Test
    fun everyBrushDrawsLikeTheDesktop() {
        for ((k, c) in golden("inkStrokes").jsonArray.withIndex()) {
            val item = Item(c.jsonObject["item"]!!.jsonObject)
            val log = LogCanvas()
            StrokePainter.paint(log, item)
            assertSameLog(c.jsonObject["log"]!!.jsonArray, log.log, "stroke $k (${item.tool})")
        }
    }

    @Test
    fun paperAndPagesDrawLikeTheDesktop() {
        for (c in golden("inkPaper").jsonArray) {
            val s = c.jsonObject["S"]!!.jsonObject
            val v = c.jsonObject["view"]!!.jsonArray.map { it.num() }
            val log = LogCanvas()
            PaperPainter.paint(log, PaperSpec.of(Board(s)), v[0], v[1], v[2], v[3], v[4])
            assertSameLog(c.jsonObject["log"]!!.jsonArray, log.log, "paper ${s["pat"]} on ${s["bg"]} (${s["pg"]})")
        }
    }

    @Test
    fun penFingerAndMouseInputMatchTheDesktop() {
        for (c in golden("inkInput").jsonArray) {
            val kind = c.str("kind")
            val tool = when (kind) { "pen" -> InkTool.PEN; "touch" -> InkTool.TOUCH; else -> InkTool.MOUSE }
            val evs = c.jsonObject["events"]!!.jsonArray.map {
                InkSample(it.dbl("x"), it.dbl("y"), it.dbl("pressure"), it.dbl("tiltX"), it.dbl("tiltY"), 0.0, it.dbl("timeStamp"), tool)
            }
            val brush = Brush(c.str("tool"), 3.0, stab = c.dbl("stab"))
            val tl = c.jsonObject["tl"]!!.jsonPrimitive.content.toBoolean()
            val b = StrokeBuilder(brush, "#000000", evs[0], pressureOn = true, tiltOn = tl, curve = PressureCurve(c.dbl("curve")))
            for (e in evs.drop(1)) b.add(e, c.dbl("zoom"))
            val want = c.jsonObject["pts"]!!.jsonArray
            assertEquals(want.size, b.points.size, "$kind ${brush.tool}: number of points")
            for ((k, q) in want.withIndex()) {
                val w = q.jsonArray.map { it.num() }
                val g = b.points[k].toList()
                assertEquals(w.size, g.size, "$kind point $k width")
                assertTrue(w.indices.all { same(w[it], g[it]) }, "$kind ${brush.tool} point $k: desktop $w, kotlin $g")
            }
        }
    }

    @Test
    fun eraserMatchesTheDesktop() {
        val e = golden("inkEraser")
        val board = e.jsonObject["board"]!!.jsonArray.map { Item(it.jsonObject) }
        for (g in e.jsonObject["gestures"]!!.jsonArray) {
            val mode = g.str("mode")
            val tool = when (g.str("kind")) { "pen" -> InkTool.PEN; "touch" -> InkTool.TOUCH; else -> InkTool.MOUSE }
            val eraser = Eraser(size = g.dbl("size"), whole = mode == "whole", onlyHighlighter = mode == "hl")
            eraser.begin()
            val items = board.toMutableList()
            for (m in g.jsonObject["moves"]!!.jsonArray) {
                val samples = m.jsonObject["coal"]!!.jsonArray.map {
                    val p = it.jsonObject["p"]!!.jsonArray
                    InkSample(p[0].num(), p[1].num(), it.dbl("pressure"), tool = tool)
                }
                eraser.move(items, samples)
            }
            assertEquals(BoardJson.write(g.jsonObject["items"]!!), BoardJson.write(JsonArray(items.map { it.raw })), "eraser $mode ${g.str("kind")}")
        }
    }

    @Test
    fun brushSizeSliderMatchesTheDesktop() {
        val s = golden("inkSizes")
        for (r in s.jsonObject["fromSlider"]!!.jsonArray) {
            val a = r.jsonArray.map { it.num() }
            assertTrue(same(a[3], BrushSize.fromSlider(a[0], a[1], a[2])), "fromSlider $a")
        }
        for (r in s.jsonObject["toSlider"]!!.jsonArray) {
            val a = r.jsonArray.map { it.num() }
            assertTrue(same(a[3], BrushSize.toSlider(a[0], a[1], a[2])), "toSlider $a")
        }
    }

    @Test
    fun drawListReplaysExactly() {
        val c = golden("inkStrokes").jsonArray[0]
        val item = Item(c.jsonObject["item"]!!.jsonObject)
        val direct = LogCanvas()
        StrokePainter.paint(direct, item)
        val rec = DrawList()
        StrokePainter.paint(rec, item)
        val replayed = LogCanvas()
        rec.replay(replayed)
        assertEquals(direct.log, replayed.log)
    }

    @Test
    fun editorDrawsErasesUndoesAndSaves() {
        val store = BoardStore(testDriver())
        store.ensureSample(1)
        val id = store.list().single().id
        val ed = BoardEditor(store.load(id)!!, store, id)
        val before = ed.state.items.size
        ed.brush = Brush.default("calli")
        ed.color = "#dc2626"
        assertTrue(ed.begin(InkSample(500.0, 500.0, .4, t = 0.0)))
        for (k in 1..30) ed.move(listOf(InkSample(500.0 + k * 4, 500.0 + k * 2, .5, t = k * 8.0)))
        assertTrue(ed.wetStroke() != null)
        assertTrue(ed.end())
        assertEquals(before + 1, ed.state.items.size)
        val s = ed.state.items.last()
        assertEquals(listOf("t", "tool", "color", "size", "sens", "ang", "opacity", "tl", "pts", "ly"), s.raw.keys.toList())

        // the side button erases across the new stroke
        assertTrue(ed.begin(InkSample(540.0, 480.0, .8, buttons = InkSample.BUTTON_BARREL)))
        ed.move(listOf(InkSample(540.0, 560.0, .8, buttons = InkSample.BUTTON_BARREL)))
        assertTrue(ed.end())
        assertTrue(ed.state.items.size != before + 1 || ed.state.items.last() != s, "the eraser cut the stroke")
        assertTrue(ed.undo())
        assertEquals(s, ed.state.items.last())
        ed.save(2)
        val reloaded = store.load(id)!!
        assertEquals(before + 1, reloaded.items.size)
        assertEquals(s, reloaded.items.last())

        // a whole frame records without errors and starts with the paper
        val frame = LogCanvas()
        ed.fitView(800.0, 600.0)
        ed.paintFrame(frame, 800.0, 600.0)
        assertEquals("fillStyle", frame.log.first()[0])
    }
}
