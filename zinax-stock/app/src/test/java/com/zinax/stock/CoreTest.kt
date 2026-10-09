package com.zinax.stock

import com.zinax.stock.core.Category
import com.zinax.stock.core.Format
import com.zinax.stock.core.ItemRow
import com.zinax.stock.core.LabelId
import com.zinax.stock.core.Report
import com.zinax.stock.core.StockSource
import com.zinax.stock.core.XlsxWriter
import com.zinax.stock.importer.CsvReader
import com.zinax.stock.importer.PackingListParser
import com.zinax.stock.importer.XlsxReader
import com.zinax.stock.label.Tspl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CoreTest {

    /** Same layout as the supplier packing list: columns B..G, Chinese copy from column I. */
    private fun supplierRows(): List<List<String>> {
        fun row(vararg cells: Pair<Int, String>): List<String> {
            val r = MutableList(17) { "" }
            cells.forEach { (c, v) -> r[c] = v }
            return r
        }
        val header = row(1 to "NO.", 2 to "Item no.", 3 to "Size(MM)", 4 to "Roll", 5 to "N.W (kg)", 6 to "G.W(kg) ", 8 to "序号", 9 to "型号")
        val sub = row(4 to "Meter(M)", 8 to "NO.", 9 to "Item No.", 10 to "Size/mm", 11 to "ROLL", 16 to "Total Amount ")
        return listOf(
            row(1 to "1", 8 to "写客户型号"),
            header, sub,
            row(1 to "1", 2 to "101", 3 to "0.30*1400", 4 to "120", 5 to "64", 6 to "67", 8 to "1"),
            row(1 to "2", 2 to "101", 3 to "0.30*1400", 4 to "120", 5 to "64", 6 to "67", 8 to "2"),
            row(1 to "3", 2 to "102", 3 to "0.30*1400", 4 to "100", 5 to "51", 6 to "54"),
            row(3 to "Total", 4 to "340"),
            row(1 to "2"),
            header.toMutableList().also { for (i in 8..16) it[i] = "" },
            row(4 to "Meter(M)"),
            row(1 to "1", 2 to "102", 3 to "0.30*1400", 4 to "120", 5 to "63", 6 to "66"),
            row(1 to "2", 2 to "505", 3 to "0.35*1400", 4 to "134", 5 to "87", 6 to "90"),
            row(3 to "Total", 4 to "254"),
            row(1 to "S"),
            header.toMutableList().also { for (i in 8..16) it[i] = "" },
            row(4 to "Meter(M)"),
            row(1 to "1", 6 to "3"),
            row(1 to "2", 6 to "3"),
            row(3 to "Total", 6 to "6"),
        )
    }

    @Test
    fun parsesSupplierPackingList() {
        val result = PackingListParser.parse(supplierRows(), Category.PVC)
        assertEquals("supplier packing list", result.format)
        assertEquals(5, result.units.size)
        assertEquals(listOf("1", "2"), result.pallets)
        val first = result.units.first()
        assertEquals("101", first.code)
        assertEquals("0.30*1400", first.size)
        assertEquals(120.0, first.qty, 0.0)
        assertEquals("m", first.unit)
        assertEquals(64.0, first.netKg!!, 0.0)
        assertEquals(67.0, first.grossKg!!, 0.0)
        assertEquals(100.0, result.units[2].qty, 0.0)
        assertEquals("2", result.units[3].pallet)
        assertEquals(1, result.units[3].lineNo)
        assertEquals(594.0, result.totalsByUnit["m"]!!, 0.0)
        assertTrue(result.warnings.any { it.startsWith("Ignored 1 empty") })
        assertTrue(result.warnings.any { it.contains("more than one pallet: 102") })
    }

    @Test
    fun parsesSimpleTable() {
        val csv = """
            Pallet,Category,Code,Size,Qty,Unit,Packs
            1,Hinge,H-110,Soft close,200,pcs,3
            1,Vacuum glue,VG-1,Gallon,20,kg,2
            2,,R-450,450mm,10,,1
        """.trimIndent()
        val result = PackingListParser.parse(CsvReader.read(csv), Category.RAIL)
        assertEquals("simple table", result.format)
        assertEquals(6, result.units.size)
        assertEquals(Category.HINGE, result.units[0].category)
        assertEquals(Category.VACUUM_GLUE, result.units[3].category)
        assertEquals("kg", result.units[3].unit)
        assertEquals(Category.RAIL, result.units[5].category)
        assertEquals("pcs", result.units[5].unit)
        assertEquals(5, result.units[4].lineNo)
    }

    @Test
    fun labelIds() {
        val id = LabelId.make("251009", "A", 7)
        assertEquals("ZX-251009-A0007", id)
        assertEquals(7, LabelId.sequence(id))
        assertNull(LabelId.sequence("ZX-1"))
        assertEquals("ZX-251009-A0007", LabelId.normalize(" zx-251009-a0007 "))
        assertEquals("B", LabelId.cleanDeviceCode("b1"))
    }

    @Test
    fun formats() {
        assertEquals("120", Format.qty(120.0))
        assertEquals("12.5", Format.qty(12.5))
        assertEquals("0.30 × 1400", Format.size("0.30*1400"))
        assertEquals("101", Format.code("101.0"))
        assertEquals(Category.EDGE_GLUE, Category.parse("Edge banding glue"))
        assertEquals(Category.EDGE_BANDING, Category.parse("edge banding"))
    }

    @Test
    fun tsplBitmapUsesZeroForBlack() {
        val s = Tspl.Setup()
        val black = BooleanArray(16) { it < 8 } // 16x1: first 8 dots black
        val job = Tspl.job(black, 16, 1, s)
        val text = String(job, Charsets.ISO_8859_1)
        assertTrue(text.startsWith("SIZE 58 mm,39 mm\r\nGAP 2.0 mm,0 mm\r\n"))
        val dataStart = text.indexOf("BITMAP 0,0,2,1,0,") + "BITMAP 0,0,2,1,0,".length
        assertEquals(0x00, job[dataStart].toInt() and 0xFF)
        assertEquals(0xFF, job[dataStart + 1].toInt() and 0xFF)
        assertTrue(text.endsWith("PRINT 1,1\r\n"))
    }

    @Test
    fun excelReportRoundTrip() {
        val lines = Report.stockLines(listOf(StockSource(Category.PVC, "101", "0.30*1400", "m", 120.0)))
        val rows = listOf(ItemRow("ZX-261009-A0001", Category.PVC, "101", "0.30*1400", 120.0, 120.0, "m", "1", "A-04 <top>", 0))
        val bytes = XlsxWriter.write(Report.stockWorkbook(lines, rows, 0))
        val sheets = XlsxReader.read(bytes.inputStream())
        assertEquals(listOf("Stock", "Items"), sheets.map { it.name })
        assertEquals("Packages", sheets[0].rows[0][4])
        assertEquals("101", sheets[0].rows[1][1])
        assertEquals("0.30 × 1400", sheets[0].rows[1][2])
        assertEquals("120", sheets[0].rows[1][5])
        assertEquals("Total", sheets[0].rows[2][0])
        assertEquals("ZX-261009-A0001", sheets[1].rows[1][0])
        assertEquals("A-04 <top>", sheets[1].rows[1][8])
        assertEquals("AA", XlsxWriter.columnName(26))
    }

    @Test
    fun stockReport() {
        val lines = Report.stockLines(
            listOf(
                StockSource(Category.PVC, "101", "0.30*1400", "m", 120.0),
                StockSource(Category.PVC, "101", "0.30*1400", "m", 80.0),
                StockSource(Category.PVC, "9", "0.30*1400", "m", 120.0),
                StockSource(Category.HINGE, "H-110", "", "pcs", 200.0),
            )
        )
        assertEquals("9", lines[0].code)
        assertEquals(2, lines[1].packs)
        assertEquals(200.0, lines[1].total, 0.0)
        val text = Report.stockText(lines, 0)
        assertTrue(text.contains("101 (0.30 × 1400): 2 rolls, 200 m"))
        assertTrue(text.contains("H-110: 1 carton, 200 pcs"))
    }
}
