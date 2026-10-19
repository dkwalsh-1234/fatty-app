# Fatty for Android

A thin wrapper around Fatty's web app. The web app does the real work; this app adds what a browser tab can't:

- **The web app in its own window**, with the camera working for barcode scanning and photos.
- **Health Connect**: every log entry is written as a nutrition record, and calories burned (from Garmin Connect, say) are read back for the energy target.
- **A home-screen widget**: today's ring, three nutrients, and Scan, Photo, Search and Type buttons that open straight onto those screens.

Everything the web app asks of the phone goes through `window.FoodBridge`. The contract is `docs/android-bridge.md`; the native side is `app/src/main/java/app/fatty/bridge/FoodBridge.kt`.

## Set up

1. Copy `fatty.properties.example` to `fatty.properties` (git-ignored) and set the web app's address, no trailing slash:

   ```properties
   FATTY_BASE_URL=https://fatty.example.app
   ```

   Without it the app shows a short "isn't set up yet" message instead of the web app. The address is compiled in, so rebuild after changing it.

2. `local.properties` points at the Android SDK (`sdk.dir=/Users/dkwalsh/Library/Android/sdk`). It's git-ignored; Android Studio writes its own.

## Build

Needs JDK 17 or later (21 is fine) and the Android SDK with platform 37.

```bash
JAVA_HOME=/Users/dkwalsh/tools/jdk-21.0.12+8/Contents/Home ./gradlew assembleDebug
```

The APK is `app/build/outputs/apk/debug/app-debug.apk`. `./gradlew assembleRelease` gives a minified build signed with the same debug key, so either installs over the other.

Tests and lint:

```bash
./gradlew testDebugUnitTest
./gradlew :app:lintDebug
```

## Install

- **USB:** turn on Developer options and USB debugging on the phone, plug it in, then:

  ```bash
  adb install -r app/build/outputs/apk/debug/app-debug.apk
  ```

- **Or** copy the APK to the phone, open it, and allow installs from that app when asked.

Updates install over the top as long as they're built on the same Mac (debug builds are signed with this Mac's debug key). From another machine, uninstall first.

**Testing against `next dev`:** debug builds allow plain http to the phone's own localhost. Set `FATTY_BASE_URL=http://localhost:3000`, rebuild, and run `adb reverse tcp:3000 tcp:3000`. localhost counts as a secure context, so the camera still works.

**Inspecting the WebView:** debug builds can be inspected from Chrome on the Mac at `chrome://inspect` while the phone is plugged in.

## Permissions, and when they're asked

| Permission | When | Notes |
| --- | --- | --- |
| Camera | The first time the web app opens the scanner or a photo input | Live scanning needs it for `getUserMedia`; photo inputs with `capture` open the camera app. Declined, the scanner falls back to typing digits and photo inputs open the picker. |
| Health Connect: write nutrition | When the web app calls `requestHealthPermissions("write")` | Food only. |
| Health Connect: read total and active calories burned | When the web app calls `requestHealthPermissions("read")`, a separate step | So a friend without a watch can say no. |
| Internet, run at startup | Install time, never shown | Startup only re-books the widget's midnight refresh. |

No notifications of any kind. WorkManager's own manifest entries (wake lock, network state, foreground service) come with the library; Fatty only uses it for the once-a-day widget redraw.

Health Connect's permission screens link to a short page explaining what Fatty writes and reads (`PermissionsRationaleActivity`). Android won't show the permission dialog without it.

## Health Connect

On Android 14 and later Health Connect is part of the system (search Settings for Health Connect). On Android 13 and earlier it's an app; `healthConnectStatus` reports `needsUpdate: true` until it's installed, and `openHealthConnectSettings()` opens the Play Store.

