package com.rejwan.rejboard.core

import com.rejwan.rejboard.core.ink.BoardEditor
import com.rejwan.rejboard.core.ink.Brush
import com.rejwan.rejboard.core.ink.InkSample
import com.rejwan.rejboard.core.ink.InkTool
import com.rejwan.rejboard.core.ink.StrokePainter
import com.rejwan.rejboard.core.ink.StrokeStyle
import com.rejwan.rejboard.core.ink.WetStroke
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** The incremental wet ink and the chunked dry ink must draw exactly what the full painters draw. */
class WetInkTest {
    /** State setters the painters repeat at the start of every piece; the drawing calls are what must match. */
    private val stateCalls = setOf("fillStyle", "strokeStyle", "strokeGrain", "lineCap", "lineJoin", "setLineDash", "globalAlpha", "shadowColor", "shadowBlur", "save", "restore")

    private fun drawing(log: List<List<Any>>) = log.filter { it[0] !in stateCalls }

    private fun strokes(): List<Item> =
        BoardJson.parse(readGolden("inkStrokes")).jsonArray.map { Item(it.jsonObject["item"]!!.jsonObject) }

    @Test
    fun incrementalWetInkDrawsTheSameSegmentsAsTheFullStroke() {
        var checked = 0
        for (s in strokes()) {
            val st = StrokeStyle.of(s)!!
            val wet = WetStroke(st)
            if (!wet.incremental) continue
            val rows = s.rows
            if (rows.size < 2) continue
            val full = LogCanvas()
            StrokePainter.paintRows(full, st, rows)
            val inc = LogCanvas()
            // points arrive one by one; the last call is the pen lifting
            for (n in 1..rows.size) wet.paintNew(inc, rows.subList(0, n), ended = n == rows.size)
            assertEquals(drawing(full.log), drawing(inc.log), "stroke ${s.tool} ${s["lineType"]} sharp=${s["sharp"]}")
            checked++
        }
        assertTrue(checked > 10, "the fixtures hold segment brushes")
    }

    @Test
    fun wetTailCoversWhatIsNotFinalYet() {
        val s = strokes().first { it.tool == "calli" && it.rows.size > 10 }
        val wet = WetStroke(StrokeStyle.of(s)!!)
        val rows = s.rows.subList(0, 8)
        wet.paintNew(LogCanvas(), rows)
        // calligraphy is smoothed, which looks one point ahead: raw segments 0..5 of 8 points are final, each one or more smoothed segments
        assertTrue(wet.paintedSegments >= 6, "final segments painted: ${wet.paintedSegments}")
        val tail = LogCanvas()
        wet.paintTail(tail, rows)
        assertTrue(tail.log.any { it[0] == "fill" }, "the provisional end is drawn")
    }

    @Test
    fun editorPaintsWetInkInPiecesAndDryInkInChunks() {
        val store = BoardStore(testDriver())
        store.ensureSample(1)
        val id = store.list().single().id
        val ed = BoardEditor(store.load(id)!!, store, id)
        val chunks0 = ed.dryChunks()
        val gen0 = ed.dryGeneration

        ed.useBrush("calli")
        assertTrue(ed.begin(InkSample(500.0, 500.0, .4, t = 0.0, tool = InkTool.PEN)))
        assertTrue(ed.wetIncremental)
        val pieces = LogCanvas()
        for (k in 1..40) {
            ed.move(listOf(InkSample(500.0 + k * 3, 500.0 + k * 2, .3 + k % 5 * .1, t = k * 4.0, tool = InkTool.PEN)))
            ed.paintWetNew(pieces)
        }
        assertTrue(pieces.log.count { it[0] == "fill" } > 20, "segments were painted as they became final")
        assertTrue(ed.end())

        // a finished stroke only adds a chunk: the earlier ones are the same objects
        val chunks1 = ed.dryChunks()
        assertEquals(gen0, ed.dryGeneration)
        assertEquals(chunks0.size + 1, chunks1.size)
        assertTrue(chunks0.indices.all { chunks0[it] === chunks1[it] })
        val inChunks = LogCanvas()
        for (c in chunks1) c.replay(inChunks)
        val whole = LogCanvas()
        ed.paintItems(whole)
        assertEquals(whole.log, inChunks.log)

        // undo is not an append: everything is redrawn
        assertTrue(ed.undo())
        assertTrue(ed.dryGeneration != gen0)
        assertEquals(1, ed.dryChunks().size)

        // highlighters are repainted whole, with their opacity
        ed.useBrush("hrd")
        ed.brush = ed.brush.copy(opacity = 60.0)
        assertTrue(ed.begin(InkSample(100.0, 100.0, .5, tool = InkTool.PEN)))
        assertFalse(ed.wetIncremental)
        ed.move(listOf(InkSample(160.0, 120.0, .5, t = 10.0, tool = InkTool.PEN)))
        val hl = LogCanvas()
        ed.paintWet(hl)
        assertTrue(hl.log.any { it[0] == "globalAlpha" && it[1] == .6 })
        assertTrue(ed.end())
        assertEquals(60.0, ed.state.items.last().opacity)
        assertEquals(60.0, ed.brushes.getValue("hrd").opacity, "settings are remembered per brush")
    }

