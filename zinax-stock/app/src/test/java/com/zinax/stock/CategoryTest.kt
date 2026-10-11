package com.zinax.stock

import com.zinax.stock.core.Category
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CategoryTest {
    @After
    fun reset() = Category.update(emptyList())

    @Test
    fun addedAndRenamedGroups() {
        Category.update(
            listOf(
                Category.Row("PVC", "PVC sheet", "m", "roll", 0, false),
                Category.Row("G_MDF_BOARD", "MDF board", "pcs", "sheet", 7, false),
                Category.Row("RAIL", "Rail", "pcs", "carton", 5, true),
            )
        )
        assertEquals("PVC sheet", Category.fromName("PVC").label)
        assertEquals(Category.PVC, Category.fromName("PVC"))
        val mdf = Category.fromName("G_MDF_BOARD")
        assertEquals("MDF board", mdf.label)
        assertEquals("sheet", mdf.pack)
        assertTrue(Category.entries.any { it.name == "G_MDF_BOARD" })
        assertFalse(Category.entries.any { it.name == "RAIL" })
        assertEquals("Rail", Category.fromName("RAIL").label)
        assertEquals(mdf, Category.parse("mdf board"))
        assertEquals(Category.EDGE_BANDING, Category.parse("edge banding"))
    }

    @Test
    fun unknownGroupShowsItsId() {
        assertEquals("HANDLE", Category.fromName("G_HANDLE").label)
        assertEquals(Category.OTHER, Category.fromName(""))
    }

    @Test
    fun newIds() {
        assertEquals("G_MDF_BOARD", Category.newId(" MDF board "))
        assertEquals("G_GROUP", Category.newId("!!!"))
    }
}
