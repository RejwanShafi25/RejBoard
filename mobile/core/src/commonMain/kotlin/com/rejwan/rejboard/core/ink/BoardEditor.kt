package com.rejwan.rejboard.core.ink

import com.rejwan.rejboard.core.Board
import com.rejwan.rejboard.core.BoardState
import com.rejwan.rejboard.core.BoardStore
import com.rejwan.rejboard.core.History
import com.rejwan.rejboard.core.Item
import com.rejwan.rejboard.core.Scene

/**
 * An open, editable board: what every platform's ink view drives. Platforms translate their pointer events into
 * [InkSample]s in board coordinates (use [view] to convert) and call [begin] / [move] / [end]; they draw with [paintFrame]
 * or the pieces of it. Undo/redo use the desktop's history; [save] writes the board back to the store in the desktop format.
 *
 * Which pointer draws (pen vs finger, palm rejection) is the platform's decision; the side button and the eraser tip are
 * decided here: a sample with [InkSample.BUTTON_BARREL] (when [barrelErases]) or [InkSample.BUTTON_ERASER] or from an
 * [InkTool.ERASER] erases.
 *
 * Drawing is split so it stays fast on big boards and long strokes:
 * - dry ink comes as [dryChunks]: a finished stroke only adds a chunk, so a renderer caches every chunk it has drawn and
 *   draws just the new one ([dryGeneration] changes when everything must be redrawn: undo, redo, erasing);
 * - wet ink for segment brushes is painted a piece at a time ([wetIncremental], [paintWetNew], [paintWetTail]).
 */
