package com.zinax.stock.data

import com.zinax.stock.core.Category
import com.zinax.stock.core.Format
import org.json.JSONObject

/** A correction to labels: each field is the new value, or null to leave it as it is. */
data class ItemEdit(
    val category: String? = null,
    val code: String? = null,
    val size: String? = null,
    val unit: String? = null,
) {
    /** Only the fields that differ from [item]; null when nothing would change. */
    fun against(item: Item): ItemEdit? {
        val e = ItemEdit(
            category?.takeIf { it != item.category },
            code?.trim()?.takeIf { it.isNotEmpty() && it != item.code },
            size?.trim()?.takeIf { it != item.size },
            unit?.trim()?.takeIf { it.isNotEmpty() && it != item.unit },
        )
        return e.takeIf { it.category != null || it.code != null || it.size != null || it.unit != null }
    }

    fun applyTo(item: Item): Item = item.copy(
        category = category ?: item.category,
        code = code ?: item.code,
        size = size ?: item.size,
        unit = unit ?: item.unit,
    )

    /** "Category PVC film → Edge banding · Size 0.30*1400 → 0.40*1400" for the log and the request. */
    fun describe(item: Item): String = listOfNotNull(
        category?.let { "Category ${Category.fromName(item.category).label} → ${Category.fromName(it).label}" },
        code?.let { "Code ${item.code} → $it" },
        size?.let { "Size ${Format.size(item.size).ifBlank { "—" }} → ${Format.size(it).ifBlank { "—" }}" },
        unit?.let { "Unit ${item.unit} → $it" },
    ).joinToString(" · ")

    /** Code, size or unit are printed on the label, so a change needs a new label. */
    val changesLabel: Boolean get() = code != null || size != null || unit != null

    fun toJson(): String = JSONObject().apply {
        category?.let { put("category", it) }
        code?.let { put("code", it) }
        size?.let { put("size", it) }
        unit?.let { put("unit", it) }
    }.toString()

    companion object {
        fun fromJson(text: String): ItemEdit {
            val o = JSONObject(text.ifBlank { "{}" })
            fun opt(k: String) = if (o.has(k)) o.optString(k) else null
            return ItemEdit(opt("category"), opt("code"), opt("size"), opt("unit"))
        }
    }
}
