package com.zinax.stock

import com.zinax.stock.core.Pin
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PinTest {
    @Test
    fun validPins() {
        assertTrue(Pin.valid("1234"))
        assertTrue(Pin.valid("123456"))
        assertFalse(Pin.valid("123"))
        assertFalse(Pin.valid("1234567"))
        assertFalse(Pin.valid("12a4"))
    }

    @Test
    fun hashMatchesOnlyTheSamePinAndSalt() {
        val salt = Pin.newSalt()
        assertEquals(32, salt.length)
        val h = Pin.hash("2580", salt)
        assertEquals(64, h.length)
        assertTrue(Pin.matches("2580", salt, h))
        assertFalse(Pin.matches("2581", salt, h))
        assertFalse(Pin.matches("2580", Pin.newSalt(), h))
        assertFalse(Pin.matches("2580", salt, ""))
        assertNotEquals(h, Pin.hash("2580", Pin.newSalt()))
    }
}
