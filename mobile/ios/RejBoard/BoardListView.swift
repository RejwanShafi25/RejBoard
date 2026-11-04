import SwiftUI
import UniformTypeIdentifiers
import RejBoardCore

extension BoardSummary: Identifiable {}

/// The shared core's board store, on the app's own database.
final class Library: ObservableObject {
    let store: BoardStore = DriverFactory_iosKt.openDefaultStore()
    @Published var boards: [BoardSummary] = []
    @Published var message: String?

    init() {
        store.ensureSample(now: Library.now())
        refresh()
    }

    static func now() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

    func refresh() { boards = store.list() }

    func importFile(_ url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do {
            let text = try String(contentsOf: url, encoding: .utf8)
            _ = try store.importRjwb(text: text, now: Library.now())
            refresh()
        } catch {
            message = error.localizedDescription
        }
    }

    func open(_ b: BoardSummary) -> OpenBoard? {
        if b.locked {
            message = "This board is password-protected. Opening it comes in a later version."
            return nil
        }
        do {
            guard let board = try store.load(id: b.id) else {
                message = "That board could not be read"
                return nil
            }
            return OpenBoard(editor: BoardEditor(board: board, store: store, boardId: b.id))
        } catch {
            message = error.localizedDescription
            return nil
        }
    }
}

struct OpenBoard: Identifiable {
    let id = UUID()
    let editor: BoardEditor
}

struct BoardListView: View {
    @StateObject private var library = Library()
    @State private var importing = false
    @State private var opened: OpenBoard?

    var body: some View {
        NavigationStack {
            List(library.boards) { b in
                Button {
                    opened = library.open(b)
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(b.locked ? "🔒 \(b.title)" : b.title).font(.headline)
                        Text("\(b.itemCount) items · \(Date(timeIntervalSince1970: Double(b.updated) / 1000).formatted())")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("RejBoard Native (preview)")
            .toolbar {
                Button("Open .rjwb") { importing = true }
            }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.data, .item]) { result in
                if case .success(let url) = result { library.importFile(url) }
            }
            .alert(library.message ?? "", isPresented: Binding(get: { library.message != nil }, set: { if !$0 { library.message = nil } })) {
                Button("OK", role: .cancel) {}
            }
            .fullScreenCover(item: $opened) { board in
                NavigationStack {
                    BoardEditorView(editor: board.editor) {
                        opened = nil
                        library.refresh()
                    }
                }
            }
        }
    }
}
