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
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
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

private enum class Panel { NONE, BRUSH, ERASER, PEN }

/** A labelled slider row, like a row of the desktop's brush panel. */
@Composable
private fun SliderRow(label: String, value: Float, range: ClosedFloatingPointRange<Float>, text: String, onChange: (Float) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.width(96.dp), style = MaterialTheme.typography.bodySmall)
        Slider(value = value, onValueChange = onChange, valueRange = range, modifier = Modifier.weight(1f))
        Text(text, Modifier.width(64.dp), style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun SwitchRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

private fun px(v: Double) = if (v < 10) "%.1f px".format(v) else "${v.toInt()} px"

/** An open board: the low-latency ink view under a toolbar. Changes are saved a moment after each stroke. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BoardEditorScreen(editor: BoardEditor, onClose: () -> Unit) {
    var tool by remember { mutableStateOf(editor.brush.tool) }
    var erasing by remember { mutableStateOf(editor.mode == BoardEditor.Mode.ERASER) }
    var color by remember { mutableStateOf(editor.color) }
    var panel by remember { mutableStateOf(Panel.NONE) }
    var fingerDraws by remember { mutableStateOf(true) }
    var changes by remember { mutableIntStateOf(0) }
    var settings by remember { mutableIntStateOf(0) } // bumps when a brush setting changes, to recompose the panel
    var pressure by remember { mutableFloatStateOf(0f) }
    var inkView by remember { mutableStateOf<View?>(null) }

    fun input(): InkInput? = when (val v = inkView) {
        is SimpleInkView -> v.input
        else -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && v is FrontBufferedInkView) v.input else null
    }
    fun redraw() { (inkView as? InkHost)?.redrawAll() }
    fun selectBrush(t: String) {
        tool = t
        erasing = false
        editor.useBrush(t)
        editor.color = color
    }
    fun updateBrush(f: (Brush) -> Brush) {
        editor.brush = f(editor.brushes[tool] ?: Brush.default(tool))
        editor.mode = BoardEditor.Mode.PEN
        erasing = false
        settings++
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
    // live pressure meter while the pen panel is open
    LaunchedEffect(panel) {
        while (panel == Panel.PEN) {
            pressure = editor.lastPressure.toFloat()
            delay(50)
        }
    }
    DisposableEffect(Unit) { onDispose { if (editor.dirty) editor.save(System.currentTimeMillis()) } }
    BackHandler { if (panel != Panel.NONE) panel = Panel.NONE else close() }

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
                        // a second tap on the selected brush opens its settings, as on the desktop
                        if (!erasing && tool == t) panel = if (panel == Panel.BRUSH) Panel.NONE else Panel.BRUSH
                        selectBrush(t)
                    }, label = { Text(BRUSH_NAMES[t] ?: t) })
                }
                FilterChip(selected = erasing, onClick = {
                    if (erasing) panel = if (panel == Panel.ERASER) Panel.NONE else Panel.ERASER
                    erasing = true
                    editor.mode = BoardEditor.Mode.ERASER
                }, label = { Text("Eraser") })
                for (c in COLORS) {
                    val parsed = android.graphics.Color.parseColor(c)
                    Box(
                        Modifier.size(28.dp).clip(CircleShape).background(Color(parsed))
                            .border(if (c == color) 3.dp else 1.dp, if (c == color) Color(0xFF2563EB) else Color.Gray, CircleShape)
                            .clickable {
                                color = c
                                editor.color = c
                                if (erasing) selectBrush(tool)
                            },
                    )
                }
                FilterChip(selected = panel == Panel.BRUSH || panel == Panel.ERASER, onClick = {
                    panel = if (panel == Panel.BRUSH || panel == Panel.ERASER) Panel.NONE else if (erasing) Panel.ERASER else Panel.BRUSH
                }, label = { Text("Settings") })
                FilterChip(selected = panel == Panel.PEN, onClick = { panel = if (panel == Panel.PEN) Panel.NONE else Panel.PEN }, label = { Text("Pen") })
                FilterChip(selected = fingerDraws, onClick = {
                    fingerDraws = !fingerDraws
                    input()?.fingerDraws = fingerDraws
                }, label = { Text("Finger draws") })
            }

            if (panel != Panel.NONE) {
                Surface(tonalElevation = 2.dp, modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(vertical = 4.dp)) {
                        settings // read, so the panel recomposes when a setting changes
                        when (panel) {
                            Panel.BRUSH -> {
                                val b = editor.brushes[tool] ?: Brush.default(tool)
                                SliderRow("Size", BrushSize.toSlider(b.size).toFloat(), 0f..1000f, px(b.size)) { v ->
                                    updateBrush { it.copy(size = BrushSize.fromSlider(v.toDouble())) }
                                }
                                SliderRow("Stabiliser", b.stab.toFloat(), 0f..100f, "${b.stab.toInt()}") { v -> updateBrush { it.copy(stab = v.toDouble().let(Math::rint)) } }
                                SliderRow("Pressure", (b.sens * 100).toFloat(), 0f..100f, "${(b.sens * 100).toInt()}") { v ->
                                    updateBrush { it.copy(sens = Math.rint(v.toDouble()) / 100) }
                                }
                                SliderRow("Nib angle", b.ang.toFloat(), 0f..180f, "${b.ang.toInt()}°") { v -> updateBrush { it.copy(ang = Math.rint(v.toDouble())) } }
                                // the desktop shows Opacity for the soft brush and the highlighters (#bopw)
                                if (tool !in listOf("fount", "calli", "ball", "pencil")) {
                                    SliderRow("Opacity", b.opacity.toFloat(), 5f..100f, "${b.opacity.toInt()}%") { v ->
                                        updateBrush { it.copy(opacity = Math.rint(v.toDouble())) }
                                    }
                                }
                            }
                            Panel.ERASER -> {
                                val e = editor.eraser
                                SliderRow("Size", BrushSize.toSlider(e.size, BrushSize.ERASER_MIN, BrushSize.ERASER_MAX).toFloat(), 0f..1000f, px(e.size)) { v ->
                                    e.size = BrushSize.fromSlider(v.toDouble(), BrushSize.ERASER_MIN, BrushSize.ERASER_MAX); settings++
                                }
                                SwitchRow("Erase whole strokes", e.whole) { e.whole = it; settings++ }
                                SwitchRow("Only highlighter", e.onlyHighlighter) { e.onlyHighlighter = it; settings++ }
                            }
                            Panel.PEN -> {
                                Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Text("Pressure", Modifier.width(96.dp), style = MaterialTheme.typography.bodySmall)
                                    LinearProgressIndicator(progress = { pressure.coerceIn(0f, 1f) }, modifier = Modifier.weight(1f))
                                    Text("%.2f".format(pressure), Modifier.width(64.dp).padding(start = 8.dp), style = MaterialTheme.typography.bodySmall)
                                }
                                SliderRow("Pressure feel", editor.pressureCurve.curve.toFloat(), 0f..100f, if (editor.pressureCurve.curve < 50) "soft" else if (editor.pressureCurve.curve > 50) "firm" else "raw") { v ->
                                    editor.pressureCurve.curve = Math.rint(v.toDouble()); settings++
                                }
                                SwitchRow("Pressure sensitivity", editor.pressureOn) { editor.pressureOn = it; settings++ }
                                SwitchRow("Tilt shading (pencil, soft brush)", editor.tiltOn) { editor.tiltOn = it; settings++ }
                                SwitchRow("Pen button erases", editor.barrelErases) { editor.barrelErases = it; settings++ }
                            }
                            Panel.NONE -> {}
                        }
                    }
                }
            }

            AndroidView(
                modifier = Modifier.fillMaxWidth().weight(1f),
                factory = { ctx ->
                    editor.color = color
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
