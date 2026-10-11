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
import com.zinax.stock.core.TextWrap
import com.zinax.stock.printer.LabelSpec
import com.zinax.stock.data.Item

/**
 * Draws the labels. Layouts are designed for 58 × 39 mm (464 × 312 dots at 203 dpi) and scaled to
 * the label size in Settings: the page keeps that design's proportions on its shorter side and the
 * extra room on the other side goes to the text.
 */
object LabelRenderer {
    private const val MARGIN = 14
    private const val BASE_W = 464f
    private const val BASE_H = 312f

    /** A white bitmap of the real label size; [c] draws in design units [w] × [h]. */
    private class Page(val bmp: Bitmap, val c: Canvas, val k: Float, val w: Float, val h: Float)

    private fun page(setup: Tspl.Setup): Page {
        val bmp = Bitmap.createBitmap(Tspl.widthDots(setup), Tspl.heightDots(setup), Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp).apply { drawColor(Color.WHITE) }
        val k = minOf(bmp.width / BASE_W, bmp.height / BASE_H)
        c.scale(k, k)
        return Page(bmp, c, k, bmp.width / k, bmp.height / k)
    }

    /** White space kept around the QR so cameras find its edges: about two QR modules. */
    private const val QR_QUIET = 20f

    /** QR side in design units: 196 on the base label, smaller if the page is short. */
    private fun qrSide(p: Page) = minOf(196f, p.h - 2 * QR_QUIET - 40f)

    fun render(item: Item, setup: Tspl.Setup): Bitmap {
        val p = page(setup)
        val c = p.c
        val w = p.w
        val h = p.h

        val qrSize = qrSide(p)
        val qrLeft = w - QR_QUIET - qrSize
        drawQr(p, item.id, qrLeft, QR_QUIET, qrSize)

        val condensed = Typeface.create("sans-serif-condensed", Typeface.BOLD)
        val textWidth = qrLeft - MARGIN - QR_QUIET
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
        fit(mono, item.id, w - 2 * MARGIN, 34f, 18f)
        c.drawText(item.id, MARGIN.toFloat(), h - MARGIN - mono.fontMetrics.descent, mono)
        return p.bmp
    }

    private fun fit(p: Paint, text: String, maxWidth: Float, maxSize: Float, minSize: Float) {
        var size = maxSize
        p.textSize = size
        while (size > minSize && p.measureText(text) > maxWidth) {
            size -= 2f
            p.textSize = size
        }
    }

    /** Draws the QR in whole printer dots so every module prints the same size. */
    private fun drawQr(page: Page, text: String, left: Float, top: Float, size: Float) {
        val hints = mapOf(EncodeHintType.MARGIN to 0, EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M)
        val m = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, 0, 0, hints)
        val dots = (size * page.k).toInt()
        val module = maxOf(1, dots / m.width)
        val offset = (dots - module * m.width) / 2
        val x0 = (left * page.k).toInt() + offset
        val y0 = (top * page.k).toInt() + offset
        val p = Paint().apply { color = Color.BLACK }
        val c = page.c
        c.save()
        c.scale(1 / page.k, 1 / page.k)
        for (y in 0 until m.height) for (x in 0 until m.width) {
            if (m[x, y]) {
                val l = (x0 + x * module).toFloat()
                val t = (y0 + y * module).toFloat()
                c.drawRect(l, t, l + module, t + module, p)
            }
        }
        c.restore()
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

    /** The label as it will print; also used for the preview in Settings. */
    fun bitmap(spec: LabelSpec, setup: Tspl.Setup): Bitmap = when (spec) {
        is LabelSpec.Roll -> render(spec.item, setup)
        is LabelSpec.Remainder -> renderRemainder(spec.item, setup)
        is LabelSpec.CustomerCut -> renderCustomer(spec, setup)
    }

    fun tsplJob(spec: LabelSpec, setup: Tspl.Setup): ByteArray {
        val bmp = bitmap(spec, setup)
        return Tspl.job(toBlack(bmp), bmp.width, bmp.height, setup).also { bmp.recycle() }
    }

