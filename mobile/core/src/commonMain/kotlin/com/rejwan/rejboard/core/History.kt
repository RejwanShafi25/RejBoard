package com.rejwan.rejboard.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlin.math.min

/** The board being edited: what undo/redo changes. Mirrors the parts of index.html's `S` that board-core.js touches. */
class BoardState(
    items: List<Item>,
    /** `pg.n`, the number of pages of a paged board */
    var pageCount: Int = 1,
    var layers: List<Layer> = listOf(Layer.DEFAULT),
    /** `ly`, id of the layer new items go on */
    var activeLayer: Int = 1,
) {
    val items: MutableList<Item> = items.toMutableList()
    var selection: List<Item> = emptyList()

    internal fun replaceItems(next: List<Item>) {
        items.clear()
        items.addAll(next)
    }

    companion object {
        fun of(board: Board): BoardState =
            board.layers.let { BoardState(board.items, board.page.count, it, it.last().id) }
    }
}

/** Optional callbacks, as the `hooks` argument of board-core.js undoStep/redoStep (pgUi, pgLk, layersChanged). */
interface HistoryHooks {
    fun pagesChanged() {}
    fun pageLinks(records: JsonElement, undoing: Boolean) {}
    fun layersChanged() {}
}

sealed class HistoryEntry {
    /** Rough memory cost in bytes, used to keep history within its budget (same numbers as board-core.js). */
    abstract val cost: Double
}

/** "A stroke was added at the end": only where it went and how to recognise it. */
class AddedStroke internal constructor(
    val index: Int,
    val pointCount: Int,
    val x: Double?,
    val y: Double?,
    /** the removed stroke, on the redo side only */
    val item: Item?,
) : HistoryEntry() {
    override val cost: Double get() = 400.0
}

/** The whole board before a change. Items are immutable, so a snapshot shares them instead of copying. */
class Snapshot internal constructor(val items: List<Item>, override val cost: Double) : HistoryEntry() {
    /** `__pn`: page count to restore */
    var pageCount: Int? = null
    /** `__lk`: page-link records the app re-applies through [HistoryHooks.pageLinks] */
    var pageLinks: JsonElement? = null
    /** `__ly`: layers to restore */
    var layers: LayerSnapshot? = null
}

class LayerSnapshot(val layers: List<Layer>, val active: Int)

/**
 * Undo/redo, ported from board-core.js (pushDeep, pushAdd, undoStep, redoStep, trimHist, addEntry, addIdx).
 * History keeps at most 60 entries and stays within [budget] bytes, but never drops below 3 entries.
 */
class History(val budget: Double = DEFAULT_BUDGET, var hooks: HistoryHooks? = null) {
    private val past = ArrayDeque<HistoryEntry>()
    private val future = ArrayDeque<HistoryEntry>()

    val undoCount: Int get() = past.size
    val redoCount: Int get() = future.size
    val canUndo: Boolean get() = past.isNotEmpty()
    val canRedo: Boolean get() = future.isNotEmpty()
    /** The newest undo entry, e.g. to attach page or layer changes to the snapshot just pushed. */
    val last: HistoryEntry? get() = past.lastOrNull()

    fun clear() {
        past.clear()
        future.clear()
    }

    /** push(): remember the whole board before a change. */
    fun pushDeep(s: BoardState) {
        past.addLast(snapshot(s.items))
        trim()
        future.clear()
    }

    /** Remember "a stroke is about to be added". False when [stroke] is not a plain stroke (use [pushDeep] then). Call before adding it. */
    fun pushAdd(s: BoardState, stroke: Item): Boolean {
        val e = addEntry(s.items, stroke) ?: return false
        past.addLast(e)
        trim()
        future.clear()
        return true
    }

    /** Record and add a finished stroke at the end of the board. */
    fun addStroke(s: BoardState, stroke: Item) {
        if (!pushAdd(s, stroke)) pushDeep(s)
        s.items.add(stroke)
    }

