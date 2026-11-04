import SwiftUI
import RejBoardCore

/// Hosts the Metal ink view in SwiftUI.
struct InkCanvas: UIViewRepresentable {
    let editor: BoardEditor
    let fingerDraws: Bool
    /// bumps whenever the board changed outside the view (undo / redo), so the view redraws
    let version: Int
    let onChanged: () -> Void
    let onModeChanged: () -> Void

    func makeUIView(context: Context) -> InkMetalView {
        let v = InkMetalView(editor: editor)
        v.onChanged = onChanged
        v.onModeChanged = onModeChanged
        return v
    }

    func updateUIView(_ v: InkMetalView, context: Context) {
        v.fingerDraws = fingerDraws
        v.redrawAll()
    }
}

private let brushNames: [(String, String)] = [
    ("fount", "Fountain"), ("calli", "Calligraphy"), ("soft", "Soft"), ("ball", "Ballpoint"), ("pencil", "Pencil"),
    ("hsq", "Highlighter"), ("hch", "Chisel HL"), ("hrd", "Round HL"),
]
private let colors = ["#111111", "#dc2626", "#2563eb", "#16a34a", "#f59e0b", "#7c3aed", "#ffffff"]

private enum Panel { case none, brush, eraser, pen }

private func px(_ v: Double) -> String { v < 10 ? String(format: "%.1f px", v) : "\(Int(v)) px" }

/// A labelled slider row, like a row of the desktop's brush panel.
private struct SliderRow: View {
    let label: String
    let value: Double
    let range: ClosedRange<Double>
    let text: String
    let onChange: (Double) -> Void

    var body: some View {
        HStack {
            Text(label).font(.caption).frame(width: 96, alignment: .leading)
            Slider(value: Binding(get: { value }, set: { onChange($0) }), in: range)
            Text(text).font(.caption).frame(width: 64, alignment: .trailing)
        }
    }
}

/// An open board: ink view, a toolbar and the desktop's brush / eraser / pen settings. Changes are saved a moment after
/// each stroke and when the board closes.
struct BoardEditorView: View {
    let editor: BoardEditor
    let onClose: () -> Void

    @State private var tool = "fount"
    @State private var erasing = false
    @State private var color = "#111111"
    @State private var panel = Panel.none
    @State private var fingerDraws = true
    @State private var changes = 0
    @State private var settings = 0 // bumps when a setting changes, so the panel shows it
    @State private var pressure = 0.0

    private static func now() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

    private func select(_ key: String) {
        tool = key
        erasing = false
        editor.useBrush(tool: key)
        editor.color = color
    }

    private func update(size: Double? = nil, stab: Double? = nil, sens: Double? = nil, ang: Double? = nil, opacity: Double? = nil) {
        let b = editor.brushFor(tool: tool)
        editor.brush = b.withSettings(size: size ?? b.size, stab: stab ?? b.stab, sens: sens ?? b.sens, ang: ang ?? b.ang, opacity: opacity ?? b.opacity)
        editor.mode = .pen
        erasing = false
        settings += 1
    }

    private func close() {
        if editor.dirty { editor.save(now: Self.now()) }
        onClose()
    }

