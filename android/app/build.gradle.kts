import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/* The Android app runs the very same web UI as the Electron app (index.html + the *-core.js modules + vendor/ + locales/),
   copied from the repository root at build time. The Android app has its own version (android/version.properties),
   independent of the desktop app's (package.json); the version code is derived from it (1.2.3 -> 10203). */
val repoRoot: File = rootProject.projectDir.parentFile
val appVersion: String = Properties().apply { rootProject.file("version.properties").inputStream().use { load(it) } }
    .getProperty("versionName")?.trim()?.takeIf { Regex("^\\d+\\.\\d+\\.\\d+$").matches(it) }
    ?: throw GradleException("android/version.properties must contain versionName=X.Y.Z")
val appVersionCode = appVersion.split(".").map { it.takeWhile(Char::isDigit).toIntOrNull() ?: 0 }
    .let { (it.getOrElse(0) { 0 } * 10000) + (it.getOrElse(1) { 0 } * 100) + it.getOrElse(2) { 0 } }

val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
// CI release builds set REQUIRE_RELEASE_SIGNING=true: never let them fall back to the debug key (installed apps could not update from it)
if (System.getenv("REQUIRE_RELEASE_SIGNING") == "true" && keystoreProps.getProperty("storeFile") == null)
    throw GradleException("Release signing is required but android/keystore.properties is missing")

android {
    namespace = "com.rejwan.rejboard"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.rejwan.rejboard"
        minSdk = 26
        targetSdk = 35
        versionCode = appVersionCode
        versionName = appVersion
    }

    signingConfigs {
        if (keystoreProps.getProperty("storeFile") != null) {
            create("release") {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    buildFeatures { buildConfig = true }

    androidResources {
        // wasm / OCR data / PDFs are served straight from the APK: no point compressing (and it keeps reads fast)
        noCompress += listOf("wasm", "traineddata", "woff2", "mjs")
    }

    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/rbweb"))
    sourceSets["main"].res.srcDir(layout.buildDirectory.dir("generated/rbres"))

    applicationVariants.all {
        outputs.all {
            (this as com.android.build.gradle.internal.api.BaseVariantOutputImpl).outputFileName =
                "RejBoard-$appVersion-android-${buildType.name}.apk"
        }
    }
}

/* ---- web assets: the same file set the Electron build ships (package.json "build.files"), minus the Electron main-process code ---- */
val electronOnly = listOf("main.js", "preload.js", "lan.js", "liveview.js", "ocr.js", "backup-store.js", "update-policy.js", "test-update-policy.js", "sw.js")
val syncWebAssets by tasks.registering(Sync::class) {
    description = "Copies the RejBoard web UI from the repository root into the APK assets"
    into(layout.buildDirectory.dir("generated/rbweb/web"))
    from(repoRoot) {
        include("index.html", "splash.html", "manifest.json", "icon.svg", "icon-*.png", "*.js")
        exclude(electronOnly)
        include("vendor/**", "locales/**")
    }
    // Offline handwriting OCR: the browser build of the same Tesseract.js version the desktop app bundles, plus its language data
    from(File(repoRoot, "ocr-engine/node_modules/tesseract.js/dist")) {
        include("tesseract.min.js", "worker.min.js")
        into("android/ocr")
    }
    from(File(repoRoot, "ocr-engine/node_modules/tesseract.js-core")) {
        include("tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js")
        into("android/ocr/core")
    }
    from(File(repoRoot, "ocr-engine/tessdata")) {
        include("*.traineddata")
        into("android/ocr/tessdata")
    }
    doFirst {
        val missing = listOf("vendor/pdf.min.js", "vendor/jspdf.umd.min.js", "vendor/tex-svg.js").filterNot { File(repoRoot, it).exists() }
        if (missing.isNotEmpty()) throw GradleException("Missing ${missing.joinToString()} - run `npm run libs` in ${repoRoot.path} first")
        if (!File(repoRoot, "ocr-engine/node_modules/tesseract.js/dist/tesseract.min.js").exists())
            logger.warn("ocr-engine/node_modules is missing (run `npm run libs`): on-device handwriting OCR will be unavailable in this build")
    }
}
val syncLauncherIcons by tasks.registering(Sync::class) {
    description = "Uses the app icon from the repository root as the Android launcher icon"
    into(layout.buildDirectory.dir("generated/rbres"))
    from(File(repoRoot, "icon-512.png")) { into("mipmap-xxxhdpi"); rename { "ic_launcher.png" } }
    from(File(repoRoot, "icon-192.png")) { into("mipmap-xhdpi"); rename { "ic_launcher.png" } }
    from(File(repoRoot, "icon-192.png")) { into("drawable-nodpi"); rename { "rb_logo.png" } }
}
tasks.named("preBuild") { dependsOn(syncWebAssets, syncLauncherIcons) }

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
    // X25519 + HKDF for encrypted local-network board sharing (wire-compatible with the desktop app's lan.js)
    implementation("org.bouncycastle:bcprov-jdk18on:1.78.1")
}
