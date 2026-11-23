package com.aryak.hingelabels.data

import android.content.Context
import com.aryak.hingelabels.label.HingeLabel
import com.aryak.hingelabels.label.Tspl
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** Settings, choice lists and the last label. [changes] ticks on every write so screens can refresh. */
class Prefs(context: Context) {
    private val sp = context.getSharedPreferences("hinge", Context.MODE_PRIVATE)
    private val _changes = MutableStateFlow(0)
    val changes: StateFlow<Int> = _changes

    private fun edit(block: android.content.SharedPreferences.Editor.() -> Unit) {
        sp.edit().apply(block).apply()
        _changes.value++
    }

    private fun list(key: String, default: List<String>): List<String> =
        if (sp.contains(key)) Lists.decode(sp.getString(key, "")).ifEmpty { default } else default

    var brands: List<String>
        get() = list("brands", Lists.DEFAULT_BRANDS)
        set(v) = edit { putString("brands", Lists.encode(v)) }
    var products: List<String>
        get() = list("products", Lists.DEFAULT_PRODUCTS)
        set(v) = edit { putString("products", Lists.encode(v)) }
    var types: List<String>
        get() = list("types", Lists.DEFAULT_TYPES)
        set(v) = edit { putString("types", Lists.encode(v)) }
    var models: List<String>
        get() = list("models", Lists.DEFAULT_MODELS)
        set(v) = edit { putString("models", Lists.encode(v)) }

    /** The label on screen, remembered between launches. */
    var last: HingeLabel
        get() = HingeLabel(
            brand = sp.getString("lastBrand", null) ?: brands.first(),
            product = sp.getString("lastProduct", null) ?: products.first(),
            type = sp.getString("lastType", null) ?: types.first(),
            model = sp.getString("lastModel", null) ?: models.first(),
            ss = sp.getBoolean("lastSs", false),
            qty = sp.getInt("lastQty", 200),
            unit = sp.getString("lastUnit", null)?.takeIf { it in HingeLabel.UNITS } ?: HingeLabel.PCS,
        )
        set(v) = edit {
            putString("lastBrand", v.brand)
            putString("lastProduct", v.product)
            putString("lastType", v.type)
            putString("lastModel", v.model)
            putBoolean("lastSs", v.ss)
            putInt("lastQty", v.qty)
            putString("lastUnit", v.unit)
        }

    var copies: Int
        get() = sp.getInt("copies", 1)
        set(v) = edit { putInt("copies", v.coerceIn(1, MAX_COPIES)) }

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

    companion object {
        const val MAX_COPIES = 999
    }
}
