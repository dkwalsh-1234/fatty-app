// Draws the energy ring for the Glance widget.
// Glance can't draw arcs itself, so render to a Bitmap and show it with
// Image(provider = ImageProvider(bitmap), contentDescription = ...).
// Mirrors components/ring.ts. From the design handoff (docs/design/RingBitmap.kt), package moved.
package app.fatty.design

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.RectF
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import kotlin.math.PI
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

enum class ActivityKind { MEASURED, ESTIMATED, NONE }

/** Energy values in kcal (or kJ, as long as all are the same unit). */
data class RingData(
    val target: Float,
    val base: Float,
    val protein: Float,
    val carbs: Float,
    val fat: Float,
    val other: Float,
    val activity: ActivityKind,
)

object RingBitmap {
    /**
     * @param sizeDp 136 for the widget (stroke 15, rail 3).
     * @param density context.resources.displayMetrics.density
     */
    fun render(
        data: RingData,
        density: Float,
        sizeDp: Float = 136f,
        strokeDp: Float = 15f,
        railDp: Float = 3f,
        insetDp: Float = 3f,
    ): Bitmap {
        val px = (sizeDp * density).roundToInt()
        val bmp = Bitmap.createBitmap(px, px, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)

        val stroke = strokeDp * density
        val rail = railDp * density
        val cx = px / 2f
        val r = cx - stroke / 2f - insetDp * density
        val oval = RectF(cx - r, cx - r, cx + r, cx + r)
        val circ = (2 * PI * r).toFloat()
        val k = stroke / 2f / circ          // round-cap compensation, as a fraction of a turn
        val kRail = rail / 2f / circ
        val target = if (data.target > 0f) data.target else 1f

        fun paint(color: Color, width: Float) = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = width
            strokeCap = Paint.Cap.ROUND
            this.color = color.toArgb()
        }

        // f = 0 is 12 o'clock, clockwise. Canvas angles start at 3 o'clock.
        fun arc(p: Paint, f0: Float, f1: Float) {
            val sweep = min(f1 - f0, 0.9995f) * 360f
            if (sweep <= 0f) return
            canvas.drawArc(oval, -90f + f0 * 360f, sweep, false, p)
        }

        // Track
        canvas.drawCircle(cx, cx, r, paint(PineColors.Track, stroke))

        // Activity rail, from the base boundary to 12 o'clock
        val fb = (data.base / target).coerceIn(0f, 1f)
        if (data.activity != ActivityKind.NONE && fb < 1f) {
            val p = paint(PineColors.ActivityRail, rail)
            if (data.activity == ActivityKind.ESTIMATED) {
                p.pathEffect = DashPathEffect(floatArrayOf(0.01f, rail * 2.2f), 0f)
            }
            arc(p, fb + kRail, 1f - kRail)
        }

        // Segments: cumulative from 12 o'clock, drawn other, fat, carbs, protein
        val parts = listOf(data.protein, data.carbs, data.fat, data.other).map { max(it, 0f) }
        val cum = FloatArray(4)
        var acc = 0f
        for (i in 0..3) { acc += parts[i]; cum[i] = min(acc / target, 1f) }
        val colours = listOf(PineColors.Protein, PineColors.Carbs, PineColors.Fat, PineColors.Other)
        for (i in 3 downTo 0) {
            if (cum[i] <= 0f) continue
            val p = paint(colours[i], stroke).apply {
                setShadowLayer(1.5f * density, 0f, 0f, PineColors.SegmentShadow.toArgb())
            }
            arc(p, k, max(cum[i] - k, k + 0.0001f))
        }

        // Over target: second lap in the warning tone
        val over = max(acc - data.target, 0f) / target
        if (over > 0f) {
            val p = paint(PineColors.Warn, stroke).apply {
                setShadowLayer(2f * density, 2f * density, 0f, PineColors.LapShadow.toArgb())
            }
            arc(p, k, max(over - k, k + 0.0001f))
        }
        return bmp
    }
}
