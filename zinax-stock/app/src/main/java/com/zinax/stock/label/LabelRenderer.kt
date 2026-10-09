package com.zinax.stock.label

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import com.zinax.stock.core.Format
import com.zinax.stock.data.Item

/**
 * Draws the 58 × 39 mm label (464 × 312 dots at 203 dpi):
 * code large on the left, size and quantity under it, QR on the right, ID along the bottom.
 */
object LabelRenderer {
    private const val MARGIN = 14

    fun render(item: Item, setup: Tspl.Setup): Bitmap {
        val w = Tspl.widthDots(setup)
        val h = Tspl.heightDots(setup)
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        c.drawColor(Color.WHITE)

        val qrSize = 200
        val qrLeft = w - MARGIN - qrSize
        drawQr(c, item.id, qrLeft, MARGIN, qrSize)

        val condensed = Typeface.create("sans-serif-condensed", Typeface.BOLD)
        val textWidth = qrLeft - MARGIN - 12f
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.BLACK; typeface = condensed }

        // Code
        fit(paint, item.code, textWidth, 118f, 34f)
        val codeBaseline = MARGIN - paint.fontMetrics.ascent * 0.92f
        c.drawText(item.code, MARGIN.toFloat(), codeBaseline, paint)

        // Size, or the product family when there is no size
        val second = if (item.size.isNotBlank()) Format.size(item.size) else item.categoryEnum.label
        fit(paint, second, textWidth, 44f, 20f)
        val sizeBaseline = codeBaseline + 12 - paint.fontMetrics.ascent
        c.drawText(second, MARGIN.toFloat(), sizeBaseline, paint)

        // Quantity with unit
        val qty = Format.qtyUnit(item.qty, item.unit)
        fit(paint, qty, textWidth, 76f, 28f)
        val qtyBaseline = sizeBaseline + 10 - paint.fontMetrics.ascent
        c.drawText(qty, MARGIN.toFloat(), qtyBaseline, paint)

        // ID, readable if the QR is damaged
        val mono = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.BLACK
            typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
        }
        fit(mono, item.id, (w - 2 * MARGIN).toFloat(), 34f, 18f)
        c.drawText(item.id, MARGIN.toFloat(), h - MARGIN - mono.fontMetrics.descent, mono)
        return bmp
    }

    private fun fit(p: Paint, text: String, maxWidth: Float, maxSize: Float, minSize: Float) {
        var size = maxSize
        p.textSize = size
        while (size > minSize && p.measureText(text) > maxWidth) {
            size -= 2f
            p.textSize = size
        }
    }

    private fun drawQr(c: Canvas, text: String, left: Int, top: Int, size: Int) {
        val hints = mapOf(EncodeHintType.MARGIN to 0, EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M)
        val m = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, 0, 0, hints)
        val module = size / m.width
        val offset = (size - module * m.width) / 2
        val p = Paint().apply { color = Color.BLACK }
        for (y in 0 until m.height) for (x in 0 until m.width) {
            if (m[x, y]) {
                val l = (left + offset + x * module).toFloat()
                val t = (top + offset + y * module).toFloat()
                c.drawRect(l, t, l + module, t + module, p)
            }
        }
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

    fun tsplJob(item: Item, setup: Tspl.Setup): ByteArray {
        val bmp = render(item, setup)
        return Tspl.job(toBlack(bmp), bmp.width, bmp.height, setup).also { bmp.recycle() }
    }
}
