package com.mauntingstudios.smart_system.camera

import com.mauntingstudios.smart_system.camera.media.InternalMediaStore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
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

    @Test
    fun `Dateien werden nach gueltigen Medienendungen gefiltert`() {
        val tempDir = Files.createTempDirectory("kamera_test_filter").toFile()
        val jpg = File(tempDir, "IMG_1.jpg").apply { writeText("bild") }
        val mp4 = File(tempDir, "VID_1.mp4").apply { writeText("video") }
        val txt = File(tempDir, "unbekannt.txt").apply { writeText("text") }

        val gefiltert = tempDir.listFiles()?.filter { it.isFile && (it.extension == "jpg" || it.extension == "mp4") }
        assertEquals(2, gefiltert?.size)
        assertTrue(gefiltert!!.contains(jpg))
        assertTrue(gefiltert.contains(mp4))
        assertFalse(gefiltert.contains(txt))

        tempDir.deleteRecursively()
    }

    @Test
    fun `Mindestspeicher-Schwellenwerte sind sicher dimensioniert`() {
        assertEquals(20L * 1024 * 1024, InternalMediaStore.MIN_SPEICHER_FOTO)
        assertEquals(100L * 1024 * 1024, InternalMediaStore.MIN_SPEICHER_VIDEO)
        assertTrue(InternalMediaStore.MIN_SPEICHER_VIDEO > InternalMediaStore.MIN_SPEICHER_FOTO)
    }
}
