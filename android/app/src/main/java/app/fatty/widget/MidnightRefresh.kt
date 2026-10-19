package app.fatty.widget

import android.content.Context
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.time.Duration
import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId
import java.util.concurrent.TimeUnit

/**
 * Redraws the widget just after midnight in the summary's zone, so yesterday's numbers give way
 * to "Nothing logged yet today". One-time work, re-scheduled each time it runs and whenever a
 * summary arrives. WorkManager timing isn't exact: Doze can push it back a little.
 */
object MidnightRefresh {
    private const val WORK = "fatty-widget-midnight"

    /** Local time the refresh aims for. */
    val AT: LocalTime = LocalTime.of(0, 1)

    /** Time from [now] to the next [AT] in [zone]; always in the future, daylight saving included. */
    fun delayUntilNext(now: Instant, zone: ZoneId): Duration {
        val today = now.atZone(zone).toLocalDate()
        var next = today.atTime(AT).atZone(zone).toInstant()
        if (!next.isAfter(now)) next = today.plusDays(1).atTime(AT).atZone(zone).toInstant()
        return Duration.between(now, next)
    }

    /** Schedules the next refresh while any widget is placed, and cancels it otherwise. */
    suspend fun schedule(context: Context) {
        val app = context.applicationContext
        if (!hasWidgets(app)) {
            cancel(app)
            return
        }
        val zone = WidgetSummary.zoneOf(WidgetStore(app).current().summaryJson)
        val delay = delayUntilNext(Instant.now(), zone)
        val request = OneTimeWorkRequestBuilder<MidnightWorker>()
            .setInitialDelay(delay.toMillis(), TimeUnit.MILLISECONDS)
            .build()
        WorkManager.getInstance(app).enqueueUniqueWork(WORK, ExistingWorkPolicy.REPLACE, request)
    }

    fun cancel(context: Context) {
        WorkManager.getInstance(context.applicationContext).cancelUniqueWork(WORK)
    }

    /** Makes every widget look at the clock again, then redraws them. */
    suspend fun redrawNow(context: Context) {
        val app = context.applicationContext
        WidgetStore(app).tick()
        FattyWidget.refresh(app)
    }

    private suspend fun hasWidgets(context: Context): Boolean =
        GlanceAppWidgetManager(context).getGlanceIds(FattyWidget::class.java).isNotEmpty()
}

class MidnightWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        MidnightRefresh.redrawNow(applicationContext)
        // Last: re-enqueueing under the same unique name replaces (and so stops) this run.
        MidnightRefresh.schedule(applicationContext)
        return Result.success()
    }
}
