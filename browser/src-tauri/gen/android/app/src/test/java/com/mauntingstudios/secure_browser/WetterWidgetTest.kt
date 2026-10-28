package com.mauntingstudios.secure_browser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Tests für die Hilfsfunktionen des Wetter-Widgets. */
class WetterWidgetTest {
    @Test
    fun `lageSymbol liefert das passende Drawable fuer jede Wetterlage`() {
        assertEquals(R.drawable.widget_wetter_klar, lageSymbol("klar"))
        assertEquals(R.drawable.widget_wetter_teils, lageSymbol("teils"))
        assertEquals(R.drawable.widget_wetter_bewoelkt, lageSymbol("bewoelkt"))
        assertEquals(R.drawable.widget_wetter_regen, lageSymbol("regen"))
        assertEquals(R.drawable.widget_wetter_schnee, lageSymbol("schnee"))
        // Groß-/Kleinschreibung tolerant
        assertEquals(R.drawable.widget_wetter_bewoelkt, lageSymbol("Bewoelkt"))
        // Unbekannte Lagen fallen auf Teils-Symbol zurueck
        assertEquals(R.drawable.widget_wetter_teils, lageSymbol("unbekannt"))
        assertEquals(R.drawable.widget_wetter_teils, lageSymbol(null))
    }

    @Test
    fun `stundeZeitFormatieren wandelt ISO-Strings in Uhrzeiten um`() {
        // Format mit Zeitzone
        val formatiert = stundeZeitFormatieren("2026-10-25T14:00:00+02:00")
        assertTrue(formatiert.endsWith(":00"))

        // Fallback bei einfachem Format
        val fallback = stundeZeitFormatieren("2026-10-25T17:30:00Z")
        assertTrue(fallback.contains(":"))

        // Leere oder ungueltige Werte
        assertEquals("–", stundeZeitFormatieren(null))
        assertEquals("–", stundeZeitFormatieren(""))
        assertEquals("kaputt", stundeZeitFormatieren("kaputt"))
    }
}
