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

    /** Workbook sent to WhatsApp: a summary sheet and one row per package. */
    fun stockWorkbook(lines: List<StockLine>, items: List<ItemRow>, nowMillis: Long): List<XlsxWriter.SheetData> {
        val stock = ArrayList<List<Any?>>()
        stock.add(listOf("Category", "Code", "Size", "Unit", "Packages", "Total", "", "Updated ${Format.dateTime(nowMillis)}"))
        lines.forEach { stock.add(listOf(it.category.label, it.code, Format.size(it.size), it.unit, it.packs, it.total)) }
        lines.groupBy { it.unit }.forEach { (unit, rows) ->
            stock.add(listOf("Total", "", "", unit, rows.sumOf { it.packs }, rows.sumOf { it.total }))
        }
        val detail = ArrayList<List<Any?>>()
        detail.add(listOf("ID", "Category", "Code", "Size", "Remaining", "Of", "Unit", "Pallet", "Location", "Received"))
        items.sortedWith(compareBy<ItemRow>({ it.category.ordinal }, { codeSortKey(it.code) }, { it.code }, { it.receivedAt }))
            .forEach {
                detail.add(
                    listOf(
                        it.id, it.category.label, it.code, Format.size(it.size), it.remaining, it.qty, it.unit,
                        it.pallet.orEmpty(), it.location, Format.date(it.receivedAt),
                    )
                )
            }
        val byPlace = ArrayList<List<Any?>>()
        byPlace.add(listOf("Location", "Category", "Code", "Size", "Unit", "Packages", "Total"))
        items.groupBy { listOf(it.location.ifBlank { "No location" }, it.category.name, it.code, it.size, it.unit) }
            .entries
            .sortedWith(compareBy({ it.key[0] == "No location" }, { it.key[0] }, { it.value.first().category.ordinal }, { codeSortKey(it.key[2]) }, { it.key[2] }))
            .forEach { (k, list) ->
                byPlace.add(listOf(k[0], list.first().category.label, k[2], Format.size(k[3]), k[4], list.size, list.sumOf { it.remaining }))
            }
        return listOf(
            XlsxWriter.SheetData("Stock", stock, listOf(18, 12, 16, 7, 10, 10, 2, 24)),
            XlsxWriter.SheetData("By location", byPlace, listOf(22, 18, 12, 16, 7, 10, 10)),
            XlsxWriter.SheetData("Items", detail, listOf(18, 18, 12, 16, 10, 8, 7, 8, 12, 12)),
        )
    }
}

/** One in-stock package for the Excel report. */
data class ItemRow(
    val id: String,
    val category: Category,
    val code: String,
    val size: String,
    val remaining: Double,
    val qty: Double,
    val unit: String,
    val pallet: String?,
    val location: String,
    val receivedAt: Long,
)

/** The fields of an in-stock item the report needs. */
data class StockSource(
    val category: Category,
    val code: String,
    val size: String,
    val unit: String,
    val remaining: Double,
)