    fun undo(s: BoardState): Boolean {
        while (past.isNotEmpty()) {
            val h = past.removeLast()
            if (h is AddedStroke) {
                val k = addIdx(s.items, h)
                if (k < 0) continue // its stroke no longer exists: skip this entry
                val it = s.items.removeAt(k)
                future.addLast(AddedStroke(k, h.pointCount, h.x, h.y, it))
                s.selection = emptyList()
                return true
            }
            h as Snapshot
            val f = snapshot(s.items)
            swapExtras(s, h, f, undoing = true)
            future.addLast(f)
            s.replaceItems(h.items)
            s.selection = emptyList()
            return true
        }
        return false
    }

    fun redo(s: BoardState): Boolean {
        val h = future.removeLastOrNull() ?: return false
        if (h is AddedStroke) {
            val k = min(h.index, s.items.size)
            s.items.add(k, h.item ?: return false)
            past.addLast(AddedStroke(k, h.pointCount, h.x, h.y, null))
            trim()
            s.selection = emptyList()
            return true
        }
        h as Snapshot
        val f = snapshot(s.items)
        swapExtras(s, h, f, undoing = false)
        past.addLast(f)
        trim()
        s.replaceItems(h.items)
        s.selection = emptyList()
        return true
    }

    private fun swapExtras(s: BoardState, h: Snapshot, f: Snapshot, undoing: Boolean) {
        h.pageCount?.let { f.pageCount = s.pageCount; s.pageCount = it; hooks?.pagesChanged() }
        h.pageLinks?.let { f.pageLinks = it; hooks?.pageLinks(it, undoing) }
        h.layers?.let { f.layers = LayerSnapshot(s.layers.toList(), s.activeLayer); s.layers = it.layers; s.activeLayer = it.active; hooks?.layersChanged() }
    }

    private fun trim() = trimHistory(past, budget) { it.cost }

    companion object {
        /** index.html uses 40, 96 or 192 MB depending on device memory; 96 MB is the middle one. */
        const val DEFAULT_BUDGET: Double = 96.0 * 1048576

        /** Snapshot of the board's items, costed like board-core.js packItems().__c. */
        fun snapshot(items: List<Item>): Snapshot = Snapshot(items.toList(), cost(items))

        fun cost(items: List<Item>): Double {
            var c = 0.0
            for (i in items) {
                val pts = i["pts"]
                val cw = i["cw"]
                c += when {
                    pts is JsonArray -> pts.size * 112.0
                    pts.truthy() -> 0.0 // a non-array truthy pts: length is undefined in JS, so NaN; counted as nothing
                    cw.truthy() -> ((cw as? JsonArray)?.size ?: 0) * ((i["rh"] as? JsonArray)?.size ?: 0) * 400.0
                    else -> 200.0
                }
            }
            return c
        }

        /** The "added stroke" entry for [s], or null when it is not a plain stroke with points. */
        internal fun addEntry(items: List<Item>, s: Item): AddedStroke? {
            if (s.code != "s") return null
            val pts = s["pts"] as? JsonArray ?: return null
            val p0 = pts.firstOrNull()?.takeIf { it.truthy() } ?: return null
            val q = p0 as? JsonArray
            return AddedStroke(items.size, pts.size, q?.getOrNull(0).numberOrNull(), q?.getOrNull(1).numberOrNull(), null)
        }

        /** Where an "added stroke" entry's stroke is now, or -1 when it is gone. */
        internal fun addIdx(items: List<Item>, h: AddedStroke): Int {
            fun ok(q: Item?): Boolean {
                if (q == null || q.code != "s") return false
                val pts = q["pts"] as? JsonArray ?: return false
                if (pts.size != h.pointCount) return false
                val p0 = pts.firstOrNull() as? JsonArray ?: return false
                val x = p0.getOrNull(0).numberOrNull()
                val y = p0.getOrNull(1).numberOrNull()
                return x != null && y != null && x == h.x && y == h.y
            }
            val k = min(h.index, items.size - 1)
            if (k >= 0 && ok(items[k])) return k
            for (j in items.indices.reversed()) if (ok(items[j])) return j
            return -1
        }
    }
}

/** trimHist(): drop the oldest entries while there are more than 60 or they cost more than [budget], keeping at least 3. */
internal fun <T> trimHistory(list: ArrayDeque<T>, budget: Double, cost: (T) -> Double) {
    var t = 0.0
    for (h in list) t += cost(h)
    while (list.size > 3 && (list.size > 60 || t > budget)) t -= cost(list.removeFirst())
}