    @ViewBuilder private var panelView: some View {
        let _ = settings
        switch panel {
        case .brush:
            let b = editor.brushFor(tool: tool)
            VStack(spacing: 2) {
                SliderRow(label: "Size", value: BrushSize.shared.toSlider(v: b.size, lo: 0.1, hi: 60), range: 0...1000, text: px(b.size)) {
                    update(size: BrushSize.shared.fromSlider(r: $0, lo: 0.1, hi: 60))
                }
                SliderRow(label: "Stabiliser", value: b.stab, range: 0...100, text: "\(Int(b.stab))") { update(stab: $0.rounded()) }
                SliderRow(label: "Pressure", value: b.sens * 100, range: 0...100, text: "\(Int(b.sens * 100))") { update(sens: $0.rounded() / 100) }
                SliderRow(label: "Nib angle", value: b.ang, range: 0...180, text: "\(Int(b.ang))°") { update(ang: $0.rounded()) }
                // the desktop shows Opacity for the soft brush and the highlighters
                if !["fount", "calli", "ball", "pencil"].contains(tool) {
                    SliderRow(label: "Opacity", value: b.opacity, range: 5...100, text: "\(Int(b.opacity))%") { update(opacity: $0.rounded()) }
                }
            }
        case .eraser:
            let e = editor.eraser
            VStack(spacing: 2) {
                SliderRow(label: "Size", value: BrushSize.shared.toSlider(v: e.size, lo: 0.5, hi: 80), range: 0...1000, text: px(e.size)) {
                    e.size = BrushSize.shared.fromSlider(r: $0, lo: 0.5, hi: 80); settings += 1
                }
                Toggle("Erase whole strokes", isOn: Binding(get: { e.whole }, set: { e.whole = $0; settings += 1 })).font(.caption)
                Toggle("Only highlighter", isOn: Binding(get: { e.onlyHighlighter }, set: { e.onlyHighlighter = $0; settings += 1 })).font(.caption)
            }
        case .pen:
            VStack(spacing: 2) {
                HStack {
                    Text("Pressure").font(.caption).frame(width: 96, alignment: .leading)
                    ProgressView(value: min(1, max(0, pressure)))
                    Text(String(format: "%.2f", pressure)).font(.caption).frame(width: 64, alignment: .trailing)
                }
                SliderRow(label: "Pressure feel", value: editor.pressureCurve.curve, range: 0...100,
                          text: editor.pressureCurve.curve < 50 ? "soft" : editor.pressureCurve.curve > 50 ? "firm" : "raw") {
                    editor.pressureCurve.curve = $0.rounded(); settings += 1
                }
                Toggle("Pressure sensitivity", isOn: Binding(get: { editor.pressureOn }, set: { editor.pressureOn = $0; settings += 1 })).font(.caption)
                Toggle("Tilt shading (pencil, soft brush)", isOn: Binding(get: { editor.tiltOn }, set: { editor.tiltOn = $0; settings += 1 })).font(.caption)
            }
        case .none:
            EmptyView()
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(brushNames, id: \.0) { item in
                        let key = item.0
                        Button(item.1) {
                            // a second tap on the selected brush opens its settings, as on the desktop
                            if !erasing && tool == key { panel = panel == .brush ? .none : .brush }
                            select(key)
                        }
                        .buttonStyle(.bordered)
                        .tint(!erasing && tool == key ? .blue : .gray)
                    }
                    Button("Eraser") {
                        if erasing { panel = panel == .eraser ? .none : .eraser }
                        erasing = true
                        editor.mode = .eraser
                    }
                    .buttonStyle(.bordered)
                    .tint(erasing ? .blue : .gray)
                    ForEach(colors, id: \.self) { c in
                        Circle()
                            .fill(Color(cgColor: CGCanvas.color(Int64(0xFF00_0000) | Int64(c.dropFirst(), radix: 16)!)))
                            .frame(width: 26, height: 26)
                            .overlay(Circle().stroke(c == color ? Color.blue : Color.gray, lineWidth: c == color ? 3 : 1))
                            .onTapGesture {
                                color = c
                                editor.color = c
                                if erasing { select(tool) }
                            }
                    }
                    Button("Settings") { panel = (panel == .brush || panel == .eraser) ? .none : (erasing ? .eraser : .brush) }
                        .buttonStyle(.bordered)
                    Button("Pen") { panel = panel == .pen ? .none : .pen }
                        .buttonStyle(.bordered)
                    Toggle("Finger draws", isOn: $fingerDraws).fixedSize()
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
            }
            if panel != .none {
                panelView
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(Color(.secondarySystemBackground))
            }
            InkCanvas(editor: editor, fingerDraws: fingerDraws, version: changes,
                      onChanged: { changes += 1 },
                      onModeChanged: { erasing = editor.mode == .eraser })
                .ignoresSafeArea(edges: .bottom)
        }
        .navigationTitle(editor.board.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .navigationBarTrailing) {
                Button("Undo") { if editor.undo() { changes += 1 } }
                Button("Redo") { if editor.redo() { changes += 1 } }
                Button("Done") { close() }
            }
        }
        .onAppear {
            tool = editor.brush.tool
            color = editor.color
        }
        .task(id: changes) {
            guard changes > 0 else { return }
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            if editor.dirty && !editor.isDrawing && !editor.isErasing { editor.save(now: Self.now()) }
        }
        // live pressure meter while the pen panel is open
        .task(id: panel == .pen) {
            while panel == .pen && !Task.isCancelled {
                pressure = editor.lastPressure
                try? await Task.sleep(nanoseconds: 50_000_000)
            }
        }
        .onDisappear { if editor.dirty { editor.save(now: Self.now()) } }
    }
}
