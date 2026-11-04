# RejBoard Native (Phase 1: Foundation)

Native apps for Android, iOS/iPadOS and Windows on one shared Kotlin Multiplatform core. This folder is separate from the
Electron app: nothing here is referenced by `main.js`, `package.json` or electron-builder, and the Electron workflows ignore
`mobile/**`.

```
mobile/
  core/      Kotlin Multiplatform: android, iosArm64, iosSimulatorArm64, mingwX64
    golden/  JSON fixtures written by the desktop JS (generate.js); the Kotlin tests must reproduce them
  android/   Jetpack Compose app
  ios/       SwiftUI app (XcodeGen project.yml), uses core as RejBoardCore.xcframework
  windows/   WinUI 3 C++/WinRT app, Direct2D drawing, uses core as rejboard_core.dll through rejboard_core.h
```

## What Phase 1 does

- **Core** (`core/src/commonMain`):
  - The board model (`Board`, `Item`, `Layer`, `PageSetup`) over the exact JSON the desktop app writes. It covers the item
    types `s t l i m k sp tb gr ck` and keeps unknown types and fields as raw JSON, so they are written back unchanged.
  - `.rjwb` read and write (`Rjwb`): `RJWB1:` + base64 of the UTF-8 JSON. Writing a board you read gives back the same bytes.
  - Undo/redo (`History`), ported from `board-core.js`: pushDeep, pushAdd, the "added stroke" entries, trimming, and page and
    layer restore.
  - Ports of `boardSig`, `searchText`, `metaOf`, `pickStart`, `flatten` and `inflate`.
  - Storage in SQLDelight (`BoardStore`, one schema on every platform). The full board JSON is kept in `body`.
  - The drawing scene (`Scene`): the core decides what to draw and each app only rasterises the primitives.
- **Apps:** each one lists its boards, imports a `.rjwb` file from the desktop app, and opens it read-only (pan and zoom). A
  fresh install starts with a small sample board. Password-protected boards are listed but can't be opened yet.
- **Windows:** the app installs next to the Electron app without clashing. Its MSIX identity is `com.rejwan.rejboard.native`
  and its display name is "RejBoard Native (preview)". Its data lives only in its own package LocalState. It registers no
  `.rjwb` association, no URL protocol and no auto-updater.

## Building

The CI workflows are `.github/workflows/mobile-android.yml`, `mobile-ios.yml` and `mobile-windows.yml`. They run on changes
under `mobile/**`. No Gradle wrapper jar is checked in, so CI uses Gradle 8.14.3 (`gradle/actions/setup-gradle`). To add a
wrapper locally, run `gradle wrapper` once in `mobile/`.

```bash
cd mobile
gradle :core:testDebugUnitTest :android:assembleDebug                    # core tests on the JVM + debug APK
gradle :core:iosSimulatorArm64Test :core:assembleRejBoardCoreReleaseXCFramework   # macOS
gradle :core:mingwX64Test :core:linkReleaseSharedMingwX64 -Prb.sqliteMingwDir=C:/msys64/mingw64/lib   # Windows + MSYS2 sqlite3
```

- **iOS:** `cd ios && xcodegen generate`, then build the `RejBoard` scheme.
- **Windows:**
  1. Run `pwsh windows/stage-core.ps1 -Msys2Root C:\msys64`.
  2. Open `windows/RejBoardNative.sln` (x64) and build, or use the msbuild line in `mobile-windows.yml`.
- **Golden fixtures:** after changing `board-core.js` or `test/helpers.js`, run `node mobile/core/golden/generate.js`. CI
  checks them with `--check`.

## Installing the CI builds

- **Android:** the `RejBoardNative-android-debug-apk` artifact is debug-signed. Install it with `adb install`, or copy it to
  the tablet.
- **iOS:**
  - `RejBoardNative-ios-simulator-app` runs in the Simulator (`xcrun simctl install booted RejBoard.app`).
  - The `.xcarchive` is unsigned. Sign it with your team in Xcode before installing it on an iPad or sending it to TestFlight.
- **Windows:** the `RejBoardNative-windows-msix` artifact is signed with a throw-away test certificate made in that CI run.
  1. Import `RejBoardNative-test-certificate.cer` into *Local Machine > Trusted People*.
  2. Install the Windows App Runtime 1.6 package from `Dependencies\x64` if Windows asks for it.
  3. Open the `.msix`.
