package app.fatty.health

import android.graphics.Typeface
import android.os.Bundle
import android.util.TypedValue
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import app.fatty.R

/**
 * Health Connect opens this from its permission screens ("Read privacy policy", or Fatty's entry in
 * Settings > Health Connect). Without it Android won't show Fatty's permission dialog at all.
 * A short plain page: what Fatty writes, what it reads, and why.
 */
class PermissionsRationaleActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val pad = dp(24)
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
            addView(text(R.string.health_title, 26f, bold = true))
            listOf(R.string.health_writes, R.string.health_reads, R.string.health_nothing_else, R.string.health_change).forEach {
                addView(text(it, 16f).apply { setPadding(0, dp(16), 0, 0) })
            }
        }
        val scroll = ScrollView(this).apply {
            setBackgroundColor(getColor(R.color.page_bg))
            addView(column)
        }
        ViewCompat.setOnApplyWindowInsetsListener(scroll) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
        setContentView(scroll)
    }

    private fun text(res: Int, sizeSp: Float, bold: Boolean = false) = TextView(this).apply {
        setText(res)
        setTextColor(getColor(R.color.ink))
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
        setLineSpacing(0f, 1.25f)
        if (bold) setTypeface(typeface, Typeface.BOLD)
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