    @Test
    fun pressureReachesTheStrokeWidth() {
        val ed = BoardEditor(Board.parse("""{"title":"t","items":[]}"""))
        ed.useBrush("fount")
        val widths = mutableListOf<Double>()
        for (p in listOf(.1, .9)) {
            ed.begin(InkSample(0.0, 0.0, p, t = 0.0, tool = InkTool.PEN))
            for (k in 1..20) ed.move(listOf(InkSample(k * 5.0, 0.0, p, t = k * 4.0, tool = InkTool.PEN)))
            ed.end()
            val log = LogCanvas()
            StrokePainter.paint(log, ed.state.items.last())
            widths += log.log.filter { it[0] == "lineWidth" }.map { it[1] as Double }.last()
        }
        assertTrue(widths[1] > widths[0] * 1.5, "a hard press draws wider than a light one: $widths")

        // a finger sends no pressure: the width follows speed, as for the desktop's mouse
        ed.begin(InkSample(0.0, 50.0, 0.0, t = 0.0, tool = InkTool.TOUCH))
        for (k in 1..20) ed.move(listOf(InkSample(k * 5.0, 50.0, 0.0, t = k * 16.0, tool = InkTool.TOUCH)))
        ed.end()
        val pr = ed.state.items.last().rows.drop(1).map { it[2] }
        assertTrue(pr.all { it in .15..1.0 })
    }

    @Test
    fun eraserWorksFromTheModeTheTipAndTheButton() {
        for (how in listOf("mode", "tip", "button")) {
            val ed = BoardEditor(Board.parse("""{"title":"t","items":[]}"""))
            ed.useBrush("ball")
            ed.begin(InkSample(0.0, 0.0, .5, tool = InkTool.PEN))
            for (k in 1..20) ed.move(listOf(InkSample(k * 5.0, 0.0, .5, t = k * 4.0, tool = InkTool.PEN)))
            ed.end()
            assertEquals(1, ed.state.items.size)
            if (how == "mode") ed.mode = BoardEditor.Mode.ERASER
            val tool = if (how == "tip") InkTool.ERASER else InkTool.PEN
            val buttons = if (how == "button") InkSample.BUTTON_BARREL else 0
            assertTrue(ed.begin(InkSample(50.0, -30.0, .5, tool = tool, buttons = buttons)), how)
            assertTrue(ed.isErasing, how)
            ed.move(listOf(InkSample(50.0, 30.0, .5, t = 8.0, tool = tool, buttons = buttons)))
            val ring = LogCanvas()
            ed.paintWetTail(ring)
            assertTrue(ring.log.any { it[0] == "arc" }, "$how: the eraser ring is drawn")
            assertTrue(ed.end(), how)
            assertEquals(2, ed.state.items.size, "$how: the stroke was cut in two")
        }
    }

    @Test
    fun brushSettingsAreKeptPerTool() {
        val ed = BoardEditor(Board.parse("""{"title":"t","items":[]}"""))
        ed.useBrush("calli")
        ed.brush = ed.brush.copy(sens = .2, ang = 30.0, stab = 70.0)
        ed.useBrush("fount")
        assertEquals(Brush.default("fount"), ed.brush)
        ed.useBrush("calli")
        assertEquals(30.0, ed.brush.ang)
        assertEquals(.2, ed.brush.sens)
    }
}
