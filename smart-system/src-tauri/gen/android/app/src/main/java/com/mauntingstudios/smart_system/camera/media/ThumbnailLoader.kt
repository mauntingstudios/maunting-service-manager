package com.mauntingstudios.smart_system.camera.media

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.MediaMetadataRetriever
import android.os.Handler
import android.os.Looper
import androidx.exifinterface.media.ExifInterface
import java.io.File
import java.util.concurrent.Executors

/**
 * Erzeugt und verwaltet das Thumbnail der letzten Aufnahme im Arbeitsspeicher
 * für die Anzeige im Auslöser-Bereich (unten links).
 *
 * Verhindert Blockaden des Haupt-UI-Threads durch asynchrone Skalierung.
 */
object ThumbnailLoader {

    private val executor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())

    @Volatile
    var letztesThumbnail: Bitmap? = null
        private set

    /**
     * Lädt das Thumbnail der neuesten Aufnahme aus dem geschützten Ordner
     * oder erzeugt es direkt aus einer neu erstellten Datei.
     */
    fun ladeFuer(datei: File, zielGroesse: Int = 192, callback: (Bitmap?) -> Unit) {
        executor.execute {
            val bitmap = if (datei.extension == "mp4") {
                videoThumbnail(datei)
            } else {
                fotoThumbnail(datei, zielGroesse)
            }

            letztesThumbnail = bitmap

            mainHandler.post {
                callback(bitmap)
            }
        }
    }

    /**
     * Sucht beim Start der Kamera nach der letzten vorhandenen Aufnahme, um
     * sofort ein gültiges Thumbnail in der Benutzeroberfläche anzeigen zu können.
     */
    fun ladeNeuestes(ausstehende: List<File>, zielGroesse: Int = 192, callback: (Bitmap?) -> Unit) {
        val neueste = ausstehende.maxByOrNull { it.lastModified() }
        if (neueste == null) {
            letztesThumbnail = null
            callback(null)
            return
        }
        ladeFuer(neueste, zielGroesse, callback)
    }

    private fun fotoThumbnail(datei: File, zielGroesse: Int): Bitmap? {
        return try {
            val optionen = BitmapFactory.Options().apply {
                inJustDecodeBounds = true
            }
            BitmapFactory.decodeFile(datei.absolutePath, optionen)

            val breite = optionen.outWidth
            val hoehe = optionen.outHeight
            if (breite <= 0 || hoehe <= 0) return null

            var inSampleSize = 1
            while (breite / (inSampleSize * 2) >= zielGroesse && hoehe / (inSampleSize * 2) >= zielGroesse) {
                inSampleSize *= 2
            }

            val ladeOptionen = BitmapFactory.Options().apply {
                this.inSampleSize = inSampleSize
                inPreferredConfig = Bitmap.Config.ARGB_8888
            }

            val rohBitmap = BitmapFactory.decodeFile(datei.absolutePath, ladeOptionen) ?: return null

            // EXIF-Drehung berücksichtigen
            val exif = ExifInterface(datei.absolutePath)
            val orientation = exif.getAttributeInt(
                ExifInterface.TAG_ORIENTATION,
                ExifInterface.ORIENTATION_NORMAL
            )
            val matrix = Matrix()
            when (orientation) {
                ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
                ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
                ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
            }

            val gedreht = if (!matrix.isIdentity) {
                Bitmap.createBitmap(rohBitmap, 0, 0, rohBitmap.width, rohBitmap.height, matrix, true)
            } else {
                rohBitmap
            }

            // Quadratischer Zuschnitt zentriert
            val dimension = minOf(gedreht.width, gedreht.height)
            val x = (gedreht.width - dimension) / 2
            val y = (gedreht.height - dimension) / 2

            Bitmap.createBitmap(gedreht, x, y, dimension, dimension)
        } catch (_: Exception) {
            null
        }
    }

    private fun videoThumbnail(datei: File): Bitmap? {
        val retriever = MediaMetadataRetriever()
        return try {
            retriever.setDataSource(datei.absolutePath)
            val frame = retriever.getFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC) ?: return null
            val dimension = minOf(frame.width, frame.height)
            val x = (frame.width - dimension) / 2
            val y = (frame.height - dimension) / 2
            Bitmap.createBitmap(frame, x, y, dimension, dimension)
        } catch (_: Exception) {
            null
        } finally {
            try {
                retriever.release()
            } catch (_: Exception) {
            }
        }
    }
}
