package com.zinax.stock.core

/**
 * Persian text for the screens. The screens keep their English strings; every string that is about to be shown
 * goes through [tr] when Persian is on. The dictionary in [FaDict] maps English to Persian:
 *  - a whole string ("Reports" to its Persian),
 *  - a string with {} for the parts that change ("Pallet {} complete"). The Persian side may use {} in the same
 *    order or {1}, {2} to move them,
 *  - and long pieces of text that appear inside bigger strings.
 * Anything not in the dictionary stays English, so a missing translation never breaks a screen.
 */
object Lang {
    private class Template(val regex: Regex, val fa: String, val size: Int)

    private val exact = HashMap<String, String>()
    private val templates = ArrayList<Template>()
    private val fragments = ArrayList<Pair<String, String>>()
    private val cache = object : LinkedHashMap<String, String>(256, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, String>?) = size > 4000
    }
    private const val LRM = "‎"

    init {
        FaDict.all().lineSequence().forEach { line ->
            val i = line.indexOf(SEP)
            if (i <= 0) return@forEach
            val en = line.substring(0, i).trim()
            val fa = line.substring(i + SEP.length).trim()
            if (en.isEmpty() || fa.isEmpty()) return@forEach
            if ("{}" in en) {
                val parts = en.split("{}")
                // A value never swallows the " · " that separates the parts of a line.
                val rx = Regex("^" + parts.joinToString("((?:(?! · ).)+?)") { Regex.escape(it) } + "$", RegexOption.DOT_MATCHES_ALL)
                templates.add(Template(rx, fa, parts.sumOf { it.length }))
            } else {
                exact[en] = fa
                if (en.length >= 14 && ' ' in en) fragments.add(en to fa)
            }
        }
        templates.sortByDescending { it.size }
        fragments.sortByDescending { it.first.length }
    }

    const val SEP = " ⇒ "

    fun tr(s: String): String {
        if (s.isBlank()) return s
        synchronized(cache) { cache[s]?.let { return it } }
        val r = compute(s, 0)
        synchronized(cache) { cache[s] = r }
        return r
    }

    private fun compute(s: String, depth: Int): String {
        exact[s]?.let { return it }
        val core = s.trim()
        if (core.isEmpty()) return s
        val lead = s.substring(0, s.indexOf(core))
        val tail = s.substring(lead.length + core.length)
        return lead + core(core, depth) + tail
    }

    private fun core(c: String, depth: Int): String {
        exact[c]?.let { return it }
        if (depth > 3) return c
        for (t in templates) {
            val m = t.regex.matchEntire(c) ?: continue
            val values = m.groupValues.drop(1).map { v -> isolate(compute(v, depth + 1)) }
            return fill(t.fa, values)
        }
        // Long text made of known pieces (the pieces of a text written over several lines in the code).
        var out = c
        var replaced = false
        for ((en, fa) in fragments) if (en in out) { out = out.replace(en, fa); replaced = true }
        if (replaced) return out
        // Lines made of parts: "3 full · 2 open · 16 m" or "14 cartons, 210 PAIR". Each part is translated on its own.
        for (sep in SEPARATORS) {
            if (sep !in c) continue
            val parts = c.split(sep)
            val done = parts.map { compute(it, depth + 1) }
            if (done != parts) return done.joinToString(sep)
        }
        return c
    }

    private val SEPARATORS = listOf(" · ", ", ")

    private fun fill(fa: String, values: List<String>): String {
        var next = 0
        return Regex("\\{(\\d*)}").replace(fa) { m ->
            val n = m.groupValues[1]
            val idx = if (n.isEmpty()) next++ else n.toInt() - 1
            values.getOrElse(idx) { "" }
        }
    }

    /** Keeps codes, numbers and names in place when they sit inside a right-to-left sentence. */
    private fun isolate(v: String) = if (v.any { it in 'A'..'Z' || it in 'a'..'z' || it in '0'..'9' }) LRM + v + LRM else v
}
