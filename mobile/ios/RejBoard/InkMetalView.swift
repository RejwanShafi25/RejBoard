import MetalKit
import UIKit
import RejBoardCore

/// A Core Graphics bitmap whose pixels live in a shared MTLBuffer, so Metal reads what CG draws without a copy.
private final class InkLayer {
    let width: Int
    let height: Int
    let context: CGContext
    let texture: MTLTexture
    private let buffer: MTLBuffer

    init?(device: MTLDevice, width: Int, height: Int, scale: CGFloat) {
        let align = device.minimumLinearTextureAlignment(for: .bgra8Unorm)
        let bytesPerRow = ((width * 4 + align - 1) / align) * align
        guard width > 0, height > 0,
              let buffer = device.makeBuffer(length: bytesPerRow * height, options: .storageModeShared) else { return nil }
        let desc = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .bgra8Unorm, width: width, height: height, mipmapped: false)
        desc.storageMode = .shared
        desc.usage = [.shaderRead]
        guard let texture = buffer.makeTexture(descriptor: desc, offset: 0, bytesPerRow: bytesPerRow),
              let ctx = CGContext(data: buffer.contents(), width: width, height: height, bitsPerComponent: 8, bytesPerRow: bytesPerRow,
                                  space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)
        else { return nil }
        // UIKit coordinates in points: y down, origin top-left (memory row 0 is the top row, as Metal expects)
        ctx.translateBy(x: 0, y: CGFloat(height))
        ctx.scaleBy(x: scale, y: -scale)
        self.width = width
        self.height = height
        self.buffer = buffer
        self.texture = texture
        self.context = ctx
    }

    func clear() {
        context.saveGState()
        context.resetClip()
        context.clear(CGRect(x: -1e6, y: -1e6, width: 2e6, height: 2e6))
        context.restoreGState()
    }
}

/// Raw Apple Pencil / finger sample, kept so late (estimated) pressure updates can rebuild the stroke.
private struct RawSample {
    var x: Double, y: Double, pressure: Double, tiltX: Double, tiltY: Double, azimuth: Double, t: Double
    var tool: InkTool
    func sample() -> InkSample {
        InkSample(x: x, y: y, pressure: pressure, tiltX: tiltX, tiltY: tiltY, azimuth: azimuth, t: t, tool: tool, buttons: 0)
    }
}

/// The iPad ink view: Metal-backed, two layers (dry board, wet stroke) composited on the GPU.
/// - Apple Pencil: force, altitude / azimuth (tilt), coalesced and predicted touches, estimated-property updates.
/// - UIPencilInteraction: double-tap and squeeze switch to the eraser and back (as the user set it in Settings).
/// - Hover (M2 and newer iPads): a ring shows where the pencil will write.
/// - With a pencil in use, fingers never draw: one finger pans, two fingers pan and zoom.
final class InkMetalView: MTKView, MTKViewDelegate, UIPencilInteractionDelegate {
    let editor: BoardEditor
    var onChanged: () -> Void = {}
    var onModeChanged: () -> Void = {}
    /// fingers draw until a pencil has been seen
    var fingerDraws = true

    private var commandQueue: MTLCommandQueue?
    private var pipeline: MTLRenderPipelineState?
    private var dry: InkLayer?
    private var wet: InkLayer?
    private var dryVersion = -1
    private var dryView = (0.0, 0.0, 0.0)
    private var pencilSeen = false
    private var inkTouch: UITouch?
    private var samples: [RawSample] = []
    private var pendingEstimates: [NSNumber: Int] = [:]
    private var hover: CGPoint?
    private var fitted = false
    private var lastPan = CGPoint.zero
    private var lastScale: CGFloat = 1

