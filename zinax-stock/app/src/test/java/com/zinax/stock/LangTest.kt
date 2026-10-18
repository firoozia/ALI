package com.zinax.stock

import com.zinax.stock.core.ArDict
import com.zinax.stock.core.FaDict
import com.zinax.stock.core.Lang
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LangTest {
    /** The translator puts invisible direction marks around values; they are left out when comparing. */
    private fun t(s: String) = Lang.tr(s).replace("\u200E", "")

    @Test fun whole_strings() {
        assertEquals("موجودی", t("Stock"))
        assertEquals("خروج کالا", t("Ship out"))
    }

    @Test fun unknown_text_stays_as_it_is() {
        assertEquals("ZX-261014-A0012", t("ZX-261014-A0012"))
        assertEquals("HIGH POINT", t("HIGH POINT"))
    }

    @Test fun numbers_and_codes_stay_in_place() {
        val r = t("Cut 12 m of 107, 5 m left")
        assertTrue(r.contains("12 m") && r.contains("107") && r.contains("5 m"))
        assertTrue(r.contains("برش"))
    }

    @Test fun lines_made_of_parts() {
        assertEquals("3 کامل · 2 باز · 190 m", t("3 full · 2 open · 190 m"))
        assertEquals("14 کارتن (3 برش), 210 PAIR", t("14 cartons (3 cut), 210 PAIR"))
    }

    @Test fun sentences_with_values_and_surrounding_spaces() {
        assertEquals("  فقط رول‌های باز", t("  open rolls only"))
        assertTrue(t("Only 5 m left on ZX-261014-A0001").startsWith("فقط"))
    }

    @Test fun parts_of_a_long_text_are_translated_one_by_one() {
        val r = t(
            "Blank labels skipped between prints? Set the label size and gap to the real roll (measure with a ruler), " +
                "then Calibrate printer. Calibrate again after every new roll.",
        )
        assertTrue(!r.contains("Blank labels"))
    }

    @Test fun a_group_name_inside_a_chip() {
        assertEquals("فیلم PVC (120)", t("PVC film (120)").replace("‎", ""))
    }

    private fun keys(text: String) = text.lineSequence().mapNotNull { l -> l.indexOf(Lang.SEP).takeIf { it > 0 }?.let { l.substring(0, it).trim() } }.toSet()

    @Test fun arabic_has_every_string_persian_has() {
        val fa = keys(FaDict.all())
        val ar = keys(ArDict.all())
        assertEquals("missing in Arabic", emptySet<String>(), fa - ar)
        assertEquals("only in Arabic", emptySet<String>(), ar - fa)
    }

    @Test fun arabic_text() {
        assertEquals("المخزون", Lang.tr("Stock", "ar"))
        assertEquals("3 كامل · 2 مفتوح · 190 m", Lang.tr("3 full · 2 open · 190 m", "ar").replace("\u200E", ""))
        assertEquals("ZX-261014-A0012", Lang.tr("ZX-261014-A0012", "ar"))
    }

    @Test fun english_is_left_alone() {
        assertEquals("Stock", Lang.tr("Stock", "en"))
    }
}