class BoardEditor(
    board: Board,
    private val store: BoardStore? = null,
    val boardId: String? = null,
) {
    enum class Mode { PEN, ERASER }

    var board: Board = board
        private set
    val state: BoardState = BoardState.of(board)
    val history = History()
    val view = Viewport()
    val paper: PaperSpec = PaperSpec.of(board)

    var mode = Mode.PEN
    /** Every brush's settings (size, stabiliser, pressure, nib angle, opacity), like the desktop's cfg. */
    val brushes: MutableMap<String, Brush> = LinkedHashMap<String, Brush>().apply { for (t in Brush.TOOLS) put(t, Brush.default(t)) }
    /** The brush new strokes use; setting it also remembers its settings for that tool. */
    var brush: Brush = brushes.getValue("fount")
        set(value) {
            field = value
            brushes[value.tool] = value
        }
    var color: String = "#111111"
    val eraser = Eraser()
    /** Settings > Pressure sensitivity */
    var pressureOn = true
    /** Settings > Tilt shading */
    var tiltOn = false
    val pressureCurve = PressureCurve()
    /** S Pen / pen side button erases while held */
    var barrelErases = true
    /** The latest raw pen pressure (0..1), for a pressure meter like the desktop's pen panel. */
    var lastPressure: Double = 0.0
        private set

    /** Changes whenever the items change. */
    var version: Int = 0
        private set
    /** Changes when the dry ink must be redrawn from scratch (anything but a stroke added at the end). */
    var dryGeneration: Int = 0
        private set
    /** Changes when a wet layer must be cleared (a new stroke, a restarted stroke, the end of a stroke). */
    var wetGeneration: Int = 0
        private set
    /** Unsaved changes. */
    var dirty: Boolean = false
        private set

    private var builder: StrokeBuilder? = null
    private var wet: WetStroke? = null
    private var curveAtStart = 0.0
    private var erasing = false
    private var eraseBefore: List<Item>? = null
    private var eraseChanged = false
    private var dryCache: DrawList? = null
    private var dryCacheVersion = -1
    private val chunks = ArrayList<DrawList>()
    private var chunkGeneration = -1
    private var chunkItems = 0

    val isDrawing: Boolean get() = builder != null
    val isErasing: Boolean get() = erasing

    /** [tool]'s settings as last used. */
    fun brushFor(tool: String): Brush = brushes[tool] ?: Brush.default(tool)

    /** Picks [tool]'s brush with the settings last used for it. */
    fun useBrush(tool: String) {
        brush = brushes[tool] ?: Brush.default(tool)
        mode = Mode.PEN
    }

    private fun editable(i: Item): Boolean {
        val l = state.layers.firstOrNull { it.id == i.layer } ?: return true
        return l.visible && !l.locked
    }

    /** Pointer down. Returns false when there is nothing to do (e.g. the active layer is locked). */
    fun begin(s: InkSample): Boolean {
        cancel()
        lastPressure = s.pressure
        wetGeneration++
        val erase = mode == Mode.ERASER || s.tool == InkTool.ERASER ||
            (s.buttons and InkSample.BUTTON_ERASER) != 0 || (barrelErases && (s.buttons and InkSample.BUTTON_BARREL) != 0)
        if (erase) {
            erasing = true
            eraseBefore = state.items.toList()
            eraseChanged = false
            eraser.pressureOn = pressureOn
            eraser.begin()
            move(listOf(s))
            return true
        }
        val layer = state.layers.firstOrNull { it.id == state.activeLayer }
        if (layer != null && layer.locked) return false
        curveAtStart = pressureCurve.last
        val b = StrokeBuilder(brush, color, s, pressureOn, tiltOn, pressureCurve, state.activeLayer)
        builder = b
        wet = WetStroke(b.style())
        return true
    }

    /** Pointer moved: all samples since the last call, oldest first (the coalesced / historical ones too). */
    fun move(samples: List<InkSample>) {
        if (samples.isNotEmpty()) lastPressure = samples[samples.size - 1].pressure
        builder?.let { b ->
            for (s in samples) b.add(s, view.zoom)
            return
        }
        if (erasing && eraser.move(state.items, samples, ::editable)) {
            eraseChanged = true
            version++
            dryGeneration++
        }
    }

    /**
     * Starts the current stroke again from [all] its samples, e.g. when Apple Pencil delivers a better pressure for
     * samples already drawn (estimated-property updates). The builder is deterministic, so this equals drawing them once.
     * The wet layer must be cleared and repainted ([wetGeneration] changes).
     */
    fun restartStroke(all: List<InkSample>) {
        val b = builder ?: return
        if (all.isEmpty()) return
        pressureCurve.last = curveAtStart
        val nb = StrokeBuilder(b.brush, b.color, all[0], pressureOn, tiltOn, pressureCurve, b.layer)
        for (k in 1 until all.size) nb.add(all[k], view.zoom)
        builder = nb
        wet = WetStroke(nb.style())
        wetGeneration++
    }

    /** Pointer up: the stroke goes on the board (one undo step). Returns true when the board changed. */
    fun end(): Boolean {
        wetGeneration++
        builder?.let { b ->
            builder = null
            wet = null
            history.addStroke(state, b.finish())
            version++ // added at the end: the dry ink only grows (no new dryGeneration)
            dirty = true
            return true
        }
        if (erasing) {
            erasing = false
            val before = eraseBefore
            eraseBefore = null
            if (eraseChanged && before != null) {
                history.pushItems(before)
                changed()
                return true
            }
        }
        return false
    }

    /** The gesture was cancelled (palm, system gesture, FLAG_CANCELED): drop the wet stroke, undo a partial erase. */
    fun cancel() {
        if (builder != null) wetGeneration++
        builder = null
        wet = null
        if (erasing) {
            erasing = false
            val before = eraseBefore
            if (eraseChanged && before != null) {
                state.replaceItems(before)
                version++
                dryGeneration++
            }
            eraseBefore = null
        }
    }

    fun undo(): Boolean = history.undo(state).also { if (it) changed() }
    fun redo(): Boolean = history.redo(state).also { if (it) changed() }

    private fun changed() {
        version++
        dryGeneration++
        dirty = true
    }

    /** Writes the board to the store (no-op without one). */
    fun save(now: Long) {
        board = board.withItems(state.items)
        if (store != null && boardId != null) store.save(boardId, board, now)
        dirty = false
    }

    /** The stroke being drawn, plus [predicted] samples ahead of the pen (never stored). Null when not drawing. */
    fun wetStroke(predicted: List<InkSample> = emptyList()): Item? =
        builder?.let { b -> if (predicted.isEmpty()) b.preview() else b.preview(b.predictedRows(predicted)) }

    /** Paper and pages, in screen space. */
    fun paintPaper(c: Canvas2D, width: Double, height: Double) =
        PaperPainter.paint(c, paper, width, height, view.ox, view.oy, view.zoom)

    /** All items, in board space. */
    fun paintItems(c: Canvas2D) = BoardPainter.paint(c, board, state.items)

    /** Items [from] until the end, in board space. */
    fun paintItems(c: Canvas2D, from: Int) = BoardPainter.paint(c, board, state.items.subList(from.coerceIn(0, state.items.size), state.items.size))

    /**
     * All items recorded once per change: replay it under the view transform. A list is never changed after it is
     * returned (a change makes a new one), so a render thread may replay it while the board is edited.
     */
    fun dryInk(): DrawList {
        val cached = dryCache
        if (cached != null && dryCacheVersion == version) return cached
        val d = DrawList()
        paintItems(d)
        dryCache = d
        dryCacheVersion = version
        return d
    }

    /**
     * The dry ink as chunks to draw in order. While only strokes are added, the earlier chunks stay the same objects
     * (cache whatever you make of them, keyed by the chunk); a new [dryGeneration] means start again. Chunks are
     * immutable, like [dryInk].
     */
    fun dryChunks(): List<DrawList> {
        val n = state.items.size
        if (chunkGeneration != dryGeneration || n < chunkItems || chunks.size >= MAX_CHUNKS) {
            chunks.clear()
            val d = DrawList()
            paintItems(d)
            chunks.add(d)
            chunkGeneration = dryGeneration
            chunkItems = n
        } else if (n > chunkItems) {
            val d = DrawList()
            paintItems(d, chunkItems)
            chunks.add(d)
            chunkItems = n
            if (chunks.size >= MAX_CHUNKS) dryGeneration++ // merge next time
        }
        return chunks.toList()
    }

    /** True when the stroke being drawn is painted a piece at a time ([paintWetNew] + [paintWetTail]). */
    val wetIncremental: Boolean get() = wet?.incremental == true

    /** Wet ink for a layer that keeps its pixels: the segments that became final since the last call (board space). */
    fun paintWetNew(c: Canvas2D) {
        val b = builder ?: return
        wet?.paintNew(c, b.points)
    }

    /** The provisional end of the stroke and the eraser ring (board space): draw it on a layer cleared every frame. */
    fun paintWetTail(c: Canvas2D, predicted: List<InkSample> = emptyList()) {
        val b = builder
        val w = wet
        if (b != null && w != null && w.incremental) w.paintTail(c, b.points, if (predicted.isEmpty()) emptyList() else b.predictedRows(predicted))
        paintEraserRing(c)
    }

    /** The whole wet stroke and the eraser ring (board space), for a layer cleared every frame. */
    fun paintWet(c: Canvas2D, predicted: List<InkSample> = emptyList()) {
        val b = builder
        if (b != null) {
            val rows = if (predicted.isEmpty()) b.points else b.points + b.predictedRows(predicted)
            c.save()
            StrokePainter.paintRows(c, b.style(), rows)
            c.restore()
        }
        paintEraserRing(c)
    }

    /** A thin ring where the eraser is, its size following pen pressure (the desktop shows its brush cursor). */
    fun paintEraserRing(c: Canvas2D) {
        if (!erasing || !eraser.hasCursor) return
        c.save()
        c.setLineDash(doubleArrayOf())
        c.setGlobalAlpha(1.0)
        c.setStrokeColor(0xB0707070)
        c.setLineWidth(1.5 / view.zoom)
        c.beginPath()
        c.arc(eraser.cursorX, eraser.cursorY, eraser.cursorRadius, 0.0, 7.0)
        c.stroke()
        c.restore()
    }

    /** A whole frame for a [width] x [height] view: paper, then items and the wet stroke under the view transform. */
    fun paintFrame(c: Canvas2D, width: Double, height: Double, predicted: List<InkSample> = emptyList()) {
        paintPaper(c, width, height)
        c.save()
        c.translate(view.ox, view.oy)
        c.scale(view.zoom, view.zoom)
        for (d in dryChunks()) d.replay(c)
        paintWet(c, predicted)
        c.restore()
    }

    /** Fits the board's content (or its first page) into a [width] x [height] view. */
    fun fitView(width: Double, height: Double) {
        if (paper.pageSize != "inf") {
            val (pw, ph) = PaperPainter.pageSize(paper).let { it[0] to it[1] }
            view.fit(0.0, 0.0, pw, ph, width, height)
            return
        }
        val s = Scene.of(board.withItems(state.items))
        view.fit(s.minX, s.minY, s.maxX, s.maxY, width, height)
    }

    companion object {
        /** After this many chunks they are merged into one (fewer, bigger draws). */
        const val MAX_CHUNKS = 24
    }
}
