# RejBoard Native: feature checklist against the Electron app

Every feature of the Electron app (README feature reference and CHANGELOG up to 1.3.4 + Unreleased), with the phase of the
native plan that builds it and where it stands. A phase is not done until all its rows are ✅ on Android, iOS and Windows.

Status: ✅ done · 🟡 partly done · ⬜ not started. Phases: 1 foundation · 2 ink · 3 editing · 4 organising ·
5 import/export · 6 diagrams & math · 7 sync & the rest.

## Brand
| Feature | Phase | Status |
|---|---|---|
| App icon = the RejBoard logo (Electron `icon-512.png` / `build/icon.ico`) on all three platforms, window icon on Windows | 2 | ✅ (`mobile/tools/make-icons.ps1`) |
| Same look as the Electron app: header, dock, popovers, page bar, home, settings (see the UI parity plan) | 3–4 | ⬜ |
| 22 interface languages, RTL layouts | 7 | ⬜ |
| Light and dark themes | 4 | ⬜ |

## Boards, storage and files
| Feature | Phase | Status |
|---|---|---|
| Board model and `.rjwb` read/write, unknown fields kept | 1 | ✅ |
| Local storage (SQLDelight), autosave | 1–2 | ✅ |
| Autosave indicator | 4 | ⬜ |
| Undo / redo (desktop history semantics) | 1 | ✅ |
| Version history (auto every 10 min, thinned, 60 per board; restore, open as copy, named versions) | 4 | ⬜ |
| Automatic daily backups (7 daily, 4 weekly, 6 monthly), Back up now / Restore | 4 | ⬜ |
| Backup / Restore all boards (JSON with recordings) | 5 | ⬜ |
| Password-protected boards (AES-256-GCM, PBKDF2 600k), change / remove password | 4 | 🟡 listed, not openable |
| App lock PIN with recovery code and idle lock | 4 | ⬜ |
| Sync folder (one `.rjwb` per board, lock file, replace / keep both / skip) | 7 | ⬜ |
| Local-network sharing (encrypted LAN transfer) | 7 | ⬜ |

## Home screen and organisation
| Feature | Phase | Status |
|---|---|---|
| Board list | 1 | 🟡 plain list, no thumbnails |
| Boards grid with thumbnails, created / modified dates | 4 | ⬜ |
| Sort by name / created / modified (remembered); folders by name | 4 | ⬜ |
| Sidebar: All notes, Favorites, Protected, Trash, Tags, Folders | 4 | ⬜ |
| Nested folders: rename, colour, subfolder, delete; drag boards onto folders | 4 | ⬜ |
| Multi-select: favorite, move, tag, trash, share; Trash restore / delete in bulk | 4 | ⬜ |
| Board menu: favorite, copy, move (tree picker), tags, lock / unlock, trash | 4 | ⬜ |
| Search: titles, tags, all typed text, PDF text, handwriting; every word, accents ignored | 4 | 🟡 search text indexed in the core |
| Notebooks with coloured sections and ordered pages, page bar | 4 | ⬜ |
| New board dialog: size, orientation, paper colour, pattern, spacing, line weight, live preview | 4 | ⬜ |
| Templates (229) and the gallery of example notes | 4 | ⬜ |
| Split view (another board beside this one) | 7 | ⬜ |

