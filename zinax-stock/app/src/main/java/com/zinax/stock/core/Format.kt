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

    /** Local midnight at the start of the day containing [millis]. */
    fun dayStart(millis: Long): Long = java.util.Calendar.getInstance().apply {
        timeInMillis = millis
        set(java.util.Calendar.HOUR_OF_DAY, 0)
        set(java.util.Calendar.MINUTE, 0)
        set(java.util.Calendar.SECOND, 0)
        set(java.util.Calendar.MILLISECOND, 0)
    }.timeInMillis

    /** Start of the day [days] after the day starting at [dayStart]; safe across daylight-saving changes. */
    fun addDays(dayStart: Long, days: Int): Long = java.util.Calendar.getInstance().apply {
        timeInMillis = dayStart
        add(java.util.Calendar.DAY_OF_MONTH, days)
    }.timeInMillis

    /** First day of the month containing the day starting at [dayStart]. */
    fun monthStart(dayStart: Long): Long = java.util.Calendar.getInstance().apply {
        timeInMillis = dayStart
        set(java.util.Calendar.DAY_OF_MONTH, 1)
    }.timeInMillis

    /** Date pickers work in UTC midnights; these convert to and from local day starts. */
    fun utcDateToLocalDay(utcMillis: Long): Long {
        val utc = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("UTC")).apply { timeInMillis = utcMillis }
        return java.util.Calendar.getInstance().apply {
            clear()
            set(utc.get(java.util.Calendar.YEAR), utc.get(java.util.Calendar.MONTH), utc.get(java.util.Calendar.DAY_OF_MONTH))
        }.timeInMillis
    }

    fun localDayToUtcDate(dayStart: Long): Long {
        val local = java.util.Calendar.getInstance().apply { timeInMillis = dayStart }
        return java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("UTC")).apply {
            clear()
            set(local.get(java.util.Calendar.YEAR), local.get(java.util.Calendar.MONTH), local.get(java.util.Calendar.DAY_OF_MONTH))
        }.timeInMillis
    }

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
