package com.aryak.hingelabels

import com.aryak.hingelabels.data.Lists
import org.junit.Assert.assertEquals
import org.junit.Test

class ListsTest {
    private val models = Lists.DEFAULT_MODELS

    @Test
    fun encodeAndDecode() {
        assertEquals(models, Lists.decode(Lists.encode(models)))
        assertEquals(listOf("A", "B"), Lists.decode(" a \n\n b\nA"))
        assertEquals(emptyList<String>(), Lists.decode(null))
    }

    @Test
    fun addCleansAndSkipsDuplicates() {
        assertEquals(models + "3D SOFT CLOSE", Lists.add(models, "  3d   soft close "))
        assertEquals(models, Lists.add(models, "2d clip on"))
        assertEquals(models, Lists.add(models, "   "))
    }

    @Test
    fun renameKeepsNamesUnique() {
        assertEquals(listOf("3D CLIP ON", "2D SLIDE ON", "2D NORMAL"), Lists.rename(models, 1, "2d slide on"))
        assertEquals(models, Lists.rename(models, 1, "2D NORMAL"))
        assertEquals(models, Lists.rename(models, 5, "X"))
    }

    @Test
    fun moveAndRemove() {
        assertEquals(listOf("2D CLIP ON", "3D CLIP ON", "2D NORMAL"), Lists.move(models, 1, -1))
        assertEquals(models, Lists.move(models, 0, -1))
        assertEquals(listOf("3D CLIP ON", "2D NORMAL", "2D CLIP ON"), Lists.move(models, 1, 1))
        assertEquals(listOf("3D CLIP ON", "2D NORMAL"), Lists.remove(models, 1))
    }
}
