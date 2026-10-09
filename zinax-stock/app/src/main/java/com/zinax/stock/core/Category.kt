package com.zinax.stock.core

/**
 * Product families. Each label is one package as it arrives from China
 * (a roll, a gallon, a bag or a carton) and carries a quantity in [unit].
 */
enum class Category(val label: String, val unit: String, val pack: String) {
    PVC("PVC film", "m", "roll"),
    EDGE_BANDING("Edge banding", "m", "roll"),
    VACUUM_GLUE("Vacuum glue", "kg", "gallon"),
    EDGE_GLUE("Edge banding glue", "kg", "bag"),
    HINGE("Hinge", "pcs", "carton"),
    RAIL("Rail", "pcs", "carton"),
    OTHER("Other", "pcs", "pack");

    companion object {
        fun fromName(name: String?): Category =
            entries.firstOrNull { it.name == name } ?: OTHER

        /** Best-effort match for free text from a spreadsheet cell. */
        fun parse(text: String?): Category? {
            if (text.isNullOrBlank()) return null
            val t = text.lowercase().replace(Regex("[^a-z]"), "")
            entries.firstOrNull { it.name.lowercase().replace("_", "") == t }?.let { return it }
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
    }
}
