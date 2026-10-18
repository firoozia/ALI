package com.zinax.stock.core

/** English ⇒ Persian lines for [Lang]. Several parts, because one string constant is limited in size. */
object FaDict {
    fun all(): String = listOf(FaDict1.TEXT, FaDict2.TEXT, FaDict3.TEXT, FaDict4.TEXT, FaDict5.TEXT).joinToString("\n")
}
