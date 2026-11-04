/* RejBoard Native for Android: board list and the low-latency ink editor (Phase 2). */
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "com.rejwan.rejboard.mobile"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.rejwan.rejboard.mobile"
        minSdk = 26
        targetSdk = 35
        versionCode = 2
        versionName = "0.2.0-phase2"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { compose = true }
}

kotlin { jvmToolchain(17) }

dependencies {
    implementation(project(":core"))
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.activity.compose)
    implementation(libs.kotlinx.coroutines.android)
    // low-latency ink: front-buffered rendering and stylus motion prediction
    implementation(libs.androidx.graphics.core)
    implementation(libs.androidx.input.motionprediction)
}
