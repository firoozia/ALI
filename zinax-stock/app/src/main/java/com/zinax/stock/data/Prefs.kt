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

    /** Person using this phone; recorded on every receive, ship-out, move and delete. */
    var userName: String
        get() = sp.getString("userName", "") ?: ""
        set(v) = edit { putString("userName", v.trim()) }

    /** The user who last signed in here; the lock screen offers them first. */
    var lastUserId: String
        get() = sp.getString("lastUserId", "") ?: ""
        set(v) = edit { putString("lastUserId", v) }

    /** Whether that user is an admin, so this phone shows approval notifications while the app is closed. */
    var phoneUserIsAdmin: Boolean
        get() = sp.getBoolean("phoneUserIsAdmin", false)
        set(v) = edit { putBoolean("phoneUserIsAdmin", v) }

    /** Lock after this many minutes without a touch; 0 never locks for being idle. */
    var lockMinutes: Int
        get() = sp.getInt("lockMinutes", 10)
        set(v) = edit { putInt("lockMinutes", v.coerceIn(0, 240)) }

    /** Change number from the sheet at the last sync; a different number on a quick check means a sync is due. */
    var lastRev: String
        get() = sp.getString("lastRev", "") ?: ""
        set(v) = edit { putString("lastRev", v) }

    /** The place last chosen in Move by scan. */
    var moveTarget: String
        get() = sp.getString("moveTarget", "") ?: ""
        set(v) = edit { putString("moveTarget", v) }

    /** Lock whenever the app leaves the screen. */
    var lockOnLeave: Boolean
        get() = sp.getBoolean("lockOnLeave", true)
        set(v) = edit { putBoolean("lockOnLeave", v) }

    /** The user who may unlock this phone with a fingerprint or face; empty when off. */
    var biometricUserId: String
        get() = sp.getString("biometricUserId", "") ?: ""
        set(v) = edit { putString("biometricUserId", v) }

    /** Look of the app on this phone: "teal" (Theme 1) or "emerald" (Theme 2). */
    var appTheme: String
        get() = sp.getString("appTheme", "teal") ?: "teal"
        set(v) = edit { putString("appTheme", v) }

    /** The product catalog was filled once from the labels on this phone. */
    var catalogSeeded: Boolean
        get() = sp.getBoolean("catalogSeeded", false)
        set(v) = edit { putBoolean("catalogSeeded", v) }

    var askedNotifications: Boolean
        get() = sp.getBoolean("askedNotifications", false)
        set(v) = edit { putBoolean("askedNotifications", v) }

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

    /** Print speed in inches per second; slower prints darker and cleaner. */
    var speed: Int
        get() = sp.getInt("speed", 4)
        set(v) = edit { putInt("speed", v.coerceIn(Tspl.MIN_SPEED, Tspl.MAX_SPEED)) }

    /** Label size on the printer's roll, in millimetres. */
    var labelWidthMm: Int
        get() = sp.getInt("labelWidthMm", 58)
        set(v) = edit { putInt("labelWidthMm", v.coerceIn(Tspl.MIN_MM, Tspl.MAX_WIDTH_MM)) }

    var labelHeightMm: Int
        get() = sp.getInt("labelHeightMm", 39)
        set(v) = edit { putInt("labelHeightMm", v.coerceIn(Tspl.MIN_MM, Tspl.MAX_HEIGHT_MM)) }

    val tspl: Tspl.Setup
        get() = Tspl.Setup(
            widthMm = labelWidthMm, heightMm = labelHeightMm,
            gapMm = gapMm.toDouble(), direction = direction, density = density, speed = speed, invert = invert,
        )

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

    /** A cut leaving less than this many metres asks what to do with the end. */
    var shortEndMetres: Float
        get() = sp.getFloat("shortEndMetres", 3f)
        set(v) = edit { putFloat("shortEndMetres", v.coerceAtLeast(0f)) }

    /** Cut lengths typed in centimetres instead of metres. */
    var cutInCm: Boolean
        get() = sp.getBoolean("cutInCm", false)
        set(v) = edit { putBoolean("cutInCm", v) }

    val syncConfigured: Boolean get() = webAppUrl.startsWith("https://") && token.isNotBlank()
}
