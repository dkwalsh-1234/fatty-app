package app.fatty.widget

import app.fatty.design.ActivityKind
import app.fatty.design.RingData
import app.fatty.health.zoneOrDefault
import org.json.JSONObject
import java.text.NumberFormat
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeParseException
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToLong

enum class Tone { Neutral, Near, Over }

data class WidgetNutrient(val name: String, val value: String, val unit: String?, val caption: String?, val tone: Tone) {
    /** "Saturated fat · 0.6 g left", or just the name. */
    val nameLine: String get() = if (caption.isNullOrBlank()) name else "$name · $caption"
}

/**
 * The web app's `WidgetSummary` (docs/android-bridge.md). The widget shows exactly this, and only
 * on the day it's for.
 */
data class WidgetSummary(
    val date: LocalDate?,
    val zone: ZoneId,
    val unit: String,
    val target: Double,
    val base: Double,
    val protein: Double,
    val carbs: Double,
    val fat: Double,
    val other: Double,
    val remaining: Double,
    val activity: ActivityKind,
    val nutrients: List<WidgetNutrient>,
) {
    fun isForToday(now: Instant): Boolean = isToday(date, zone, now)

    val isOver: Boolean get() = remaining.roundToLong() < 0

    /** "720", or "230" when over (the label says over). */
    val centreNumber: String get() = formatWhole(abs(remaining))

    val centreLabel: String get() = if (isOver) "▲ $unit OVER" else "$unit LEFT"

    fun ringData() = RingData(
        target = target.toFloat(),
        base = base.toFloat(),
        protein = protein.toFloat(),
        carbs = carbs.toFloat(),
        fat = fat.toFloat(),
        other = other.toFloat(),
        activity = activity,
    )

    /** What TalkBack reads for the ring and nutrients. */
    fun spoken(): String = buildString {
        append(centreNumber).append(' ').append(unit.lowercase()).append(if (isOver) " over" else " left")
        append(" of ").append(formatWhole(target)).append(". ")
        nutrients.forEach { append(it.nameLine).append(", ").append(it.value).append(' ').append(it.unit.orEmpty()).append(". ") }
    }.trim()

    companion object {
        /** Days belong to the person's zone; Daniel's is Sydney, so that's the default. */
        val DEFAULT_ZONE: ZoneId = ZoneId.of("Australia/Sydney")

        /** True when [date] is today in [zone]. A missing date is never today. */
        fun isToday(date: LocalDate?, zone: ZoneId, now: Instant): Boolean =
            date != null && date == now.atZone(zone).toLocalDate()

        /** Null if the JSON isn't a summary at all; missing numbers become 0. */
        fun parse(json: String): WidgetSummary? = try {
            val o = JSONObject(json)
            val eaten = o.optJSONObject("eaten") ?: JSONObject()
            val list = o.optJSONArray("nutrients")
            WidgetSummary(
                date = o.optString("date").takeIf { it.isNotBlank() && !o.isNull("date") }?.let {
                    try { LocalDate.parse(it.trim()) } catch (_: DateTimeParseException) { null }
                },
                zone = zoneOrDefault(o.optString("time_zone").takeUnless { o.isNull("time_zone") }, DEFAULT_ZONE),
                unit = o.optString("unit").trim().uppercase().takeIf { it == "KJ" } ?: "KCAL",
                target = o.number("target"),
                base = o.number("base"),
                protein = eaten.number("protein"),
                carbs = eaten.number("carbs"),
                fat = eaten.number("fat"),
                other = eaten.number("other"),
                remaining = o.number("remaining"),
                activity = when (o.optString("activity").trim().lowercase()) {
                    "measured" -> ActivityKind.MEASURED
                    "estimated" -> ActivityKind.ESTIMATED
                    else -> ActivityKind.NONE
                },
                nutrients = (0 until (list?.length() ?: 0)).mapNotNull { i ->
                    val n = list?.optJSONObject(i) ?: return@mapNotNull null
                    WidgetNutrient(
                        name = n.text("name") ?: return@mapNotNull null,
                        value = n.text("value") ?: "–",
                        unit = n.text("unit"),
                        caption = n.text("caption"),
                        tone = when (n.optString("tone").trim().lowercase()) {
                            "near" -> Tone.Near
                            "over" -> Tone.Over
                            else -> Tone.Neutral
                        },
                    )
                },
            )
        } catch (_: Exception) {
            null
        }

        /** The zone a stored summary's day runs in, for scheduling the midnight refresh. */
        fun zoneOf(json: String?): ZoneId = json?.let(::parse)?.zone ?: DEFAULT_ZONE

        private fun JSONObject.number(key: String): Double = optDouble(key, 0.0).takeIf { it.isFinite() } ?: 0.0

        private fun JSONObject.text(key: String): String? = if (isNull(key)) null else optString(key).trim().takeIf { it.isNotEmpty() }

        private fun formatWhole(value: Double): String =
            NumberFormat.getIntegerInstance(Locale.forLanguageTag("en-AU")).format(value.roundToLong())
    }
}
