import org.jetbrains.kotlin.gradle.plugin.mpp.apple.XCFramework
import org.jetbrains.kotlin.gradle.targets.native.tasks.KotlinNativeSimulatorTest

/* The shared RejBoard core: board model, .rjwb/JSON format, undo/redo, storage and the drawing scene.
   - Android uses it as a normal Kotlin library (:android depends on it).
   - iOS uses the static RejBoardCore.xcframework (assembleRejBoardCoreXCFramework).
   - Windows uses rejboard_core.dll from the mingwX64 shared library, through the C functions in CApi.kt. */
plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.android.library)
    alias(libs.plugins.sqldelight)
}

/* mingwX64 links SQLite from MSYS2 (CI passes -Prb.sqliteMingwDir=<msys64>/mingw64/lib). */
val sqliteMingwDir: String? = providers.gradleProperty("rb.sqliteMingwDir").orNull

kotlin {
    jvmToolchain(17)

    androidTarget()

    val xcf = XCFramework("RejBoardCore")
    listOf(iosArm64(), iosSimulatorArm64()).forEach { target ->
        target.binaries.framework {
            baseName = "RejBoardCore"
            isStatic = true
            xcf.add(this)
        }
    }

    mingwX64 {
        binaries {
            sharedLib { baseName = "rejboard_core" }
            all { if (sqliteMingwDir != null) linkerOpts("-L$sqliteMingwDir") }
        }
    }

    sourceSets {
        commonMain.dependencies {
            implementation(libs.kotlinx.serialization.json)
            implementation(libs.sqldelight.runtime)
        }
        commonTest.dependencies {
            implementation(kotlin("test"))
        }
        androidMain.dependencies {
            implementation(libs.sqldelight.android.driver)
        }
        val androidUnitTest by getting {
            dependencies { implementation(libs.sqldelight.sqlite.driver) }
        }
        nativeMain.dependencies {
            implementation(libs.sqldelight.native.driver)
            implementation(libs.sqliter)
        }
    }
}

android {
    namespace = "com.rejwan.rejboard.core"
    compileSdk = 36
    defaultConfig { minSdk = 26 }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

sqldelight {
    databases {
        create("RejBoardDb") {
            packageName.set("com.rejwan.rejboard.core.db")
        }
    }
}

/* Golden fixtures (core/golden/*.json, written by golden/generate.js from the desktop JS) are read from disk by the tests.
   Their absolute path is baked into a generated source file, which works for JVM, simulator and Windows test runs alike. */
val goldenPath = layout.buildDirectory.dir("generated/goldenPath/kotlin")
val generateGoldenPath by tasks.registering {
    val dir = file("golden").absolutePath
    val out = goldenPath
    inputs.property("dir", dir)
    outputs.dir(out)
    doLast {
        val literal = dir.replace("\\", "\\\\").replace("\"", "\\\"").replace("$", "\${'$'}")
        val f = out.get().file("com/rejwan/rejboard/core/GoldenPath.kt").asFile
        f.parentFile.mkdirs()
        f.writeText("package com.rejwan.rejboard.core\n\ninternal const val GOLDEN_DIR = \"$literal\"\n")
    }
}
kotlin.sourceSets.commonTest { kotlin.srcDir(generateGoldenPath) }

/* simulator tests: the device name must exist on the runner (CI picks one with simctl) */
tasks.withType<KotlinNativeSimulatorTest>().configureEach {
    providers.gradleProperty("rb.iosSimulator").orNull?.let { device.set(it) }
}
