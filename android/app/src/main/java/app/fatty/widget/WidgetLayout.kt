package app.fatty.widget

/**
 * Sizes for the widget at whatever size the launcher gives it. At the design's 380 x 220 dp it's
 * the design: a 136 dp ring, three nutrients and the 48 dp buttons. Smaller, the ring shrinks and
 * nutrient gaps tighten, then nutrients drop, then the buttons go.
 */
internal data class WidgetLayout(
    val ring: Float,
    val ringGap: Float,
    val buttons: Boolean,
    val nutrients: Int,
    val gap: Float,
) {
    companion object {
        const val BUTTONS_GAP = 6f
        private const val BUTTON = 48f
        private const val RING = 136f
        /** A 12 sp name line over a 20 sp value, as Android lays them out. */
        private const val BLOCK = 42f

        fun of(widthDp: Float, heightDp: Float, fontScale: Float = 1f): WidgetLayout {
            val innerW = (widthDp - 32f).coerceAtLeast(0f) // padding 14 left, 18 right
            val innerH = (heightDp - 28f).coerceAtLeast(0f) // padding 14 top and bottom
            val buttons = innerH - BUTTON - BUTTONS_GAP >= 72f
            val top = if (buttons) innerH - BUTTON - BUTTONS_GAP else innerH
            val ringGap = if (innerW >= 300f) 18f else 12f
            val ring = minOf(RING, top, innerW * 0.45f).coerceAtLeast(40f)
            val block = BLOCK * fontScale.coerceAtLeast(1f)
            val count = ((top + 2f) / (block + 2f)).toInt().coerceIn(1, 3)
            val gap = if (count > 1) ((top - count * block) / (count - 1)).coerceIn(2f, 12f) else 0f
            return WidgetLayout(ring, ringGap, buttons, count, gap)
        }

        /**
         * Text sizes in dp for the ring centre: 36 and 10 at 136 dp, scaled with the ring and the
         * font size setting, and shrunk so a long number (kJ, or over by thousands) stays inside.
         */
        fun centreText(number: String, label: String, ringDp: Float, fontScale: Float = 1f): Pair<Float, Float> {
            val scale = ringDp / RING
            val room = ringDp * 0.66f // the ring's opening, less a little air
            val numberEm = number.sumOf { if (it.isDigit()) 0.53 else 0.25 }.toFloat().coerceAtLeast(0.53f)
            val labelEm = (label.length * 0.68f).coerceAtLeast(0.68f)
            return minOf(36f * scale * fontScale, room / numberEm) to minOf(10f * scale * fontScale, room / labelEm)
        }
    }
}
