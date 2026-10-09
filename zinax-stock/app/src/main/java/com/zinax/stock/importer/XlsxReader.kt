package com.zinax.stock.importer

import org.xml.sax.Attributes
import org.xml.sax.helpers.DefaultHandler
import java.io.ByteArrayInputStream
import java.io.InputStream
import java.util.zip.ZipInputStream
import javax.xml.parsers.SAXParserFactory

/** One worksheet as a dense grid of cell text. rows[r][c] is "" for an empty cell. */
data class Sheet(val name: String, val rows: List<List<String>>)

/**
 * Minimal .xlsx reader: unzips the workbook and reads cell values with SAX.
 * Merged cells keep their value in the top-left cell only, which is what the parser expects.
 */
object XlsxReader {
    private const val MAX_COLUMNS = 400

    fun read(input: InputStream): List<Sheet> {
        val entries = HashMap<String, ByteArray>()
        ZipInputStream(input).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                if (!entry.isDirectory && (entry.name.endsWith(".xml") || entry.name.endsWith(".rels"))) {
                    entries[entry.name.removePrefix("/")] = zip.readBytes()
                }
            }
        }
        val shared = entries["xl/sharedStrings.xml"]?.let { parseSharedStrings(it) } ?: emptyList()
        val sheets = sheetPaths(entries)
        return sheets.mapNotNull { (name, path) ->
            entries[path]?.let { Sheet(name, parseSheet(it, shared)) }
        }
    }

    private fun sax(bytes: ByteArray, handler: DefaultHandler) {
        val factory = SAXParserFactory.newInstance()
        factory.isNamespaceAware = false
        factory.newSAXParser().parse(ByteArrayInputStream(bytes), handler)
    }

    private fun local(qName: String) = qName.substringAfter(':')

    /** Sheet names and paths in workbook order. */
    private fun sheetPaths(entries: Map<String, ByteArray>): List<Pair<String, String>> {
        val rels = HashMap<String, String>()
        entries["xl/_rels/workbook.xml.rels"]?.let { bytes ->
            sax(bytes, object : DefaultHandler() {
                override fun startElement(uri: String?, ln: String?, qName: String, a: Attributes) {
                    if (local(qName) == "Relationship") {
                        val id = a.getValue("Id") ?: return
                        var target = a.getValue("Target") ?: return
                        target = if (target.startsWith("/")) target.removePrefix("/") else "xl/$target"
                        rels[id] = target
                    }
                }
            })
        }
        val result = ArrayList<Pair<String, String>>()
        entries["xl/workbook.xml"]?.let { bytes ->
            sax(bytes, object : DefaultHandler() {
                override fun startElement(uri: String?, ln: String?, qName: String, a: Attributes) {
                    if (local(qName) == "sheet") {
                        val name = a.getValue("name") ?: "Sheet"
                        val rid = (0 until a.length).firstOrNull { local(a.getQName(it)) == "id" && a.getQName(it).contains(':') }
                            ?.let { a.getValue(it) }
                        val path = rid?.let { rels[it] }
                        if (path != null) result.add(name to path)
                    }
                }
            })
        }
        if (result.isEmpty()) {
            entries.keys.filter { it.startsWith("xl/worksheets/sheet") && it.endsWith(".xml") }
                .sorted().forEachIndexed { i, p -> result.add("Sheet${i + 1}" to p) }
        }
        return result
    }

    private fun parseSharedStrings(bytes: ByteArray): List<String> {
        val out = ArrayList<String>()
        sax(bytes, object : DefaultHandler() {
            val sb = StringBuilder()
            var inSi = false
            var inT = false
            var inPhonetic = false
            override fun startElement(uri: String?, ln: String?, qName: String, a: Attributes) {
                when (local(qName)) {
                    "si" -> { inSi = true; sb.setLength(0) }
                    "t" -> inT = inSi && !inPhonetic
                    "rPh" -> inPhonetic = true
                }
            }
            override fun endElement(uri: String?, ln: String?, qName: String) {
                when (local(qName)) {
                    "si" -> { out.add(sb.toString()); inSi = false }
                    "t" -> inT = false
                    "rPh" -> inPhonetic = false
                }
            }
            override fun characters(ch: CharArray, start: Int, length: Int) {
                if (inT) sb.appendRange(ch, start, start + length)
            }
        })
        return out
    }

    private fun parseSheet(bytes: ByteArray, shared: List<String>): List<List<String>> {
        val cells = HashMap<Int, HashMap<Int, String>>()
        var maxRow = -1
        var maxCol = -1
        sax(bytes, object : DefaultHandler() {
            var rowIndex = -1
            var nextCol = 0
            var col = 0
            var type: String? = null
            var inValue = false
            val sb = StringBuilder()

            override fun startElement(uri: String?, ln: String?, qName: String, a: Attributes) {
                when (local(qName)) {
                    "row" -> {
                        rowIndex = a.getValue("r")?.toIntOrNull()?.minus(1) ?: (rowIndex + 1)
                        nextCol = 0
                    }
                    "c" -> {
                        col = a.getValue("r")?.let { columnIndex(it) } ?: nextCol
                        nextCol = col + 1
                        type = a.getValue("t")
                        sb.setLength(0)
                    }
                    "v", "t" -> inValue = true
                }
            }

            override fun endElement(uri: String?, ln: String?, qName: String) {
                when (local(qName)) {
                    "v", "t" -> inValue = false
                    "c" -> {
                        val raw = sb.toString()
                        val value = when (type) {
                            "s" -> raw.trim().toIntOrNull()?.let { shared.getOrNull(it) } ?: ""
                            "b" -> if (raw.trim() == "1") "TRUE" else "FALSE"
                            else -> cleanNumber(raw)
                        }
                        if (value.isNotBlank() && col < MAX_COLUMNS && rowIndex >= 0) {
                            cells.getOrPut(rowIndex) { HashMap() }[col] = value
                            if (rowIndex > maxRow) maxRow = rowIndex
                            if (col > maxCol) maxCol = col
                        }
                    }
                }
            }

            override fun characters(ch: CharArray, start: Int, length: Int) {
                if (inValue) sb.appendRange(ch, start, start + length)
            }
        })
        val width = maxCol + 1
        return (0..maxRow).map { r ->
            val row = cells[r]
            if (row == null) List(width) { "" } else List(width) { c -> row[c] ?: "" }
        }
    }

    /** "B12" -> 1 */
    fun columnIndex(ref: String): Int {
        var n = 0
        for (ch in ref) {
            if (ch in 'A'..'Z') n = n * 26 + (ch - 'A' + 1)
            else if (ch in 'a'..'z') n = n * 26 + (ch - 'a' + 1)
            else break
        }
        return n - 1
    }

    /** Excel stores 0.3 as "0.29999999999999999"; round floating noise away. */
    private fun cleanNumber(raw: String): String {
        val t = raw.trim()
        if (!Regex("^-?\\d+\\.\\d{10,}(E-?\\d+)?$").matches(t)) return raw
        val d = t.toDoubleOrNull() ?: return raw
        return java.math.BigDecimal(d).round(java.math.MathContext(12)).stripTrailingZeros().toPlainString()
    }
}

