package app.fatty.widget

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

class MidnightRefreshTest {
    private val sydney = ZoneId.of("Australia/Sydney")

    private fun local(date: String, time: String, zone: ZoneId = sydney): Instant =
        LocalDate.parse(date).atTime(LocalTime.parse(time)).atZone(zone).toInstant()

    @Test
    fun justBeforeMidnight() {
        val delay = MidnightRefresh.delayUntilNext(local("2026-10-19", "23:59:30"), sydney)
        assertEquals(Duration.ofSeconds(90), delay)
    }

    @Test
    fun justAfterMidnightButBeforeTheRefresh() {
        val delay = MidnightRefresh.delayUntilNext(local("2026-10-20", "00:00:30"), sydney)
        assertEquals(Duration.ofSeconds(30), delay)
    }

    @Test
    fun exactlyAtTheRefreshMeansTomorrow() {
        val delay = MidnightRefresh.delayUntilNext(local("2026-10-20", "00:01"), sydney)
        assertEquals(Duration.ofHours(24), delay)
    }

    @Test
    fun middayInSydneyWhateverTheUtcDate() {
        // 12:00 Sydney on the 20th is 01:00 UTC on the 20th; next refresh 00:01 Sydney on the 21st.
        val now = Instant.parse("2026-10-20T01:00:00Z")
        assertEquals(Duration.ofHours(12).plusMinutes(1), MidnightRefresh.delayUntilNext(now, sydney))
    }

    @Test
    fun daylightSavingDayIsShorter() {
        // Sydney springs forward at 02:00 on 4 October 2026, so that day has 23 hours.
        val delay = MidnightRefresh.delayUntilNext(local("2026-10-04", "00:01"), sydney)
        assertEquals(Duration.ofHours(23), delay)
    }

    @Test
    fun followsTheSummarysZoneNotThePhones() {
        val now = Instant.parse("2026-10-19T12:00:00Z") // 23:00 in Sydney, 13:00 in London
        assertEquals(Duration.ofMinutes(61), MidnightRefresh.delayUntilNext(now, sydney))
        assertEquals(Duration.ofHours(11).plusMinutes(1), MidnightRefresh.delayUntilNext(now, ZoneId.of("Europe/London")))
    }

    @Test
    fun alwaysInTheFuture() {
        var t = Instant.parse("2026-01-01T00:00:00Z")
        repeat(400) {
            val d = MidnightRefresh.delayUntilNext(t, sydney)
            assertTrue(d > Duration.ZERO && d <= Duration.ofHours(25))
            assertEquals(MidnightRefresh.AT, t.plus(d).atZone(sydney).toLocalTime())
            t = t.plus(Duration.ofHours(23).plusMinutes(17))
        }
    }
}
