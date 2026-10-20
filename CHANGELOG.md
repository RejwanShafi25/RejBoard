# Changelog
## [Unreleased]
### Added
- **Equation solver** (🧮 in the dock) with step-by-step working: solve equations and systems, differentiate, integrate (indefinite and definite), simplify, expand, factor, limits and plain calculation. Exact answers where possible (fractions, radicals, complex roots, general trig solutions), every answer is checked, and an equation with no closed form falls back to labelled numeric roots. Insert the answer or the grouped steps on the board.
- **Graph plotter** (📈 in the dock): graphs are board objects. Explicit `y = f(x)`, implicit `x^2 + y^2 = 9`, polar `r = f(theta)` and parametric `(cos(t), sin(2t))` curves, sliders for any extra letter (with animation), labelled intersections, zoom and pan, double-click to edit; included in PNG / PDF / SVG exports. The math libraries load only when used.
- **Straight lines with Shift.** Hold Shift while drawing with any pen, the pencil or a highlighter to get a straight line; close to level, upright or 45° it snaps exactly onto that direction (music staves and guitar tabs come out truly parallel).
- **Start-up window.** On a slower computer a small window with the RejBoard logo names the board being opened while the app starts; the main window then opens once the board is ready.
- **Settings → Storage → Compact board storage** (on by default). Turn it off before installing an older version of RejBoard: every board is converted back to the classic format.
- Automated tests: unit tests (`npm test`) and an end-to-end desktop smoke test (`npm run test:smoke`), run by the new Tests workflow, the installer build and the website deploy.
- **Writing sounds.** Optional natural sounds while you draw: every pen (fountain, calligraphy, soft brush, ballpoint, pencil), the three highlighters, the eraser and the tape tool has its own sound. They are synthesized live (no audio files) and follow your drawing speed and pen pressure, and are silent when you pause or lift. Turn them on in **Settings → Writing sounds** (off by default), with an extra switch for eraser/tape and a volume slider.
- **Sync folder** ([#2](https://github.com/RejwanShafi25/RejBoard/issues/2)). Save selected boards (select mode or a board's ⋮ menu) or all boards as one `.rjwb` file each into a folder inside OneDrive, Google Drive, Dropbox or Nextcloud, and import them on a second PC from **☁ Sync folder** on the home screen. Files carry ink, text, PDFs, tags, voice recordings and linked boards. Importing asks to replace, keep both or skip when a board already exists, and warns when the file is older than the board in the app. A lock file (computer name + heartbeat, stale after 5 minutes) keeps two PCs from writing at once. Chrome/Edge use the folder directly; other browsers download one file per board.

### Changed
- **Faster start.** The board you had open last is opened directly (no scan of every board), and a small index of your boards (title, dates, tags, thumbnail; never the strokes) keeps **My boards** quick even with a large library or on a slow disk. The index rebuilds itself if it ever disagrees with the boards.
- **Much faster on crowded boards and old PCs.** Scrolling a board with lots of ink now shifts the already-painted picture and paints only the newly exposed strip (about 4x less work per frame in our test). Starting or finishing a stroke no longer repaints the whole screen or copies the whole board for Undo (a finished stroke used to cost ~350 ms on a 3,000-stroke board, now about 1 ms), and Undo/Redo entries for new strokes are tiny. The eraser skips strokes that are nowhere near it and repaints only the area it changed. Saving crowded boards is about 3x faster, happens later (never while the pen is down), and the board thumbnail is refreshed at most every 8 s while you work. Boards are stored with compact stroke data; existing boards open as before. The speed-ups also apply to boards with only a few long calligraphy, soft-brush or highlighter strokes, which are expensive to repaint on every pen move; the screen cache is rebuilt in the background while you are idle, so the next stroke starts instantly. Zooming now scales the cached picture while you zoom and sharpens it once you stop, drawing a Lasso loop or clicking to select no longer repaints the board, and dragging a selection repaints only the moving items.

### Fixed
- Moving a selected shape or connector threw an error on the first mouse move of every drag, so the "Move connected shapes together" setting never worked (the first move was also dropped). It now works as described: dragging a shape or connector moves everything linked to it (hold Alt to move only the selection).
- A voice recording could be saved to the wrong board if you switched boards while the microphone permission prompt was open ([#1](https://github.com/RejwanShafi25/RejBoard/issues/1)). The board is now captured when you press Record, and if you switch boards before the prompt is answered the recording is cancelled instead of starting on the wrong board.

## [1.3.1]
### Added
- **Tool shortcuts.** `1`–`8` pick the fountain pen, calligraphy pen, soft brush, ballpoint, pencil and the square, chisel and round highlighters; `T` text, `W` tape, `E` eraser. `H` converts the selected handwriting to text and only works while handwriting is selected. Shortcuts are shown in the toolbar tooltips and ignored while typing.
- **Connected lines.** Lines, arrows and double arrows have a new **Connect to shapes** toggle (shape options and the selected line's style bar). Drop an end anywhere on a shape and it snaps to the shape's edge and follows it when the shape moves; turn it off to keep a line free.

### Fixed
- Pressing **Distribute evenly** (the button at the right end of the selection toolbar, previously shown as ⋯) with handwriting selected no longer spreads the letters apart. Handwriting and groups are now treated as one object each, and a toast explains when there is nothing to distribute. The button now has a clearer icon.
- The home sidebar showed a double `#` in front of tag names. It also listed every tag, which got very long with many tags; it now shows the 3 most recently used tags (plus the one you have open), and the Tags section still lists all of them.
- Newly drawn lines and arrows never connected to shapes automatically, and had to be dragged by hand; they now connect when drawn.
- Pasting copied objects sometimes seemed to do nothing: they were put back at their original position, which could be off-screen or outside the current page. Paste now places them where you last clicked (or the centre of the view), on the page you are on in page mode. Ctrl/Cmd+C and X also work with Caps Lock and non-Latin keyboard layouts.
- Deleting a layer (e.g. an imported PDF) no longer leaves an invisible, still-selectable area behind, and Undo now restores the layer along with its items.

## [1.3.0]
### Changed
- **Pages overview.** New **▦ Pages** button in the page bar opens thumbnails of every page. Select one or several pages (click, Ctrl/Shift-click) to move them earlier/later (also Alt+←/→), swap two pages, copy (each copy lands right after its original, with its own groups and connector links), delete, or insert a blank page. Pages can also be dragged to reorder, and a double-click opens a page. `@` board links that point to a specific page of the board (from the same board or any other board) follow the pages when you reorder, swap or delete them; a link whose page was deleted falls back to just opening the board. All of it is undoable (Ctrl+Z restores the page count and the links too).

### Fixed
- Deleting (or trashing/locking) your last board no longer creates a new empty "Untitled" board. The board list now stays empty, and a blank board is only created once you start drawing or press **New board**. The same applies when the app is launched with no boards.
- Pressing **+** or **-** alone zoomed the canvas. Keyboard zoom now needs **Ctrl/Cmd + +** (zoom in) and **Ctrl/Cmd + -** (zoom out), and the browser's own page zoom no longer fires on top of it.
- Pencil brush strokes (e.g. handwritten labels) looked blurry. The pencil now has a crisp graphite grain (a light body plus device-pixel speckle) instead of three translucent, sub-pixel-offset copies, so it stays sharp at any zoom and still looks different from the ballpoint; pen-tilt pencil strokes no longer bead at segment joints, and SVG export uses a matching opacity.

## [1.2.11]
### Added
- In-app desktop updates through `electron-updater`, with differential downloads where supported, opt-in automatic checks (off by default), explicit download/restart confirmation, platform-specific manual-download fallbacks, and activity guards for recording, LAN transfers and unsaved changes.
- GitHub Release publishing for platform update metadata and blockmaps; macOS ZIP target and future code-signing/notarization guidance.

### Security and privacy
- Update checks use HTTPS and are made only after a manual check or explicit opt-in. Pre-releases and downgrades are disabled; update checksum verification remains enabled.

## [1.2.10]
### Changed
- **Bento UI across the whole app.** Home, sidebar, folders, tags, boards, the board header, canvas, tool dock, zoom controls, pop-ups, dialogs and Settings now share one bento-style tile design (rounded tiles, soft shadows, a mosaic of wide and regular board tiles, colour-tinted folder tiles). All 12 themes, the light/dark modes and the phone layout are supported; no board data or features changed.
- Added windows portable build.

### Fixed
- Minimizing the in-app browser / video window after it had been dragged or resized only moved it instead of collapsing it; it now collapses to the title bar and restores to its exact size and position.


## [1.2.9]
### Changed
- **One offline handwriting engine on every platform.** On-device recognition now uses a bundled Tesseract.js engine on Windows, macOS and Linux. Apple Vision, Windows.Media.Ocr and the system `tesseract` command are no longer used (because they were not working perfectly all the time). All installers include the engine and English data. From source, run `npm run libs` once (replaces `npm run libs:linux`; the `ocr-linux` folder is now `ocr-engine`).

### Fixed
- Minimizing the in-app browser / video window after it had been dragged or resized only moved it instead of collapsing it; it now collapses to the title bar and restores to its exact size and position.
- Moving a shape or connector now moves everything linked to it (shapes and connectors, transitively). Toggle in Settings; hold Alt to move only the selection.
- Lines, arrows and connectors now attach to the true outline of a shape (cone, triangle, star, heart, cylinder, rotated shapes...) instead of its bounding box, so there are no gaps.
- Text color picker now always registers a pick (e.g. black) - it follows the color of the selected text.
- Selecting a sticky note shows its color swatches + custom picker in the text bar.
- Paper color changes are non-destructive: original colors are remembered and restored exactly when you return to the old paper; pale fills/stickies are no longer darkened on white.
- "Fix shapes" is now off by default
- The LaTeX placement, the layer deletion that left imported pages visible, and Page Up/Page Down in present mode on an infinite canvas.
- A new Added entry for dragging layers to reorder them.

## [1.2.8]
### Added
- **Multilingual interface.** The application is now available in 22 languages: English, Arabic, Bengali, Chinese (Simplified), Dutch, French, German, Hindi, Indonesian, Italian, Japanese, Korean, Persian, Polish, Portuguese, Russian, Spanish, Tamil, Thai, Turkish, Urdu and Vietnamese.
- Language selection in [Settings → Language].

### Notes
- **Machine-translated strings.** The non-English translations were generated with Meta AI's `facebook/nllb-200-distilled-600M` (NLLB-200) neural machine translation model and have not yet been reviewed by native speakers. Some strings may be inaccurate, unnatural, or inconsistent in terminology. We apologize for any inconvenience and welcome corrections from the community (see *Contributing translations* in the README).

## [1.2.7]
### Added
- **Downloadable language packs.** Choosing a language in *Settings → Appearance → Language* downloads its pack once, saves it on your device, and translates the whole interface, including tooltips, placeholders and notices. It works the same in the desktop app and the web app, and offline afterwards. Packs live in `locales/` and are keyed by the English text, so no UI text is hardcoded per language. 22 languages are listed (English, Spanish, French, German, Bengali, Hindi, Arabic, Chinese, Portuguese, Italian, Russian, Japanese, Korean, Turkish, Indonesian, Vietnamese, Tamil, Persian, Urdu, Polish, Dutch, Thai). Arabic, Persian and Urdu switch the layout to right-to-left.
- **Delete downloaded language packs.** A new *Downloaded language packs* row in Settings lists every pack on the device with a Delete button. Deleting the pack you are using switches back to English first.
- `tools/extract-strings.py` and `tools/translate-packs.py` to rebuild `locales/en.json` and fill missing translations.

### Changed
- Language switching no longer depends on Chrome's on-device Translator API, which the desktop app doesn't have. The built-in dictionaries in `index.html` were removed in favour of pack files.
- Strings that include changing values (for example "Grouped N objects") stay in English for now.

### Fixed
- Choosing a language in the desktop app did not translate the interface.


## [1.2.6]
### Added
- **Infinite-canvas PDF export is always one page.** An Infinite board now exports as a single PDF page containing everything on it. Bounds account for rotated items and full pen width/glow, so nothing is clipped. Very large boards lower the pixel density (and scale the page to a size PDF viewers accept) instead of failing or cutting content off.
- **On-device handwriting recognition (offline).** New *Handwriting to text* setting with two engines: Online (Google, unchanged) or On-device. On-device draws the selected strokes to a small in-memory PNG and pipes it to Apple Vision (macOS), Windows.Media.Ocr (Windows) or Tesseract (Linux). Linux builds also bundle Tesseract.js plus English data (as an extra resource, Linux packages only) so on-device recognition works out of the box and fully offline. No network, no API key, no temp files, one job at a time, image capped at 1600 px.
- **Laser fade time.** Double-click the laser tool to set how long the trail takes to fade (0.2-5 s) and the dot size. The trail is now a smooth, tapered, glowing curve with a bright head dot.
- **Automatic contrast when the paper colour changes.** Switching paper (white, cream, light gray, black, slate, navy) now checks every pen stroke, shape, tape, text, sticky note, formula and table (cell text and borders) and adjusts only the colours that would be hard to read on the new paper, keeping their hue where possible. Sticky note backgrounds follow the paper too (a yellow note turns a deep yellow on dark paper and back again, and always stays distinct from the paper), and their text is checked against the note's own background, as is text in filled table cells. Pen, text and shape colours for new objects are adjusted too. Previously only a light↔dark switch recoloured, so e.g. black ink stayed invisible when changing from black to navy paper.
- **Created and modified dates on every board card** (Home, Favorites, Protected, folders, tags and Trash). *Modified* only changes when you edit the board's content or title; opening, favouriting, moving or locking a board does not change it. Boards made before this update show their real creation date, recovered from the board's id, and use their last save as the modified date.
- **Sort boards** by name (A→Z / Z→A), date created or date modified (newest / oldest) from the new *Boards* selector at the top of the Home page. The choice is remembered. Default is *Modified: newest*.
- **Sort folders** by name (A→Z / Z→A) from the new *Folders* selector wherever folders are listed. The choice is remembered.
- **Text styling inside table cells.** The table bar has a new **Text** row: font (Handwriting, Sans, Mono, Marker, Serif), size, text colour and **B / I / U** for the selected cells, plus **Reset** (back to the table default) and **▦ All cells** (select every cell). Each cell keeps its own style, so a header row can be large, bold and red while the body stays normal. Rows grow automatically so bigger text is never clipped. The in-cell editor shows the real font and colour while you type, new rows/columns inherit the style of their neighbour, and SVG export keeps the styling. The controls follow the cell you click.
- **Maths in table cells.** `$x^{2}$` (alone or mixed with text, e.g. `$x^{2}$ is a square`) is typeset as a formula when you finish editing a cell. With **Auto-math** on, typing `x^2/3+sqrt(y)` in a cell becomes a typeset equation, like in text boxes. Formulas wrap with the text, rows grow to fit them, and they appear in SVG export. Cells starting with `=` stay spreadsheet formulas, and plain amounts such as `$5 and $6` are not treated as maths.
- **Border line style.** A new Solid / Dashed / Dotted selector next to border thickness and colour (board and SVG export).
- **LaTeX button works inside tables.** With a table cell selected (or just edited), the LaTeX dock button now inserts the formula into that cell. The dialog title shows the target, e.g. `LaTeX → cell B2`; the formula is added after any text already in the cell. Without a selected cell it inserts a free-floating formula as before.
- **Style bar for selected objects.** Selecting objects with Select / Lasso now shows a style bar just above the selection bar:
  - **Strokes:** change the **brush** (fountain, calligraphy, soft paint, ballpoint, pencil, square / chisel / round highlighter), the **brush size** and the **line type** (solid, dashed, dotted, dash-dot, long dash, short dash). The stroke is redrawn with the new brush and width, and highlighter brushes pick up their usual opacity.
  - **Shapes:** change **line type**, **corner type** (rounded / sharp), **border width**, **border colour** and **fill colour** (swatches, any colour, or no fill).
  - **Colour for any selection:** a colour row (swatches plus any colour) recolours every selected stroke, shape, tape, formula, text and table. It also appears alone when you select a mix of different objects. Several strokes or several shapes can be restyled together, and every change can be undone with Ctrl+Z.

### Fixed
- **Table colour.** The main colour palette ignored tables. It now recolours the whole selected table (text, borders and per-cell text colours), and the light/dark theme switch also flips per-cell text and border colours so they stay readable.
- **Border thickness, colour and style.** These controls did nothing until you pressed a border button. They now update the selected borders immediately (re-applying the last border mode, or **All** if none was chosen yet).
- **Selecting a table.** Selecting a table with Select / Lasso (no cell chosen) now means the whole table: fill, text style, borders and colour apply to every cell instead of only A1, and the highlight covers the whole table. Clicking or dragging across cells still selects just those cells.

### Improved
- **Smoother ink.** Pen input uses every coalesced pointer sample, redraws once per frame, and fountain/calligraphy strokes are curve-smoothed at render time (saved data is unchanged).
- **Smoother eraser.** The eraser sweeps the gaps between pointer samples, so fast strokes no longer skip over ink.


## [1.2.5]
### Added
- **Board links with `@`.** Type `@` inside a text or sticky note to open a picker of your other boards; click one, or keep typing its name and press Enter/Tab (arrow keys move, Esc closes). The board appears as a blue underlined `@Board name` link. Click it (Select, Lasso, Hand or Laser tool, or Ctrl/Cmd+click with any tool) to open that board.
- **Link to one page.** Boards with several pages show a `▸ N pages` toggle in the `@` list (or press → on the row); expand it to link straight to “Notes › 3”. You can also type `Notes › 3`. Clicking the link opens that board at that page (also works for pages of the current board).
- **Create from the list.** If no board has the name you typed, the list offers `➕ Create board “…”` (click or Tab; Enter only after you pick it with the arrow keys or mouse, so finishing a sentence never makes a board by accident).
- **Linked from.** A board that other boards point to shows `🔗 Linked from …` beside its name; click it to jump to one of them.
- **Linked boards travel along.** Saving a copy (`.rjwb`) and sending over the network ask whether to take the boards you link to along (including boards they link to). They travel inside the board itself; the receiving side shows a picture of each linked board, lets you untick any you do not want, and saves the rest with one Save. Links between the imported boards are re-pointed to the new copies automatically.
- **Back button.** After opening a board through a link, a `← Back to “…”` button appears at the left of the header and returns to the previous board (it works across several hops). Opening a board from Boards/Home clears the trail.
- **Linked boards in PDF and SVG.** Exporting a board that links to others now offers to include them. In a PDF they come after the board, page by page, and a click on a link jumps to the page it names (a link to “Notes › 3” lands on page 3 of Notes). In an SVG they sit under the board, and a click on a link shows that board, with a link back to the first board. Boards you choose not to include, locked boards whose password you do not enter, and deleted boards stay plain text. Linked boards that are password-protected ask for their password first.


### Fixed
- **Text and selection bars no longer overlap.** Clicking a text object shows both the text-format bar (size, colour, font, B/I/U) and the selection bar (duplicate, copy, delete…). They used to sit on top of each other; the text bar now stacks directly above the selection bar and follows it when the window is resized or the bars wrap.
- **Text no longer disappears at the bottom of a page.** On a paged canvas (A4, A5, A3, Letter, PDF) drawing is clipped to the page, so lines added with Shift+Enter past the bottom of a page were invisible until the canvas was switched back to Infinite. Lines that do not fit now continue at the top of the next page (pages are added when needed, long text can span several pages) and a message tells you where the text went. Works for every paper size and orientation.
- **Page overflow now covers every kind of text.** Sticky notes, rotated text and text with `$...$` formulas used to stay clipped at the bottom of a page. Sticky notes now move as a whole to the next page (and shrink if larger than a page); rotated text is split line by line using its rotated outline; formulas are laid out row by row and continue on the next page.
- **Long lines wrap at the right edge of a page.** On A4, A5, A3, Letter and PDF pages a line that would run past the right edge now wraps at word boundaries (very long words break by character). Text clicked close to the right edge is shifted left so it keeps a usable width. Wrapping uses the real font sizes, bold/italic, and board links, and adapts to every paper size and orientation.

## [1.2.4]
### Added
- **In-app Browser dock button** for a compact draggable website panel with address/search, back/forward, reload, minimize, maximize/restore and close controls.
- **Video dock button** with YouTube, Udemy, online video/livestream URL and local video file options.
- Embedded video play/pause and ±10-second seek controls where standard media elements are exposed by the site.
- Temporary, non-persistent Electron browser session; the app clears the session's storage/cache when the panel closes and on exit and does not save panel URLs or form/keyboard/mouse activity in app storage.

### Security and privacy notes
- Website requests still expose ordinary connection metadata (including IP address) to the website, and sites may retain server-side account/search/activity data. RejBoard cannot erase information already received by a third party.
- Embedded-site compatibility, DRM, codecs, popups, login flows and livestream smoothness depend on Chromium, the website, hardware and network; universal compatibility is not guaranteed.

### Changed
- Electron enables webview support while keeping Node integration disabled and context isolation enabled.
- Version bumped to 1.2.4

## [1.2.3]
### Changed
- **The app is now called RejBoard** everywhere: window title, header, Home sidebar, web-app manifest (install name and short name), Electron product name, and the Windows / macOS / Linux installers and files (`RejBoard-<version>-...`). The installer app id is now `com.rejwan.rejboard`.
- **Responsive bottom bar and header.** The tool dock, the page navigator (◀ 1/3 ▶ ＋ Page) and the zoom controls no longer overlap in smaller or non-maximized windows:
  - When they all fit, they stay on one row (the dock shifts off-center only if it must).
  - When they don't, the page navigator and zoom controls move to a row above the dock.
  - If the dock itself is too wide it shrinks its icons in two steps, and scrolls sideways as a last resort (very narrow phone widths).
  - Panels that open above the dock (select bar, table bar, menus) move up with it.
  - The header drops its text labels (Record / Canvas / Export / Present) below 1180 px, then the brand name, tags field and button labels as the window gets narrower.

### Notes
- Desktop app: if an older "Rejwan Whiteboard" data folder exists, RejBoard keeps using it, so your existing boards stay in place after the rename.
- Windows/macOS treat the new app id as a new app: the old "Rejwan Whiteboard" install stays until you uninstall it. Your boards are not affected.
- Installed web apps (PWA) pick up the new name after they update; reinstall the PWA if the old name still shows on your desktop or home screen.
- Cache bumped to `rw-v17`.



## [1.2.2]
### Added
- **Select multiple boards** on the Home screen (☑ Select): favorite/unfavorite, move, add tags, move to Trash, or share on the network in one go. In Trash: restore or permanently delete several at once.
- **Drag and drop several selected boards onto a folder** to move them all at once.
- **Move and Share on network** buttons appear in the selection bar whenever boards are selected.
- **Voice recordings per board** (🎙 Record in the top bar): record a class while taking notes, with pause/resume. Each board can hold many recordings, and they never appear on other boards.

### Changed
- Removed the ✕ button next to Restore on the Home screen (it jumped straight into the most recent board).
- The ✏️ new-board button now appears only on the main Home page, not in Favorites, Protected, Trash, Tags or Folders.
- Permanently deleting a board from Trash also deletes its recordings.
- `.docx` / `.pptx` imports are now tagged as imported content, so they are protected from invert on export. Documents imported before this version are not tagged; re-import them to protect them.
- Service-worker cache bumped (`rw-v16`) so installed PWAs pick up the update.

### Fixed
- **Invert on export no longer inverts imported content.** With "Invert PDF colors before saving" ticked, your handwriting, shapes, text, math and paper are inverted as before, but imported images, PDF pages and imported Word/PowerPoint documents keep their original colors. The same rule applies to PNG and SVG export, which share the invert option.
- **Importing a PDF no longer switches the canvas to Infinite.** When the note uses a fixed page size (A4, A5, A3, Letter), the canvas stays in that mode: each imported PDF page is scaled to fit and centered on its own page, starting at the page you are viewing. Pages are added automatically if the PDF has more pages than the note has left. Infinite canvases and importing from the Home screen behave as before.

### Notes
- Requires microphone permission. Recordings are not included in "Save a copy" (.rjwb) files or local-network sharing.
- Closing the app mid-recording discards that recording.
- A transparent PNG that is protected from invert shows the original paper color behind it, not the inverted one.
- A PDF page imported into a fixed-size note is fitted to the note's page, so it may have side margins if its shape differs from the canvas.



## [1.2.1]

### Added
- **Share boards on your local network** (desktop app, Windows / macOS / Linux): send one or more boards to another computer running the app on the same network. Data is encrypted in transit only (X25519 key exchange + AES-256-GCM), confirmed with a 6-digit security code on both screens. Boards are never stored encrypted.
- Live progress bar with percentage while sending and receiving boards.
- Table formulas: cell address labels (A, B, C… / 1, 2, 3…) on the selected table, click cells to insert references while typing a formula, whole-column ranges (`A:A`).
- New functions: SUMIF, COUNTIF, AVERAGEIF, COUNTA, MEDIAN, IFERROR, ISERROR, ISNUMBER, AND, OR, NOT, ROUNDUP, ROUNDDOWN, INT, TRUNC, FLOOR, CEILING, SIGN, EXP, LN, LOG, LOG10, PI, LEN, LEFT, RIGHT, MID, UPPER, LOWER, TRIM.

### Changed
- Numbers in tables right-align by default; `1,000`, `$5` and `50%` are read as numbers.
- Enter in a table cell now moves the selection down.

### Fixed
- `^` is now left-associative like Excel (`2^3^2 = 64`).
- `ROUND` rounds negative numbers and values like `1.005` correctly.
- A blank cell compares equal to 0.


