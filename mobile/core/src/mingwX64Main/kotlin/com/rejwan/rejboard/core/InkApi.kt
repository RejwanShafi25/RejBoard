@file:OptIn(ExperimentalForeignApi::class, ExperimentalNativeApi::class)

package com.rejwan.rejboard.core

import com.rejwan.rejboard.core.ink.BoardEditor
import com.rejwan.rejboard.core.ink.Brush
import com.rejwan.rejboard.core.ink.DrawList
import com.rejwan.rejboard.core.ink.InkSample
import com.rejwan.rejboard.core.ink.InkTool
import kotlinx.cinterop.ByteVar
import kotlinx.cinterop.CPointer
import kotlinx.cinterop.DoubleVar
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.IntVar
import kotlinx.cinterop.convert
import kotlinx.cinterop.reinterpret
import kotlinx.cinterop.set
import kotlinx.cinterop.toKString
import platform.posix.free
import platform.posix.malloc
import kotlin.experimental.ExperimentalNativeApi
import kotlin.native.CName

/*
 * Editing and ink for the Windows app (declared in rejboard_core.h). One board is open for editing at a time.
 * Pointer positions are in view pixels (DIPs); the core converts them with the editor's viewport.
 * Draw lists come back as one malloc'ed array of doubles (free with rb_free_doubles):
 *   [nOps, nArgs, nTexts, ops (nOps values), args (nArgs values), then per text: its length n and n UTF-16 code units]
 * Opcodes and their arguments are listed in DrawList.kt.
 */

private var editor: BoardEditor? = null

private fun ed(): BoardEditor = editor ?: error("no board is open for editing")

private inline fun ok(block: () -> Unit): Int = try {
    block()
    1
} catch (e: Throwable) {
    lastError = e.message ?: e.toString()
    0
}

private fun export(d: DrawList, count: CPointer<IntVar>?): CPointer<DoubleVar>? {
    val ops = d.ops
    val args = d.args
    val texts = d.texts
    val n = 3 + ops.size + args.size + texts.sumOf { it.length + 1 }
    val p = malloc((n.coerceAtLeast(1) * 8).convert())?.reinterpret<DoubleVar>() ?: return null
    var k = 0
    p[k++] = ops.size.toDouble()
    p[k++] = args.size.toDouble()
    p[k++] = texts.size.toDouble()
    for (o in ops) p[k++] = o.toDouble()
    for (a in args) p[k++] = a
    for (t in texts) {
        p[k++] = t.length.toDouble()
        for (ch in t) p[k++] = ch.code.toDouble()
    }
    count?.set(0, n)
    return p
}

private fun tool(code: Int): InkTool = when (code) {
    1 -> InkTool.ERASER
    2 -> InkTool.TOUCH
    3 -> InkTool.MOUSE
    else -> InkTool.PEN
}

private fun sample(x: Double, y: Double, pressure: Double, tiltX: Double, tiltY: Double, twist: Double, t: Double, tool: Int, buttons: Int): InkSample {
    val v = ed().view
    return InkSample(v.toBoardX(x), v.toBoardY(y), pressure, tiltX, tiltY, twist, t, tool(tool), buttons)
}

@CName("rb_free_doubles")
fun rbFreeDoubles(p: CPointer<DoubleVar>?) {
    free(p)
}

/** Opens board [id] for editing (closing, and saving, the previous one). 1 = ok. */
@CName("rb_editor_open")
fun rbEditorOpen(id: CPointer<ByteVar>?, nowMs: Long): Int = ok {
    editor?.let { if (it.dirty) it.save(nowMs) }
    editor = null
    val s = store ?: error("rb_store_open was not called")
    val key = id?.toKString() ?: error("no board id given")
    val board = s.load(key) ?: error("board not found")
    if (board.isProtected) error("This board is password-protected; opening it comes in a later version")
    editor = BoardEditor(board, s, key)
}

/** Saves (if changed) and closes the open board. */
@CName("rb_editor_close")
fun rbEditorClose(nowMs: Long): Int = ok {
    editor?.let { if (it.dirty) it.save(nowMs) }
    editor = null
}

@CName("rb_editor_save")
fun rbEditorSave(nowMs: Long): Int = ok { ed().save(nowMs) }

/** 1 when there are unsaved changes. */
@CName("rb_editor_dirty")
fun rbEditorDirty(): Int = if (editor?.dirty == true) 1 else 0

