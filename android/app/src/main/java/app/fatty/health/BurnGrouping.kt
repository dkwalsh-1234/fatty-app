package app.fatty.health

import org.json.JSONArray
import org.json.JSONObject
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToLong

/** One calories-burned record, reduced to what the grouping needs. */
data class BurnSample(val app: String, val start: Instant, val end: Instant, val kcal: Double)

/** One app's burn for one local day. Null means that app wrote nothing of that kind that day. */
data class BurnSource(val app: String, val totalKcal: Double?, val activeKcal: Double?)

data class BurnDay(val date: LocalDate, val sources: List<BurnSource>)

/**
 * Total and active calories burned per local day and per source app (docs/android-bridge.md,
 * `BurnResult`). Apps are never added together: Garmin Connect and a phone pedometer both writing
 * for the same day come back as two sources, and the web app picks one.
 */
object BurnGrouping {

    /** The last [days] local dates ending today, oldest first. */
    fun lastDays(days: Int, today: LocalDate): List<LocalDate> = (days - 1 downTo 0).map { today.minusDays(it.toLong()) }

    fun group(total: List<BurnSample>, active: List<BurnSample>, dates: List<LocalDate>, zone: ZoneId): List<BurnDay> {
        val totals = perDayAndApp(total, dates, zone)
        val actives = perDayAndApp(active, dates, zone)
        return dates.map { date ->
            val t = totals[date].orEmpty()
            val a = actives[date].orEmpty()
            val sources = (t.keys + a.keys).map { BurnSource(it, t[it], a[it]) }
                .sortedWith(compareByDescending<BurnSource> { it.totalKcal ?: -1.0 }.thenBy { it.app })
            BurnDay(date, sources)
        }
    }

    /**
     * Sums each app's samples per local day. A record that crosses midnight is split between the
     * two days in proportion to its time on each; an instant record counts on the day it falls in.
     */
    internal fun perDayAndApp(samples: List<BurnSample>, dates: List<LocalDate>, zone: ZoneId): Map<LocalDate, Map<String, Double>> {
        val windows = dates.associateWith { it.atStartOfDay(zone).toInstant() to it.plusDays(1).atStartOfDay(zone).toInstant() }
        val out = mutableMapOf<LocalDate, MutableMap<String, Double>>()
        for (s in samples) {
            if (!s.kcal.isFinite() || s.kcal < 0) continue
            val length = Duration.between(s.start, s.end).toMillis()
            for ((date, window) in windows) {
                val (from, to) = window
                val share = if (length <= 0) {
                    if (!s.start.isBefore(from) && s.start.isBefore(to)) 1.0 else 0.0
                } else {
                    val overlap = min(s.end.toEpochMilli(), to.toEpochMilli()) - max(s.start.toEpochMilli(), from.toEpochMilli())
                    if (overlap > 0) overlap.toDouble() / length else 0.0
                }
                if (share <= 0.0) continue
                val day = out.getOrPut(date) { mutableMapOf() }
                day[s.app] = (day[s.app] ?: 0.0) + s.kcal * share
            }
        }
        return out
    }

    /** `BurnResult` JSON. kcal are rounded to whole numbers; [label] gives each app's readable name. */
    fun toJson(days: List<BurnDay>, permission: Boolean, label: (String) -> String): JSONObject {
        val list = JSONArray()
        days.forEach { day ->
            val sources = JSONArray()
            day.sources.forEach { s ->
                sources.put(
                    JSONObject()
                        .put("app", s.app)
                        .put("label", label(s.app))
                        .put("total_kcal", s.totalKcal?.roundToLong() ?: JSONObject.NULL)
                        .put("active_kcal", s.activeKcal?.roundToLong() ?: JSONObject.NULL),
                )
            }
            list.put(JSONObject().put("date", day.date.toString()).put("sources", sources))
        }
        return JSONObject().put("days", list).put("permission", permission)
    }
}
