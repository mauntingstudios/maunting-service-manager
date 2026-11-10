package com.mauntingstudios.smart_system.camera

import com.mauntingstudios.smart_system.MainActivity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

/**
 * Prüft Schnittstellen und Konstanten für die Übergabe von Aufnahmen
 * aus der nativen Kamera an das Tresorsystem.
 */
class VaultHandoffTest {

    @Test
    fun `Intent-Aktion fuer Tresor-Oeffnung ist stabil definiert`() {
        assertEquals("com.mauntingstudios.smart_system.OPEN_VAULT", MainActivity.ACTION_OPEN_VAULT)
        assertEquals("com.mauntingstudios.smart_system.OPEN_WALLET", MainActivity.ACTION_OPEN_WALLET)
    }
}