    private fun condensed() = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.BLACK
        typeface = Typeface.create("sans-serif-condensed", Typeface.BOLD)
    }

    private fun mono() = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.BLACK
        typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
    }

    /**
     * Customer label for a cut piece. The top three fifths is the customer's name, wrapped and
     * shrunk to fit. Then a rule, colour code with size on the left and the length on the right,
     * and a small footer with the invoice number, date and cut reference. No QR.
     */
    fun renderCustomer(spec: LabelSpec.CustomerCut, setup: Tspl.Setup): Bitmap {
        val p = page(setup)
        val c = p.c
        val w = p.w
        val h = p.h
        val inner = w - 2 * MARGIN

        val name = condensed()
        val nameTop = MARGIN.toFloat()
        val nameBottom = h * 0.60f
        val (size, lines) = TextWrap.fit(
            spec.customer.ifBlank { "—" }, inner, nameBottom - nameTop, 3, 120f, 26f, 1.08f,
        ) { text, sz -> name.textSize = sz; name.measureText(text) }
        name.textSize = size
        var y = nameTop - name.fontMetrics.ascent * 0.95f
        lines.forEach { line ->
            c.drawText(line, MARGIN.toFloat(), y, name)
            y += size * 1.08f
        }

        val ruleY = nameBottom + 6f
        c.drawRect(MARGIN.toFloat(), ruleY, w - MARGIN, ruleY + 3f, Paint().apply { color = Color.BLACK })

        val length = condensed()
        val lengthText = Format.qtyUnit(spec.length, spec.unit)
        fit(length, lengthText, inner * 0.45f, 56f, 28f)
        length.textAlign = Paint.Align.RIGHT
        val lineBaseline = ruleY + 10f - length.fontMetrics.ascent
        c.drawText(lengthText, w - MARGIN, lineBaseline, length)

        val codeText = listOf(spec.code, Format.size(spec.size)).filter { it.isNotBlank() }.joinToString(" · ")
        val code = condensed()
        fit(code, codeText, inner - length.measureText(lengthText) - 16f, 44f, 18f)
        c.drawText(codeText, MARGIN.toFloat(), lineBaseline, code)

        val foot = mono().apply { textSize = 20f }
        val footY = h - MARGIN - foot.fontMetrics.descent
        if (spec.invoice.isNotBlank()) c.drawText(spec.invoice, MARGIN.toFloat(), footY, foot)
        foot.textAlign = Paint.Align.RIGHT
        c.drawText("${Format.date(spec.at)} · ${spec.ref}", w - MARGIN, footY, foot)
        return p.bmp
    }

    /**
     * Remainder label for an open roll: OPEN on a black band, code and size, metres left large,
     * "left of 120 m", the same QR and ID as the roll so scanning keeps working.
     */
    fun renderRemainder(item: Item, setup: Tspl.Setup): Bitmap {
        val p = page(setup)
        val c = p.c
        val w = p.w
        val h = p.h
        val qrSize = qrSide(p)
        val qrLeft = w - QR_QUIET - qrSize
        drawQr(p, item.id, qrLeft, QR_QUIET, qrSize)
        val textWidth = qrLeft - MARGIN - QR_QUIET

        val tag = condensed().apply { textSize = 40f }
        val tagW = tag.measureText("OPEN") + 16f
        val tagH = tag.fontMetrics.descent - tag.fontMetrics.ascent
        c.drawRect(MARGIN.toFloat(), MARGIN.toFloat(), MARGIN + tagW, MARGIN + tagH, Paint().apply { color = Color.BLACK })
        tag.color = Color.WHITE
        c.drawText("OPEN", MARGIN + 8f, MARGIN - tag.fontMetrics.ascent, tag)

        val line = condensed()
        val codeText = listOf(item.code, Format.size(item.size)).filter { it.isNotBlank() }.joinToString(" · ")
        fit(line, codeText, textWidth, 40f, 18f)
        var y = MARGIN + tagH + 6f - line.fontMetrics.ascent
        c.drawText(codeText, MARGIN.toFloat(), y, line)

        val big = condensed()
        val left = Format.qtyUnit(item.remaining, item.unit)
        fit(big, left, textWidth, 84f, 30f)
        y += 4f - big.fontMetrics.ascent
        c.drawText(left, MARGIN.toFloat(), y, big)

        val of = condensed().apply { textSize = 28f }
        y += 4f - of.fontMetrics.ascent
        c.drawText("left of ${Format.qtyUnit(item.qty, item.unit)}", MARGIN.toFloat(), y, of)

        val id = mono()
        fit(id, item.id, w - 2 * MARGIN, 34f, 18f)
        c.drawText(item.id, MARGIN.toFloat(), h - MARGIN - id.fontMetrics.descent, id)
        return p.bmp
    }
}