**What's written.** One `NutritionRecord` per log entry: start time is `eaten_at`, end time a minute later, the meal type, the food name, energy and the eight other nutrients already scaled to the grams eaten. A nutrient the web app sends as `null` is left unset on the record, never written as zero. The record's client ID is the log entry's id and its version is `updated_at` in milliseconds, so re-sending an entry updates it in place: "Resync today" never makes duplicates, and an edit overwrites the old record. Deleting an entry deletes its record by client ID.

**What's read.** `TotalCaloriesBurnedRecord` and `ActiveCaloriesBurnedRecord` for the last `days` local days in the phone's time zone, summed **per source app** and never across apps. A record that crosses midnight is split between the two days by time. Each source comes back with a readable app name where the phone will tell us. An app that writes only a total reports `active_kcal: null`.

**Testing with Garmin.** Garmin Connect (Android 14 or later) writes burn one way into Health Connect:

1. In Garmin Connect's settings, find Health Connect (under connected apps) and let it write active calories burned and total calories burned.
2. Sync the watch, then check Health Connect > Data and access > Activity > Total calories burned: Garmin Connect should be listed with today's figure.
3. In Fatty, allow the read step and open the Goal screen. Each app's burn shows separately.

**Seeing Fatty's records.** In Health Connect, Data and access > Nutrition, then see all entries. Log, edit and delete an entry in Fatty and watch the record appear, change and disappear.

## The widget

- Long-press the home screen > Widgets > Fatty > Today. About 4 x 2 cells, resizable: smaller sizes shrink the ring, then drop nutrients, then the buttons.
- It shows exactly the summary the web app last sent with `updateWidget`, which it does after every change and when the app opens. The widget updates within a second or so.
- **Only today.** If the summary's `date` isn't today in its `time_zone` (Sydney if missing), the widget shows the bare ring and "Nothing logged yet today". It never shows yesterday's numbers. A placed widget with no summary yet looks the same.
- **Just after midnight** (00:01 in the summary's zone) WorkManager redraws it. The time is approximate: if the phone is asleep in Doze it can run later, at the latest when the phone wakes. It's re-booked after each run, whenever a summary arrives, after a restart and after a clock or time zone change.
- Tapping the ring or the nutrients opens Today (`/`). Scan, Photo, Search and Type open `/log/scan`, `/log/photo`, `/log/search` and `/log/type` in the app that's already running.
- The card is pine `#0D2F23` in light mode and `#112921` in dark, as designed. Text is the system font (Glance can't load Geist).

## Verify on the Pixel

None of this can be checked without a device.

- [ ] **Barcode scanning inside the WebView.** Open the scanner. If `BarcodeDetector` is available (it needs Google Play services, which a Pixel has), scanning works natively; if not, the web app falls back to its JavaScript barcode library automatically. Check with `chrome://inspect`: `'BarcodeDetector' in window`, and `await BarcodeDetector.getSupportedFormats()` includes `ean_13`.
- [ ] **Camera permission.** First scan asks for the camera once; the live preview appears. Deny it, and the scanner offers typing the digits. A meal or label photo opens the camera app and the photo lands in the web app.
- [ ] **Light and dark.** Switch the system theme with the app open: the page follows (`prefers-color-scheme`), the bars stay pine with light icons, and nothing is auto-darkened.
- [ ] **Health Connect write.** Allow food access. Log an entry: its record appears in Health Connect with the right time, meal and nutrients, and an unknown nutrient (an Open Food Facts product with no saturated fat) is missing rather than 0. Edit it: the record changes. Delete it: the record disappears.
- [ ] **Resync creates no duplicates.** Settings > Resync today, twice. Health Connect still has one record per entry.
- [ ] **Health Connect read.** Allow burn in the second step (or decline it, and check food still syncs). With Garmin Connect writing burn, Refresh burn shows Garmin's figure on its own, not added to any other app's.
- [ ] **Widget.** Logging something updates the widget within a few seconds. After midnight it shows "Nothing logged yet today". The four buttons open the right screens in the running app, and back from there returns through the app's history.
- [ ] **TalkBack** reads the ring and nutrients as one item and names each button.
