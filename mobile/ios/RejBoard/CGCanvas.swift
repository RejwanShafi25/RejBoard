import CoreGraphics
import UIKit
import RejBoardCore

/// The core's `Canvas2D` on a Core Graphics context (y pointing down, like UIKit and the desktop canvas).
/// Kotlin's painters (brushes, paper, items) call straight into it.
final class CGCanvas: NSObject, Canvas2D {
    private struct State {
        var fill: CGColor = UIColor.black.cgColor
        var stroke: CGColor = UIColor.black.cgColor
        var grain = false
        var width: CGFloat = 1
        var cap: CGLineCap = .butt
        var join: CGLineJoin = .miter
        var dash: [CGFloat] = []
        var alpha: CGFloat = 1
        var shadowColor: CGColor = UIColor.clear.cgColor
        var shadowBlur: CGFloat = 0
    }

    private let ctx: CGContext
    private var st = State()
    private var stack: [State] = []
    private var path = CGMutablePath()

    init(_ ctx: CGContext) {
        self.ctx = ctx
        super.init()
    }

    static func color(_ argb: Int64) -> CGColor {
        CGColor(srgbRed: CGFloat((argb >> 16) & 0xFF) / 255, green: CGFloat((argb >> 8) & 0xFF) / 255,
                blue: CGFloat(argb & 0xFF) / 255, alpha: CGFloat((argb >> 24) & 0xFF) / 255)
    }

    func save() {
        stack.append(st)
        ctx.saveGState()
    }

    func restore() {
        guard let s = stack.popLast() else { return }
        st = s
        ctx.restoreGState()
    }

    func translate(x: Double, y: Double) { ctx.translateBy(x: x, y: y) }
    func scale(x: Double, y: Double) { ctx.scaleBy(x: x, y: y) }
    func beginPath() { path = CGMutablePath() }
    func moveTo(x: Double, y: Double) { path.move(to: CGPoint(x: x, y: y)) }

    func lineTo(x: Double, y: Double) {
        if path.isEmpty { path.move(to: CGPoint(x: x, y: y)) } else { path.addLine(to: CGPoint(x: x, y: y)) }
    }

    func quadTo(cx: Double, cy: Double, x: Double, y: Double) {
        if path.isEmpty { path.move(to: CGPoint(x: cx, y: cy)) }
        path.addQuadCurve(to: CGPoint(x: x, y: y), control: CGPoint(x: cx, y: cy))
    }

    func bezierTo(c1x: Double, c1y: Double, c2x: Double, c2y: Double, x: Double, y: Double) {
        if path.isEmpty { path.move(to: CGPoint(x: c1x, y: c1y)) }
        path.addCurve(to: CGPoint(x: x, y: y), control1: CGPoint(x: c1x, y: c1y), control2: CGPoint(x: c2x, y: c2y))
    }

    func arc(x: Double, y: Double, r: Double, a0: Double, a1: Double) {
        guard r > 0 else { return }
        if abs(a1 - a0) >= 2 * Double.pi {
            path.addEllipse(in: CGRect(x: x - r, y: y - r, width: 2 * r, height: 2 * r))
        } else {
            path.addArc(center: CGPoint(x: x, y: y), radius: r, startAngle: a0, endAngle: a1, clockwise: false)
        }
    }

    func rect(x: Double, y: Double, w: Double, h: Double) { path.addRect(CGRect(x: x, y: y, width: w, height: h)) }
    func closePath() { if !path.isEmpty { path.closeSubpath() } }

    private func prepare() {
        ctx.setAlpha(st.alpha)
        if st.shadowBlur > 0 { ctx.setShadow(offset: .zero, blur: st.shadowBlur, color: st.shadowColor) } else { ctx.setShadow(offset: .zero, blur: 0, color: nil) }
    }

    func fill() {
        guard !path.isEmpty else { return }
        ctx.saveGState()
        prepare()
        ctx.setFillColor(st.fill)
        ctx.addPath(path)
        ctx.fillPath(using: .winding)
        ctx.restoreGState()
    }

    func stroke() {
        guard !path.isEmpty else { return }
        ctx.saveGState()
        prepare()
        // pencil graphite: the desktop's speckle texture is not reproduced yet; a lighter line stands in for it
        if st.grain { ctx.setAlpha(st.alpha * 0.75) }
        ctx.setStrokeColor(st.stroke)
        ctx.setLineWidth(st.width)
        ctx.setLineCap(st.cap)
        ctx.setLineJoin(st.join)
        ctx.setLineDash(phase: 0, lengths: st.dash)
        ctx.addPath(path)
        ctx.strokePath()
        ctx.restoreGState()
    }

    func clip() {
        guard !path.isEmpty else { return }
        ctx.addPath(path)
        ctx.clip(using: .winding)
    }

    func fillRect(x: Double, y: Double, w: Double, h: Double) {
        ctx.saveGState()
        prepare()
        ctx.setFillColor(st.fill)
        ctx.fill(CGRect(x: x, y: y, width: w, height: h))
        ctx.restoreGState()
    }

    func setFillColor(argb: Int64) { st.fill = CGCanvas.color(argb) }
    func setStrokeColor(argb: Int64) { st.stroke = CGCanvas.color(argb); st.grain = false }
    func setStrokeGrain(argb: Int64) { st.stroke = CGCanvas.color(argb); st.grain = true }
    func setLineWidth(w: Double) { if w.isFinite && w > 0 { st.width = w } }

    func setLineCap(cap: Int32) {
        st.cap = cap == 1 ? .round : cap == 2 ? .square : .butt
    }

    func setLineJoin(join: Int32) { st.join = join == 1 ? .round : .miter }

    func setLineDash(dash: KotlinDoubleArray) {
        var d: [CGFloat] = []
        var ok = true
        for i in 0..<dash.size {
            let v = dash.get(index: i)
            if !v.isFinite || v < 0 { ok = false }
            d.append(CGFloat(v))
        }
        st.dash = ok ? d : []
    }

    func setGlobalAlpha(a: Double) { if a.isFinite { st.alpha = CGFloat(min(1, max(0, a))) } }

    func setShadow(argb: Int64, blur: Double) {
        st.shadowColor = CGCanvas.color(argb)
        st.shadowBlur = blur.isFinite ? CGFloat(max(0, blur)) : 0
    }

    func fillText(text: String, x: Double, y: Double, size: Double, font: Int32, align: Int32, baseline: Int32) {
        guard size > 0 else { return }
        let f: UIFont = font == 1
            ? UIFont(descriptor: UIFont.systemFont(ofSize: size).fontDescriptor.withDesign(.serif)?.withSymbolicTraits(.traitBold) ?? UIFont.boldSystemFont(ofSize: size).fontDescriptor, size: size)
            : UIFont.systemFont(ofSize: size)
        let attrs: [NSAttributedString.Key: Any] = [.font: f, .foregroundColor: UIColor(cgColor: st.fill).withAlphaComponent(UIColor(cgColor: st.fill).cgColor.alpha * st.alpha)]
        let s = NSAttributedString(string: text, attributes: attrs)
        let sz = s.size()
        let px = align == 1 ? x - sz.width / 2 : x
        let py = baseline == 1 ? y - sz.height / 2 : y
        UIGraphicsPushContext(ctx)
        s.draw(at: CGPoint(x: px, y: py))
        UIGraphicsPopContext()
    }
}
