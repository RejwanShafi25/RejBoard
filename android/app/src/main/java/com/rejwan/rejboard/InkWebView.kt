package com.rejwan.rejboard

import android.annotation.SuppressLint
import android.content.Context
import android.view.MotionEvent
import android.webkit.WebView

/**
 * The app's WebView, with one change for pens: Android's WebView does not tell the page that a stylus side (barrel) button is held
 * while drawing (it only turns the button into a right-click), so "Pen side button rubs out" could never work on a tablet.
 * A pen stroke that STARTS with the side button held is passed to the page as a stroke of the pen's eraser end instead
 * (pointerType "pen", button 5 / buttons 32), which the board already erases with. The whole stroke stays an eraser stroke
 * until the pen lifts, and the next stroke is the selected pen again - like Samsung Notes.
 */
@SuppressLint("ViewConstructor")
class InkWebView(ctx: Context) : WebView(ctx) {
    private var eraserStroke = false

    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        if (ev.actionMasked == MotionEvent.ACTION_DOWN) {
            // a pen's eraser end (TOOL_TYPE_ERASER) already reaches the page as an eraser; this is for the side button
            eraserStroke = ev.getToolType(0) == MotionEvent.TOOL_TYPE_STYLUS && (ev.buttonState and SIDE_BUTTONS) != 0
        }
        if (!eraserStroke) return super.dispatchTouchEvent(ev)
        val e = asEraser(ev)
        try {
            return super.dispatchTouchEvent(e)
        } finally {
            e.recycle()
            if (ev.actionMasked == MotionEvent.ACTION_UP || ev.actionMasked == MotionEvent.ACTION_CANCEL) eraserStroke = false
        }
    }

    /** the same event (with its batched samples), with stylus pointers turned into the eraser tool and the side button released */
    private fun asEraser(ev: MotionEvent): MotionEvent {
        val n = ev.pointerCount
        val props = Array(n) { i ->
            MotionEvent.PointerProperties().also { p ->
                ev.getPointerProperties(i, p)
                if (p.toolType == MotionEvent.TOOL_TYPE_STYLUS) p.toolType = MotionEvent.TOOL_TYPE_ERASER
            }
        }
        val buttons = ev.buttonState and SIDE_BUTTONS.inv()
        val hist = ev.historySize
        fun coordsAt(h: Int) = Array(n) { i -> MotionEvent.PointerCoords().also { c -> if (h < 0) ev.getPointerCoords(i, c) else ev.getHistoricalPointerCoords(i, h, c) } }
        val out = MotionEvent.obtain(ev.downTime, if (hist > 0) ev.getHistoricalEventTime(0) else ev.eventTime, ev.action, n, props,
            coordsAt(if (hist > 0) 0 else -1), ev.metaState, buttons, ev.xPrecision, ev.yPrecision, ev.deviceId, ev.edgeFlags, ev.source, ev.flags)
        if (hist > 0) {
            for (h in 1 until hist) out.addBatch(ev.getHistoricalEventTime(h), coordsAt(h), ev.metaState)
            out.addBatch(ev.eventTime, coordsAt(-1), ev.metaState)
        }
        return out
    }

    companion object {
        /* the barrel button(s) as different pens report them: S Pen and most active pens use STYLUS_PRIMARY; Lenovo, Xiaomi, Wacom and
           USI pens with two buttons add STYLUS_SECONDARY; some report the button as a mouse-style SECONDARY (right) button */
        private const val SIDE_BUTTONS = MotionEvent.BUTTON_STYLUS_PRIMARY or MotionEvent.BUTTON_STYLUS_SECONDARY or MotionEvent.BUTTON_SECONDARY
    }
}