## Ink and pens
| Feature | Phase | Status |
|---|---|---|
| Fountain, calligraphy, soft brush, ballpoint, pencil; square / chisel / round highlighters (desktop's exact stroke drawing) | 2 | ✅ |
| Sizes 0.1–60 px on the log slider | 2 | ✅ |
| Brush settings: stabiliser, pressure, nib angle, opacity | 2 | ✅ |
| Line types (dashed, dotted, …) for pens | 3 | 🟡 drawn, no picker yet |
| Presets for pens, highlighters and tapes | 3 | ⬜ |
| Highlighter straight / fit-to-text-line options | 3 | ⬜ |
| Pressure and tilt, pressure-feel curve, palm rejection | 2 | ✅ |
| Low-latency ink: front buffer (Android), Metal (iOS), Direct2D wet layer (Windows) | 2 | ✅ (needs device testing) |
| Stylus side-button eraser, eraser tip | 2 | ✅ |
| Apple Pencil double-tap / squeeze, hover | 2 | ✅ |
| Pressure-sensitive eraser with ring | 2 | ✅ |
| Eraser: whole strokes, only highlighter, tape mode, shapes | 2–3 | 🟡 strokes only |
| Straight lines (Shift-snap level / upright / 45°) | 3 | ⬜ (the core already has shiftSnap's logic in board-core.js to port) |
| Hold to snap; sketch and snap (shape recognition) | 3 | ⬜ |
| Tape (covers what is beneath; click to reveal; cute and professional designs) | 3 | 🟡 drawn as a plain band |
| Laser pointer with fade time and dot size | 7 | ⬜ |
| Transparent ruler, set squares (45°, 30/60°), protractor; strokes snap to edges | 3 | ⬜ |
| Pan, zoom (buttons, Ctrl+wheel, pinch, Fit), speed mode | 2 | 🟡 pan / pinch / wheel / fit; no buttons or speed mode |
| Automatic contrast when the paper changes | 4 | ⬜ |

## Paper and pages
| Feature | Phase | Status |
|---|---|---|
| All paper colours and patterns (incl. music staff with clef, guitar tab, Cornell, engineering …) | 2 | ✅ |
| Infinite or A4 / A5 / A3 / Letter, portrait / landscape, pages stacked | 2 | ✅ drawn |
| Add / duplicate / delete / swap / insert pages; page strip; page bar | 3 | ⬜ |
| Drawing clipped to the page; text wraps onto the next page | 3 | ⬜ |
| Change paper, spacing, line weight on an open board | 3 | ⬜ |

## Selection and editing
| Feature | Phase | Status |
|---|---|---|
| Select: click, box, lasso, Shift multi-select | 3 | ⬜ |
| 8-handle resize, rotate, duplicate, copy / cut / paste, group / ungroup, z-order, align, distribute | 3 | ⬜ |
| Style bar for selections (brush, size, line type, shape borders and fill, recolour) | 3 | ⬜ |
| Layers: add, rename, hide, lock, reorder, delete | 3 | 🟡 hidden / locked layers respected |
| Snap to grid, smart guides | 3 | ⬜ |
| View mode (look and point, nothing changes) | 3 | ⬜ |

## Text, math and links
| Feature | Phase | Status |
|---|---|---|
| Text boxes: fonts, bold / italic / underline, colour, rich text | 3 | 🟡 shown as plain text |
| Sticky notes | 3 | ⬜ |
| Emoji, images (insert, drag in) | 5 | 🟡 images shown as boxes |
| LaTeX equations, inline `$…$`, LaTeX palette | 6 | 🟡 source text shown |
| Board links with `@`, Back across hops, Linked-from indicator | 4 | ⬜ |
| Handwriting → text (online Google engine; on-device Tesseract) | 7 | ⬜ |
| Handwriting → LaTeX (pix2text-mfr, ONNX, download on first use) | 7 | ⬜ |
| Handwriting help (align letters) | 7 | ⬜ |

## Tables, checklists, stickers
| Feature | Phase | Status |
|---|---|---|
| Tables: merge / split, resize, fills, per-side borders, alignment, cell styles, Tab navigation | 6 | 🟡 drawn read-only |
| Formulas: 50+ functions, A1 refs, ranges, error values | 6 | ⬜ |
| Math in cells, numbers right-aligned | 6 | ⬜ |
| Checklists with reminders and system notifications | 6 | 🟡 drawn read-only |
| Sticker library (unlimited, own stickers, transparent hit-testing) | 4 | ⬜ |

## Shapes and diagrams
| Feature | Phase | Status |
|---|---|---|
| Shapes: basic, lines, 3D, containers, swimlanes, flowchart, BPMN, UML, ER, EER, SysML, CS, security, wireframe, planning, cloud / network / C4 | 6 | 🟡 rectangles / ellipses drawn |
| Dynamic connectors (attach to outlines, follow shapes, S-curves, elbow routes, line jumps, labels, arrowheads, crow's foot) | 6 | ⬜ |
| Move connected shapes together; text grows the shape | 6 | ⬜ |
| Auto-layout | 6 | ⬜ |
| Mermaid, PlantUML, SQL / DBML, draw.io import and export | 6 | ⬜ |
| Equation solver with steps; graph plotter (sliders, intersections, polar, parametric) | 6 | 🟡 graphs drawn as labelled boxes |

## Import, export, capture
| Feature | Phase | Status |
|---|---|---|
| PDF import (pages, dpi, stack / row / grid) and annotation | 5 | ⬜ |
| PDF outline and bookmarks | 5 | ⬜ |
| Word / PowerPoint / OpenDocument import | 5 | ⬜ (Windows via LibreOffice / Office as on the desktop; Android and iOS have no office converter on the device: open as PDF instead) |
| Document scanner (camera, corners, filters) | 5 | ⬜ |
| Export PNG, SVG, PDF, selection PNG, JSON, Markdown (.zip), `.rjwb`; linked boards; invert colours | 5 | ⬜ |
| Board replay video | 5 | ⬜ |
| Voice recordings per board (pause, speed, rename), notes synced to audio | 7 | ⬜ |
| Present mode: fullscreen, laser, spotlight, page navigation, zoom to selection, find, timer / Pomodoro | 7 | ⬜ |
| In-app browser and video panel; web clipper | 7 | ⬜ (native web views: WebView2 / WKWebView / Android WebView; sites may still block embedding) |
| Keyboard shortcuts (all of the desktop's on Windows and with hardware keyboards) | 3 | ⬜ |
