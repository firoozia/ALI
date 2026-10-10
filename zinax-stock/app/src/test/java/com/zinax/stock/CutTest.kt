package com.zinax.stock

import com.zinax.stock.core.CustomerNames
import com.zinax.stock.core.CutCandidate
import com.zinax.stock.core.CutPlan
import com.zinax.stock.core.Lengths
import com.zinax.stock.core.OutReport
import com.zinax.stock.core.OutSource
import com.zinax.stock.core.TextWrap
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CutTest {

    @Test
    fun lengthsParseMetresAndCentimetres() {
        assertEquals(12.5, Lengths.parse("12.5", cm = false)!!, 1e-9)
        assertEquals(12.5, Lengths.parse("12,5", cm = false)!!, 1e-9)
        assertEquals(1.255, Lengths.parse("125.5", cm = true)!!, 1e-9)
        assertEquals(3.0, Lengths.parse("۳", cm = false)!!, 1e-9)
        assertEquals(2.5, Lengths.parse("٢٫٥", cm = false)!!, 1e-9)
        assertNull(Lengths.parse("", cm = false))
        assertNull(Lengths.parse("0", cm = false))
        assertNull(Lengths.parse("-2", cm = false))
        assertNull(Lengths.parse("abc", cm = false))
    }

    @Test
    fun lengthsShowKeepsMillimetres() {
        assertEquals("3", Lengths.show(3.0, cm = false))
        assertEquals("300", Lengths.show(3.0, cm = true))
        assertEquals("1.255", Lengths.show(1.255, cm = false))
        assertEquals("125.5", Lengths.show(1.255, cm = true))
        assertEquals(1.255, Lengths.parse(Lengths.show(Lengths.parse("125.5", true)!!, false), false)!!, 1e-9)
    }

    @Test
    fun customerNamesMatchAcrossSpellings() {
        assertEquals(CustomerNames.key("  Ali   Rezaei "), CustomerNames.key("ali rezaei"))
        assertEquals(CustomerNames.key("علي"), CustomerNames.key("علی"))
        assertEquals(CustomerNames.key("كاشي"), CustomerNames.key("کاشی"))
        assertEquals("Ali Rezaei", CustomerNames.clean("  Ali   Rezaei "))
    }

    @Test
    fun customerSuggestionsStartsThenWords() {
        val names = listOf("Bahar Design", "Ali Rezaei", "Alborz Co", "Tehran Ali Shop", "Mehdi")
        assertEquals(listOf("Alborz Co", "Ali Rezaei", "Tehran Ali Shop"), CustomerNames.suggest(names, "al"))
        assertEquals(emptyList<String>(), CustomerNames.suggest(names, ""))
        // An exact, already-tidy match needs no suggestion.
        assertEquals(emptyList<String>(), CustomerNames.suggest(names, "Mehdi"))
    }

    @Test
    fun cutPlanPrefersSmallestOpenRoll() {
        val rolls = listOf(
            CutCandidate("A1", 120.0, 120.0, 1),
            CutCandidate("A2", 40.0, 120.0, 2),
            CutCandidate("A3", 8.0, 100.0, 3),
            CutCandidate("A0", 100.0, 100.0, 0),
        )
        assertEquals(listOf("A3", "A2", "A0", "A1"), CutPlan.order(rolls).map { it.id })
        assertEquals("A3", CutPlan.best(rolls, 5.0)!!.id)
        assertEquals("A2", CutPlan.best(rolls, 30.0)!!.id)
        assertEquals("A0", CutPlan.best(rolls, 90.0)!!.id)
        assertEquals("A1", CutPlan.best(rolls, 110.0)!!.id)
        assertNull(CutPlan.best(rolls, 500.0))
    }

    @Test
    fun shortEnd() {
        assertEquals(0.0, CutPlan.left(10.0, 10.0), 0.0)
        assertEquals(2.0, CutPlan.left(12.0, 10.0), 1e-9)
        assertTrue(CutPlan.leavesShortEnd(12.0, 10.0, 3.0))
        assertFalse(CutPlan.leavesShortEnd(13.0, 10.0, 3.0))
        assertFalse(CutPlan.leavesShortEnd(10.0, 10.0, 3.0))
        assertFalse(CutPlan.leavesShortEnd(12.0, 10.0, 0.0))
    }

    @Test
    fun wrapBreaksWordsAndLongNames() {
        val measure: (String) -> Float = { it.length.toFloat() }
        assertEquals(listOf("Ali", "Rezaei"), TextWrap.wrap("Ali Rezaei", 6f, measure))
        assertEquals(listOf("Ali Rezaei"), TextWrap.wrap("Ali   Rezaei", 10f, measure))
        assertEquals(listOf("ABCD", "EFGH", "IJ"), TextWrap.wrap("ABCDEFGHIJ", 4f, measure))
    }

    @Test
    fun fitShrinksUntilNameFits() {
        // Width of a character equals the font size / 2.
        val at: (String, Float) -> Float = { t, size -> t.length * size / 2 }
        val (big, oneLine) = TextWrap.fit("Ali", 400f, 200f, 3, 120f, 26f, 1.1f, at)
        assertEquals(120f, big)
        assertEquals(listOf("Ali"), oneLine)
        val (size, lines) = TextWrap.fit("Mohammad Hossein Rezaei Trading Company", 400f, 180f, 3, 120f, 26f, 1.1f, at)
        assertTrue(size < 120f)
        assertTrue(lines.size <= 3)
        assertTrue(lines.all { at(it, size) <= 400f })
    }

    @Test
    fun customerLinesGroupSpellings() {
        fun cut(customer: String, qty: Double, invoice: String, code: String, user: String) =
            OutSource("ZX-1", null, code, "", "m", qty, 100.0, customer, 0, "A", user, "CUT", "id", customer, invoice)
        val lines = OutReport.customerLines(
            listOf(
                cut("Ali Rezaei", 10.0, "F-12", "101", "Sara"),
                cut("ali  rezaei", 5.5, "F-13", "102", "Reza"),
                cut("Bahar", 3.0, "", "101", "Sara"),
                cut("", 1.0, "", "103", "Sara"),
            )
        )
        assertEquals(listOf("Ali Rezaei", "Bahar", "No customer"), lines.map { it.customer })
        assertEquals(2, lines[0].cuts)
        assertEquals("15.5 m", lines[0].totalText)
        assertEquals(listOf("F-12", "F-13"), lines[0].invoices)
        assertEquals(listOf("101", "102"), lines[0].codes)
        assertEquals(listOf("Sara", "Reza"), lines[0].users)
    }
}
