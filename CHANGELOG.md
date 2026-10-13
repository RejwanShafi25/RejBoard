# Changelog

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


