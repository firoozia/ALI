package com.zinax.stock.core

/**
 * A product group. Each label is one package as it arrives from China (a roll, a gallon, a bag or a
 * carton) and carries a quantity in [unit]. The seven built-in groups always exist; admins can rename
 * them and add their own groups, which reach this class through [update].
 */
class Category private constructor(
    /** Stored on every label, e.g. "PVC" or "G_MDF". Never changes. */
    val name: String,
    val label: String,
    val unit: String,
    val pack: String,
    /** Sort position in lists and reports. */
    val ordinal: Int,
    val hidden: Boolean = false,
) {
    override fun equals(other: Any?) = other is Category && other.name == name
    override fun hashCode() = name.hashCode()
    override fun toString() = name

    /** A group as stored in the Groups table and sheet tab. */
    data class Row(val id: String, val name: String, val unit: String, val pack: String, val order: Int, val hidden: Boolean)

    companion object {
        val PVC = Category("PVC", "PVC film", "m", "roll", 0)
        val EDGE_BANDING = Category("EDGE_BANDING", "Edge banding", "m", "roll", 1)
        val VACUUM_GLUE = Category("VACUUM_GLUE", "Vacuum glue", "kg", "gallon", 2)
        val EDGE_GLUE = Category("EDGE_GLUE", "Edge banding glue", "kg", "bag", 3)
        val HINGE = Category("HINGE", "Hinge", "pcs", "carton", 4)
        val RAIL = Category("RAIL", "Rail", "pcs", "carton", 5)
        val OTHER = Category("OTHER", "Other", "pcs", "pack", 6)

        val builtIns: List<Category> = listOf(PVC, EDGE_BANDING, VACUUM_GLUE, EDGE_GLUE, HINGE, RAIL, OTHER)

        @Volatile private var all: Map<String, Category> = builtIns.associateBy { it.name }

        /** Groups to offer when choosing: built-in and added ones, without removed ones, in order. */
        val entries: List<Category> get() = all.values.filter { !it.hidden }.sortedWith(compareBy({ it.ordinal }, { it.label }))

        /** Every known group, removed ones included, in order. */
        val everything: List<Category> get() = all.values.sortedWith(compareBy({ it.ordinal }, { it.label }))

        /** Replaces the added groups and the names of built-in ones with the [rows] from the Groups table. */
        fun update(rows: List<Row>) {
            val map = LinkedHashMap<String, Category>()
            builtIns.forEach { map[it.name] = it }
            rows.forEach { r ->
                val base = map[r.id]
                map[r.id] = Category(
                    r.id,
                    r.name.ifBlank { base?.label ?: r.id },
                    r.unit.ifBlank { base?.unit ?: "pcs" },
                    r.pack.ifBlank { base?.pack ?: "pack" },
                    r.order,
                    r.hidden && r.id != OTHER.name,
                )
            }
            all = map
        }

        /** The group stored as [name] on a label; an unknown ID shows as itself until the groups sync. */
        fun fromName(name: String?): Category {
            if (name.isNullOrBlank()) return OTHER
            return all[name] ?: Category(name, name.removePrefix("G_").replace('_', ' '), "pcs", "pack", 999)
        }

        /** Best-effort match for free text from a spreadsheet cell. */
        fun parse(text: String?): Category? {
            if (text.isNullOrBlank()) return null
            val t = text.lowercase().replace(Regex("[^a-z0-9]"), "")
            all.values.firstOrNull { it.name.lowercase().replace(Regex("[^a-z0-9]"), "") == t }?.let { return it }
            all.values.firstOrNull { it.label.lowercase().replace(Regex("[^a-z0-9]"), "") == t }?.let { return it }
            return when {
                "edge" in t && "glue" in t -> EDGE_GLUE
                "hotmelt" in t -> EDGE_GLUE
                "vacuum" in t || "vaccum" in t -> VACUUM_GLUE
                "edge" in t || "band" in t -> EDGE_BANDING
                "pvc" in t || "film" in t || "foil" in t -> PVC
                "hinge" in t -> HINGE
                "rail" in t || "slide" in t || "runner" in t -> RAIL
                "glue" in t -> VACUUM_GLUE
                else -> null
            }
        }

        /** ID for a new group named [label], e.g. "G_MDF_BOARD". */
        fun newId(label: String): String =
            "G_" + label.trim().uppercase().replace(Regex("[^A-Z0-9]+"), "_").trim('_').ifEmpty { "GROUP" }.take(24)
    }
}
