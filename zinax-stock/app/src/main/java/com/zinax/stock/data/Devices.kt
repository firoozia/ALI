package com.zinax.stock.data

import org.json.JSONArray

/** A phone as the sheet last saw it. */
data class DeviceSync(val device: String, val user: String, val appVersion: String, val at: Long) {
    fun daysSince(now: Long) = ((now - at) / (24 * 3600 * 1000L)).toInt()
}

object Devices {
    /** Phones that have not synced for [days] or more, other than this one. */
    const val STALE_DAYS = 2

    fun parse(json: String): List<DeviceSync> = try {
        val arr = JSONArray(json)
        (0 until arr.length()).map { arr.getJSONObject(it) }
            .map { DeviceSync(it.optString("device"), it.optString("user"), it.optString("appVersion"), it.optLong("at")) }
            .filter { it.device.isNotBlank() && it.at > 0 }
            .sortedBy { it.device }
    } catch (_: Exception) {
        emptyList()
    }

    fun stale(all: List<DeviceSync>, thisDevice: String, now: Long) =
        all.filter { it.device != thisDevice && it.daysSince(now) >= STALE_DAYS }
}
