package com.zinax.stock.label

import java.io.ByteArrayOutputStream
import java.util.Locale

/**
 * TSPL job for Xprinter label printers (XP-420B and similar, 203 dpi = 8 dots/mm).
 * The whole label is sent as one bitmap so any font prints correctly.
 */
object Tspl {
    data class Setup(
        val widthMm: Int = 58,
        val heightMm: Int = 39,
        val gapMm: Double = 2.0,
        val direction: Int = 1,
        val density: Int = 8,
        val speed: Int = 4,
        /** TSPL prints a dot for bit 0. Turn on if labels come out as negatives. */
        val invert: Boolean = false,
    )

    const val DOTS_PER_MM = 8

    fun widthDots(s: Setup) = s.widthMm * DOTS_PER_MM
    fun heightDots(s: Setup) = s.heightMm * DOTS_PER_MM

    /** [black] is row-major, true where a dot should be printed. */
    fun job(black: BooleanArray, width: Int, height: Int, s: Setup, copies: Int = 1): ByteArray {
        require(black.size == width * height) { "bitmap size mismatch" }
        val widthBytes = (width + 7) / 8
        val data = ByteArray(widthBytes * height)
        for (y in 0 until height) {
            for (xb in 0 until widthBytes) {
                var b = 0
                for (bit in 0 until 8) {
                    val x = xb * 8 + bit
                    val dot = x < width && black[y * width + x]
                    val one = if (s.invert) dot else !dot
                    if (one) b = b or (0x80 ushr bit)
                }
                data[y * widthBytes + xb] = b.toByte()
            }
        }
        val gap = String.format(Locale.US, "%.1f", s.gapMm)
        val head = buildString {
            append("SIZE ${s.widthMm} mm,${s.heightMm} mm\r\n")
            append("GAP $gap mm,0 mm\r\n")
            append("DIRECTION ${s.direction}\r\n")
            append("REFERENCE 0,0\r\n")
            append("DENSITY ${s.density}\r\n")
            append("SPEED ${s.speed}\r\n")
            append("CLS\r\n")
            append("BITMAP 0,0,$widthBytes,$height,0,")
        }
        val out = ByteArrayOutputStream(head.length + data.size + 32)
        out.write(head.toByteArray(Charsets.US_ASCII))
        out.write(data)
        out.write("\r\nPRINT 1,$copies\r\n".toByteArray(Charsets.US_ASCII))
        return out.toByteArray()
    }
}
