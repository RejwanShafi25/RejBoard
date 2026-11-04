package com.rejwan.rejboard.mobile

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.sp
import com.rejwan.rejboard.core.Scene
import com.rejwan.rejboard.core.ScenePolyline
import com.rejwan.rejboard.core.SceneRect
import com.rejwan.rejboard.core.SceneText
import kotlin.math.min

private fun argb(c: Long) = Color(c.toInt())

/**
 * Read-only board view: draws the core's [Scene] with Compose Canvas. Pinch to zoom, drag to pan.
 * (Phase 2 replaces this with the low-latency ink view.)
 */
@Composable
fun BoardView(scene: Scene, modifier: Modifier = Modifier) {
    val measurer = rememberTextMeasurer()
    var zoom by remember(scene) { mutableFloatStateOf(0f) } // 0 = not fitted yet
    var pan by remember(scene) { mutableStateOf(Offset.Zero) }
    val margin = 24f

    Canvas(
        modifier.pointerInput(scene) {
            detectTransformGestures { centroid, dragged, gestureZoom, _ ->
                if (zoom == 0f) return@detectTransformGestures
                val z = (zoom * gestureZoom).coerceIn(0.05f, 20f)
                // keep the board point under the fingers where it is
                pan = centroid - (centroid - pan) * (z / zoom) + dragged
                zoom = z
            }
        },
    ) {
        if (zoom == 0f) {
            val w = scene.width.toFloat().coerceAtLeast(1f)
            val h = scene.height.toFloat().coerceAtLeast(1f)
            zoom = min((size.width - 2 * margin) / w, (size.height - 2 * margin) / h).coerceIn(0.05f, 4f)
            pan = Offset(margin - scene.minX.toFloat() * zoom, margin - scene.minY.toFloat() * zoom)
        }
        drawRect(argb(scene.background))
        withTransform({
            translate(pan.x, pan.y)
            scale(zoom, zoom, Offset.Zero)
        }) { drawScene(scene, measurer) }
    }
}

private fun DrawScope.drawScene(scene: Scene, measurer: androidx.compose.ui.text.TextMeasurer) {
    for (p in scene.prims) when (p) {
        is ScenePolyline -> {
            val pts = p.points
            if (pts.size < 2) continue
            val color = argb(p.color)
            val width = p.width.toFloat()
            if (pts.size == 2) {
                drawCircle(color, width / 2, Offset(pts[0].toFloat(), pts[1].toFloat()))
                continue
            }
            val path = Path().apply {
                moveTo(pts[0].toFloat(), pts[1].toFloat())
                var k = 2
                while (k + 1 < pts.size) { lineTo(pts[k].toFloat(), pts[k + 1].toFloat()); k += 2 }
            }
            drawPath(path, color, style = Stroke(width, cap = StrokeCap.Round, join = StrokeJoin.Round))
        }
        is SceneRect -> {
            val tl = Offset(p.x.toFloat(), p.y.toFloat())
            val sz = Size(p.w.toFloat(), p.h.toFloat())
            if ((p.fill ushr 24) != 0L) {
                if (p.ellipse) drawOval(argb(p.fill), tl, sz) else drawRect(argb(p.fill), tl, sz)
            }
            if ((p.stroke ushr 24) != 0L && p.lineWidth > 0) {
                val st = Stroke(p.lineWidth.toFloat())
                if (p.ellipse) drawOval(argb(p.stroke), tl, sz, style = st) else drawRect(argb(p.stroke), tl, sz, style = st)
            }
        }
        is SceneText -> drawText(
            measurer,
            p.text,
            topLeft = Offset(p.x.toFloat(), p.y.toFloat()),
            // the canvas is already scaled to board units: one board unit is one pixel at zoom 1
            style = TextStyle(color = argb(p.color), fontSize = (p.size / density / fontScale).toFloat().sp),
        )
    }
}
