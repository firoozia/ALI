package com.zinax.stock.data

import android.content.Context
import com.zinax.stock.core.LabelId
import com.zinax.stock.label.Tspl
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** App settings. [changes] ticks on every write so screens can refresh. */
class Prefs(context: Context) {
    private val sp = context.getSharedPreferences("zinax", Context.MODE_PRIVATE)
    private val _changes = MutableStateFlow(0)
    val changes: StateFlow<Int> = _changes

    private fun edit(block: android.content.SharedPreferences.Editor.() -> Unit) {
        sp.edit().apply(block).apply()
        _changes.value++
    }

    var deviceCode: String
        get() = sp.getString("deviceCode", "A") ?: "A"
        set(v) = edit { putString("deviceCode", LabelId.cleanDeviceCode(v)) }

    var printerAddress: String?
        get() = sp.getString("printerAddress", null)
        set(v) = edit { putString("printerAddress", v) }

    var printerName: String?
        get() = sp.getString("printerName", null)
        set(v) = edit { putString("printerName", v) }

    var direction: Int
        get() = sp.getInt("direction", 1)
        set(v) = edit { putInt("direction", v) }

    var invert: Boolean
        get() = sp.getBoolean("invert", false)
        set(v) = edit { putBoolean("invert", v) }

    var gapMm: Float
        get() = sp.getFloat("gapMm", 2f)
        set(v) = edit { putFloat("gapMm", v) }

    var density: Int
        get() = sp.getInt("density", 8)
        set(v) = edit { putInt("density", v) }

    val tspl: Tspl.Setup
        get() = Tspl.Setup(gapMm = gapMm.toDouble(), direction = direction, density = density, invert = invert)

    var webAppUrl: String
        get() = sp.getString("webAppUrl", "") ?: ""
        set(v) = edit { putString("webAppUrl", v.trim()) }

    var token: String
        get() = sp.getString("token", "") ?: ""
        set(v) = edit { putString("token", v.trim()) }

    var sheetUrl: String
        get() = sp.getString("sheetUrl", "") ?: ""
        set(v) = edit { putString("sheetUrl", v.trim()) }

    /** Server time of the last successful sync; rows changed after it are pulled next time. */
    var lastServerSync: Long
        get() = sp.getLong("lastServerSync", 0)
        set(v) = edit { putLong("lastServerSync", v) }

    /** False until this phone has pulled the full movement history once (ship-outs from other phones). */
    var movementsBackfilled: Boolean
        get() = sp.getBoolean("movementsBackfilled", false)
        set(v) = edit { putBoolean("movementsBackfilled", v) }

    var lastSyncMessage: String
        get() = sp.getString("lastSyncMessage", "Not synced yet") ?: ""
        set(v) = edit { putString("lastSyncMessage", v) }

    var reportEnabled: Boolean
        get() = sp.getBoolean("reportEnabled", false)
        set(v) = edit { putBoolean("reportEnabled", v) }

    var reportHour: Int
        get() = sp.getInt("reportHour", 17)
        set(v) = edit { putInt("reportHour", v.coerceIn(0, 23)) }

    /** Send the stock report as an Excel file instead of a text message. */
    var reportAsExcel: Boolean
        get() = sp.getBoolean("reportAsExcel", true)
        set(v) = edit { putBoolean("reportAsExcel", v) }

    var reportMinute: Int
        get() = sp.getInt("reportMinute", 0)
        set(v) = edit { putInt("reportMinute", v.coerceIn(0, 59)) }

    /** Places goods are kept, in the order shown on the location buttons. */
    var locations: List<String>
        get() = sp.getString("locations", null)?.split("\n")?.filter { it.isNotBlank() }
            ?: listOf("Warehouse 1", "Warehouse 2", "Showroom")
        set(v) = edit { putString("locations", v.map { it.trim() }.filter { it.isNotBlank() }.distinct().joinToString("\n")) }

    /** Location given to labels printed on Receive and Print by hand; empty means none. */
    var currentLocation: String
        get() = sp.getString("currentLocation", "") ?: ""
        set(v) = edit { putString("currentLocation", v.trim()) }

    val syncConfigured: Boolean get() = webAppUrl.startsWith("https://") && token.isNotBlank()
}
