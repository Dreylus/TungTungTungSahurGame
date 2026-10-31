# Keep the JavaScript bridge methods callable from the WebView.
-keepattributes JavascriptInterface
-keepclassmembers class com.dreylus.pixelwars.NativeBridge {
    @android.webkit.JavascriptInterface <methods>;
}
