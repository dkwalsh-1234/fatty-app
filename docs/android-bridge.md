# Android bridge contract

The web app runs inside the Android wrapper's WebView. The wrapper exposes `window.FoodBridge`
(via `addJavascriptInterface`) only inside the app; in a normal browser it is absent and the web
app skips every call. The web side lives in `lib/bridge.ts`; the native side in
`android/app/src/main/java/app/fatty/bridge/`.

## Calling convention

`addJavascriptInterface` methods are synchronous and take strings, so every call that returns
data takes a `requestId` first. Native work runs off the main thread and, when done, answers on
the main thread with:

```js
window.__fattyBridge.resolve(requestId, resultJson)   // resultJson is a JSON string
```

`window.__fattyBridge` is installed by the web app before any call. If native fails, it still
resolves, with `{"error": "plain message"}`. The web side gives up after 20 s by default, 30 s for
`readBurn`, 60 s for `syncEntries` and 120 s for `requestHealthPermissions` (a system dialog).
Calls are answered only while the WebView's page is on the app's own address.

The wrapper's user agent ends with ` FattyApp/1`, and `FoodBridge.version()` returns `"1"`.

## Methods

| Method | Arguments | Resolves with |
| --- | --- | --- |
| `version()` | none, returns `"1"` synchronously | |
| `syncEntries(requestId, entriesJson)` | `SyncEntry[]` | `{ "synced": string[], "failed": string[], "error"?: string }` |
| `deleteEntries(requestId, idsJson)` | `string[]` of log entry ids | `{ "deleted": string[], "error"?: string }` |
| `readBurn(requestId, days)` | `days` as a string, e.g. `"7"` | `BurnResult` |
| `updateWidget(summaryJson)` | `WidgetSummary`, returns nothing | |
| `healthConnectStatus(requestId)` | | `HealthStatus` |
| `requestHealthPermissions(requestId, scope)` | `"write"` (nutrition) or `"read"` (burn) | `HealthStatus` after the system dialog (skipped when already granted; after two refusals Android stops showing it, so offer `openHealthConnectSettings()`) |
| `openHealthConnectSettings()` | returns nothing | |

### `SyncEntry` (one Health Connect `NutritionRecord` per entry)

```json
{
  "id": "6f1c…",                       // log entry id → clientRecordId
  "updated_at": "2026-10-19T02:40:12.345Z", // → clientRecordVersion (epoch ms)
  "eaten_at": "2026-10-19T01:40:00.000Z",   // startTime; endTime = startTime + 1 minute
  "time_zone": "Australia/Sydney",          // zone offsets for start and end
  "meal": "lunch",                          // breakfast | lunch | dinner | snack → MEAL_TYPE_*
  "name": "Mixed salad leaves",
  "nutrients": {                            // already scaled to the grams eaten
    "energy_kj": 33.4, "protein_g": 0.6, "fat_g": 0.1, "sat_fat_g": null,
    "trans_fat_g": 0, "carbs_g": 0.7, "sugars_g": 0.6, "fibre_g": 0.9, "sodium_mg": 9
  }
}
```

Unknown nutrients are `null` and must be left unset on the record, never zero. Mapping:
energy (kJ → `Energy.kilojoules`), protein, totalFat, saturatedFat, transFat, totalCarbohydrate,
sugar, dietaryFiber (grams), sodium (mg → `Mass.milligrams`). Upserting with the same
clientRecordId and a newer version overwrites, so re-sending is safe ("Resync today" never
duplicates).

### `BurnResult`

Total and active calories burned per local day (device zone), **per source app, never summed**:

```json
{
  "days": [
    {
      "date": "2026-10-19",
      "sources": [
        { "app": "com.garmin.android.apps.connectmobile", "label": "Garmin Connect", "total_kcal": 2612, "active_kcal": 410 },
        { "app": "com.google.android.apps.fitness", "label": "Fit", "total_kcal": 2390, "active_kcal": null }
      ]
    }
  ],
  "permission": true
}
```

A source with only total calories reports `active_kcal: null` (the web app works out
activity = total − resting); one with only active calories reports `total_kcal: null`. Every
requested day comes back, oldest first, including days with `sources: []`; figures are whole
kcal, sources are sorted by highest total, and `days` is capped at 30 (Health Connect's limit).
With no permission, `permission: false` and `days: []`.

### `WidgetSummary`

Built by the web app after any change and on app open. The widget shows exactly this.

```json
{
  "date": "2026-10-19",               // local date the summary is for
  "time_zone": "Australia/Sydney",
  "unit": "KCAL",                     // or "KJ"
  "target": 2180,
  "base": 1770,                       // resting + goal adjustment (the rest is activity)
  "eaten": { "protein": 455, "carbs": 569, "fat": 394, "other": 42 },   // same unit as target
  "remaining": 720,                   // negative when over
  "activity": "measured",             // measured | estimated | none
  "nutrients": [
    { "name": "Protein", "value": "112", "unit": "/ 150 g", "caption": null, "tone": "neutral" },
    { "name": "Saturated fat", "value": "6.4", "unit": "/ 7 g", "caption": "0.6 g left", "tone": "near" },
    { "name": "Sodium", "value": "1,240", "unit": "mg", "caption": "3.1 g salt", "tone": "neutral" }
  ],
  "base_url": "https://fatty.example.app"
}
```

`tone` is `neutral`, `near` (warning colour) or `over` (warning colour, value prefixed ▲ by the
web app). The name line reads `name` or `name · caption`. If `date` isn't today in `time_zone`,
the widget shows the empty ring and "Nothing logged yet today" instead of the numbers. `base_url`
is informational: the widget's buttons always open the address built into the app.

### `HealthStatus`

```json
{
  "available": true,          // Health Connect SDK available on this device
  "needsUpdate": false,       // provider must be installed or updated
  "writeNutrition": true,
  "readTotalCalories": false,
  "readActiveCalories": false,
  "lastSyncAt": "2026-10-19T02:41:00.000Z"
}
```

## Routes the wrapper opens

The widget buttons open these paths on the base URL, straight into the WebView:
`/log/scan`, `/log/photo`, `/log/search`, `/log/type`. Tapping the ring opens `/`.
