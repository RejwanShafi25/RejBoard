# RejBoard for Android

A native Android app (Kotlin) that runs **the same UI as the desktop app**: the repository's `index.html`, its `*-core.js`
modules, `vendor/` and `locales/` are copied into the APK at build time, so every screen, tool, menu, colour and shortcut is the
one the Electron build ships. Nothing in the web code is forked or changed.

Everything Electron's main process does for that UI is re-implemented natively, behind the **same `window.wb` API** that
`preload.js` exposes (same channel names, arguments and results):

| Desktop (Electron)                         | Android                                                                                          |
|--------------------------------------------|--------------------------------------------------------------------------------------------------|
| `preload.js` → `window.wb`                 | `assets/web/android/rb-bridge.js` + `Bridge.kt` (WebMessage channel, own origin only)           |
| `file://index.html` in a BrowserWindow     | `https://appassets.androidplatform.net/index.html` served from the APK (`WebAssets.kt`)          |
| Splash window naming the last board        | Native splash with the same look (`MainActivity.showSplash`)                                     |
| Online handwriting (`hw`)                  | `NetFeatures.kt` (same endpoint and request)                                                     |
| On-device OCR (`ocr.js`, Tesseract.js)     | The same Tesseract.js version, its browser build, bundled with `eng.traineddata`                 |
| Language packs (`i18n:fetch`)              | Bundled `locales/`, then GitHub                                                                  |
| Remote images (`image:fetch-remote`)       | `NetFeatures.kt`                                                                                 |
| Sync folder (OneDrive, Drive, Dropbox...)  | `SyncFolder.kt`, system folder picker (Storage Access Framework)                                 |
| Daily automatic backups (`backup-store.js`)| `BackupStore.kt`, same names and 7/4/6 rotation; "Open folder" shares them                       |
| LAN board sharing (`lan.js`)               | `LanShare.kt`, wire-compatible: phones and computers can send boards to each other               |
| "Open on your phone" (`liveview.js`)       | `LiveView.kt`, same server, page, key and CSP                                                    |
| In-app updates (electron-updater)          | `Updater.kt`: GitHub release APK, signer checked, system installer (off for Play installs)       |
| `<webview>` browser / video panel          | `BrowserOverlay.kt`: native WebView kept over the element, same events, long-press menu with "Add image to board", data wiped on close |
| Save dialogs for exports (`<a download>`)  | System "Save as" picker                                                                          |
| Notifications (checklist reminders)        | Android notifications; tapping opens the board                                                   |
| Pen side button "rubs out"                 | `InkWebView.kt`: a stroke started with the S Pen side button held reaches the page as an eraser stroke |
| Word / PowerPoint → PDF (LibreOffice/Office)| `DocRender.kt`: .docx / .pptx laid out offline in a hidden view (docx-preview, pptx-to-html; see `assets/web/android/doc/THIRD_PARTY.md`), each page drawn into a PDF, imported like a PDF |

The microphone (voice recordings) and camera (document scanner) are requested on first use. The Android back button closes the
top-most dialog (like Escape), goes back in the in-app browser, and a second press leaves the app.

## Build

Prerequisites: JDK 17 and the Android SDK (platform 35, build-tools 35), e.g. from Android Studio.

```bash
# once, in the repository root: the same libraries the desktop build bundles (pdf.js, jsPDF, MathJax, Tesseract.js, OCR data...)
npm run libs
```

```bash
cd android
gradle wrapper --gradle-version 8.10.2   # once, if gradlew is not there yet
./gradlew assembleDebug                  # -> app/build/outputs/apk/debug/RejBoard-<version>-android-debug.apk
```

Or open the `android/` folder in Android Studio and press Run.

Release builds are signed with `android/keystore.properties` when it exists (never commit it):

```properties
storeFile=rejboard-release.jks
storePassword=...
keyAlias=rejboard
keyPassword=...
```

```bash
./gradlew assembleRelease   # -> app/build/outputs/apk/release/RejBoard-<version>-android-release.apk
```

## Releases

The Android app has **its own version**, in `android/version.properties` (`versionName=1.0.0`), independent of the desktop
app's version in `package.json`; its changes are listed in `android/CHANGELOG.md`. Desktop and Android are released
separately by GitHub Actions (`.github/workflows/build.yml`):

- tag `vX.Y.Z` (matching `package.json`): **RejBoard X.Y.Z**, the desktop installers (Windows, macOS, Linux). The desktop
  release is the repository's *latest* release, which the desktop app's updater follows.
- tag `android-vX.Y.Z` (matching `android/version.properties`): **RejBoard for Android X.Y.Z**, with
  `RejBoard-X.Y.Z-android.apk` signed with the release key from the repository secrets `ANDROID_KEYSTORE_BASE64`,
  `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`. It is never marked latest; the Android
  app's updater looks for the newest `android-v*` release.

To release a new Android version: raise `versionName` in `android/version.properties`, add its section to
`android/CHANGELOG.md`, commit, then push the tag `android-v<versionName>`.

Updates are only installed when they are signed with the same key as the installed app.

The version name and code come from the root `package.json`, so the Android and desktop builds always carry the same version.
