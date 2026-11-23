package com.aryak.hingelabels.label

/** What one box sticker shows. All text is printed as given; the screen upper-cases it. */
data class HingeLabel(
    val brand: String,
    val product: String,
    val type: String,
    val model: String,
    /** Stainless steel: prints the black SS bar under the model. */
    val ss: Boolean,
    val qty: Int,
    /** "PCS" or "PAIRS". */
    val unit: String,
) {
    val qtyText: String get() = "QTY: $qty $unit"

    companion object {
        const val PCS = "PCS"
        const val PAIRS = "PAIRS"
        val UNITS = listOf(PCS, PAIRS)
    }
}
