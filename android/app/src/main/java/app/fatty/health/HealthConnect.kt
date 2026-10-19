package app.fatty.health

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.edit
import androidx.core.net.toUri
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.NutritionRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlin.coroutines.cancellation.CancellationException
import kotlin.reflect.KClass

/**
 * Everything Fatty does with Health Connect: nutrition records written from log entries, and
 * calories burned read back per source app. Every call returns the bridge's JSON and never throws,
 * except for coroutine cancellation.
 */
class HealthConnect(context: Context) {

    private val context = context.applicationContext
    private val prefs = this.context.getSharedPreferences("health", Context.MODE_PRIVATE)
    private var cachedClient: HealthConnectClient? = null

    fun sdkStatus(): Int = HealthConnectClient.getSdkStatus(context, PROVIDER)

    /** The client, or null while Health Connect is missing or needs an update. */
    private fun client(): HealthConnectClient? {
        cachedClient?.let { return it }
        if (sdkStatus() != HealthConnectClient.SDK_AVAILABLE) return null
        return HealthConnectClient.getOrCreate(context, PROVIDER).also { cachedClient = it }
    }

    suspend fun granted(): Set<String> = client()?.permissionController?.getGrantedPermissions().orEmpty()

    fun isAvailable(): Boolean = sdkStatus() == HealthConnectClient.SDK_AVAILABLE

    /** `HealthStatus`. */
    suspend fun status(): JSONObject {
        val status = sdkStatus()
        val granted = if (status == HealthConnectClient.SDK_AVAILABLE) safeGranted() else emptySet()
        return JSONObject()
            .put("available", status == HealthConnectClient.SDK_AVAILABLE)
            .put("needsUpdate", status == HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED)
            .put("writeNutrition", WRITE_NUTRITION in granted)
            .put("readTotalCalories", READ_TOTAL in granted)
            .put("readActiveCalories", READ_ACTIVE in granted)
            .put("lastSyncAt", prefs.getString(KEY_LAST_SYNC, null) ?: JSONObject.NULL)
    }

    /**
     * Upserts one NutritionRecord per entry. Health Connect matches on clientRecordId and keeps
     * the higher clientRecordVersion, so re-sending the same entries never duplicates them.
     */
    suspend fun sync(entriesJson: String): JSONObject {
        val entries = try {
            JSONArray(entriesJson)
        } catch (_: Exception) {
            return syncResult(emptyList(), emptyList(), "The entries weren't valid JSON")
        }
        val failed = mutableListOf<String>()
        val records = linkedMapOf<String, NutritionRecord>()
        for (i in 0 until entries.length()) {
            val obj = entries.optJSONObject(i) ?: continue
            val id = obj.optString("id").trim().takeIf { it.isNotEmpty() } ?: continue
            try {
                val record = NutritionMapping.toRecord(NutritionMapping.parse(obj))
                // The same entry twice in one call: keep the newer edit.
                val existing = records[id]
                if (existing == null || existing.metadata.clientRecordVersion <= record.metadata.clientRecordVersion) records[id] = record
            } catch (_: Exception) {
                failed += id
            }
        }
        val client = client()
            ?: return syncResult(emptyList(), failed + records.keys, "Health Connect isn't available on this phone")
        if (WRITE_NUTRITION !in safeGranted()) {
            return syncResult(emptyList(), failed + records.keys, "Fatty doesn't have permission to write food to Health Connect")
        }

        val synced = mutableListOf<String>()
        var error: String? = if (failed.isEmpty()) null else "Some entries couldn't be turned into Health Connect records"
        records.entries.chunked(BATCH).forEach { chunk ->
            try {
                client.insertRecords(chunk.map { it.value })
                synced += chunk.map { it.key }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // One bad record fails the whole insert, so retry one at a time to find it.
                chunk.forEach { (id, record) ->
                    try {
                        client.insertRecords(listOf(record))
                        synced += id
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        failed += id
                        error = "Health Connect refused some entries: ${e.message ?: e.javaClass.simpleName}"
                    }
                }
            }
        }
        if (synced.isNotEmpty()) prefs.edit { putString(KEY_LAST_SYNC, Instant.now().toString()) }
        return syncResult(synced, failed, error)
    }

    /** Deletes the records written for these log entry ids. Unknown ids are not an error. */
    suspend fun delete(idsJson: String): JSONObject {
        val ids = try {
            JSONArray(idsJson).let { a -> (0 until a.length()).mapNotNull { a.optString(it).trim().takeIf(String::isNotEmpty) } }
        } catch (_: Exception) {
            return deleteResult(emptyList(), "The ids weren't valid JSON")
        }
        val client = client() ?: return deleteResult(emptyList(), "Health Connect isn't available on this phone")
        if (WRITE_NUTRITION !in safeGranted()) {
            return deleteResult(emptyList(), "Fatty doesn't have permission to change food in Health Connect")
        }
        val deleted = mutableListOf<String>()
        for (chunk in ids.distinct().chunked(BATCH)) {
            try {
                client.deleteRecords(NutritionRecord::class, recordIdsList = emptyList(), clientRecordIdsList = chunk)
                deleted += chunk
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                return deleteResult(deleted, "Health Connect couldn't delete some entries: ${e.message ?: e.javaClass.simpleName}")
            }
        }
        return deleteResult(deleted, null)
    }

