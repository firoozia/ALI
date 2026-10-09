package com.zinax.stock.core

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Label IDs look like ZX-251009-A0007:
 * ZX, the Gregorian print date (yyMMdd), the device code and a daily sequence.
 * The device code keeps IDs unique when several phones print on the same day.
 */
object LabelId {
    private val PATTERN = Regex("^ZX-(\\d{6})-([A-Z]{1,2})(\\d{4,})$")

    fun datePart(millis: Long): String = SimpleDateFormat("yyMMdd", Locale.US).format(Date(millis))

    fun prefix(datePart: String, device: String): String = "ZX-$datePart-$device"

    fun make(datePart: String, device: String, seq: Int): String =
        prefix(datePart, device) + seq.toString().padStart(4, '0')

    /** Sequence number of an ID, or null when the ID is not ours. */
    fun sequence(id: String): Int? = PATTERN.matchEntire(id)?.groupValues?.get(3)?.toIntOrNull()

    fun isValid(id: String): Boolean = PATTERN.matches(id)

    /** Scanners and keyboards may add spaces or lower case. */
    fun normalize(input: String): String = input.trim().uppercase().replace(" ", "")

    fun cleanDeviceCode(input: String): String =
        input.uppercase().filter { it in 'A'..'Z' }.take(2).ifEmpty { "A" }
}
