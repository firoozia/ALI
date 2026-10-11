package com.zinax.stock.core

/** One spelling per unit, so "M", "mtr" and "meter" are all the same metres in stock and reports. */
object Units {
    private val aliases = mapOf(
        "m" to listOf("m", "mtr", "mtrs", "meter", "meters", "metre", "metres", "mt"),
        "cm" to listOf("cm", "cms"),
        "kg" to listOf("kg", "kgs", "kilo", "kilos", "kilogram", "kilograms"),
        "pcs" to listOf("pcs", "pc", "piece", "pieces", "ea", "each", "pce"),
        "roll" to listOf("roll", "rolls"),
        "set" to listOf("set", "sets"),
    )
    private val lookup: Map<String, String> = aliases.flatMap { (unit, names) -> names.map { it to unit } }.toMap()

    /** The usual spelling of [raw]; units it does not know are only trimmed and lowercased. */
    fun normalize(raw: String): String {
        val t = raw.trim().lowercase().removeSuffix(".")
        return lookup[t] ?: t
    }
}
