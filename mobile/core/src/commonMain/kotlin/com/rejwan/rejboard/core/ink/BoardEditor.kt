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
    var brush: Brush = Brush.default("fount")
    var color: String = "#111111"
    val eraser = Eraser()
    /** Settings > Pressure sensitivity */
    var pressureOn = true
    /** Settings > Tilt shading */
    var tiltOn = false
    val pressureCurve = PressureCurve()
    /** S Pen / pen side button erases while held */
    var barrelErases = true

    /** Changes whenever the items change (for caches of the dry ink). */
    var version: Int = 0
        private set
    /** Unsaved changes. */
    var dirty: Boolean = false
        private set

    private var builder: StrokeBuilder? = null
    private var curveAtStart = 0.0
    private var erasing = false
    private var eraseBefore: List<Item>? = null
    private var eraseChanged = false
    private var dryCache: DrawList? = null
    private var dryCacheVersion = -1

    val isDrawing: Boolean get() = builder != null
    val isErasing: Boolean get() = erasing

    private fun editable(i: Item): Boolean {
        val l = state.layers.firstOrNull { it.id == i.layer } ?: return true
        return l.visible && !l.locked
    }

    /** Pointer down. Returns false when there is nothing to do (e.g. the active layer is locked). */
    fun begin(s: InkSample): Boolean {
        cancel()
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
        builder = StrokeBuilder(brush, color, s, pressureOn, tiltOn, pressureCurve, state.activeLayer)
        return true
    }

    /** Pointer moved: all samples since the last call, oldest first (the coalesced / historical ones too). */
    fun move(samples: List<InkSample>) {
        builder?.let { b ->
            for (s in samples) b.add(s, view.zoom)
            return
        }
        if (erasing && eraser.move(state.items, samples, ::editable)) {
            eraseChanged = true
            version++
        }
    }

    /**
     * Starts the current stroke again from [all] its samples, e.g. when Apple Pencil delivers a better pressure for
     * samples already drawn (estimated-property updates). The builder is deterministic, so this equals drawing them once.
     */
    fun restartStroke(all: List<InkSample>) {
        val b = builder ?: return
        if (all.isEmpty()) return
        pressureCurve.last = curveAtStart
        val nb = StrokeBuilder(b.brush, b.color, all[0], pressureOn, tiltOn, pressureCurve, b.layer)
        for (k in 1 until all.size) nb.add(all[k], view.zoom)
        builder = nb
    }

    /** Pointer up: the stroke goes on the board (one undo step). Returns true when the board changed. */
    fun end(): Boolean {
        builder?.let { b ->
            builder = null
            history.addStroke(state, b.finish())
            changed()
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
        builder = null
        if (erasing) {
            erasing = false
            val before = eraseBefore
            if (eraseChanged && before != null) {
                state.replaceItems(before)
                version++
            }
            eraseBefore = null
        }
    }

    fun undo(): Boolean = history.undo(state).also { if (it) changed() }
    fun redo(): Boolean = history.redo(state).also { if (it) changed() }

    private fun changed() {
        version++
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

    /**
     * All items recorded once per change: replay it under the view transform (cheap while panning). A list is never
     * changed after it is returned (a change makes a new one), so a render thread may replay it while the board is edited.
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

    /** The wet stroke, in board space. */
    fun paintWet(c: Canvas2D, predicted: List<InkSample> = emptyList()) {
        val w = wetStroke(predicted) ?: return
        c.save()
        StrokePainter.paint(c, w)
        c.restore()
    }

    /** A whole frame for a [width] x [height] view: paper, then items and the wet stroke under the view transform. */
    fun paintFrame(c: Canvas2D, width: Double, height: Double, predicted: List<InkSample> = emptyList()) {
        paintPaper(c, width, height)
        c.save()
        c.translate(view.ox, view.oy)
        c.scale(view.zoom, view.zoom)
        dryInk().replay(c)
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
}
