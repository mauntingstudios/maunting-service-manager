package com.mauntingstudios.smart_system.camera.media

import android.content.Context
import android.os.StatFs
import java.io.File
import java.io.RandomAccessFile
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Verwaltet den geschützten internen Medienspeicher der nativen Kamera.
 *
 * Alle Aufnahmen landen im privaten `noBackupFilesDir`, damit weder das
 * Android-Backup noch externe Apps oder Cloud-Dienste (Google Fotos) Zugriff
 * darauf erhalten. Erst der Tresor-Import übernimmt die Daten in die
 * E2E-Verschlüsselung.
 */
object InternalMediaStore {

    private const val UNTERORDNER = "kamera/aufnahmen"
    private const val NULLUNG_BYTES = 64 * 1024 // Erste 64 KiB vor dem Löschen nullen

    /** Mindestreserve für Fotoaufnahmen: 20 MiB */
    const val MIN_SPEICHER_FOTO = 20L * 1024 * 1024

    /** Mindestreserve für Videoaufnahmen: 100 MiB */
    const val MIN_SPEICHER_VIDEO = 100L * 1024 * 1024

    /**
     * Prüft den freien Speicherplatz im Dateisystem des geschützten App-Speichers.
     */
    fun freierSpeicher(context: Context): Long {
        return try {
            val stat = StatFs(aufnahmenOrdner(context).absolutePath)
            stat.availableBytes
        } catch (_: Exception) {
            Long.MAX_VALUE
        }
    }

    fun hatAusreichendSpeicher(context: Context, mindestBytes: Long): Boolean {
        return freierSpeicher(context) >= mindestBytes
    }

    fun aufnahmenOrdner(context: Context): File {
        return File(context.noBackupFilesDir, UNTERORDNER).apply {
            if (!exists()) {
                mkdirs()
            }
        }
    }

    /**
     * Erzeugt eine neue Zieldatei für eine Fotoaufnahme im geschützten Ordner.
     */
    fun neueFotoDatei(context: Context): File {
        val zeitstempel = SimpleDateFormat("yyyyMMdd_HHmmss_SSS", Locale.US).format(Date())
        return File(aufnahmenOrdner(context), "IMG_${zeitstempel}.jpg")
    }

    /**
     * Erzeugt eine neue Zieldatei für eine Videoaufnahme im geschützten Ordner.
     */
    fun neueVideoDatei(context: Context): File {
        val zeitstempel = SimpleDateFormat("yyyyMMdd_HHmmss_SSS", Locale.US).format(Date())
        return File(aufnahmenOrdner(context), "VID_${zeitstempel}.mp4")
    }

    /**
     * Liefert alle noch nicht an den Tresor übergebenen lokalen Aufnahmen.
     */
    fun ausstehendeAufnahmen(context: Context): List<File> {
        val ordner = aufnahmenOrdner(context)
        val dateien = ordner.listFiles() ?: return emptyList()
        return dateien.filter { it.isFile && (it.extension == "jpg" || it.extension == "mp4") }
            .sortedBy { it.lastModified() }
    }

    /**
     * Sicheres Löschen einer Klartext-Datei: überschreibt den Dateianfang mit
     * Nullen und flasht den Dateideskriptor, bevor das Dateisystem den Eintrag
     * entfernt. Schützt vor Datenrekonstruktion aus Flash-Blöcken.
     */
    fun sicherLoeschen(datei: File): Boolean {
        if (!datei.exists()) return true
        return try {
            val laenge = datei.length()
            if (laenge > 0) {
                RandomAccessFile(datei, "rws").use { raf ->
                    val nullGroesse = minOf(laenge, NULLUNG_BYTES.toLong()).toInt()
                    val nullen = ByteArray(nullGroesse)
                    raf.seek(0)
                    raf.write(nullen)
                    raf.fd.sync()
                }
            }
            datei.delete()
        } catch (_: Exception) {
            datei.delete()
        }
    }
}
