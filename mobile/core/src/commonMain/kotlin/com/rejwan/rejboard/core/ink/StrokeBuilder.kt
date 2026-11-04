package com.rejwan.rejboard.core.ink

import com.rejwan.rejboard.core.Item
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/** What touched the screen. */
enum class InkTool { PEN, ERASER, TOUCH, MOUSE }

/**
 * One input sample, the same on every platform. Board coordinates; [pressure] 0..1 (0 = not reported);
 * [tiltX], [tiltY] in degrees (-90..90, as PointerEvent); [azimuth] radians; [t] milliseconds;
 * [buttons]: [BUTTON_BARREL] for the S Pen / Surface pen side button, [BUTTON_ERASER] for an eraser tip.
 */
data class InkSample(
    val x: Double,
    val y: Double,
    val pressure: Double = 0.0,
    val tiltX: Double = 0.0,
    val tiltY: Double = 0.0,
    val azimuth: Double = 0.0,
    val t: Double = 0.0,
    val tool: InkTool = InkTool.PEN,
    val buttons: Int = 0,
) {
    companion object {
        const val BUTTON_BARREL = 1
        const val BUTTON_ERASER = 2
    }
}

/** The desktop's brush sizes: 0.1 to 60 px on a log slider (szFromR / szToR / BSZ in index.html). */
object BrushSize {
    const val MIN = 0.1
    const val MAX = 60.0
    const val ERASER_MIN = 0.5
    const val ERASER_MAX = 80.0

    /** Slider position 0..1000 to a size: one decimal below 10 px, whole pixels above. */
    fun fromSlider(r: Double, lo: Double = MIN, hi: Double = MAX): Double {
        val rr = if (r.isNaN()) 0.0 else min(1000.0, max(0.0, r))
        val v = lo * (hi / lo).pow(rr / 1000)
        return if (v < 10) jsRound(v * 10) / 10 else jsRound(v)
    }

    fun toSlider(v: Double, lo: Double = MIN, hi: Double = MAX): Double {
        val vv = if (v.isNaN() || v == 0.0) lo else v
        return jsRound(1000 * ln(min(hi, max(lo, vv)) / lo) / ln(hi / lo))
    }

    /** Math.round: halves go up. */
    fun jsRound(v: Double): Double = floor(v + 0.5)
}

/** One brush's settings (cfg[tool] in index.html). */
data class Brush(
    val tool: String,
    val size: Double,
    /** stabiliser 0..100 */
    val stab: Double = 30.0,
    /** pressure sensitivity 0..1 */
    val sens: Double = .6,
    val ang: Double = if (tool == "hch") 45.0 else 135.0,
    val opacity: Double = if (tool.startsWith("h")) 35.0 else 100.0,
    /** dashed / dotted ... for pens; "solid" or null for none */
    val lineType: String? = null,
) {
    val isHighlighter: Boolean get() = tool.startsWith("h")
    /** isPen() in index.html: the brushes that can be dashed */
    val isPen: Boolean get() = tool == "fount" || tool == "calli" || tool == "soft" || tool == "ball" || tool == "pencil"

    /** This brush at another size (for Swift / C, where data-class copy() is awkward). */
    fun withSize(size: Double): Brush = copy(size = size)

    /** This brush with the desktop brush panel's settings: size, stabiliser, pressure (sens 0..1), nib angle, opacity. */
    fun withSettings(size: Double, stab: Double, sens: Double, ang: Double, opacity: Double): Brush =
        copy(size = size, stab = stab, sens = sens, ang = ang, opacity = opacity)

    companion object {
        /** DEF in index.html */
        val DEFAULT_SIZES = linkedMapOf("fount" to 6.0, "calli" to 8.0, "soft" to 14.0, "ball" to 3.0, "pencil" to 3.0, "hsq" to 18.0, "hch" to 18.0, "hrd" to 18.0)
        val TOOLS: List<String> = DEFAULT_SIZES.keys.toList()
        fun default(tool: String): Brush = Brush(tool, DEFAULT_SIZES[tool] ?: 6.0)

        /** Same as [default] (`default` is a keyword in Swift). */
        fun named(tool: String): Brush = default(tool)
    }
}

/** Pen pressure after the user's "feel" curve (penPr / penGamma in index.html). 50 = raw pressure. */
class PressureCurve(var curve: Double = 50.0) {
    /** The last raw pressure seen (lastPenPr): used when a sample reports none. */
    internal var last = 0.0

    val gamma: Double get() = 3.0.pow((curve - 50) / 50)

    fun apply(raw: Double): Double {
        var r = raw
        if (!(r > 0)) r = if (last != 0.0) last else .3
        last = r
        return max(.02, min(1.0, r.pow(gamma)))
    }
}

/**
 * Turns input samples into a stroke the way the desktop does (pointerdown + addPt in index.html): stabiliser,
 * pressure smoothing (speed-based pressure for fingers and mice), a 0.6-screen-pixel minimum step and tilt shading.
 * [finish] gives the stroke item in the desktop's field order, ready for the board.
 */
