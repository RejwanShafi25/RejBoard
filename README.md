# Rejwan Whiteboard

A local-first whiteboard and note-taking app for handwritten notes, diagrams, PDF annotation and lecture voice recordings. No account and no cloud: all data stays on your device (IndexedDB). Available as a website, an installable offline app (PWA) and a desktop app (Electron).

**Web app:** https://rejwanshafi25.github.io/RejBoard/
Open the link, then in Chrome/Edge click the install icon in the address bar to install it as an offline app (PWA). Boards are stored in your own browser, so they are not shared between devices.

**Desktop installers (Windows, macOS, Linux):** https://github.com/RejwanShafi25/RejBoard/releases/latest

**Where are my boards stored?** In the browser's IndexedDB (not the cache). Clearing only "cached images and files" is safe; clearing "cookies and other site data" deletes boards. Use **Backup** on the home screen regularly. The desktop app stores boards in its own app-data folder.

Current version: **1.2.2** (see [CHANGELOG.md](CHANGELOG.md)).

## Run it
| Way | Steps |
|---|---|
| **Quick (browser)** | `python server.py` → open http://localhost:8000 |
| **Install as an app (PWA)** | open it from `server.py` in Chrome/Edge → click the install icon in the address bar. Works offline afterwards. |
| **Desktop app (Electron)** | `npm install` → `python fetch_libs.py` (one-time, for offline LaTeX/PDF) → `npm start` |
| **Build installers** | `npm run dist` → installers appear in `dist/` (Windows .exe, macOS .dmg, Linux AppImage; build each OS on that OS) |

## Features