    init(editor: BoardEditor) {
        self.editor = editor
        let device = MTLCreateSystemDefaultDevice()
        super.init(frame: .zero, device: device)
        colorPixelFormat = .bgra8Unorm
        framebufferOnly = true
        isPaused = true
        enableSetNeedsDisplay = false
        isMultipleTouchEnabled = true
        delegate = self
        if let device {
            commandQueue = device.makeCommandQueue()
            if let lib = device.makeDefaultLibrary() {
                let d = MTLRenderPipelineDescriptor()
                d.vertexFunction = lib.makeFunction(name: "ink_vertex")
                d.fragmentFunction = lib.makeFunction(name: "ink_fragment")
                d.colorAttachments[0].pixelFormat = colorPixelFormat
                pipeline = try? device.makeRenderPipelineState(descriptor: d)
            }
        }

        let pencil = UIPencilInteraction()
        pencil.delegate = self
        addInteraction(pencil)
        addGestureRecognizer(UIHoverGestureRecognizer(target: self, action: #selector(onHover(_:))))
        let pan = UIPanGestureRecognizer(target: self, action: #selector(onPan(_:)))
        pan.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
        pan.maximumNumberOfTouches = 2
        pan.delegate = self
        addGestureRecognizer(pan)
        let pinch = UIPinchGestureRecognizer(target: self, action: #selector(onPinch(_:)))
        pinch.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
        pinch.delegate = self
        addGestureRecognizer(pinch)
    }

    required init(coder: NSCoder) { fatalError("not used") }

    // MARK: - drawing

    override func layoutSubviews() {
        super.layoutSubviews()
        let w = Int(bounds.width * contentScaleFactor), h = Int(bounds.height * contentScaleFactor)
        if dry?.width != w || dry?.height != h, let device {
            dry = InkLayer(device: device, width: w, height: h, scale: contentScaleFactor)
            wet = InkLayer(device: device, width: w, height: h, scale: contentScaleFactor)
            dryVersion = -1
        }
        if !fitted && bounds.width > 0 {
            editor.fitView(width: Double(bounds.width), height: Double(bounds.height))
            fitted = true
        }
        redrawAll()
    }

    /// Paper and every item, only when the board or the view changed.
    private func renderDry() {
        guard let dry else { return }
        let v = editor.view
        let key = (v.ox, v.oy, v.zoom)
        if dryVersion == Int(editor.version) && dryView == key { return }
        dry.clear()
        let c = CGCanvas(dry.context)
        dry.context.saveGState()
        editor.paintPaper(c: c, width: Double(bounds.width), height: Double(bounds.height))
        c.save()
        c.translate(x: v.ox, y: v.oy)
        c.scale(x: v.zoom, y: v.zoom)
        editor.dryInk().replay(c: c)
        c.restore()
        dry.context.restoreGState()
        dryVersion = Int(editor.version)
        dryView = key
    }

    /// The stroke being drawn (plus predicted touches) and the hover ring.
    private func renderWet(predicted: [InkSample]) {
        guard let wet else { return }
        wet.clear()
        let v = editor.view
        let c = CGCanvas(wet.context)
        wet.context.saveGState()
        c.save()
        c.translate(x: v.ox, y: v.oy)
        c.scale(x: v.zoom, y: v.zoom)
        editor.paintWet(c: c, predicted: predicted)
        c.restore()
        if let h = hover, inkTouch == nil {
            let r = max(2, CGFloat(editor.mode == .eraser ? editor.eraser.size : editor.brush.size) * CGFloat(v.zoom) / 2)
            wet.context.setStrokeColor(UIColor.systemBlue.withAlphaComponent(0.7).cgColor)
            wet.context.setLineWidth(1)
            wet.context.strokeEllipse(in: CGRect(x: h.x - r, y: h.y - r, width: 2 * r, height: 2 * r))
        }
        wet.context.restoreGState()
    }

    func redrawAll() {
        renderDry()
        renderWet(predicted: [])
        draw()
    }

    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

    func draw(in view: MTKView) {
        guard let pipeline, let dry, let wet, let queue = commandQueue,
              let pass = currentRenderPassDescriptor, let drawable = currentDrawable,
              let cmd = queue.makeCommandBuffer(), let enc = cmd.makeRenderCommandEncoder(descriptor: pass) else { return }
        enc.setRenderPipelineState(pipeline)
        enc.setFragmentTexture(dry.texture, index: 0)
        enc.setFragmentTexture(wet.texture, index: 1)
        enc.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
        enc.endEncoding()
        cmd.present(drawable)
        cmd.commit()
    }

    // MARK: - input

    private func rawSample(_ t: UITouch) -> RawSample {
        let p = t.preciseLocation(in: self)
        let pencil = t.type == .pencil
        let v = editor.view
        var tx = 0.0, ty = 0.0, az = 0.0, force = 0.0
        if pencil {
            force = Double(t.maximumPossibleForce > 0 ? t.force / t.maximumPossibleForce : 0)
            az = Double(t.azimuthAngle(in: self))
            let tilt = Double.pi / 2 - Double(t.altitudeAngle) // from upright
            tx = atan(tan(tilt) * cos(az)) * 180 / Double.pi
            ty = atan(tan(tilt) * sin(az)) * 180 / Double.pi
        }
        return RawSample(x: v.toBoardX(sx: Double(p.x)), y: v.toBoardY(sy: Double(p.y)), pressure: force, tiltX: tx, tiltY: ty,
                         azimuth: az, t: t.timestamp * 1000, tool: pencil ? .pen : .touch)
    }

    private func draws(_ t: UITouch) -> Bool {
        if t.type == .pencil { return true }
        return fingerDraws && !pencilSeen && t.type == .direct
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        for t in touches where t.type == .pencil { pencilSeen = true }
        guard inkTouch == nil, let t = touches.first(where: draws) else { return }
        // a finger only draws when it is the only finger down
        if t.type != .pencil && (event?.allTouches?.filter { $0.type == .direct }.count ?? 1) > 1 { return }
        let s = rawSample(t)
        samples = [s]
        pendingEstimates = [:]
        track(t, index: 0)
        if editor.begin(s: s.sample()) {
            inkTouch = t
            if editor.isErasing { redrawAll() } else { renderWet(predicted: []); draw() }
        }
    }

    private func track(_ t: UITouch, index: Int) {
        if !t.estimatedPropertiesExpectingUpdates.isEmpty, let k = t.estimationUpdateIndex { pendingEstimates[k] = index }
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let t = inkTouch, touches.contains(t) else { return }
        let coalesced = event?.coalescedTouches(for: t) ?? [t]
        var batch: [InkSample] = []
        for c in coalesced {
            let s = rawSample(c)
            track(c, index: samples.count)
            samples.append(s)
            batch.append(s.sample())
        }
        editor.move(samples: batch)
        if editor.isErasing {
            redrawAll()
        } else {
            let predicted = (event?.predictedTouches(for: t) ?? []).map { rawSample($0).sample() }
            renderWet(predicted: predicted)
            draw()
        }
    }

    override func touchesEstimatedPropertiesUpdated(_ touches: Set<UITouch>) {
        guard inkTouch != nil, editor.isDrawing else { return }
        var changed = false
        for t in touches {
            guard let k = t.estimationUpdateIndex, let i = pendingEstimates[k], i < samples.count else { continue }
            if t.type == .pencil, t.maximumPossibleForce > 0 { samples[i].pressure = Double(t.force / t.maximumPossibleForce) }
            if t.estimatedPropertiesExpectingUpdates.isEmpty { pendingEstimates[k] = nil }
            changed = true
        }
        if changed {
            editor.restartStroke(all: samples.map { $0.sample() })
            renderWet(predicted: [])
            draw()
        }
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let t = inkTouch, touches.contains(t) else { return }
        inkTouch = nil
        let changed = editor.end()
        redrawAll()
        if changed { onChanged() }
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let t = inkTouch, touches.contains(t) else { return }
        inkTouch = nil
        editor.cancel()
        redrawAll()
    }

    // MARK: - pan / zoom with fingers

    @objc private func onPan(_ g: UIPanGestureRecognizer) {
        let p = g.translation(in: self)
        switch g.state {
        case .began: lastPan = p
        case .changed:
            editor.view.pan(dx: Double(p.x - lastPan.x), dy: Double(p.y - lastPan.y))
            lastPan = p
            redrawAll()
        default: break
        }
    }

    @objc private func onPinch(_ g: UIPinchGestureRecognizer) {
        let c = g.location(in: self)
        switch g.state {
        case .began: lastScale = g.scale
        case .changed:
            editor.view.zoomAt(factor: Double(g.scale / lastScale), cx: Double(c.x), cy: Double(c.y))
            lastScale = g.scale
            redrawAll()
        default: break
        }
    }

    @objc private func onHover(_ g: UIHoverGestureRecognizer) {
        switch g.state {
        case .began, .changed: hover = g.location(in: self)
        default: hover = nil
        }
        renderWet(predicted: [])
        draw()
    }

    // MARK: - Apple Pencil double-tap and squeeze

    private func toggleEraser() {
        editor.mode = editor.mode == .eraser ? .pen : .eraser
        onModeChanged()
        renderWet(predicted: [])
        draw()
    }

    func pencilInteractionDidTap(_ interaction: UIPencilInteraction) {
        switch UIPencilInteraction.preferredTapAction {
        case .switchEraser, .switchPrevious: toggleEraser()
        default: break
        }
    }

    @available(iOS 17.5, *)
    func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveSqueeze squeeze: UIPencilInteraction.Squeeze) {
        if squeeze.phase == .ended { toggleEraser() }
    }
}

extension InkMetalView: UIGestureRecognizerDelegate {
    func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }

    /// While fingers may draw, panning needs two fingers; once a pencil is in use, one finger pans.
    override func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
        if let pan = g as? UIPanGestureRecognizer {
            if inkTouch != nil && inkTouch?.type == .pencil { return false }
            return pencilSeen || !fingerDraws || pan.numberOfTouches >= 2
        }
        return true
    }
}
