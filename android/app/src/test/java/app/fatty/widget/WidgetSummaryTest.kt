package app.fatty.widget

import app.fatty.design.ActivityKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

class WidgetSummaryTest {

    /** The contract's example summary. */
    private val example = """
        {
          "date": "2026-10-19",
          "time_zone": "Australia/Sydney",
          "unit": "KCAL",
          "target": 2180,
          "base": 1770,
          "eaten": { "protein": 455, "carbs": 569, "fat": 394, "other": 42 },
          "remaining": 720,
          "activity": "measured",
          "nutrients": [
            { "name": "Protein", "value": "112", "unit": "/ 150 g", "caption": null, "tone": "neutral" },
            { "name": "Saturated fat", "value": "6.4", "unit": "/ 7 g", "caption": "0.6 g left", "tone": "near" },
            { "name": "Sodium", "value": "1,240", "unit": "mg", "caption": "3.1 g salt", "tone": "neutral" }
          ],
          "base_url": "https://fatty.example.app"
        }
    """.trimIndent()

    @Test
    fun parsesTheContractExample() {
        val s = WidgetSummary.parse(example)!!
        assertEquals(LocalDate.of(2026, 10, 19), s.date)
        assertEquals(ZoneId.of("Australia/Sydney"), s.zone)
        assertEquals(ActivityKind.MEASURED, s.activity)
        assertEquals("720", s.centreNumber)
        assertEquals("KCAL LEFT", s.centreLabel)
        assertFalse(s.isOver)
        assertEquals(3, s.nutrients.size)
        assertEquals("Protein", s.nutrients[0].nameLine)
        assertEquals("Saturated fat · 0.6 g left", s.nutrients[1].nameLine)
        assertEquals(Tone.Near, s.nutrients[1].tone)
        assertEquals("1,240", s.nutrients[2].value)
        val ring = s.ringData()
        assertEquals(2180f, ring.target)
        assertEquals(455f, ring.protein)
    }

    @Test
    fun staleDayInTheSummarysZone() {
        val s = WidgetSummary.parse(example)!!
        // 23:59 on the 19th in Sydney (+11): still today.
        assertTrue(s.isForToday(Instant.parse("2026-10-19T12:59:00Z")))
        // 00:01 on the 20th in Sydney, though it's still the 19th in UTC: yesterday's numbers.
        assertFalse(s.isForToday(Instant.parse("2026-10-19T13:01:00Z")))
        // Early on the 19th in Sydney is still the 18th in UTC: today.
        assertTrue(s.isForToday(Instant.parse("2026-10-18T13:30:00Z")))
        assertFalse(s.isForToday(Instant.parse("2026-10-18T12:30:00Z")))
    }

    @Test
    fun missingZoneMeansSydney() {
        val s = WidgetSummary.parse("""{ "date": "2026-10-19", "remaining": 10 }""")!!
        assertEquals(WidgetSummary.DEFAULT_ZONE, s.zone)
        assertEquals(WidgetSummary.DEFAULT_ZONE, WidgetSummary.zoneOf(null))
        assertEquals(ZoneId.of("Europe/London"), WidgetSummary.zoneOf("""{ "time_zone": "Europe/London" }"""))
        assertTrue(s.isForToday(Instant.parse("2026-10-19T01:00:00Z")))
    }

    @Test
    fun missingOrBadDateIsNeverToday() {
        val now = Instant.parse("2026-10-19T01:00:00Z")
        assertFalse(WidgetSummary.parse("""{ "remaining": 10 }""")!!.isForToday(now))
        assertFalse(WidgetSummary.parse("""{ "date": "19/10/2026" }""")!!.isForToday(now))
        assertFalse(WidgetSummary.isToday(null, WidgetSummary.DEFAULT_ZONE, now))
        assertNull(WidgetSummary.parse("not json"))
    }

    @Test
    fun overTargetReadsOver() {
        val s = WidgetSummary.parse(example.replace("\"remaining\": 720", "\"remaining\": -1230").replace("\"KCAL\"", "\"KJ\""))
        assertNotNull(s)
        assertTrue(s!!.isOver)
        assertEquals("1,230", s.centreNumber)
        assertEquals("▲ KJ OVER", s.centreLabel)
    }

    @Test
    fun layoutAtDesignSizeIsTheDesign() {
        val l = WidgetLayout.of(380f, 220f)
        assertEquals(136f, l.ring)
        assertTrue(l.buttons)
        assertEquals(3, l.nutrients)
        assertEquals(18f, l.ringGap)

        val small = WidgetLayout.of(260f, 110f)
        assertFalse(small.buttons)
        assertTrue(small.ring < 136f)

        val (number, label) = WidgetLayout.centreText("720", "KCAL LEFT", 136f)
        assertEquals(36f, number)
        assertEquals(10f, label)
        assertTrue(WidgetLayout.centreText("12,345", "KJ LEFT", 136f).first < 36f)
    }
}
