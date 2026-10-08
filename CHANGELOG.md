# Changelog

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

### Notes
- Requires microphone permission. Recordings are not included in "Save a copy" (.rjwb) files or local-network sharing.
- Closing the app mid-recording discards that recording.


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


