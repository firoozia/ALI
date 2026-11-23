package com.aryak.hingelabels

import com.aryak.hingelabels.label.Tspl
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TsplTest {
    private val setup = Tspl.Setup()

    private fun text(job: ByteArray) = String(job, Charsets.ISO_8859_1)

    @Test
    fun jobPrintsTheRequestedCopies() {
        val black = BooleanArray(16 * 2)
        assertTrue(text(Tspl.job(black, 16, 2, setup)).endsWith("PRINT 1,1\r\n"))
        assertTrue(text(Tspl.job(black, 16, 2, setup, copies = 7)).endsWith("PRINT 1,7\r\n"))
    }

    @Test(expected = IllegalArgumentException::class)
    fun zeroCopiesIsRejected() {
        Tspl.job(BooleanArray(8), 8, 1, setup, copies = 0)
    }

    @Test
    fun headerUsesTheLabelSize() {
        val t = text(Tspl.job(BooleanArray(8), 8, 1, setup.copy(widthMm = 50, heightMm = 30)))
        assertTrue(t.startsWith("SIZE 50 mm,30 mm\r\nGAP 2.0 mm,0 mm\r\n"))
        assertTrue(t.contains("BITMAP 0,0,1,1,0,"))
    }

    @Test
    fun blackDotIsBitZero() {
        val black = BooleanArray(8) { it == 0 }
        val job = Tspl.job(black, 8, 1, setup)
        val marker = "BITMAP 0,0,1,1,0,".toByteArray(Charsets.US_ASCII)
        val at = text(job).indexOf(String(marker, Charsets.ISO_8859_1)) + marker.size
        assertEquals(0x7F.toByte(), job[at])
        val inverted = Tspl.job(black, 8, 1, setup.copy(invert = true))
        assertEquals(0x80.toByte(), inverted[at])
    }

    @Test
    fun copiesAreSplitIntoBatches() {
        assertEquals(listOf<Int>(), Tspl.batches(0))
        assertEquals(listOf(1), Tspl.batches(1))
        assertEquals(listOf(10), Tspl.batches(10))
        assertEquals(listOf(10, 10, 5), Tspl.batches(25))
        assertEquals(listOf(3, 3, 1), Tspl.batches(7, size = 3))
        assertEquals(999, Tspl.batches(999).sum())
    }

    @Test
    fun calibrateDetectsTheGap() {
        val t = text(Tspl.calibrateJob(setup))
        assertTrue(t.contains("GAPDETECT\r\n"))
        assertTrue(t.endsWith("HOME\r\n"))
        assertArrayEquals(t.toByteArray(Charsets.US_ASCII), Tspl.calibrateJob(setup))
    }
}