/** Fits the board into a width x height view. */
@CName("rb_view_fit")
fun rbViewFit(width: Double, height: Double): Int = ok { ed().fitView(width, height) }

@CName("rb_view_pan")
fun rbViewPan(dx: Double, dy: Double): Int = ok { ed().view.pan(dx, dy) }

@CName("rb_view_zoom")
fun rbViewZoom(factor: Double, cx: Double, cy: Double): Int = ok { ed().view.zoomAt(factor, cx, cy) }

/** Writes ox, oy, zoom into out[0..2]. */
@CName("rb_view_get")
fun rbViewGet(out: CPointer<DoubleVar>?): Int = ok {
    val v = ed().view
    out?.set(0, v.ox); out?.set(1, v.oy); out?.set(2, v.zoom)
}

/** tool: brush name (fount calli soft ball pencil hsq hch hrd); size in px; color "#rrggbb". */
@CName("rb_set_brush")
fun rbSetBrush(tool: CPointer<ByteVar>?, size: Double, color: CPointer<ByteVar>?): Int = ok {
    val e = ed()
    val t = tool?.toKString() ?: e.brush.tool
    e.brush = Brush.default(t).copy(size = size)
    color?.toKString()?.let { e.color = it }
    e.mode = BoardEditor.Mode.PEN
}

/** Eraser mode with diameter [size]; whole = 1 removes whole strokes. */
@CName("rb_set_eraser")
fun rbSetEraser(size: Double, whole: Int): Int = ok {
    val e = ed()
    e.eraser.size = size
    e.eraser.whole = whole != 0
    e.mode = BoardEditor.Mode.ERASER
}

/** tool: 0 pen, 1 eraser tip, 2 touch, 3 mouse. buttons: 1 = barrel button, 2 = eraser. t in ms. 1 = ink started. */
@CName("rb_ink_begin")
fun rbInkBegin(x: Double, y: Double, pressure: Double, tiltX: Double, tiltY: Double, twist: Double, t: Double, tool: Int, buttons: Int): Int =
    try { if (ed().begin(sample(x, y, pressure, tiltX, tiltY, twist, t, tool, buttons))) 1 else 0 } catch (e: Throwable) { lastError = e.message ?: e.toString(); 0 }

@CName("rb_ink_move")
fun rbInkMove(x: Double, y: Double, pressure: Double, tiltX: Double, tiltY: Double, twist: Double, t: Double, tool: Int, buttons: Int): Int =
    ok { ed().move(listOf(sample(x, y, pressure, tiltX, tiltY, twist, t, tool, buttons))) }

/** 1 when the board changed (then save soon). */
@CName("rb_ink_end")
fun rbInkEnd(): Int = try { if (ed().end()) 1 else 0 } catch (e: Throwable) { lastError = e.message ?: e.toString(); 0 }

@CName("rb_ink_cancel")
fun rbInkCancel(): Int = ok { ed().cancel() }

@CName("rb_undo")
fun rbUndo(): Int = try { if (ed().undo()) 1 else 0 } catch (e: Throwable) { 0 }

@CName("rb_redo")
fun rbRedo(): Int = try { if (ed().redo()) 1 else 0 } catch (e: Throwable) { 0 }

/** Changes whenever the board's items change: re-fetch rb_draw_dry only then. */
@CName("rb_ink_version")
fun rbInkVersion(): Int = editor?.version ?: -1

/** Paper and pages for a width x height view, in view pixels. */
@CName("rb_draw_paper")
fun rbDrawPaper(width: Double, height: Double, count: CPointer<IntVar>?): CPointer<DoubleVar>? = try {
    val d = DrawList()
    ed().paintPaper(d, width, height)
    export(d, count)
} catch (e: Throwable) { lastError = e.message ?: e.toString(); null }

/** All items, in board units (apply the view transform: translate(ox, oy) then scale(zoom)). */
@CName("rb_draw_dry")
fun rbDrawDry(count: CPointer<IntVar>?): CPointer<DoubleVar>? = try {
    export(ed().dryInk(), count)
} catch (e: Throwable) { lastError = e.message ?: e.toString(); null }

/** The stroke being drawn, in board units (empty when not drawing). */
@CName("rb_draw_wet")
fun rbDrawWet(count: CPointer<IntVar>?): CPointer<DoubleVar>? = try {
    val d = DrawList()
    ed().paintWet(d)
    export(d, count)
} catch (e: Throwable) { lastError = e.message ?: e.toString(); null }