class StrokeBuilder(
    val brush: Brush,
    val color: String,
    first: InkSample,
    /** Settings > Pressure sensitivity (ST.pres) */
    pressureOn: Boolean = true,
    /** Settings > Tilt shading (S.tilt); only pens use it */
    tiltOn: Boolean = false,
    val curve: PressureCurve = PressureCurve(),
    /** the stroke's layer (S.ly) */
    val layer: Int = 1,
) {
    private val isPenInput = first.tool == InkTool.PEN || first.tool == InkTool.ERASER
    private val tl = tiltOn && isPenInput
    private val sens = if (pressureOn) brush.sens else 0.0
    private var spx = first.x
    private var spy = first.y
    private var lt = first.t
    private var lp: Double
    private val pts = ArrayList<DoubleArray>()

    /** Points so far: [x, y, pressure] for the first, [x, y, pressure, tilt] after it (as the desktop stores them). */
    val points: List<DoubleArray> get() = pts

    init {
        val p0 = if (isPenInput) curve.apply(first.pressure) else .5
        pts.add(doubleArrayOf(first.x, first.y, p0))
        lp = if (isPenInput) curve.apply(first.pressure) else .5
    }

    /** addPt(): [zoom] is the view zoom, so the minimum step is 0.6 screen pixels. Returns true when a point was added. */
    fun add(s: InkSample, zoom: Double): Boolean {
        val k = min(.92, brush.stab / 100 * .95)
        val dt = max(1.0, s.t - lt)
        lt = s.t
        spx += (s.x - spx) * (1 - k)
        spy += (s.y - spy) * (1 - k)
        val l = pts[pts.size - 1]
        val d = hypot(spx - l[0], spy - l[1])
        val isPen = s.tool == InkTool.PEN || s.tool == InkTool.ERASER
        val pr = if (isPen) curve.apply(s.pressure)
        else if (s.tool != InkTool.MOUSE && s.pressure > 0) s.pressure
        else max(.15, min(1.0, 1 - d / dt * .4))
        lp += (pr - lp) * (if (isPen) .55 else .3)
        if (d > .6 / zoom) {
            pts.add(doubleArrayOf(spx, spy, lp, if (tl) min(1.0, hypot(s.tiltX, s.tiltY) / 60) else 0.0))
            return true
        }
        return false
    }

    /** Rows for predicted samples (the latest smoothed pressure, no tilt), to show ahead of the pen on the wet layer. */
    fun predictedRows(samples: List<InkSample>): List<DoubleArray> = samples.map { doubleArrayOf(it.x, it.y, lp, 0.0) }

    /** How this stroke is drawn (the same fields [finish] stores). */
    fun style(): StrokeStyle {
        val dashed = brush.isPen && brush.lineType != null && brush.lineType != "solid"
        return StrokeStyle(brush.tool, brush.size, color, sens, brush.ang, brush.opacity, tl, dashed, if (dashed) brush.lineType else null, null, false)
    }

    /** The stroke as the desktop builds it: {t, tool, color, size, sens, ang, opacity, [lineType, pl], tl, pts, ly}. */
    fun finish(): Item = Item(JsonObject(buildFields(pts)))

    /** The stroke so far plus [extra] predicted points (drawn on the wet layer, never stored). */
    fun preview(extra: List<DoubleArray> = emptyList()): Item = Item(JsonObject(buildFields(if (extra.isEmpty()) pts else pts + extra)))

    private fun buildFields(points: List<DoubleArray>): LinkedHashMap<String, JsonElement> {
        val m = LinkedHashMap<String, JsonElement>()
        m["t"] = JsonPrimitive("s")
        m["tool"] = JsonPrimitive(brush.tool)
        m["color"] = JsonPrimitive(color)
        m["size"] = jsNumber(brush.size)
        m["sens"] = jsNumber(sens)
        m["ang"] = jsNumber(brush.ang)
        m["opacity"] = jsNumber(brush.opacity)
        if (brush.isPen && brush.lineType != null && brush.lineType != "solid") {
            m["lineType"] = JsonPrimitive(brush.lineType)
            m["pl"] = jsNumber(1.0)
        }
        m["tl"] = JsonPrimitive(tl)
        m["pts"] = JsonArray(points.map { q -> JsonArray(q.map { jsNumber(it) }) })
        m["ly"] = jsNumber(layer.toDouble())
        return m
    }
}

/** A JSON number written the way JavaScript would write it for ordinary values (no ".0" on whole numbers). */
fun jsNumber(v: Double): JsonPrimitive {
    if (v.isNaN() || v.isInfinite()) return JsonPrimitive(null as Number?) // JSON.stringify writes null
    if (v == floor(v) && kotlin.math.abs(v) < 1e15) return JsonPrimitive(v.toLong())
    return JsonPrimitive(v)
}
