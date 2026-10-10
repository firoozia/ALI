package com.zinax.stock.core

/** Word wrapping for label text, measured by the caller's font. */
object TextWrap {
    /** Splits [text] into lines no wider than [maxWidth]; a word too long for a line is broken by characters. */
    fun wrap(text: String, maxWidth: Float, measure: (String) -> Float): List<String> {
        val lines = ArrayList<String>()
        var line = ""
        for (word in text.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }) {
            val candidate = if (line.isEmpty()) word else "$line $word"
            if (measure(candidate) <= maxWidth) {
                line = candidate
                continue
            }
            if (line.isNotEmpty()) lines.add(line)
            line = ""
            var rest = word
            while (measure(rest) > maxWidth && rest.length > 1) {
                var n = rest.length - 1
                while (n > 1 && measure(rest.substring(0, n)) > maxWidth) n--
                lines.add(rest.substring(0, n))
                rest = rest.substring(n)
            }
            line = rest
        }
        if (line.isNotEmpty()) lines.add(line)
        return lines
    }

    /**
     * Largest font size from [maxSize] down to [minSize] at which [text] fits in [maxLines] lines
     * of [maxWidth] and in [maxHeight], given a line height of [lineFactor] × size.
     */
    fun fit(
        text: String, maxWidth: Float, maxHeight: Float, maxLines: Int, maxSize: Float, minSize: Float,
        lineFactor: Float, measureAt: (String, Float) -> Float,
    ): Pair<Float, List<String>> {
        var size = maxSize
        while (size >= minSize) {
            val lines = wrap(text, maxWidth) { measureAt(it, size) }
            if (lines.size <= maxLines && lines.size * size * lineFactor <= maxHeight) return size to lines
            size -= 2f
        }
        val lines = wrap(text, maxWidth) { measureAt(it, minSize) }
        return minSize to lines.take(maxLines)
    }
}