### Home screen
- Boards grid with thumbnails, search (titles, text, #tags), import PDF, backup/restore.
- **Sidebar:** All notes · Favorites · **Protected** · Trash, then **Tags** and **Folders**. The **Folders** button shows your top-level folders as a grid (5×5 paging); click one to see its subfolders and boards, with a breadcrumb back.
- **Folders:** unlimited nesting. Hover a folder card for ✎ rename, 🎨 color (swatches + custom), ＋ subfolder, 🗑 delete (contents move up one level). **＋ New folder** creates a folder in the one you are viewing. Drag boards onto a folder to move them.
- **Board ⋮ menu:** favorite, copy, **Move board** (tree picker), **Edit tags**, **Lock with password** / **Remove password**, Move to Trash. Locked boards show a blurred thumbnail with a lock, are listed under **Protected**, and ask for the password before opening.
- **Tags:** add them from the ⋮ menu or the board header; the **Tags** page lists every tag and its boards (chips on cards are clickable).
- **Select multiple boards** (☑ Select): favorite/unfavorite, move, add tags, move to Trash or share on the network in one go. In Trash: restore or permanently delete several at once. Drag a selection onto a folder to move them all.
- **Trash:** deleting a board moves it to Trash; restore it or empty the trash. Permanently deleting a board also deletes its recordings.
- All prompts are in-app dialogs (browser `prompt()` does not exist in Electron).

### Drawing and tools
- **Bottom dock:** fountain, calligraphy (adjustable nib angle), soft brush, ballpoint, pencil, square / chisel / round highlighters (opacity, nib angle), eraser, select, lasso, pan, laser pointer, text, sticky notes, shapes, emoji, images, undo/redo.
- **Select tools:** click, box-select, lasso, Shift-click multi-select, 8-handle resize, rotation handle, move, duplicate, copy/cut/paste, delete, **group / ungroup**, **lock / unlock**, bring to front / send to back, align, center, distribute. Clicking any member selects its whole group. Locked objects can't be moved, edited, erased or deleted, but stay clickable so you can unlock them (Alt+click picks one under an unlocked object). A 🔓 *Unlock all* pill appears while anything is locked.
- **Sketch & snap** ("Fix shapes", on by default and remembered): rough circles, ellipses, rectangles (also rotated), squares, triangles, diamonds, pentagons, hexagons, straight lines, curved lines and arrows become real shapes.
- **Dynamic connectors:** Line / Arrow / Double arrow can be curved (drag the orange mid-handle; double-click to straighten). Drag an end onto a shape's edge to attach it (green ring); attached ends follow the shapes, and a connector between two shapes bends into a smooth S-curve.
- **Sticky notes** (small / medium / large, pastel colors), **shapes** (12 kinds, fill + line width), **emoji**.
- **Layers** (add, rename, hide, lock, reorder, delete), **tape** (covers what is beneath; click to reveal), **pen & highlighter presets**.
- **Transparent ruler** with drag/rotation support for straight-line drawing.
- **Zoom** (buttons, Ctrl+wheel, pinch, Fit), **speed mode** for big notes, **palm rejection**, **tilt shading**, stylus side-button eraser, and a Windows Ink / raw pointer mode for lower-latency pen input when Chromium exposes it.
- **Autosave** with a live indicator (● Saving… → ✓ Saved).

### Text and math
- Fonts (handwriting, sans, mono, marker, serif), bold/italic/underline, rich text color and partial-selection formatting. Enter finishes editing; Shift+Enter inserts a line break.
- Typed math (`sqrt(x^2+1)/2`, `a/b`, `int_0^1 x^2 dx`) becomes a LaTeX formula. Inline `$...$` is previewed while typing, and `text $O(n)$ more text` turns only `$O(n)$` into a formula, which is its own object you can select, move, resize and rotate.
- Manual LaTeX tool with a palette: structures, Greek, symbols, computer-science and other symbols.
- **Handwriting recognition:** lasso-select handwriting → **✍→T** (Canvas panel). Order tried: browser Handwriting API → Electron main process / `server.py` (unofficial Google Input Tools endpoint, needs internet). Swap `recognize()` in `server.py` / the `hw` handler in `main.js` for another engine (MyScript, a local model) at any time. Recognized text that looks like math becomes a formula.

### Pages and paper
- **Canvas** panel: **Infinite** (default) or A4 / A5 / A3 / Letter in Portrait/Landscape (orientation is locked while infinite). Pages stack vertically and drawing is clipped to the page. When content reaches the bottom a "Page full — add another page?" button appears.
- **Paper:** white, cream, gray, black, slate, navy; plain, grid, dots, lined, Cornell, columns, ruled + margin, isometric dots; spacing and mark-size sliders; auto-contrast of ink when switching light ↔ dark paper.
- **Present mode:** fullscreen, dock stays visible, laser pointer, spotlight, timer. ◀ ▶ (or arrow keys / PageUp / PageDown) change pages with a smooth camera move; 🔍 / Z zooms to the selection (or everything). Also a Pomodoro timer.

### Importing documents
- **PDF:** choose pages and quality (dpi) and arrange them as a stack, row or grid.
  - On the Home screen, or in an **infinite** note, the pages become a locked layer and the canvas is sized to them (Home) or left infinite.
  - In a note with a **fixed page size** (A4, A5, A3, Letter) the canvas mode is kept: each PDF page is scaled to fit and centered on its own page, starting at the page you are viewing, and pages are added if needed.
  - Multi-page PDF export follows the page layout.
- **DOCX / PPTX:** imported as editable text through the built-in ZIP/XML reader. Legacy binary `.doc` and `.ppt` must be converted to `.docx` / `.pptx` first.
- **Images:** insert pictures onto the board.

### Export
- **PNG, SVG, PDF**, selection as PNG, JSON, and **Save a copy** (`.rjwb`, which only this app opens).
- **Invert colors** (optional, for PNG / SVG / PDF): inverts your ink, shapes, text, math and paper, but **not imported content**. Images, imported PDF pages and imported Word/PowerPoint text keep their original colors. A protected transparent PNG shows the original paper color behind it. Documents imported before v1.2.3 aren't tagged as imported; re-import them to protect them.

### Tables
- ➕ → Table (3×3). Select the table, then use its bar. **Select cells** by dragging (Shift+click extends). **Resize** columns/rows by dragging a grid line; the ✥ handle at the top-left corner moves the table.
- **Merge** / **Split** (unmerge, or split one cell into N×M), **cell background**, **borders** (all / outer / inner / top / bottom / left / right / none, with thickness and colour), **alignment** (left/centre/right, top/middle/bottom). Text wraps inside cells. Double-click (or Text tool) to edit; **Tab / Shift+Tab** jumps between cells; **Enter** moves down. Row/column insert and delete keep merges and formulas intact.
- Numbers right-align by default; `1,000`, `$5` and `50%` are read as numbers.

#### Table formulas
Start a cell with `=`. Cells are `A1`-style (column letter + row number; top-left is A1); ranges are `A1:B5`, whole columns `A:A`. Address labels (A, B, C… / 1, 2, 3…) show on the table edge when it is selected, and while typing a formula you can click cells to insert references (Shift+click for a range). The **Σ Sum** button fills in `=SUM(...)` for the numbers above (or to the left of) the selected cell. Formulas follow their cells when rows/columns are inserted or deleted.

- **Operators:** `+ - * / ^ % &` (join text) and comparisons `= <> < > <= >=`. `^` is left-associative like Excel.
- **Functions:** SUM AVERAGE MIN MAX COUNT COUNTA MEDIAN PRODUCT ABS SQRT POWER MOD ROUND ROUNDUP ROUNDDOWN INT TRUNC FLOOR CEILING SIGN EXP LN LOG LOG10 PI IF AND OR NOT IFERROR ISERROR ISNUMBER SUMIF COUNTIF AVERAGEIF CONCAT LEN UPPER LOWER TRIM LEFT RIGHT MID. Constants `TRUE FALSE PI`.
- **Errors:** `#DIV/0!`, `#REF!`, `#NAME?`, `#VALUE!`, `#CYCLE!`, `#ERR!`.

### Voice recordings
**🎙 Record** in the top bar: record a lecture while you take notes, pause/resume, and keep several recordings per board. Play, seek, change speed (0.75×–2×), rename or delete them later. Recordings stay on your device and belong to one board only. They are part of Backup / Restore, "Save a copy" (.rjwb) files and local-network sharing. Needs microphone permission; closing the app mid-recording discards that recording.

### Languages
8 UI languages (English default) and 15 text languages. UI text is translated at runtime: built-in strings work everywhere; for any other string the browser's on-device Translator API is used (Chrome 138+; one-time language-pack download, then fully offline) and results are cached locally. Extra languages appear in the language list when that API exists. Hover tooltips are English only.

### Settings
⚙ opens appearance (language, themes), inking, canvas, reset to default, and boards. Every section explains itself; every button has a hover tooltip.

## Share boards on your local network (desktop app)
Menu **Export / Save ▸ 📡 Share boards on local network**. Works between Windows, macOS and Linux computers on the same Wi‑Fi / LAN, both running the desktop app.

1. On the receiving computer turn on **Receive boards on this computer**.
2. On the sending computer tick the boards, pick the computer from the list (or type its IP address) and press **Send**. A live progress bar shows the transfer.
3. Both screens show the same 6‑digit security code. The receiver checks it matches and presses **Accept**.

Received boards land in a folder called *Received from <computer>*.

**Encryption:** only in transit. Every transfer does a fresh X25519 key exchange and sends the data with AES‑256‑GCM (tamper‑proof); the confirmation code protects against a man‑in‑the‑middle. Boards are never stored encrypted; they stay ordinary boards on both computers. Receiving is off by default, and nothing is announced on the network until you turn it on. The first time, the OS firewall may ask to allow the app on private networks (UDP 41234 discovery, TCP 41235 transfer); allow it.

## Shortcuts
Ctrl+Z / Ctrl+Y undo/redo · Ctrl+C/X/V/D copy/cut/paste/duplicate · Ctrl+G group · Ctrl+Shift+G ungroup · Ctrl+Shift+L lock/unlock · Ctrl+S save · Delete · +/- zoom · Esc/B in present mode.

## Files
`index.html` (whole app) · `server.py` · `main.js` + `preload.js` + `lan.js` (Electron) · `manifest.json` + `sw.js` (PWA) · `fetch_libs.py` · `vendor/` (offline jsPDF, pdf.js, MathJax) · `build/icon.png` · `CHANGELOG.md`.

## Publishing on GitHub
- **Web build:** `.github/workflows/pages.yml` deploys to GitHub Pages on every push to `main`. One-time: repo **Settings → Pages → Source: GitHub Actions**.
- **Installers:** `.github/workflows/build.yml` builds Windows (Setup + Portable `.exe`), macOS (`.dmg`, Intel + Apple Silicon) and Linux (`.AppImage`, `.deb`, `.rpm`) and attaches them to a GitHub Release. Bump `version` in `package.json`, commit, then tag and push, e.g. `git tag v1.2.3 && git push origin v1.2.3` (the tag must match the version).
- When you change `index.html`, also bump the cache name in `sw.js` (currently `rw-v16`) so installed PWAs update.
- macOS/Windows builds are unsigned: macOS may say the app is damaged (run `xattr -cr "/Applications/Rejwan Whiteboard.app"`), and Windows SmartScreen may warn (More info → Run anyway).

## Roadmap
Templates (UML, flowchart, planners), smart connectors, and handwriting-to-LaTeX recognition with a bundled model.

## License
MIT