    /** `BurnResult` for the last [days] local days in the phone's zone, per source app. */
    suspend fun readBurn(days: Int, zone: ZoneId = ZoneId.systemDefault()): JSONObject {
        val client = client() ?: return BurnGrouping.toJson(emptyList(), false, ::label)
        val granted = safeGranted()
        val readTotal = READ_TOTAL in granted
        val readActive = READ_ACTIVE in granted
        if (!readTotal && !readActive) return BurnGrouping.toJson(emptyList(), false, ::label)

        val dates = BurnGrouping.lastDays(days, LocalDate.now(zone))
        // A day early, so records that started before the first midnight are found and split.
        val from = dates.first().minusDays(1).atStartOfDay(zone).toInstant()
        val to = dates.last().plusDays(1).atStartOfDay(zone).toInstant()
        val total = if (readTotal) {
            readAll(client, TotalCaloriesBurnedRecord::class, from, to).map {
                BurnSample(it.metadata.dataOrigin.packageName, it.startTime, it.endTime, it.energy.inKilocalories)
            }
        } else emptyList()
        val active = if (readActive) {
            readAll(client, ActiveCaloriesBurnedRecord::class, from, to).map {
                BurnSample(it.metadata.dataOrigin.packageName, it.startTime, it.endTime, it.energy.inKilocalories)
            }
        } else emptyList()
        return BurnGrouping.toJson(BurnGrouping.group(total, active, dates, zone), true, ::label)
    }

    /**
     * Where "Health Connect settings" goes: the Play Store when it must be installed or updated,
     * otherwise Fatty's own permissions page in Health Connect, falling back to its home screen.
     */
    fun settingsIntents(): List<Intent> = buildList {
        if (sdkStatus() == HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) {
            add(
                Intent(Intent.ACTION_VIEW, "market://details?id=$PROVIDER&url=healthconnect%3A%2F%2Fonboarding".toUri())
                    .setPackage("com.android.vending")
                    .putExtra("overlay", true)
                    .putExtra("callerId", context.packageName),
            )
            add(Intent(Intent.ACTION_VIEW, "https://play.google.com/store/apps/details?id=$PROVIDER".toUri()))
            return@buildList
        }
        if (Build.VERSION.SDK_INT >= 34) {
            add(Intent(ACTION_MANAGE_HEALTH_PERMISSIONS).putExtra(Intent.EXTRA_PACKAGE_NAME, context.packageName))
        }
        add(Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS))
    }

    /** Readable app name for a data origin, for the web app's source picker. */
    fun label(packageName: String): String {
        KNOWN_LABELS[packageName]?.let { return it }
        return try {
            val pm = context.packageManager
            val info = if (Build.VERSION.SDK_INT >= 33) {
                pm.getApplicationInfo(packageName, PackageManager.ApplicationInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION")
                pm.getApplicationInfo(packageName, 0)
            }
            pm.getApplicationLabel(info).toString().takeIf { it.isNotBlank() } ?: packageName
        } catch (_: PackageManager.NameNotFoundException) {
            packageName
        }
    }

    private suspend fun safeGranted(): Set<String> = try {
        granted()
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        emptySet()
    }

    private suspend fun <T : Record> readAll(client: HealthConnectClient, type: KClass<T>, from: Instant, to: Instant): List<T> {
        val out = mutableListOf<T>()
        var token: String? = null
        var pages = 0
        do {
            val response = client.readRecords(
                ReadRecordsRequest(type, TimeRangeFilter.between(from, to), pageSize = PAGE_SIZE, pageToken = token),
            )
            out += response.records
            token = response.pageToken?.takeIf { it.isNotEmpty() }
        } while (token != null && ++pages < MAX_PAGES)
        return out
    }

    private fun syncResult(synced: List<String>, failed: List<String>, error: String?) = JSONObject()
        .put("synced", JSONArray(synced))
        .put("failed", JSONArray(failed.distinct()))
        .apply { if (error != null) put("error", error) }

    private fun deleteResult(deleted: List<String>, error: String?) = JSONObject()
        .put("deleted", JSONArray(deleted))
        .apply { if (error != null) put("error", error) }

    companion object {
        /** Health Connect's own app on Android 13 and earlier. From 14 it's part of the system. */
        const val PROVIDER = "com.google.android.apps.healthdata"
        private const val ACTION_MANAGE_HEALTH_PERMISSIONS = "android.health.connect.action.MANAGE_HEALTH_PERMISSIONS"
        private const val KEY_LAST_SYNC = "last_sync_at"
        private const val BATCH = 100
        private const val PAGE_SIZE = 5000
        private const val MAX_PAGES = 40

        val WRITE_NUTRITION = HealthPermission.getWritePermission(NutritionRecord::class)
        val READ_TOTAL = HealthPermission.getReadPermission(TotalCaloriesBurnedRecord::class)
        val READ_ACTIVE = HealthPermission.getReadPermission(ActiveCaloriesBurnedRecord::class)

        /** Asked in two steps: "write" for food, then "read" for burn, which a friend without a watch can decline. */
        fun permissionsFor(scope: String?): Set<String>? = when (scope?.trim()?.lowercase()) {
            "write" -> setOf(WRITE_NUTRITION)
            "read" -> setOf(READ_TOTAL, READ_ACTIVE)
            else -> null
        }

        private val KNOWN_LABELS = mapOf(
            PROVIDER to "Health Connect",
            "com.google.android.healthconnect.controller" to "Health Connect",
            "com.android.healthconnect.controller" to "Health Connect",
            "com.garmin.android.apps.connectmobile" to "Garmin Connect",
            "com.google.android.apps.fitness" to "Fit",
        )
    }
}
