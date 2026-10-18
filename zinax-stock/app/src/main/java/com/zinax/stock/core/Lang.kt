package com.zinax.stock.core

/**
 * Persian and Arabic text for the screens. The screens keep their English strings; every string that is about to be shown
 * goes through [tr] when Persian or Arabic is on. The dictionaries ([FaDict] for Persian, [ArDict] for Arabic) map English to the language:
 *  - a whole string ("Reports" to its translation),
 *  - a string with {} for the parts that change ("Pallet {} complete"). The other side may use {} in the same
 *    order or {1}, {2} to move them,
 *  - and long pieces of text that appear inside bigger strings.
 * Anything not in the dictionary stays English, so a missing translation never breaks a screen.
 */
object Lang {
    private class Template(val regex: Regex, val target: String, val size: Int)

    /** One language: exact strings, templates with {}, long pieces, and a cache of what was already translated. */
    private class Dict(source: String) {
        val exact = HashMap<String, String>()
        val templates = ArrayList<Template>()
        val fragments = ArrayList<Pair<String, String>>()
        val cache = object : LinkedHashMap<String, String>(256, 0.75f, true) {
            override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, String>?) = size > 4000
        }

        init {
            source.lineSequence().forEach { line ->
                val i = line.indexOf(SEP)
                if (i <= 0) return@forEach
                val en = line.substring(0, i).trim()
                val to = line.substring(i + SEP.length).trim()
                if (en.isEmpty() || to.isEmpty()) return@forEach
                if ("{}" in en) {
                    val parts = en.split("{}")
                    // A value never swallows the " · " that separates the parts of a line.
                    val rx = Regex("^" + parts.joinToString("(.+?)") { Regex.escape(it) } + "$", RegexOption.DOT_MATCHES_ALL)
                    templates.add(Template(rx, to, parts.sumOf { it.length }))
                } else {
                    exact[en] = to
                    if (en.length >= 14 && ' ' in en) fragments.add(en to to)
                }
            }
            templates.sortByDescending { it.size }
            fragments.sortByDescending { it.first.length }
        }
    }

    private val dicts = HashMap<String, Dict>()
    private const val LRM = "\u200E"
    const val SEP = " ⇒ "
    private val SEPARATORS = listOf(" · ", ", ")

    /** Dictionary text for a language: "fa" or "ar". */
    private fun source(lang: String): String? = when (lang) {
        "fa" -> FaDict.all()
        "ar" -> ArDict.all()
        else -> null
    }

    private fun dict(lang: String): Dict? = synchronized(dicts) {
        dicts[lang] ?: source(lang)?.let { Dict(it).also { d -> dicts[lang] = d } }
    }

    /** [s] in [lang] ("fa" or "ar"); any other language, and anything without a translation, stays as it is. */
    fun tr(s: String, lang: String = "fa"): String {
        if (s.isBlank()) return s
        val d = try { dict(lang) } catch (e: Throwable) { null } ?: return s
        synchronized(d.cache) { d.cache[s]?.let { return it } }
        // A translation problem must never take the app down: show the English text instead.
        val r = try { compute(d, s, 0) } catch (e: Throwable) { s }
        synchronized(d.cache) { d.cache[s] = r }
        return r
    }

    private fun compute(d: Dict, s: String, depth: Int): String {
        d.exact[s]?.let { return it }
        val core = s.trim()
        if (core.isEmpty()) return s
        val lead = s.substring(0, s.indexOf(core))
        val tail = s.substring(lead.length + core.length)
        return lead + core(d, core, depth) + tail
    }

    private fun core(d: Dict, c: String, depth: Int): String {
        d.exact[c]?.let { return it }
        if (depth > 3) return c
        for (t in d.templates) {
            val m = t.regex.matchEntire(c) ?: continue
            // A value never swallows the " · " that separates the parts of a line.
            if (m.groupValues.drop(1).any { " · " in it }) continue
            val values = m.groupValues.drop(1).map { v -> isolate(compute(d, v, depth + 1)) }
            return fill(t.target, values)
        }
        // Long text made of known pieces (the pieces of a text written over several lines in the code).
        var out = c
        var replaced = false
        for ((en, to) in d.fragments) if (en in out) { out = out.replace(en, to); replaced = true }
        if (replaced) return out
        // Lines made of parts: "3 full · 2 open · 16 m" or "14 cartons, 210 PAIR". Each part is translated on its own.
        for (sep in SEPARATORS) {
            if (sep !in c) continue
            val parts = c.split(sep)
            val done = parts.map { compute(d, it, depth + 1) }
            if (done != parts) return done.joinToString(sep)
        }
        return c
    }

    private fun fill(target: String, values: List<String>): String {
        var next = 0
        return Regex("\\{(\\d*)}").replace(target) { m ->
            val n = m.groupValues[1]
            val idx = if (n.isEmpty()) next++ else n.toInt() - 1
            values.getOrElse(idx) { "" }
        }
    }

    /** Keeps codes, numbers and names in place when they sit inside a right-to-left sentence. */
    private fun isolate(v: String) = if (v.any { it in 'A'..'Z' || it in 'a'..'z' || it in '0'..'9' }) LRM + v + LRM else v
}
