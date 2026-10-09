package com.zinax.stock.importer

import com.zinax.stock.core.Category
import com.zinax.stock.core.Format

/** One package expected in a shipment: one row of the packing list, one label. */
data class ParsedUnit(
    val pallet: String,
    val lineNo: Int,
    val category: Category,
    val code: String,
    val size: String,
    val qty: Double,
    val unit: String,
    val netKg: Double?,
    val grossKg: Double?,
)

data class ParseResult(
    val units: List<ParsedUnit>,
    val format: String,
    val warnings: List<String>,
) {
    val pallets: List<String> get() = units.map { it.pallet }.distinct()
    val codes: List<String> get() = units.map { it.code }.distinct()
    val sizes: List<String> get() = units.map { it.size }.filter { it.isNotBlank() }.distinct()
    val totalsByUnit: Map<String, Double> get() = units.groupBy { it.unit }.mapValues { e -> e.value.sumOf { it.qty } }
}

/**
 * Reads two layouts:
 *
 * 1. The supplier packing list: one block per pallet. A cell with the pallet number,
 *    a header row "NO. | Item no. | Size(MM) | Roll | N.W (kg) | G.W(kg)", a "Meter(M)" sub-header,
 *    one row per roll, then a "Total" row. Extra columns (Chinese copies, prices) are ignored.
 *
 * 2. A simple table for other goods, with a header row naming columns:
 *    Pallet, Category, Code, Size, Qty, Unit, Packs. Code and Qty are required.
 *    Each row creates [Packs] labels (default 1), each holding Qty in Unit.
 */
object PackingListParser {

    fun parse(rows: List<List<String>>, defaultCategory: Category): ParseResult {
        val simpleHeader = rows.indexOfFirst { isSimpleHeader(it) }
        val supplierHeader = rows.indexOfFirst { supplierColumns(it) != null }
        return when {
            simpleHeader >= 0 && (supplierHeader < 0 || simpleHeader < supplierHeader) ->
                parseSimple(rows, simpleHeader, defaultCategory)
            supplierHeader >= 0 -> parseSupplier(rows, defaultCategory)
            else -> ParseResult(emptyList(), "unknown", listOf("No header row found. Expected \"NO. / Item no.\" or \"Code / Qty\"."))
        }
    }

    private fun norm(s: String) = s.trim().lowercase()

    // ---------- supplier packing list ----------

    private data class Cols(val no: Int, val code: Int, val size: Int, val qty: Int, val net: Int, val gross: Int) {
        val first get() = listOf(no, code, size, qty, net, gross).filter { it >= 0 }.min()
        val last get() = listOf(no, code, size, qty, net, gross).filter { it >= 0 }.max()
    }

    private fun supplierColumns(row: List<String>): Cols? {
        val no = row.indexOfFirst { norm(it) == "no." || norm(it) == "no" }
        if (no < 0) return null
        val code = row.indexOfFirst { norm(it).startsWith("item no") || norm(it) == "item" || norm(it) == "code" }
        if (code < 0 || code < no || code - no > 3) return null
        fun find(pred: (String) -> Boolean): Int =
            (code + 1 until minOf(row.size, code + 8)).firstOrNull { pred(norm(row[it])) } ?: -1
        val size = find { it.startsWith("size") || it.startsWith("spec") }
        val qty = find { it == "roll" || it.startsWith("meter") || it.startsWith("qty") || it.startsWith("quantity") }
        val net = find { it.startsWith("n.w") || it.startsWith("nw") || it.contains("net") }
        val gross = find { it.startsWith("g.w") || it.startsWith("gw") || it.contains("gross") }
        if (qty < 0) return null
        return Cols(no, code, size, qty, net, gross)
    }

    private fun parseSupplier(rows: List<List<String>>, category: Category): ParseResult {
        val warnings = ArrayList<String>()
        val units = ArrayList<ParsedUnit>()
        var emptyBlocks = 0
        var blockIndex = 0
        var r = 0
        while (r < rows.size) {
            val cols = supplierColumns(rows[r])
            if (cols == null) { r++; continue }
            blockIndex++
            val pallet = palletAbove(rows, r, cols) ?: blockIndex.toString()
            // Unit comes from the header or the sub-header under it ("Meter(M)").
            val unitHint = listOfNotNull(rows.getOrNull(r + 1)?.getOrNull(cols.qty), rows[r][cols.qty])
                .joinToString(" ") { norm(it) }
            val unit = when {
                "meter" in unitHint || "(m)" in unitHint -> "m"
                "kg" in unitHint -> "kg"
                "pcs" in unitHint || "pc" in unitHint -> "pcs"
                else -> category.unit
            }
            var line = 0
            var end = r + 1
            while (end < rows.size) {
                val row = rows[end]
                if (supplierColumns(row)?.no == cols.no) break
                if ((cols.first..cols.last).any { norm(row.getOrNull(it) ?: "").startsWith("total") }) { end++; break }
                val no = Format.number(row.getOrNull(cols.no))
                val code = Format.code(row.getOrNull(cols.code) ?: "")
                if (no != null && code.isNotEmpty()) {
                    val qty = Format.number(row.getOrNull(cols.qty))
                    if (qty == null || qty <= 0) {
                        warnings.add("Pallet $pallet, row ${end + 1}: code $code has no quantity and was skipped.")
                    } else {
                        line++
                        units.add(
                            ParsedUnit(
                                pallet = pallet,
                                lineNo = line,
                                category = category,
                                code = code,
                                size = if (cols.size >= 0) row.getOrNull(cols.size)?.trim().orEmpty() else "",
                                qty = qty,
                                unit = unit,
                                netKg = if (cols.net >= 0) Format.number(row.getOrNull(cols.net)) else null,
                                grossKg = if (cols.gross >= 0) Format.number(row.getOrNull(cols.gross)) else null,
                            )
                        )
                    }
                }
                end++
            }
            if (line == 0) emptyBlocks++
            r = end
        }
        if (emptyBlocks > 0) warnings.add(0, "Ignored $emptyBlocks empty pallet block(s).")
        addConsistencyWarnings(units, warnings)
        return ParseResult(units, "supplier packing list", warnings)
    }

