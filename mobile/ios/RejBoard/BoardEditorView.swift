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

/// An open board: ink view and a toolbar. Changes are saved a moment after each stroke and when the board closes.
struct BoardEditorView: View {
    let editor: BoardEditor
    let onClose: () -> Void

    @State private var tool = "fount"
    @State private var erasing = false
    @State private var color = "#111111"
    @State private var slider: Double = 0
    @State private var fingerDraws = true
    @State private var changes = 0

    private static func now() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

    private var sizeText: String {
        let px = erasing ? BrushSize.shared.fromSlider(r: slider, lo: 0.5, hi: 80) : BrushSize.shared.fromSlider(r: slider, lo: 0.1, hi: 60)
        return px < 10 ? String(format: "%.1f px", px) : "\(Int(px)) px"
    }

    private func apply() {
        editor.brush = Brush.companion.named(tool: tool).withSize(size: BrushSize.shared.fromSlider(r: slider, lo: 0.1, hi: 60))
        editor.color = color
        editor.mode = erasing ? .eraser : .pen
        if erasing { editor.eraser.size = BrushSize.shared.fromSlider(r: slider, lo: 0.5, hi: 80) }
    }

    private func close() {
        if editor.dirty { editor.save(now: Self.now()) }
        onClose()
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(brushNames, id: \.0) { item in
                        let key = item.0
                        Button(item.1) {
                            if tool != key { slider = BrushSize.shared.toSlider(v: Brush.companion.named(tool: key).size, lo: 0.1, hi: 60) }
                            tool = key
                            erasing = false
                            apply()
                        }
                        .buttonStyle(.bordered)
                        .tint(!erasing && tool == key ? .blue : .gray)
                    }
                    Button("Eraser") {
                        erasing = true
                        slider = BrushSize.shared.toSlider(v: editor.eraser.size, lo: 0.5, hi: 80)
                        apply()
                    }
                    .buttonStyle(.bordered)
                    .tint(erasing ? .blue : .gray)
                    ForEach(colors, id: \.self) { c in
                        Circle()
                            .fill(Color(cgColor: CGCanvas.color(Int64(0xFF00_0000) | Int64(c.dropFirst(), radix: 16)!)))
                            .frame(width: 26, height: 26)
                            .overlay(Circle().stroke(c == color ? Color.blue : Color.gray, lineWidth: c == color ? 3 : 1))
                            .onTapGesture { color = c; erasing = false; apply() }
                    }
                    Toggle("Finger draws", isOn: $fingerDraws).fixedSize()
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
            }
            HStack {
                Text(sizeText).frame(width: 70, alignment: .leading)
                Slider(value: $slider, in: 0...1000) { _ in apply() }
                    .onChange(of: slider) { _ in apply() }
            }
            .padding(.horizontal, 12)
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
            slider = BrushSize.shared.toSlider(v: editor.brush.size, lo: 0.1, hi: 60)
            apply()
        }
        .task(id: changes) {
            guard changes > 0 else { return }
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            if editor.dirty && !editor.isDrawing && !editor.isErasing { editor.save(now: Self.now()) }
        }
        .onDisappear { if editor.dirty { editor.save(now: Self.now()) } }
    }
}
