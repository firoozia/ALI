package com.zinax.stock.core

/** Code autocomplete: "1" offers every code starting with 1, "10" narrows it to 101, 102… */
object CodeSuggest {
    fun <T> filter(all: List<T>, typed: String, code: (T) -> String, limit: Int = 8): List<T> {
        val prefix = typed.trim()
        if (prefix.isEmpty()) return emptyList()
        return all.filter { code(it).startsWith(prefix, ignoreCase = true) }
            .sortedWith(compareBy<T>({ code(it).length }, { Report.codeSortKey(code(it)) }, { code(it) }))
            .take(limit)
    }
}
