package com.zinax.stock.core

/** Lengths typed by people: "20.5", "20,5" or "2050" in centimetres. */
object Lengths {
    /** Metres from [text] in metres or, when [cm] is true, centimetres. Null when it is not a positive number. */
    fun parse(text: String, cm: Boolean): Double? {
        val t = text.trim().replace(',', '.').replace('٫', '.')
            .map { c -> if (c in '۰'..'۹') '0' + (c - '۰') else if (c in '٠'..'٩') '0' + (c - '٠') else c }
            .joinToString("")
        val v = t.toDoubleOrNull() ?: return null
        if (v <= 0 || v.isNaN() || v.isInfinite()) return null
        return if (cm) v / 100.0 else v
    }

    /** How a length in metres reads in the chosen unit: 20.5 m -> "20.5" or "2050". */
    fun show(metres: Double, cm: Boolean): String {
        if (cm) return Format.qty(metres * 100)
        // Metres keep millimetres so switching to cm and back loses nothing.
        val mm = Math.round(metres * 1000)
        return if (mm % 1000 == 0L) (mm / 1000).toString()
        else String.format(java.util.Locale.US, "%.3f", mm / 1000.0).trimEnd('0').trimEnd('.')
    }
}

/** Customer names as typed by different people on different phones. */
object CustomerNames {
    /** Same customer when this matches: case, extra spaces and Arabic/Persian letter forms ignored. */
    fun key(name: String): String = name.trim().lowercase()
        .replace('ي', 'ی').replace('ى', 'ی').replace('ك', 'ک').replace('ة', 'ه')
        .replace(Regex("\\s+"), " ")

    /** Tidy display form: trimmed, single spaces. */
    fun clean(name: String): String = name.trim().replace(Regex("\\s+"), " ")

    /** Names starting with what was typed first, then names containing it. */
    fun suggest(names: List<String>, typed: String, limit: Int = 6): List<String> {
        val k = key(typed)
        if (k.isEmpty()) return emptyList()
        val starts = names.filter { key(it).startsWith(k) }
        val words = names.filter { n -> n !in starts && key(n).split(' ').any { it.startsWith(k) } }
        val contains = names.filter { it !in starts && it !in words && key(it).contains(k) }
        return (starts.sortedBy { key(it) } + words.sortedBy { key(it) } + contains.sortedBy { key(it) })
            .filter { key(it) != k || it != clean(typed) }
            .take(limit)
    }
}

/** A roll on offer for cutting. */
data class CutCandidate(val id: String, val remaining: Double, val full: Double, val receivedAt: Long) {
    val open: Boolean get() = remaining < full - 1e-6
}

object CutPlan {
    /**
     * Order rolls for cutting: open rolls first, smallest first, so pieces are used up;
     * then full rolls, oldest first.
     */
    fun order(rolls: List<CutCandidate>): List<CutCandidate> =
        rolls.filter { it.open }.sortedWith(compareBy({ it.remaining }, { it.receivedAt })) +
            rolls.filter { !it.open }.sortedWith(compareBy({ it.receivedAt }, { it.remaining }))

    /** Smallest open roll that holds [length], else the first roll in [order] that does. */
    fun best(rolls: List<CutCandidate>, length: Double?): CutCandidate? {
        val ordered = order(rolls)
        if (length == null) return ordered.firstOrNull()
        return ordered.firstOrNull { it.remaining >= length - 1e-6 }
    }

    /** What is left after cutting [length] from [remaining]; never below zero. */
    fun left(remaining: Double, length: Double): Double = (remaining - length).let { if (it < 1e-6) 0.0 else it }

    /** True when a cut leaves a piece shorter than [shortEnd] but not nothing. */
    fun leavesShortEnd(remaining: Double, length: Double, shortEnd: Double): Boolean {
        val l = left(remaining, length)
        return l > 0 && l < shortEnd - 1e-9
    }
}
