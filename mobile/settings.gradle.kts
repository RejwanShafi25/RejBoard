/* RejBoard native apps: one Gradle build for the shared Kotlin Multiplatform core and the Android app.
   The iOS (Xcode) and Windows (Visual Studio) apps consume the core's XCFramework / DLL built from here. */
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.PREFER_SETTINGS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "rejboard-mobile"
include(":core", ":android")
