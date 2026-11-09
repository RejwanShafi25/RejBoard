# JavaScript bridge (fallback path when WebMessageListener is unavailable)
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
# BouncyCastle lightweight crypto used by LAN sharing
-keep class org.bouncycastle.crypto.** { *; }
-dontwarn org.bouncycastle.**
