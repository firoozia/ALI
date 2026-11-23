package com.aryak.hingelabels.data

/** The editable choice lists (brands, products, types, models), stored one entry per line. */
object Lists {
    val DEFAULT_BRANDS = listOf("ZINEB MARKET")
    val DEFAULT_PRODUCTS = listOf("HINGES")
    val DEFAULT_TYPES = listOf("A", "B", "C")
    val DEFAULT_MODELS = listOf("3D CLIP ON", "2D CLIP ON", "2D NORMAL")

    /** Upper case, single line, single spaces. */
    fun clean(v: String): String = v.replace(Regex("\\s+"), " ").trim().uppercase()

    fun encode(items: List<String>): String = items.joinToString("\n")

    fun decode(s: String?): List<String> =
        s.orEmpty().split("\n").map { clean(it) }.filter { it.isNotEmpty() }.distinct()

    /** Adds [v] at the end unless it is blank or already there. */
    fun add(items: List<String>, v: String): List<String> {
        val c = clean(v)
        return if (c.isEmpty() || c in items) items else items + c
    }

    /** Renames item [index] to [v]; ignored when blank or when another item already has that name. */
    fun rename(items: List<String>, index: Int, v: String): List<String> {
        val c = clean(v)
        if (index !in items.indices || c.isEmpty()) return items
        if (items.withIndex().any { (i, s) -> i != index && s == c }) return items
        return items.toMutableList().also { it[index] = c }
    }

    fun remove(items: List<String>, index: Int): List<String> =
        if (index in items.indices) items.toMutableList().also { it.removeAt(index) } else items

    /** Moves item [index] by [by] places (−1 up, +1 down), staying inside the list. */
    fun move(items: List<String>, index: Int, by: Int): List<String> {
        if (index !in items.indices) return items
        val to = (index + by).coerceIn(0, items.lastIndex)
        if (to == index) return items
        return items.toMutableList().also { it.add(to, it.removeAt(index)) }
    }
}
