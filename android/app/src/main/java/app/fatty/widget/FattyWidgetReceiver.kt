package app.fatty.widget

import android.appwidget.AppWidgetManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import app.fatty.FattyApp
import kotlinx.coroutines.launch

class FattyWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = FattyWidget()

    // Placement and resize both land here; keep the midnight refresh booked while a widget exists.
    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        super.onUpdate(context, appWidgetManager, appWidgetIds)
        // Glance already holds this broadcast open with goAsync(), and it can only be taken once.
        val app = context.applicationContext
        FattyApp.scope(app).launch { MidnightRefresh.schedule(app) }
    }

    override fun onDisabled(context: Context) {
        super.onDisabled(context)
        MidnightRefresh.cancel(context)
    }
}

/**
 * After a reboot, a clock change or a time zone change: redraw (the day may have changed under the
 * widget) and book the next midnight refresh again.
 */
class TimeChangeReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_TIME_CHANGED, Intent.ACTION_TIMEZONE_CHANGED -> {
                val pending = goAsync()
                FattyApp.scope(context).launch {
                    try {
                        MidnightRefresh.redrawNow(context)
                        MidnightRefresh.schedule(context)
                    } finally {
                        pending.finish()
                    }
                }
            }
        }
    }
}
