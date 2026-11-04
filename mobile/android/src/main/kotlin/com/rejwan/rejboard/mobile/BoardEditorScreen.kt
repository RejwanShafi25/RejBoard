package com.rejwan.rejboard.mobile

import android.os.Build
import android.view.View
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.rejwan.rejboard.core.ink.BoardEditor
import com.rejwan.rejboard.core.ink.Brush
import com.rejwan.rejboard.core.ink.BrushSize
import com.rejwan.rejboard.mobile.ink.FrontBufferedInkView
import com.rejwan.rejboard.mobile.ink.InkHost
import com.rejwan.rejboard.mobile.ink.InkInput
import com.rejwan.rejboard.mobile.ink.SimpleInkView
import kotlinx.coroutines.delay

private val COLORS = listOf("#111111", "#dc2626", "#2563eb", "#16a34a", "#f59e0b", "#7c3aed", "#ffffff")
private val BRUSH_NAMES = mapOf(
    "fount" to "Fountain", "calli" to "Calligraphy", "soft" to "Soft", "ball" to "Ballpoint", "pencil" to "Pencil",
    "hsq" to "Highlighter", "hch" to "Chisel HL", "hrd" to "Round HL",
)

/** An open board: the low-latency ink view under a small toolbar. Changes are saved a moment after each stroke. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BoardEditorScreen(editor: BoardEditor, onClose: () -> Unit) {
    var tool by remember { mutableStateOf(editor.brush.tool) }
    var erasing by remember { mutableStateOf(editor.mode == BoardEditor.Mode.ERASER) }
    var color by remember { mutableStateOf(editor.color) }
    var slider by remember { mutableFloatStateOf(BrushSize.toSlider(editor.brush.size).toFloat()) }
    var fingerDraws by remember { mutableStateOf(true) }
    var changes by remember { mutableIntStateOf(0) }
    var inkView by remember { mutableStateOf<View?>(null) }

    fun input(): InkInput? = when (val v = inkView) {
        is SimpleInkView -> v.input
        else -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && v is FrontBufferedInkView) v.input else null
    }
    fun redraw() { (inkView as? InkHost)?.redrawAll() }
    fun applyBrush() {
        editor.brush = Brush.default(tool).copy(size = BrushSize.fromSlider(slider.toDouble()))
        editor.color = color
        editor.mode = if (erasing) BoardEditor.Mode.ERASER else BoardEditor.Mode.PEN
        editor.eraser.size = BrushSize.fromSlider(slider.toDouble(), BrushSize.ERASER_MIN, BrushSize.ERASER_MAX)
    }
    fun close() {
        if (editor.dirty) editor.save(System.currentTimeMillis())
        onClose()
    }

    // save a moment after the last change
    LaunchedEffect(changes) {
        if (changes == 0) return@LaunchedEffect
        delay(1500)
        if (editor.dirty && !editor.isDrawing && !editor.isErasing) editor.save(System.currentTimeMillis())
    }
    DisposableEffect(Unit) { onDispose { if (editor.dirty) editor.save(System.currentTimeMillis()) } }
    BackHandler { close() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(editor.board.title) },
                actions = {
                    TextButton(onClick = { if (editor.undo()) { redraw(); changes++ } }) { Text("Undo") }
                    TextButton(onClick = { if (editor.redo()) { redraw(); changes++ } }) { Text("Redo") }
                    TextButton(onClick = { close() }) { Text("Done") }
                },
            )
        },
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize()) {
            Row(
                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                for (t in Brush.TOOLS) {
                    FilterChip(selected = !erasing && tool == t, onClick = {
                        if (tool != t) slider = BrushSize.toSlider(Brush.default(t).size).toFloat()
                        tool = t; erasing = false; applyBrush()
                    }, label = { Text(BRUSH_NAMES[t] ?: t) })
                }
                FilterChip(selected = erasing, onClick = {
                    erasing = true
                    slider = BrushSize.toSlider(editor.eraser.size, BrushSize.ERASER_MIN, BrushSize.ERASER_MAX).toFloat()
                    applyBrush()
                }, label = { Text("Eraser") })
                for (c in COLORS) {
                    val parsed = android.graphics.Color.parseColor(c)
                    Box(
                        Modifier.size(28.dp).clip(CircleShape).background(Color(parsed))
                            .border(if (c == color) 3.dp else 1.dp, if (c == color) Color(0xFF2563EB) else Color.Gray, CircleShape)
                            .clickable { color = c; erasing = false; applyBrush() },
                    )
                }
                FilterChip(selected = fingerDraws, onClick = {
                    fingerDraws = !fingerDraws
                    input()?.fingerDraws = fingerDraws
                }, label = { Text("Finger draws") })
            }
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                val px = if (erasing) BrushSize.fromSlider(slider.toDouble(), BrushSize.ERASER_MIN, BrushSize.ERASER_MAX) else BrushSize.fromSlider(slider.toDouble())
                Text(if (px < 10) "%.1f px".format(px) else "${px.toInt()} px", Modifier.width(64.dp))
                Slider(value = slider, onValueChange = { slider = it; applyBrush() }, valueRange = 0f..1000f, modifier = Modifier.weight(1f))
            }
            AndroidView(
                modifier = Modifier.fillMaxWidth().weight(1f),
                factory = { ctx ->
                    applyBrush()
                    val onChanged: () -> Unit = { changes++ }
                    val v: View = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) FrontBufferedInkView(ctx, editor, onChanged)
                    else SimpleInkView(ctx, editor, onChanged)
                    inkView = v
                    v
                },
            )
        }
    }
}
