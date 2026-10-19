package app.fatty.widget

import android.content.Context
import android.content.Intent
import android.util.TypedValue
import android.widget.RemoteViews
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalContext
import androidx.glance.LocalSize
import androidx.glance.action.Action
import androidx.glance.action.clickable
import androidx.glance.appwidget.AndroidRemoteViews
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.appWidgetBackground
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.updateAll
import androidx.glance.background
import androidx.glance.color.ColorProvider
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.RowScope
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.semantics.contentDescription
import androidx.glance.semantics.semantics
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import app.fatty.FattyConfig
import app.fatty.MainActivity
import app.fatty.R
import app.fatty.design.ActivityKind
import app.fatty.design.DarkColors
import app.fatty.design.LightColors
import app.fatty.design.PineColors
import app.fatty.design.RingBitmap
import app.fatty.design.RingData
import java.time.Instant
import androidx.glance.unit.ColorProvider as FixedColor

/**
 * Today's ring, three nutrients and the four log buttons (design README "Widget at real size",
 * 07-widget-light/dark). Shows exactly what the web app last sent through `updateWidget`, and
 * only on the day it's for: a stale or missing summary shows the bare track and
 * "Nothing logged yet today", never yesterday's numbers.
 */
class FattyWidget : GlanceAppWidget() {
    override val sizeMode: SizeMode = SizeMode.Exact

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val store = WidgetStore(context)
        val initial = store.current()
        provideContent {
            // A running session is recomposed on update rather than re-provided, so read the live flow.
            val state by store.state.collectAsState(initial)
            val summary = remember(state.summaryJson) { state.summaryJson?.let(WidgetSummary::parse) }
            // The clock is read on every recomposition; a new tick (midnight, time change) forces one.
            Card(summary?.takeIf { it.isForToday(Instant.now()) })
        }
    }

    companion object {
        suspend fun refresh(context: Context) = FattyWidget().updateAll(context)

        /** From the bridge: keep the web app's summary, redraw every widget now, book the next midnight. */
        suspend fun show(context: Context, summaryJson: String) {
            if (WidgetSummary.parse(summaryJson) == null) return
            val app = context.applicationContext
            WidgetStore(app).saveSummary(summaryJson)
            refresh(app)
            MidnightRefresh.schedule(app)
        }
    }
}

private val Surface = ColorProvider(day = LightColors.WidgetSurface, night = DarkColors.WidgetSurface)
private val Raised = FixedColor(PineColors.Raised)
private val Mint = FixedColor(PineColors.Mint)
private val Mint2 = FixedColor(PineColors.Mint2)
private val Warn = FixedColor(PineColors.Warn)

/** Only the track: the ring for a day with nothing logged yet. */
private val EmptyRing = RingData(target = 1f, base = 1f, protein = 0f, carbs = 0f, fat = 0f, other = 0f, activity = ActivityKind.NONE)

@Composable
private fun Card(summary: WidgetSummary?) {
    val context = LocalContext.current
    val size = LocalSize.current
    val layout = WidgetLayout.of(size.width.value, size.height.value, context.resources.configuration.fontScale)
    val spoken = summary?.spoken() ?: context.getString(R.string.widget_nothing_yet)
    Column(
        GlanceModifier.fillMaxSize()
            .appWidgetBackground()
            .cornerRadius(32.dp)
            .background(Surface)
            .padding(start = 14.dp, top = 14.dp, end = 18.dp, bottom = 14.dp),
    ) {
        Row(
            GlanceModifier.fillMaxWidth().defaultWeight()
                .clickable(open(context, "/"))
                .semantics { contentDescription = context.getString(R.string.widget_today, spoken) },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Ring(summary, layout.ring)
            Spacer(GlanceModifier.width(layout.ringGap.dp))
            Column(GlanceModifier.defaultWeight()) {
                if (summary == null) {
                    Text(
                        context.getString(R.string.widget_nothing_yet),
                        style = TextStyle(color = Mint2, fontSize = 15.sp),
                        maxLines = 2,
                    )
                } else {
                    summary.nutrients.take(layout.nutrients).forEachIndexed { i, n ->
                        if (i > 0) Spacer(GlanceModifier.height(layout.gap.dp))
                        Nutrient(n)
                    }
                }
            }
        }
        if (layout.buttons) {
            Spacer(GlanceModifier.height(WidgetLayout.BUTTONS_GAP.dp))
            Row(GlanceModifier.fillMaxWidth()) {
                LogButton(R.drawable.ic_scan, R.string.widget_scan, "/log/scan")
                Spacer(GlanceModifier.width(8.dp))
                LogButton(R.drawable.ic_photo, R.string.widget_photo, "/log/photo")
                Spacer(GlanceModifier.width(8.dp))
                LogButton(R.drawable.ic_search, R.string.widget_search, "/log/search")
                Spacer(GlanceModifier.width(8.dp))
                LogButton(R.drawable.ic_type, R.string.widget_type, "/log/type")
            }
        }
    }
}

