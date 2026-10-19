package app.fatty.health

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.json.JSONObject
import org.junit.Test
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId

class BurnGroupingTest {
    private val sydney = ZoneId.of("Australia/Sydney")
    private val garmin = "com.garmin.android.apps.connectmobile"
    private val fit = "com.google.android.apps.fitness"
    private val day = LocalDate.of(2026, 10, 19)

    private fun at(date: LocalDate, hour: Int, minute: Int = 0) = LocalDateTime.of(date, LocalTime.of(hour, minute)).atZone(sydney).toInstant()

    private fun sample(app: String, date: LocalDate, fromHour: Int, toHour: Int, kcal: Double) =
        BurnSample(app, at(date, fromHour), at(date, toHour), kcal)

    @Test
    fun twoAppsOnTheSameDayStaySeparate() {
        val total = listOf(
            sample(garmin, day, 0, 12, 1300.0),
            sample(garmin, day, 12, 23, 1312.0),
            sample(fit, day, 0, 23, 2390.0),
        )
        val active = listOf(sample(garmin, day, 8, 9, 410.0))

        val result = BurnGrouping.group(total, active, listOf(day), sydney).single()

        assertEquals(day, result.date)
        assertEquals(2, result.sources.size)
        // Highest daily total first; each app on its own, never summed.
        val (first, second) = result.sources
        assertEquals(garmin, first.app)
        assertEquals(2612.0, first.totalKcal!!, 0.001)
        assertEquals(410.0, first.activeKcal!!, 0.001)
        assertEquals(fit, second.app)
        assertEquals(2390.0, second.totalKcal!!, 0.001)
        // Fit wrote no active calories: null, not zero.
        assertNull(second.activeKcal)
    }

    @Test
    fun recordAcrossMidnightIsSplitByTime() {
        val yesterday = day.minusDays(1)
        // 22:00 to 02:00 local: two hours each side of midnight.
        val sample = BurnSample(garmin, at(yesterday, 22), at(day, 2), 400.0)

        val days = BurnGrouping.group(listOf(sample), emptyList(), listOf(yesterday, day), sydney)

        assertEquals(200.0, days[0].sources.single().totalKcal!!, 0.001)
        assertEquals(200.0, days[1].sources.single().totalKcal!!, 0.001)
    }

    @Test
    fun recordsOutsideTheDaysAreIgnoredAndEmptyDaysStay() {
        val dates = BurnGrouping.lastDays(3, day)
        assertEquals(listOf(day.minusDays(2), day.minusDays(1), day), dates)

        val old = sample(garmin, day.minusDays(5), 0, 23, 2500.0)
        val today = sample(garmin, day, 0, 10, 900.0)
        val result = BurnGrouping.group(listOf(old, today), emptyList(), dates, sydney)

        assertEquals(3, result.size)
        assertTrue(result[0].sources.isEmpty())
        assertTrue(result[1].sources.isEmpty())
        assertEquals(900.0, result[2].sources.single().totalKcal!!, 0.001)
    }

    @Test
    fun activeOnlySourceHasNullTotal() {
        val result = BurnGrouping.group(emptyList(), listOf(sample(fit, day, 9, 10, 120.0)), listOf(day), sydney).single()
        val source = result.sources.single()
        assertNull(source.totalKcal)
        assertEquals(120.0, source.activeKcal!!, 0.001)
    }

    @Test
    fun instantRecordCountsOnItsDay() {
        val instant = at(day, 23, 59)
        val result = BurnGrouping.group(listOf(BurnSample(garmin, instant, instant, 50.0)), emptyList(), listOf(day), sydney)
        assertEquals(50.0, result.single().sources.single().totalKcal!!, 0.001)
    }

    @Test
    fun jsonMatchesTheContract() {
        val days = BurnGrouping.group(
            listOf(sample(garmin, day, 0, 12, 2611.6)),
            emptyList(),
            listOf(day),
            sydney,
        )
        val json = JSONObject(BurnGrouping.toJson(days, true) { if (it == garmin) "Garmin Connect" else it }.toString())

        assertTrue(json.getBoolean("permission"))
        val d = json.getJSONArray("days").getJSONObject(0)
        assertEquals("2026-10-19", d.getString("date"))
        val s = d.getJSONArray("sources").getJSONObject(0)
        assertEquals(garmin, s.getString("app"))
        assertEquals("Garmin Connect", s.getString("label"))
        assertEquals(2612, s.getInt("total_kcal"))
        assertTrue(s.isNull("active_kcal"))
        assertTrue(s.has("active_kcal"))
    }

    @Test
    fun noPermissionIsEmpty() {
        val json = BurnGrouping.toJson(emptyList(), false) { it }
        assertFalse(json.getBoolean("permission"))
        assertEquals(0, json.getJSONArray("days").length())
    }
}
