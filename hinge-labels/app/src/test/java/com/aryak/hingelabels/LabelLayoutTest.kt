package com.aryak.hingelabels

import com.aryak.hingelabels.label.Align
import com.aryak.hingelabels.label.HingeLabel
import com.aryak.hingelabels.label.LabelLayout
import com.aryak.hingelabels.label.LabelOp
import com.aryak.hingelabels.label.Measure
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LabelLayoutTest {
    /** Every character is 0.6 of the font size wide, like a bold sans font. */
    private val measure = Measure { text, size -> text.length * size * 0.6f }

    private val base = HingeLabel(
        brand = "ZINEB MARKET", product = "HINGES", type = "A", model = "3D CLIP ON",
        ss = false, qty = 200, unit = HingeLabel.PCS,
    )

    private fun texts(ops: List<LabelOp>) = ops.filterIsInstance<LabelOp.Text>()
    private fun text(ops: List<LabelOp>, s: String) = texts(ops).firstOrNull { it.text == s }

    @Test
    fun ssBarOnlyForStainlessSteel() {
        val plain = LabelLayout.layout(base, measure)
        val ss = LabelLayout.layout(base.copy(ss = true), measure)

        assertNull(text(plain, "SS"))
        assertTrue(plain.none { it is LabelOp.Fill && it.top == LabelLayout.SS_TOP })

        val bar = ss.filterIsInstance<LabelOp.Fill>().single { it.top == LabelLayout.SS_TOP }
        assertEquals(LabelLayout.SS_BOTTOM, bar.bottom)
        val ssText = text(ss, "SS")!!
        assertTrue(ssText.white)
        assertTrue(ssText.centerY > bar.top && ssText.centerY < bar.bottom)
    }

    @Test
    fun modelSitsLowerWithoutTheSsBar() {
        val plain = text(LabelLayout.layout(base, measure), "3D CLIP ON")!!
        val ss = text(LabelLayout.layout(base.copy(ss = true), measure), "3D CLIP ON")!!
        assertEquals(LabelLayout.MODEL_Y_PLAIN, plain.centerY)
        assertEquals(LabelLayout.MODEL_Y_SS, ss.centerY)
        // With the bar, the model text stays above it.
        assertTrue(ss.centerY + ss.size / 2 < LabelLayout.SS_TOP)
    }

    @Test
    fun shortBrandUsesTheBiggestSize() {
        val brand = text(LabelLayout.layout(base.copy(brand = "ZINEB"), measure), "ZINEB")!!
        assertEquals(LabelLayout.BRAND_MAX, brand.size)
        assertEquals(Align.CENTER, brand.align)
        assertEquals(LabelLayout.W / 2, brand.x)
    }

    @Test
    fun longBrandShrinksToFitTheMargins() {
        val name = "ZINEB MARKET HARDWARE TRADING"
        val brand = text(LabelLayout.layout(base.copy(brand = name), measure), name)!!
        assertTrue(brand.size < LabelLayout.BRAND_MAX)
        assertTrue(measure.width(name, brand.size) <= LabelLayout.W - 2 * LabelLayout.MARGIN)
        // One size bigger would no longer fit.
        assertTrue(measure.width(name, brand.size + 1) > LabelLayout.W - 2 * LabelLayout.MARGIN)
    }

    @Test
    fun longModelShrinksToFitBesideTheTypeBox() {
        val model = "3D CLIP ON SOFT CLOSE 110°"
        val t = text(LabelLayout.layout(base.copy(model = model), measure), model)!!
        assertTrue(t.size < LabelLayout.MODEL_MAX)
        val half = measure.width(model, t.size) / 2
        assertTrue(t.x - half >= LabelLayout.TYPE_RIGHT)
        assertTrue(t.x + half <= LabelLayout.W - LabelLayout.MARGIN)
    }

    @Test
    fun quantityBoxHoldsQuantityAndUnit() {
        val ops = LabelLayout.layout(base.copy(qty = 50, unit = HingeLabel.PAIRS), measure)
        val qty = text(ops, "QTY: 50 PAIRS")
        assertNotNull(qty)
        val box = ops.filterIsInstance<LabelOp.Box>().single { it.top == LabelLayout.QTY_TOP }
        assertEquals(LabelLayout.W - LabelLayout.MARGIN, box.right)
        val half = measure.width(qty!!.text, qty.size) / 2
        assertTrue(qty.x - half > box.left && qty.x + half < box.right)
        // The product stays left of the box.
        val product = text(ops, "HINGES")!!
        assertEquals(Align.LEFT, product.align)
        assertTrue(product.x + measure.width("HINGES", product.size) < box.left)
    }

    @Test
    fun typeLetterInItsBox() {
        val ops = LabelLayout.layout(base.copy(type = "C"), measure)
        val box = ops.filterIsInstance<LabelOp.Box>().single { it.top == LabelLayout.TYPE_TOP }
        val letter = text(ops, "C")!!
        val caption = text(ops, "TYPE")!!
        assertFalse(caption.bold)
        assertEquals(LabelLayout.TYPE_MAX, letter.size)
        assertTrue(letter.centerY > caption.centerY)
        assertTrue(letter.centerY in box.top..box.bottom)
    }

    @Test
    fun blankBrandPrintsNoBrandText() {
        val ops = LabelLayout.layout(base.copy(brand = "  "), measure)
        assertTrue(texts(ops).none { it.centerY == LabelLayout.BRAND_Y })
    }

    @Test
    fun fitNeverGoesBelowTheMinimum() {
        assertEquals(12f, LabelLayout.fit("X".repeat(500), 100f, 40f, 12f, measure))
        assertEquals(40f, LabelLayout.fit("X", 100f, 40f, 12f, measure))
    }

    @Test
    fun baseSizeNeedsNoScaling() {
        val t = LabelLayout.transform(464, 312)
        assertEquals(1f, t.scale, 0.0001f)
        assertEquals(0f, t.dx, 0.0001f)
        assertEquals(0f, t.dy, 0.0001f)
    }

    @Test
    fun widerLabelIsCentredAtTheSameScale() {
        // 100 × 50 mm: limited by height, extra width split on both sides.
        val t = LabelLayout.transform(800, 400)
        assertEquals(400f / 312f, t.scale, 0.0001f)
        assertEquals(0f, t.dy, 0.001f)
        assertEquals((800f / t.scale - 464f) / 2f, t.dx, 0.001f)
        assertTrue(t.dx > 0)
    }
}
