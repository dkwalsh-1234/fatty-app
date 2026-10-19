package app.fatty.health

import androidx.health.connect.client.records.MealType
import androidx.health.connect.client.records.metadata.Metadata
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset

class NutritionMappingTest {

    /** The contract's example entry. */
    private fun entry() = JSONObject(
        """
        {
          "id": "6f1c0000-0000-4000-8000-000000000001",
          "updated_at": "2026-10-19T02:40:12.345Z",
          "eaten_at": "2026-10-19T01:40:00.000Z",
          "time_zone": "Australia/Sydney",
          "meal": "lunch",
          "name": "Mixed salad leaves",
          "nutrients": {
            "energy_kj": 33.4, "protein_g": 0.6, "fat_g": 0.1, "sat_fat_g": null,
            "trans_fat_g": 0, "carbs_g": 0.7, "sugars_g": 0.6, "fibre_g": 0.9, "sodium_mg": 9
          }
        }
        """.trimIndent(),
    )

    @Test
    fun mapsTheContractExample() {
        val f = NutritionMapping.parse(entry())

        assertEquals("6f1c0000-0000-4000-8000-000000000001", f.id)
        assertEquals(Instant.parse("2026-10-19T02:40:12.345Z").toEpochMilli(), f.version)
        assertEquals(Instant.parse("2026-10-19T01:40:00Z"), f.start)
        assertEquals(Instant.parse("2026-10-19T01:41:00Z"), f.end)
        // Sydney is on daylight time (+11) by 19 October.
        assertEquals(ZoneOffset.ofHours(11), f.startOffset)
        assertEquals(ZoneOffset.ofHours(11), f.endOffset)
        assertEquals(MealType.MEAL_TYPE_LUNCH, f.mealType)
        assertEquals("Mixed salad leaves", f.name)
        assertEquals(33.4, f.energyKj!!, 1e-9)
        assertEquals(0.6, f.proteinG!!, 1e-9)
        assertEquals(0.1, f.fatG!!, 1e-9)
        assertNull("unknown stays unknown", f.satFatG)
        assertEquals("zero is a real zero", 0.0, f.transFatG!!, 0.0)
        assertEquals(0.7, f.carbsG!!, 1e-9)
        assertEquals(0.6, f.sugarsG!!, 1e-9)
        assertEquals(0.9, f.fibreG!!, 1e-9)
        assertEquals(9.0, f.sodiumMg!!, 1e-9)
    }

    @Test
    fun recordLeavesUnknownNutrientsUnset() {
        val record = NutritionMapping.toRecord(NutritionMapping.parse(entry()))

        assertEquals("6f1c0000-0000-4000-8000-000000000001", record.metadata.clientRecordId)
        assertEquals(Instant.parse("2026-10-19T02:40:12.345Z").toEpochMilli(), record.metadata.clientRecordVersion)
        assertEquals(Metadata.RECORDING_METHOD_MANUAL_ENTRY, record.metadata.recordingMethod)
        assertEquals(33.4, record.energy!!.inKilojoules, 1e-6)
        assertEquals(0.6, record.protein!!.inGrams, 1e-9)
        assertEquals(0.1, record.totalFat!!.inGrams, 1e-9)
        assertNull(record.saturatedFat)
        assertEquals(0.0, record.transFat!!.inGrams, 0.0)
        assertEquals(0.7, record.totalCarbohydrate!!.inGrams, 1e-9)
        assertEquals(0.6, record.sugar!!.inGrams, 1e-9)
        assertEquals(0.9, record.dietaryFiber!!.inGrams, 1e-9)
        assertEquals(9.0, record.sodium!!.inMilligrams, 1e-9)
        // Nothing the web app didn't send.
        assertNull(record.calcium)
        assertNull(record.potassium)
        assertEquals("Mixed salad leaves", record.name)
        assertEquals(MealType.MEAL_TYPE_LUNCH, record.mealType)
        assertEquals(Instant.parse("2026-10-19T01:41:00Z"), record.endTime)
    }

    @Test
    fun missingNullOrBadValuesAreUnset() {
        val e = entry().apply {
            put("nutrients", JSONObject().put("energy_kj", "120.5").put("protein_g", -1).put("fat_g", "n/a").put("sodium_mg", JSONObject.NULL))
            put("meal", "brunch")
            put("name", JSONObject.NULL)
        }
        val f = NutritionMapping.parse(e)
        assertEquals(120.5, f.energyKj!!, 1e-9)
        assertNull(f.proteinG)
        assertNull(f.fatG)
        assertNull(f.sodiumMg)
        assertNull(f.carbsG)
        assertNull(f.name)
        assertEquals(MealType.MEAL_TYPE_UNKNOWN, f.mealType)
    }

    @Test
    fun mealTypesMap() {
        mapOf(
            "breakfast" to MealType.MEAL_TYPE_BREAKFAST,
            "lunch" to MealType.MEAL_TYPE_LUNCH,
            "dinner" to MealType.MEAL_TYPE_DINNER,
            "snack" to MealType.MEAL_TYPE_SNACK,
        ).forEach { (meal, type) ->
            assertEquals(meal, type, NutritionMapping.parse(entry().put("meal", meal)).mealType)
        }
    }

    @Test
    fun unknownZoneFallsBackAndBadTimesFail() {
        val f = NutritionMapping.parse(entry().put("time_zone", "Mars/Olympus"))
        assertEquals(ZoneId.systemDefault().rules.getOffset(f.start), f.startOffset)

        assertThrows(IllegalArgumentException::class.java) { NutritionMapping.parse(entry().put("updated_at", "yesterday")) }
        assertThrows(IllegalArgumentException::class.java) { NutritionMapping.parse(entry().put("eaten_at", JSONObject.NULL)) }
        assertThrows(IllegalArgumentException::class.java) { NutritionMapping.parse(entry().put("id", "")) }
    }

    @Test
    fun parsesPostgresAndJavaScriptTimestamps() {
        val expected = Instant.parse("2026-10-19T02:40:12.345Z")
        assertEquals(expected, parseInstant("2026-10-19T02:40:12.345Z"))
        assertEquals(expected, parseInstant("2026-10-19T02:40:12.345+00:00"))
        assertEquals(expected, parseInstant("2026-10-19 02:40:12.345+00"))
        assertEquals(expected, parseInstant("2026-10-19T13:40:12.345+11:00"))
        // Supabase timestamptz keeps microseconds; the record version is whole milliseconds.
        assertEquals(expected.toEpochMilli(), parseInstant("2026-10-19T02:40:12.345678+00:00")!!.toEpochMilli())
        assertNull(parseInstant(""))
        assertNull(parseInstant("not a date"))
    }
}