/** The design's RingBitmap as an image, with the centre text laid over it. */
@Composable
private fun Ring(summary: WidgetSummary?, sizeDp: Float) {
    val context = LocalContext.current
    val data = summary?.ringData() ?: EmptyRing
    val scale = sizeDp / 136f
    val bitmap = remember(data, sizeDp) {
        // Capped density keeps the bitmap well inside RemoteViews' memory limit.
        val density = context.resources.displayMetrics.density.coerceAtMost(3f)
        RingBitmap.render(data, density, sizeDp = sizeDp, strokeDp = 15f * scale, railDp = 3f * scale, insetDp = 3f * scale)
    }
    Box(GlanceModifier.size(sizeDp.dp), contentAlignment = Alignment.Center) {
        Image(ImageProvider(bitmap), contentDescription = null, modifier = GlanceModifier.fillMaxSize())
        if (summary != null) AndroidRemoteViews(centre(context, summary, sizeDp))
    }
}

/**
 * "720" over "KCAL LEFT" (or "▲ KCAL OVER" in coral). A tiny XML layout rather than Glance Text,
 * because Glance can't set the light weight, the caps tracking or tabular figures.
 */
private fun centre(context: Context, summary: WidgetSummary, ringDp: Float): RemoteViews {
    val sizes = WidgetLayout.centreText(summary.centreNumber, summary.centreLabel, ringDp, context.resources.configuration.fontScale)
    val tone = if (summary.isOver) PineColors.Warn else PineColors.Mint
    return RemoteViews(context.packageName, R.layout.widget_ring_centre).apply {
        setTextViewText(R.id.ring_value, summary.centreNumber)
        setTextViewTextSize(R.id.ring_value, TypedValue.COMPLEX_UNIT_DIP, sizes.first)
        setTextColor(R.id.ring_value, tone.toArgb())
        setTextViewText(R.id.ring_label, summary.centreLabel)
        setTextViewTextSize(R.id.ring_label, TypedValue.COMPLEX_UNIT_DIP, sizes.second)
        setTextColor(R.id.ring_label, (if (summary.isOver) PineColors.Warn else PineColors.Mint2).toArgb())
    }
}

/** Name line over the value, with its unit smaller and quieter. Near or over turns the value coral. */
@Composable
private fun Nutrient(n: WidgetNutrient) {
    Column {
        Text(n.nameLine, style = TextStyle(color = Mint2, fontSize = 12.sp), maxLines = 1)
        Row(verticalAlignment = Alignment.Bottom) {
            Text(
                n.value,
                style = TextStyle(color = if (n.tone == Tone.Neutral) Mint else Warn, fontSize = 20.sp),
                maxLines = 1,
            )
            if (!n.unit.isNullOrBlank()) {
                // Bottom-aligned, the smaller text's shallower descent leaves it 2 dp low; lift it onto the baseline.
                Text(
                    " ${n.unit}",
                    style = TextStyle(color = Mint2, fontSize = 13.sp),
                    maxLines = 1,
                    modifier = GlanceModifier.padding(bottom = 2.dp),
                )
            }
        }
    }
}

@Composable
private fun RowScope.LogButton(icon: Int, label: Int, route: String) {
    val context = LocalContext.current
    val description = context.getString(label)
    Box(
        GlanceModifier.defaultWeight().height(48.dp)
            .cornerRadius(24.dp)
            .background(Raised)
            .clickable(open(context, route))
            .semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) {
        Image(ImageProvider(icon), contentDescription = null, modifier = GlanceModifier.size(22.dp))
    }
}

/**
 * Opens the app on [route]. The identifier keeps each button's PendingIntent distinct, since
 * intents that differ only in extras would otherwise share one.
 */
private fun open(context: Context, route: String): Action = actionStartActivity(
    Intent(context, MainActivity::class.java)
        .putExtra(FattyConfig.EXTRA_ROUTE, route)
        .setIdentifier("route:$route")
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
)
