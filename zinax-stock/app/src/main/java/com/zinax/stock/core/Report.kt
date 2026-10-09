package com.zinax.stock.core

/** One row of the stock list: all in-stock packages with the same code and size. */
data class StockLine(
    val category: Category,
    val code: String,
    val size: String,
    val unit: String,
    val packs: Int,
    val total: Double,
)

data class CheckLine(
    val code: String,
    val size: String,
    val unit: String,
    val expected: Int,
    val labelled: Int,
) {
    val missing get() = expected - labelled
}

object Report {
    fun stockLines(items: List<StockSource>): List<StockLine> =
        items.groupBy { Triple(it.category, it.code, it.size) to it.unit }
            .map { (key, list) ->
                StockLine(key.first.first, key.first.second, key.first.third, key.second, list.size, list.sumOf { it.remaining })
            }
            .sortedWith(compareBy<StockLine>({ it.category.ordinal }, { codeSortKey(it.code) }, { it.code }, { it.size }))

    /** Numeric codes sort as numbers (9 before 101). */
    fun codeSortKey(code: String): Long = code.toLongOrNull() ?: Long.MAX_VALUE

    fun stockText(lines: List<StockLine>, nowMillis: Long): String = buildString {
        append("*Zinax Stock* · ${Format.dateTime(nowMillis)}\n")
        if (lines.isEmpty()) {
            append("\nNo stock.")
            return@buildString
        }
        lines.groupBy { it.category }.forEach { (category, rows) ->
            append("\n*${category.label}*\n")
            rows.forEach { l ->
                val size = if (l.size.isBlank()) "" else " (${Format.size(l.size)})"
                append("${l.code}$size: ${l.packs} ${plural(category.pack, l.packs)}, ${Format.qtyUnit(l.total, l.unit)}\n")
            }
            val totals = rows.groupBy { it.unit }.map { (u, r) -> Format.qtyUnit(r.sumOf { it.total }, u) }
            append("Total: ${rows.sumOf { it.packs }} ${plural(category.pack, 2)}, ${totals.joinToString(", ")}\n")
        }
    }

    fun checkText(shipment: String, lines: List<CheckLine>, extras: List<CheckLine>, nowMillis: Long): String = buildString {
        val expected = lines.sumOf { it.expected }
        val labelled = lines.sumOf { it.labelled }
        append("*Zinax shipment check* · $shipment · ${Format.dateTime(nowMillis)}\n")
        append("Labelled $labelled of $expected\n")
        val missing = lines.filter { it.missing > 0 }
        if (missing.isEmpty() && extras.isEmpty()) {
            append("All items labelled. Shipment complete.\n")
        }
        if (missing.isNotEmpty()) {
            append("\n*Missing*\n")
            missing.forEach { append("${it.code} ${Format.size(it.size)}: ${it.missing} of ${it.expected}\n") }
        }
        if (extras.isNotEmpty()) {
            append("\n*Not on the list*\n")
            extras.forEach { append("${it.code} ${Format.size(it.size)}: ${it.labelled}\n") }
        }
    }

    fun plural(word: String, n: Int) = if (n == 1) word else word + "s"
}

/** The fields of an in-stock item the report needs. */
data class StockSource(
    val category: Category,
    val code: String,
    val size: String,
    val unit: String,
    val remaining: Double,
)
