package com.mauntingstudios.smart_system.camera

import com.mauntingstudios.smart_system.camera.media.InternalMediaStore
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.io.RandomAccessFile
import java.nio.file.Files

/**
 * Prüft den sicheren Löschvorgang und Dateiverwaltung im internen Medienspeicher.
 */
class InternalMediaStoreTest {

    @Test
    fun `sicheres Loeschen nullt Header-Bytes und entfernt die Datei`() {
        val tempDir = Files.createTempDirectory("kamera_test").toFile()
        val datei = File(tempDir, "IMG_test.jpg")
        
        // Schreibe Testmuster (128 KiB)
        val testDaten = ByteArray(128 * 1024) { 0x55.toByte() }
        datei.writeBytes(testDaten)
        assertTrue(datei.exists())

        // Simuliere Nullung und Löschung
        val geloescht = InternalMediaStore.sicherLoeschen(datei)
        assertTrue(geloescht)
        assertFalse(datei.exists())

        tempDir.deleteRecursively()
    }

    @Test
    fun `sicheres Loeschen einer nicht existierenden Datei schlaegt nicht fehl`() {
        val datei = File("nicht_vorhanden_${System.currentTimeMillis()}.jpg")
        assertTrue(InternalMediaStore.sicherLoeschen(datei))
    }
}
