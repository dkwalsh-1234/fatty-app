package app.fatty.health

import androidx.health.connect.client.records.MealType
import androidx.health.connect.client.records.NutritionRecord
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.units.Energy
import androidx.health.connect.client.units.Mass
import org.json.JSONObject
import java.time.DateTimeException
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset

/** One `SyncEntry` from the web app (docs/android-bridge.md), checked and ready to become a record. */
data class NutritionFields(
    val id: String,
    /** `updated_at` in epoch ms: the record version, so a newer edit overwrites. */
    val version: Long,
    val start: Instant,
    val end: Instant,
    val startOffset: ZoneOffset,
    val endOffset: ZoneOffset,
    val mealType: Int,
    val name: String?,
    // Already scaled to the grams eaten. Null means unknown and stays unset on the record.
    val energyKj: Double?,
    val proteinG: Double?,
    val fatG: Double?,
    val satFatG: Double?,
    val transFatG: Double?,
    val carbsG: Double?,
    val sugarsG: Double?,
    val fibreG: Double?,
    val sodiumMg: Double?,
)

object NutritionMapping {

    private val meals = mapOf(
        "breakfast" to MealType.MEAL_TYPE_BREAKFAST,
        "lunch" to MealType.MEAL_TYPE_LUNCH,
        "dinner" to MealType.MEAL_TYPE_DINNER,
        "snack" to MealType.MEAL_TYPE_SNACK,
    )

    /** Throws [IllegalArgumentException] if the entry can't be written; the caller marks it failed. */
    fun parse(entry: JSONObject): NutritionFields {
        val id = entry.optString("id").trim()
        require(id.isNotEmpty()) { "entry has no id" }
        val updated = parseInstant(entry.optString("updated_at")) ?: throw IllegalArgumentException("bad updated_at")
        val start = parseInstant(entry.optString("eaten_at")) ?: throw IllegalArgumentException("bad eaten_at")
        val end = start.plusSeconds(60)
        val zone = zoneOrDefault(entry.optString("time_zone"))
        val n = entry.optJSONObject("nutrients") ?: JSONObject()
        return NutritionFields(
            id = id,
            version = updated.toEpochMilli(),
            start = start,
            end = end,
            startOffset = zone.rules.getOffset(start),
            endOffset = zone.rules.getOffset(end),
            mealType = meals[entry.optString("meal").trim().lowercase()] ?: MealType.MEAL_TYPE_UNKNOWN,
            name = entry.optString("name").trim().takeIf { it.isNotEmpty() && !entry.isNull("name") },
            energyKj = amount(n, "energy_kj"),
            proteinG = amount(n, "protein_g"),
            fatG = amount(n, "fat_g"),
            satFatG = amount(n, "sat_fat_g"),
            transFatG = amount(n, "trans_fat_g"),
            carbsG = amount(n, "carbs_g"),
            sugarsG = amount(n, "sugars_g"),
            fibreG = amount(n, "fibre_g"),
            sodiumMg = amount(n, "sodium_mg"),
        )
    }

    fun toRecord(f: NutritionFields): NutritionRecord = NutritionRecord(
        startTime = f.start,
        startZoneOffset = f.startOffset,
        endTime = f.end,
        endZoneOffset = f.endOffset,
        metadata = Metadata.manualEntry(clientRecordId = f.id, clientRecordVersion = f.version),
        energy = f.energyKj?.let { Energy.kilojoules(it) },
        protein = f.proteinG?.let { Mass.grams(it) },
        totalFat = f.fatG?.let { Mass.grams(it) },
        saturatedFat = f.satFatG?.let { Mass.grams(it) },
        transFat = f.transFatG?.let { Mass.grams(it) },
        totalCarbohydrate = f.carbsG?.let { Mass.grams(it) },
        sugar = f.sugarsG?.let { Mass.grams(it) },
        dietaryFiber = f.fibreG?.let { Mass.grams(it) },
        sodium = f.sodiumMg?.let { Mass.milligrams(it) },
        name = f.name,
        mealType = f.mealType,
    )

    /** A nutrient amount, or null when it's missing, null, not a number or negative. Zero stays zero. */
    internal fun amount(nutrients: JSONObject, key: String): Double? {
        if (nutrients.isNull(key)) return null
        val raw: Any = nutrients.opt(key) ?: return null
        val value = (raw as? Number)?.toDouble() ?: (raw as? String)?.trim()?.toDoubleOrNull()
        return value?.takeIf { it.isFinite() && it >= 0.0 }
    }
}

/** ISO 8601 instants as Postgres and JavaScript write them: `…Z`, `…+00:00`, or `…+00` with a space. */
fun parseInstant(raw: String?): Instant? {
    val s = raw?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    val iso = s.replaceFirst(' ', 'T').replace(Regex("([+-]\\d{2})$"), "$1:00")
    return try {
        OffsetDateTime.parse(iso).toInstant()
    } catch (_: DateTimeException) {
        try { Instant.parse(iso) } catch (_: DateTimeException) { null }
    }
}

/** The zone named, or the phone's own when it's missing or unknown. */
fun zoneOrDefault(name: String?, fallback: ZoneId = ZoneId.systemDefault()): ZoneId =
    name?.trim()?.takeIf { it.isNotEmpty() }?.let { runCatching { ZoneId.of(it) }.getOrNull() } ?: fallback