object CsvReader {
    fun read(text: String): List<List<String>> {
        val lines = text.removePrefix("﻿").lines()
        val first = lines.firstOrNull { it.isNotBlank() } ?: return emptyList()
        val sep = listOf('\t', ';', ',').maxBy { c -> first.count { it == c } }
        val rows = ArrayList<List<String>>()
        val cur = ArrayList<String>()
        val field = StringBuilder()
        var quoted = false
        var i = 0
        val s = lines.joinToString("\n")
        while (i < s.length) {
            val ch = s[i]
            if (quoted) {
                if (ch == '"' && i + 1 < s.length && s[i + 1] == '"') { field.append('"'); i++ }
                else if (ch == '"') quoted = false
                else field.append(ch)
            } else when (ch) {
                '"' -> quoted = true
                sep -> { cur.add(field.toString()); field.setLength(0) }
                '\n' -> { cur.add(field.toString()); field.setLength(0); rows.add(ArrayList(cur)); cur.clear() }
                '\r' -> {}
                else -> field.append(ch)
            }
            i++
        }
        if (field.isNotEmpty() || cur.isNotEmpty()) { cur.add(field.toString()); rows.add(ArrayList(cur)) }
        val width = rows.maxOfOrNull { it.size } ?: 0
        return rows.map { r -> List(width) { c -> r.getOrNull(c)?.trim() ?: "" } }
    }
}
