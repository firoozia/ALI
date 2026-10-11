package com.zinax.stock

import com.zinax.stock.core.Units
import org.junit.Assert.assertEquals
import org.junit.Test

class UnitsTest {
    @Test
    fun oneSpellingPerUnit() {
        assertEquals("m", Units.normalize("M"))
        assertEquals("m", Units.normalize(" mtr "))
        assertEquals("m", Units.normalize("Meters"))
        assertEquals("kg", Units.normalize("KGS"))
        assertEquals("pcs", Units.normalize("Pc."))
        assertEquals("pcs", Units.normalize("PCS"))
        assertEquals("box", Units.normalize("Box"))
    }
}
