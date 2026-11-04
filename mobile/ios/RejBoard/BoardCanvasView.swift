import SwiftUI
import RejBoardCore

/// The core's scene copied into Swift values once, so drawing does not cross into Kotlin every frame.
struct DrawScene {
    enum Prim {
        case line([CGPoint], CGFloat, Color)
        case rect(CGRect, Color?, Color?, CGFloat, Bool)
        case text(CGPoint, CGFloat, Color, String)
    }

    let background: Color
    let prims: [Prim]
    let bounds: CGRect

    init(_ s: RejBoardCore.Scene) {
        background = DrawScene.color(s.background)
        bounds = CGRect(x: s.minX, y: s.minY, width: max(s.width, 1), height: max(s.height, 1))
        var out: [Prim] = []
        for p in s.prims {
            if let l = p as? ScenePolyline {
                let a = l.points
                var pts: [CGPoint] = []
                pts.reserveCapacity(Int(a.size) / 2)
                var k: Int32 = 0
                while k + 1 < a.size {
                    pts.append(CGPoint(x: a.get(index: k), y: a.get(index: k + 1)))
                    k += 2
                }
                out.append(.line(pts, CGFloat(l.width), DrawScene.color(l.color)))
            } else if let r = p as? SceneRect {
                let fill: Color? = (r.fill >> 24) & 0xFF == 0 ? nil : DrawScene.color(r.fill)
                let stroke: Color? = ((r.stroke >> 24) & 0xFF == 0 || r.lineWidth <= 0) ? nil : DrawScene.color(r.stroke)
                out.append(.rect(CGRect(x: r.x, y: r.y, width: r.w, height: r.h), fill, stroke, CGFloat(r.lineWidth), r.ellipse))
            } else if let t = p as? SceneText {
                out.append(.text(CGPoint(x: t.x, y: t.y), CGFloat(t.size), DrawScene.color(t.color), t.text))
            }
        }
        prims = out
    }

    static func color(_ argb: Int64) -> Color {
        Color(.sRGB,
              red: Double((argb >> 16) & 0xFF) / 255,
              green: Double((argb >> 8) & 0xFF) / 255,
              blue: Double(argb & 0xFF) / 255,
              opacity: Double((argb >> 24) & 0xFF) / 255)
    }
}

/// Read-only board view (pinch to zoom, drag to pan). Phase 2 replaces it with the Metal / Apple Pencil ink view.
struct BoardCanvasView: View {
    let scene: DrawScene
    @State private var zoom: CGFloat = 0 // 0 = fit to the view
    @State private var pan: CGSize = .zero
    @GestureState private var pinch: CGFloat = 1
    @GestureState private var drag: CGSize = .zero

    private func baseZoom(_ size: CGSize) -> CGFloat {
        if zoom != 0 { return zoom }
        let fit = min((size.width - 48) / scene.bounds.width, (size.height - 48) / scene.bounds.height)
        return min(max(fit, 0.05), 4)
    }

    var body: some View {
        GeometryReader { geo in
            let base = baseZoom(geo.size)
            let z = base * pinch
            Canvas { ctx, size in
                ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .color(scene.background))
                ctx.translateBy(x: 24 + pan.width + drag.width - scene.bounds.minX * z,
                                y: 24 + pan.height + drag.height - scene.bounds.minY * z)
                ctx.scaleBy(x: z, y: z)
                for p in scene.prims {
                    switch p {
                    case let .line(pts, w, c):
                        if pts.count == 1 {
                            ctx.fill(Path(ellipseIn: CGRect(x: pts[0].x - w / 2, y: pts[0].y - w / 2, width: w, height: w)), with: .color(c))
                        } else {
                            var path = Path()
                            path.addLines(pts)
                            ctx.stroke(path, with: .color(c), style: StrokeStyle(lineWidth: w, lineCap: .round, lineJoin: .round))
                        }
                    case let .rect(r, fill, stroke, lw, ellipse):
                        let path = ellipse ? Path(ellipseIn: r) : Path(r)
                        if let fill { ctx.fill(path, with: .color(fill)) }
                        if let stroke { ctx.stroke(path, with: .color(stroke), lineWidth: lw) }
                    case let .text(at, size, c, s):
                        ctx.draw(Text(s).font(.system(size: size)).foregroundColor(c), at: at, anchor: .topLeading)
                    }
                }
            }
            .gesture(
                SimultaneousGesture(
                    MagnificationGesture()
                        .updating($pinch) { v, st, _ in st = v }
                        .onEnded { v in zoom = min(max(base * v, 0.05), 20) },
                    DragGesture()
                        .updating($drag) { v, st, _ in st = v.translation }
                        .onEnded { v in
                            pan.width += v.translation.width
                            pan.height += v.translation.height
                        }
                )
            )
        }
    }
}