    /** The pallet number sits alone in the NO. column a row or two above the header. */
    private fun palletAbove(rows: List<List<String>>, header: Int, cols: Cols): String? {
        for (r in header - 1 downTo maxOf(0, header - 3)) {
            val row = rows[r]
            val value = row.getOrNull(cols.no)?.trim().orEmpty()
            val others = (cols.first..cols.last).filter { it != cols.no }.any { (row.getOrNull(it) ?: "").isNotBlank() }
            if (value.isNotEmpty() && !others) return Format.code(value)
            if (value.isNotEmpty() || others) return null
        }
        return null
    }

    // ---------- simple table ----------

    private fun isSimpleHeader(row: List<String>): Boolean {
        val n = row.map { norm(it) }
        return n.any { it == "code" } && n.any { it == "qty" || it == "quantity" }
    }

    private fun parseSimple(rows: List<List<String>>, header: Int, defaultCategory: Category): ParseResult {
        val h = rows[header].map { norm(it) }
        fun col(vararg names: String) = h.indexOfFirst { it in names }
        val cPallet = col("pallet", "pallet no", "pallet no.")
        val cCategory = col("category", "type")
        val cCode = col("code")
        val cSize = col("size", "model", "spec")
        val cQty = col("qty", "quantity")
        val cUnit = col("unit")
        val cPacks = col("packs", "count", "labels", "cartons", "rolls")
        val cNet = col("net kg", "n.w", "net")
        val cGross = col("gross kg", "g.w", "gross")
        val warnings = ArrayList<String>()
        val units = ArrayList<ParsedUnit>()
        val lines = HashMap<String, Int>()
        for (r in header + 1 until rows.size) {
            val row = rows[r]
            val code = Format.code(row.getOrNull(cCode) ?: "")
            if (code.isEmpty()) continue
            val qty = Format.number(row.getOrNull(cQty))
            if (qty == null || qty <= 0) {
                warnings.add("Row ${r + 1}: code $code has no quantity and was skipped.")
                continue
            }
            val category = (if (cCategory >= 0) Category.parse(row[cCategory]) else null) ?: defaultCategory
            val unit = (if (cUnit >= 0) row[cUnit].trim().lowercase() else "").ifEmpty { category.unit }
            val packs = (if (cPacks >= 0) Format.number(row[cPacks])?.toInt() else null) ?: 1
            val pallet = (if (cPallet >= 0) Format.code(row[cPallet]) else "").ifEmpty { "1" }
            repeat(packs.coerceIn(1, 10_000)) {
                val n = (lines[pallet] ?: 0) + 1
                lines[pallet] = n
                units.add(
                    ParsedUnit(
                        pallet = pallet,
                        lineNo = n,
                        category = category,
                        code = code,
                        size = if (cSize >= 0) row[cSize].trim() else "",
                        qty = qty,
                        unit = unit,
                        netKg = if (cNet >= 0) Format.number(row[cNet]) else null,
                        grossKg = if (cGross >= 0) Format.number(row[cGross]) else null,
                    )
                )
            }
        }
        addConsistencyWarnings(units, warnings)
        return ParseResult(units, "simple table", warnings)
    }

    private fun addConsistencyWarnings(units: List<ParsedUnit>, warnings: MutableList<String>) {
        units.groupBy { it.code }.forEach { (code, list) ->
            val sizes = list.map { it.size }.distinct()
            if (sizes.size > 1) warnings.add("Code $code appears with ${sizes.size} sizes: ${sizes.joinToString(", ")}. Labels show the size, so check them.")
        }
        val split = units.groupBy { it.code }.filter { e -> e.value.map { it.pallet }.distinct().size > 1 }.keys
        if (split.isNotEmpty()) warnings.add("Codes on more than one pallet: ${split.joinToString(", ")}. Totals are checked across the whole shipment.")
    }
}
