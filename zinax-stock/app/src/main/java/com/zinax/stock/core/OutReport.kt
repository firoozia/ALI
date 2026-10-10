package com.zinax.stock.core

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Kinds of stock change a report can show. */
enum class Activity(val type: String, val title: String, val verb: String) {
    OUT("OUT", "Ship-outs", "shipped"),
    IN("IN", "Received", "received"),
    VOID("VOID", "Deleted", "deleted"),
    MOVE("MOVE", "Moved", "moved"),
}

/** One stock change, with what the package held when it was labelled. */
data class OutSource(
    val itemId: String,
    val category: Category?,
    val code: String,
    val size: String,
    val unit: String,
    val qty: Double,
    /** Full amount of the package, when known; a ship-out below it is a cut. */
    val packQty: Double?,
    val reference: String,
    val at: Long,
    val device: String,
    val user: String = "",
    val type: String = Activity.OUT.type,
)

/** Changes of one code and size in the report period. */
data class OutLine(
    val category: Category?,
    val code: String,
    val size: String,
    val unit: String,
    /** Distinct packages touched. */
    val packs: Int,
    /** Ship-outs that took only part of a package. */
    val cuts: Int,
    val total: Double,
    val references: List<String>,
    val users: List<String>,
)

object OutReport {
    private const val EPS = 1e-6

    fun isCut(o: OutSource) = o.type == Activity.OUT.type && o.packQty != null && o.qty < o.packQty - EPS

    fun who(o: OutSource) = o.user.ifBlank { "phone ${o.device}" }

    fun lines(outs: List<OutSource>): List<OutLine> =
        outs.groupBy { listOf(it.code, it.size, it.unit) }
            .map { (k, list) ->
                OutLine(
                    category = list.firstNotNullOfOrNull { it.category },
                    code = k[0], size = k[1], unit = k[2],
                    packs = list.map { it.itemId }.distinct().size,
                    cuts = list.count { isCut(it) },
                    total = list.sumOf { it.qty },
                    references = list.map { it.reference.trim() }.filter { it.isNotEmpty() }.distinct(),
                    users = list.map { who(it) }.distinct(),
                )
            }
            .sortedWith(compareBy<OutLine>({ it.category?.ordinal ?: Int.MAX_VALUE }, { Report.codeSortKey(it.code) }, { it.code }, { it.size }))

    private fun packWord(line: OutLine, n: Int) = Report.plural(line.category?.pack ?: "pack", n)

    fun lineSummary(l: OutLine): String = buildString {
        append("${l.packs} ${packWord(l, l.packs)}")
        if (l.cuts > 0) append(" (${l.cuts} cut)")
        append(", ${Format.qtyUnit(l.total, l.unit)}")
    }

    /** "2026-10-10" for one day, "2026-10-01 → 2026-10-10" for a range; [to] is the exclusive end. */
    fun period(from: Long, to: Long): String {
        val last = Format.addDays(to, -1)
        return if (Format.date(from) == Format.date(last)) Format.date(from) else "${Format.date(from)} → ${Format.date(last)}"
    }

    fun text(activity: Activity, period: String, outs: List<OutSource>): String = buildString {
        append("*Zinax ${activity.title.lowercase()}* · $period\n")
        val lines = lines(outs)
        if (lines.isEmpty()) {
            append("\nNothing ${activity.verb}.")
            return@buildString
        }
        lines.groupBy { it.category }.forEach { (category, rows) ->
            append("\n*${category?.label ?: "Other"}*\n")
            rows.forEach { l ->
                val size = if (l.size.isBlank()) "" else " (${Format.size(l.size)})"
                append("${l.code}$size: ${lineSummary(l)}")
                if (activity == Activity.OUT && l.references.isNotEmpty()) append(" → ${l.references.joinToString(", ")}")
                append(" · by ${l.users.joinToString(", ")}")
                append("\n")
            }
        }
        append("\nTotal: ")
        append(lines.groupBy { it.unit }.map { (u, r) -> Format.qtyUnit(r.sumOf { it.total }, u) }.joinToString(", "))
        append(" · ${outs.map { it.itemId }.distinct().size} packages\n")
    }

    private fun dateTime(ms: Long) = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US).format(Date(ms))

    fun summarySheet(name: String, outs: List<OutSource>): XlsxWriter.SheetData {
        val rows = ArrayList<List<Any?>>()
        rows.add(listOf("Category", "Code", "Size", "Unit", "Packages", "Cuts", "Total", "Customer / note", "By"))
        val lines = lines(outs)
        lines.forEach {
            rows.add(
                listOf(
                    it.category?.label.orEmpty(), it.code, Format.size(it.size), it.unit, it.packs, it.cuts, it.total,
                    it.references.joinToString(", "), it.users.joinToString(", "),
                )
            )
        }
        lines.groupBy { it.unit }.forEach { (u, r) ->
            rows.add(listOf("Total", "", "", u, r.sumOf { it.packs }, r.sumOf { it.cuts }, r.sumOf { it.total }, "", ""))
        }
        return XlsxWriter.SheetData(name, rows, listOf(18, 12, 16, 7, 10, 7, 10, 28, 16))
    }

    fun workbook(activity: Activity, period: String, outs: List<OutSource>): List<XlsxWriter.SheetData> {
        val detail = ArrayList<List<Any?>>()
        detail.add(listOf("Date", "ID", "Category", "Code", "Size", "Qty", "Unit", "Whole / cut", "Customer / note", "User", "Phone"))
        outs.sortedBy { it.at }.forEach {
            detail.add(
                listOf(
                    dateTime(it.at), it.itemId, it.category?.label.orEmpty(), it.code, Format.size(it.size), it.qty, it.unit,
                    if (activity != Activity.OUT) "" else if (isCut(it)) "Cut" else "Whole",
                    it.reference, it.user, it.device,
                )
            )
        }
        return listOf(
            summarySheet("${activity.title} $period".take(31), outs),
            XlsxWriter.SheetData("Details", detail, listOf(17, 18, 18, 12, 16, 8, 7, 11, 24, 14, 7)),
        )
    }
}
