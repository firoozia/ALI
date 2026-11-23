package com.aryak.hingelabels.label

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface

/**
 * Draws [LabelLayout] on a bitmap the size of the real label. The layout is designed for 58 × 39 mm
 * (464 × 312 dots) and scaled to the label size in Settings, centred.
 */
object LabelRenderer {
    fun render(label: HingeLabel, setup: Tspl.Setup): Bitmap {
        val bmp = Bitmap.createBitmap(Tspl.widthDots(setup), Tspl.heightDots(setup), Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp).apply { drawColor(Color.WHITE) }
        val t = LabelLayout.transform(bmp.width, bmp.height)
        c.scale(t.scale, t.scale)
        c.translate(t.dx, t.dy)

        val bold = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.BLACK
            typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
        }
        val regular = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.BLACK
            typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL)
        }
        val measure = Measure { text, size -> bold.textSize = size; bold.measureText(text) }
        val fill = Paint().apply { color = Color.BLACK; style = Paint.Style.FILL }
        val stroke = Paint().apply { color = Color.BLACK; style = Paint.Style.STROKE }

        LabelLayout.layout(label, measure).forEach { op ->
            when (op) {
                is LabelOp.Fill -> c.drawRect(op.left, op.top, op.right, op.bottom, fill)
                is LabelOp.Box -> {
                    stroke.strokeWidth = op.stroke
                    val h = op.stroke / 2f
                    c.drawRect(op.left + h, op.top + h, op.right - h, op.bottom - h, stroke)
                }
                is LabelOp.Text -> {
                    val p = if (op.bold) bold else regular
                    p.textSize = op.size
                    p.color = if (op.white) Color.WHITE else Color.BLACK
                    p.textAlign = when (op.align) {
                        Align.LEFT -> Paint.Align.LEFT
                        Align.CENTER -> Paint.Align.CENTER
                        Align.RIGHT -> Paint.Align.RIGHT
                    }
                    // Centre capital letters on centerY: cap height is about 0.72 of the size.
                    val baseline = op.centerY + op.size * 0.36f
                    c.drawText(op.text, op.x, baseline, p)
                }
            }
        }
        return bmp
    }

    /** Threshold to 1-bit for the printer. */
    fun toBlack(bmp: Bitmap): BooleanArray {
        val w = bmp.width
        val h = bmp.height
        val px = IntArray(w * h)
        bmp.getPixels(px, 0, w, 0, 0, w, h)
        return BooleanArray(px.size) { i ->
            val c = px[i]
            val lum = (Color.red(c) * 299 + Color.green(c) * 587 + Color.blue(c) * 114) / 1000
            lum < 128
        }
    }

    /** One TSPL job per batch of copies, all of the same label. */
    fun tsplJobs(label: HingeLabel, setup: Tspl.Setup, batches: List<Int>): List<ByteArray> {
        val bmp = render(label, setup)
        val black = toBlack(bmp)
        val w = bmp.width
        val h = bmp.height
        bmp.recycle()
        return batches.map { Tspl.job(black, w, h, setup, it) }
    }
}
