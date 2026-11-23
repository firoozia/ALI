package com.aryak.hingelabels.label

/** Text alignment relative to [LabelOp.Text.x]. */
enum class Align { LEFT, CENTER, RIGHT }

/** One thing to draw, in base-page units (464 × 312 dots = 58 × 39 mm at 203 dpi). */
sealed interface LabelOp {
    /** Text vertically centred on [centerY]. */
    data class Text(
        val text: String,
        val x: Float,
        val centerY: Float,
        val size: Float,
        val align: Align,
        val bold: Boolean = true,
        val white: Boolean = false,
    ) : LabelOp

    /** An outlined rectangle; the [stroke] lies inside the bounds. */
    data class Box(val left: Float, val top: Float, val right: Float, val bottom: Float, val stroke: Float) : LabelOp

    /** A solid black rectangle. */
    data class Fill(val left: Float, val top: Float, val right: Float, val bottom: Float) : LabelOp
}

/** Width of [text] in the bold label font at [size]. */
fun interface Measure {
    fun width(text: String, size: Float): Float
}

/** Scale and offset that put the base page in the middle of the real label, keeping its proportions. */
data class PageTransform(val scale: Float, val dx: Float, val dy: Float)

/**
 * Where everything on the hinge box sticker goes. Pure Kotlin so it can be unit tested; [LabelRenderer]
 * draws the result on a bitmap.
 */
object LabelLayout {
    const val W = 464f
    const val H = 312f
    const val MARGIN = 16f

    const val BRAND_Y = 58f
    const val BRAND_MAX = 64f
    const val RULE_TOP = 101f
    const val RULE = 3f

    const val ROW_Y = 140f
    const val PRODUCT_MAX = 34f
    const val QTY_MAX = 30f
    const val QTY_PAD = 10f
    const val QTY_TOP = 118f
    const val QTY_BOTTOM = 162f
    const val QTY_STROKE = 3f

    const val TYPE_LEFT = 16f
    const val TYPE_RIGHT = 146f
    const val TYPE_TOP = 180f
    const val TYPE_BOTTOM = 288f
    const val TYPE_STROKE = 4f
    const val TYPE_CAPTION = 20f
    const val TYPE_MAX = 56f

    /** Model area: right of the type box to the right margin. */
    const val MODEL_LEFT = TYPE_RIGHT + 12f
    const val MODEL_RIGHT = W - MARGIN
    const val MODEL_MAX = 40f
    const val MODEL_Y_SS = 212f
    const val MODEL_Y_PLAIN = 234f

    const val SS_LEFT = 170f
    const val SS_RIGHT = 436f
    const val SS_TOP = 240f
    const val SS_BOTTOM = 284f
    const val SS_SIZE = 36f
    const val SS_TEXT = "SS"

    const val MIN_SIZE = 12f

    val modelCenterX: Float get() = (MODEL_LEFT + MODEL_RIGHT) / 2f

    /**
     * The largest size from [max] down to [min] (in steps of 1) at which [text] fits in [maxWidth].
     * Returns [min] when even that is too wide.
     */
    fun fit(text: String, maxWidth: Float, max: Float, min: Float, m: Measure): Float {
        var size = max
        while (size > min && m.width(text, size) > maxWidth) size -= 1f
        return size.coerceAtLeast(min)
    }

    /** Fits the base page into a label of [widthDots] × [heightDots], centred. */
    fun transform(widthDots: Int, heightDots: Int): PageTransform {
        val k = minOf(widthDots / W, heightDots / H)
        return PageTransform(k, (widthDots / k - W) / 2f, (heightDots / k - H) / 2f)
    }

    fun layout(label: HingeLabel, m: Measure): List<LabelOp> {
        val ops = ArrayList<LabelOp>()

        // 1. Brand, centred, as big as fits.
        val brand = label.brand.trim()
        if (brand.isNotEmpty()) {
            val size = fit(brand, W - 2 * MARGIN, BRAND_MAX, MIN_SIZE, m)
            ops += LabelOp.Text(brand, W / 2f, BRAND_Y, size, Align.CENTER)
        }

        // 2. Rule across.
        ops += LabelOp.Fill(MARGIN, RULE_TOP, W - MARGIN, RULE_TOP + RULE)

        // 3. Product on the left, quantity in a box on the right.
        val qty = label.qtyText
        val qtySize = fit(qty, (W - 2 * MARGIN) * 0.6f - 2 * QTY_PAD, QTY_MAX, MIN_SIZE, m)
        val qtyWidth = m.width(qty, qtySize)
        val boxRight = W - MARGIN
        val boxLeft = boxRight - qtyWidth - 2 * QTY_PAD - 2 * QTY_STROKE
        ops += LabelOp.Box(boxLeft, QTY_TOP, boxRight, QTY_BOTTOM, QTY_STROKE)
        ops += LabelOp.Text(qty, (boxLeft + boxRight) / 2f, ROW_Y, qtySize, Align.CENTER)

        val product = label.product.trim()
        if (product.isNotEmpty()) {
            val size = fit(product, boxLeft - 12f - MARGIN, PRODUCT_MAX, MIN_SIZE, m)
            ops += LabelOp.Text(product, MARGIN, ROW_Y, size, Align.LEFT)
        }

        // 4. Type box: caption and the big letter.
        ops += LabelOp.Box(TYPE_LEFT, TYPE_TOP, TYPE_RIGHT, TYPE_BOTTOM, TYPE_STROKE)
        val typeCenter = (TYPE_LEFT + TYPE_RIGHT) / 2f
        ops += LabelOp.Text("TYPE", typeCenter, TYPE_TOP + 20f, TYPE_CAPTION, Align.CENTER, bold = false)
        val type = label.type.trim()
        if (type.isNotEmpty()) {
            val size = fit(type, TYPE_RIGHT - TYPE_LEFT - 2 * TYPE_STROKE - 12f, TYPE_MAX, MIN_SIZE, m)
            ops += LabelOp.Text(type, typeCenter, 250f, size, Align.CENTER)
        }

        // 5. Model, and the SS bar for stainless steel.
        val model = label.model.trim()
        if (model.isNotEmpty()) {
            val size = fit(model, MODEL_RIGHT - MODEL_LEFT - 8f, MODEL_MAX, MIN_SIZE, m)
            ops += LabelOp.Text(model, modelCenterX, if (label.ss) MODEL_Y_SS else MODEL_Y_PLAIN, size, Align.CENTER)
        }
        if (label.ss) {
            ops += LabelOp.Fill(SS_LEFT, SS_TOP, SS_RIGHT, SS_BOTTOM)
            ops += LabelOp.Text(SS_TEXT, (SS_LEFT + SS_RIGHT) / 2f, (SS_TOP + SS_BOTTOM) / 2f, SS_SIZE, Align.CENTER, white = true)
        }
        return ops
    }
}
