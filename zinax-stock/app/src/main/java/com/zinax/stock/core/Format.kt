package com.zinax.stock.core

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToLong

object Format {
    /** 120.0 -> "120", 12.5 -> "12.5", 0.333 -> "0.33". */
    fun qty(value: Double): String {
        val rounded = (value * 100).roundToLong() / 100.0
        return if (abs(rounded - rounded.roundToLong()) < 1e-9) {
            rounded.roundToLong().toString()
        } else {
            String.format(Locale.US, "%.2f", rounded).trimEnd('0').trimEnd('.')
        }
    }

    fun qtyUnit(value: Double, unit: String): String = "${qty(value)} $unit"

    /** "0.30*1400" -> "0.30 × 1400" for display and labels. */
    fun size(raw: String): String =
        raw.trim().replace(Regex("\\s*[*xX×]\\s*"), " × ")

    fun date(millis: Long): String =
        SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(millis))

    fun dateTime(millis: Long): String =
        SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US).format(Date(millis))

    /** Cell text such as "101.0" or " 101 " -> "101". */
    fun code(raw: String): String {
        val t = raw.trim()
        return if (Regex("^\\d+\\.0+$").matches(t)) t.substringBefore('.') else t
    }

    fun number(raw: String?): Double? =
        raw?.trim()?.replace(",", "")?.takeIf { it.isNotEmpty() }?.toDoubleOrNull()
}
