# Glance, WorkManager, DataStore and Health Connect ship their own consumer rules.
# The web app calls FoodBridge by method name, so keep every @JavascriptInterface method.
-keepclassmembers class app.fatty.bridge.FoodBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface, *Annotation*
