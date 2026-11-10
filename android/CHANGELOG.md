# Changelog: RejBoard for Android

Versions of the Android app (tags `android-vX.Y.Z`). The desktop app has its own changelog and versions: [CHANGELOG.md](../CHANGELOG.md).

## [1.0.2]
### Fixed
- **Text stays still while you write:** typed text on a board no longer shakes slightly while you handwrite next to it.
- **The Solve button is readable in the light theme** in the equation solver.

## [1.0.1]
### Fixed
- **Typing in the in-app browser** keeps the browser panel in place above the keyboard, and the interface keeps its size while the keyboard is open.
- **Rotated pictures** show a selection box that matches how they look, and can be resized.

## [1.0.0]
### Added
- **First release** (phones and tablets, Android 8 and later). A native Android app that runs the very same RejBoard as the desktop app, so the home screen, boards, tools, menus, templates, settings and the 22 languages look and work the same. Everything the desktop app does behind the scenes works on Android too:
- **Handwriting to text**, online and fully on-device (the same bundled Tesseract.js engine, nothing leaves the device), and handwriting search.
- **Local-network sharing** with computers and other phones: discovery, the 6-digit code and the encryption are the same as on the desktop, so a phone and a PC can send boards to each other.
- **Open on your phone**, **sync folder** (Google Drive, OneDrive, Dropbox, Nextcloud… through Android's folder picker), **automatic daily backups** (Open folder shares them), **language packs** and **pictures from the web**.
- The **in-app browser and video panel** (YouTube, Udemy…) inside the floating frame, with a long-press menu that includes **Add image to board**; what websites stored is wiped when it closes.
- Exports open Android's **Save as** screen; checklist reminders are Android notifications; voice recordings and the document scanner ask for the microphone and camera on first use.
- **S Pen and other styluses:** hold the side button (either button on two-button pens such as Lenovo, Xiaomi, Wacom and USI pens) to erase; let go and you are back on the same pen. A pen's eraser end erases too. Passive rubber-tip styluses work like a finger. The back button closes the top-most dialog like Esc, and a second press leaves the app.
- **In-app updates** from GitHub releases for the APK, installed only when they are signed with the same key as the installed app (installs from Google Play update through Play).
- **Word (.docx) and PowerPoint (.pptx) open as pages**, like a PDF, through the same import dialog as on the desktop, without LibreOffice or Microsoft Office: the document is laid out on the device (Word's own page breaks are kept, one slide per page) and every page becomes a picture on the board. Offline; the file never leaves the device. Older .doc, .ppt, .odt, .rtf and .odp files need saving as .docx, .pptx or PDF first.
- **Your notes are safe:** clearing a browser's data or the app's cache never touches your boards. The automatic daily backups are also copied to the phone's **Documents/RejBoard backups** folder (Android 10 and later), so even after uninstalling the app or *Clear storage*, **Restore** on the home screen brings everything back.
- **Custom board size** in pixels with presets, keep-proportions and swap, with no upper limit.
- **Landscape:** every tool in the bottom dock is visible on one row; on phones and small tablets the header, page bar, zoom controls and dock shrink together so the board gets more room.
