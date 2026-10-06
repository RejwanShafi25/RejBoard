# 🌸 Rejwan Whiteboard

A cute, local-first whiteboard and note-taking app. No account, no cloud: your boards live on your device
(IndexedDB). Runs as a website, an installable offline app (PWA), or a desktop app (Electron).

## Run it
| Way | Steps |
|---|---|
| **Quick (browser)** | `python server.py` → open http://localhost:8000 |
| **Install as an app (PWA)** | open it from `server.py` in Chrome/Edge → click the install icon in the address bar. Works offline afterwards. |
| **Desktop app (Electron)** | `npm install` → `python fetch_libs.py` (one-time, for offline LaTeX/PDF) → `npm start` |
| **Build installers** | `npm run dist` → installers appear in `dist/` (Windows .exe, macOS .dmg, Linux AppImage; build each OS on that OS) |

Tauri instead of Electron? Create a Tauri project and point `frontendDist` at this folder. The handwriting proxy
(`main.js` / `server.py`) would need a small Rust command; everything else is plain HTML/JS.

## What's inside
- **Home screen**: boards grid with thumbnails, nested folders (as many as you like), tags, favorites, search (titles, text, #tags), import PDF, backup/restore.
- **Bottom dock** with cute pens: fountain, calligraphy (angle adjustable), soft brush, ballpoint, pencil, square / chisel / round highlighters (opacity, nib angle), eraser, select, lasso, pan, laser pointer, text, sticky notes, shapes, emoji, images, undo/redo.
- **Select tools**: click, box-select, lasso, Shift-click multi-select, 8-handle resize, move, duplicate, copy/cut/paste, delete, lock, bring to front / send to back, align, center, distribute.
- **Text**: fonts (handwriting, sans, mono, marker, serif), bold/italic/underline; typed math (`sqrt(x^2+1)/2`, `a/b`, `int_0^1 x^2 dx`) becomes a LaTeX formula; plus a manual LaTeX tool.
- **Sticky notes** (small / medium / large, pastel colors), **shapes** (12 kinds, fill + line width), **emoji**.
- **Layers** (add, rename, hide, lock, reorder, delete), **tape** (covers what is beneath; click to reveal), **pen & highlighter presets**.
- **Paper**: white, cream, gray, black, slate, navy; plain, grid, dots, lined, Cornell; spacing & mark size sliders; auto-contrast of ink when switching light ↔ dark paper.
- **PDF**: import and annotate on top (pages become a locked layer); multi-page PDF export follows the imported pages.
- **Export**: PNG, SVG, PDF, selection as PNG, JSON, optional invert; **Save a copy** writes a `.rjwb` file that only this app opens.
- **Zoom** (buttons, Ctrl+wheel, pinch, Fit), **speed mode** for big notes, **palm rejection**, **tilt shading**, stylus side-button eraser.
- **Present mode**: fullscreen, dock stays visible, laser pointer, spotlight, blank screen (B), timer.
- **Settings** (⚙): appearance (language, themes), inking, canvas, reset to default, boards. Every section explains itself; every button has a hover tooltip.
- **Autosave** with a live indicator (● Saving… → ✓ Saved).
- 8 UI languages (English default) and 15 text languages.

## Handwriting recognition
Lasso-select your handwriting → **✍→T** (Canvas panel). Order tried: browser Handwriting API → Electron main process / `server.py`
(unofficial Google Input Tools endpoint, needs internet). Swap `recognize()` in `server.py` / the `hw` handler in `main.js`
for another engine (MyScript, a local model) at any time. Recognized text that looks like math becomes a formula.

## Shortcuts
Ctrl+Z / Ctrl+Y undo/redo · Ctrl+C/X/V/D copy/cut/paste/duplicate · Ctrl+S save · Delete · +/- zoom · Esc/B in present mode.

## Files
`index.html` (whole app) · `server.py` · `main.js`+`preload.js` (Electron) · `manifest.json`+`sw.js` (PWA) · `fetch_libs.py` · `build/icon.png`.

## Pages, tables, trash
- **Canvas** panel: Infinite (default) or A4 / A5 / A3 / Letter with Portrait/Landscape (orientation is locked while infinite). Pages stack vertically; when content reaches the bottom a "Page full — add another page?" button appears. PDF export writes one PDF page per board page.
- **Tables**: ➕ → Table (3×3). Double-click (or Text tool) to edit a cell; with the table selected use the bar for row/column insert & delete, copy, bring to front / send to back.
- **Papers**: plain, grid, dots, lined, Cornell, columns, ruled + margin, isometric dots.
- **Present**: ◀ ▶ (or arrow keys / PageUp / PageDown) change pages with a smooth camera move; 🔍 / Z zooms to the selection (or everything).
- **Trash**: deleting a board moves it to Trash (home screen); restore it or empty the trash.
- Visible labels are translated into 8 languages; hover tooltips are English only.

## Publishing on GitHub
See the step-by-step guide in the project description / repo wiki: push this folder, enable GitHub Pages for the web/PWA version,
and push a tag (`git tag v1.0.0 && git push --tags`) to build Windows/macOS/Linux installers automatically.

## Not built yet
Templates (UML / flowchart / planners), smart connectors, rotate, group/ungroup, ruler, Word/PowerPoint import, handwriting-to-LaTeX OCR with a bundled model.

## v1.1.0 update

This build includes:
- finite paper clipping so drawing stays inside selected page dimensions
- fixed text placement and Enter-to-finish editing (Shift+Enter inserts a line break)
- rich text color and partial-selection formatting
- inline `$...$` math preview while typing
- expanded LaTeX palette: structures, Greek, symbols, computer-science, and other symbols
- folder-first home dashboard with 5x5 folder paging, nested folders, folder colors, search, drag/drop board moves, board copy and password lock
- board hover actions for copy, move, lock and delete
- rotation handle for selected objects and individual movement within multi-selection
- transparent ruler with drag/rotation support for straight-line drawing
- Pomodoro timer
- Windows Ink/raw pointer event mode for lower-latency pen input when Chromium exposes it
- PDF, DOCX and PPTX text import through the built-in ZIP/XML reader
- Electron build targets for Windows NSIS + portable EXE, macOS DMG, and Linux AppImage + DEB + RPM

Legacy binary `.doc` and `.ppt` files are detected and report that they need conversion to `.docx`/`.pptx`; parsing those old binary formats would require a separate legacy Office parser.

## Home screen: folders, protected boards, tags (v17)
- **Sidebar**: All notes · Favorites · **Protected** · Trash, then **Tags** and **Folders** as buttons. Folders are no longer listed in the sidebar; the **Folders** button shows your top-level folders as a grid (click one to see its subfolders and boards, with a breadcrumb back).
- **Folder cards** (hover): ✎ rename, 🎨 color (swatches + custom), ＋ subfolder, 🗑 delete (contents move up one level). The top-bar **＋ New folder** creates a folder in the folder you are looking at.
- **Board ⋮ menu**: favorite, copy, **Move board** (pick Home / any folder / subfolder from a tree), **Edit tags**, **Lock with password** / **Remove password**, Move to Trash. Locked boards show a blurred thumbnail with a lock, are listed under **Protected**, and ask for the password before opening.
- **Tags**: add them from the ⋮ menu or the board header; the **Tags** page lists every tag, click one to see its boards (tag chips on cards are clickable too).
- All prompts are in-app dialogs (browser `prompt()` does not exist in Electron).
- Typing `text $O(n)$ more text` turns only `$O(n)$` into a formula; the formula is its own object you can select, move, resize and rotate, and the rest stays normal text.
