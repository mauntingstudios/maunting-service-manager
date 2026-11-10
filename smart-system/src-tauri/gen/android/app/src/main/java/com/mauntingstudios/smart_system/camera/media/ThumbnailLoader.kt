package com.mauntingstudios.smart_system.camera.media

import android.content.ContentUris
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import androidx.exifinterface.media.ExifInterface
import java.io.File
import java.util.concurrent.Executors

/**
 * Erzeugt und verwaltet das Thumbnail der letzten Aufnahme im Arbeitsspeicher
 * für die Anzeige im Auslöser-Bereich (unten links).
 *
 * Verhindert Blockaden des Haupt-UI-Threads durch asynchrone Skalierung und
 * unterstützt sowohl MediaStore-URIs als auch lokale Dateien.
 */
object ThumbnailLoader {

    private val executor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())

    @Volatile
    var letztesThumbnail: Bitmap? = null
        private set

    /**
     * Lädt das Thumbnail für eine MediaStore-URI.
     */
    fun ladeFuerUri(context: Context, uri: Uri, zielGroesse: Int = 192, callback: (Bitmap?) -> Unit) {
        executor.execute {
            val bitmap = ladeBitmapAusUri(context, uri, zielGroesse)
            letztesThumbnail = bitmap
            mainHandler.post {
                callback(bitmap)
            }
        }
    }

    /**
     * Sucht im MediaStore nach der neuesten Aufnahme (Bild oder Video) in DCIM
     * und liefert Thumbnail und URI zurück.
     */
    fun ladeNeuestesAusMediaStore(context: Context, zielGroesse: Int = 192, callback: (Bitmap?, Uri?) -> Unit) {
        executor.execute {
            val uri = ermittleNeuesteMediaStoreUri(context)
            val bitmap = if (uri != null) ladeBitmapAusUri(context, uri, zielGroesse) else null
            letztesThumbnail = bitmap
            mainHandler.post {
                callback(bitmap, uri)
            }
        }
    }

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

    private fun ermittleNeuesteMediaStoreUri(context: Context): Uri? {
        val projektion = arrayOf(
            MediaStore.MediaColumns._ID,
            MediaStore.MediaColumns.DATE_ADDED
        )
        val sortierung = "${MediaStore.MediaColumns.DATE_ADDED} DESC"

        var bildUri: Uri? = null
        var bildZeit = 0L

        try {
            context.contentResolver.query(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                projektion,
                null,
                null,
                sortierung
            )?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val id = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID))
                    bildZeit = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_ADDED))
                    bildUri = ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id)
                }
            }
        } catch (_: Exception) {}

        var videoUri: Uri? = null
        var videoZeit = 0L

        try {
            context.contentResolver.query(
                MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                projektion,
                null,
                null,
                sortierung
            )?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val id = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID))
                    videoZeit = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_ADDED))
                    videoUri = ContentUris.withAppendedId(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, id)
                }
            }
        } catch (_: Exception) {}

        return if (videoZeit > bildZeit) videoUri else bildUri
    }

    private fun ladeBitmapAusUri(context: Context, uri: Uri, zielGroesse: Int): Bitmap? {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                try {
                    val thumb = context.contentResolver.loadThumbnail(uri, android.util.Size(zielGroesse, zielGroesse), null)
                    return zuschneidenQuadrat(thumb)
                } catch (_: Exception) {
                    // Fallback auf Stream
                }
            }

            val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            context.contentResolver.openInputStream(uri)?.use {
                BitmapFactory.decodeStream(it, null, options)
            }

            val breite = options.outWidth
            val hoehe = options.outHeight
            if (breite <= 0 || hoehe <= 0) return null

            var inSampleSize = 1
            while (breite / (inSampleSize * 2) >= zielGroesse && hoehe / (inSampleSize * 2) >= zielGroesse) {
                inSampleSize *= 2
            }

            val ladeOptionen = BitmapFactory.Options().apply {
                this.inSampleSize = inSampleSize
                inPreferredConfig = Bitmap.Config.ARGB_8888
            }

            val rohBitmap = context.contentResolver.openInputStream(uri)?.use {
                BitmapFactory.decodeStream(it, null, ladeOptionen)
            } ?: return null

            val matrix = Matrix()
            try {
                context.contentResolver.openInputStream(uri)?.use { stream ->
                    val exif = ExifInterface(stream)
                    val orientation = exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
                    when (orientation) {
                        ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
                        ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
                        ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
                        else -> {}
                    }
                }
            } catch (_: Exception) {}

            val gedreht = if (!matrix.isIdentity) {
                Bitmap.createBitmap(rohBitmap, 0, 0, rohBitmap.width, rohBitmap.height, matrix, true)
            } else {
                rohBitmap
            }

            zuschneidenQuadrat(gedreht)
        } catch (_: Exception) {
            null
        }
    }

    private fun zuschneidenQuadrat(bitmap: Bitmap): Bitmap {
        val dimension = minOf(bitmap.width, bitmap.height)
        val x = (bitmap.width - dimension) / 2
        val y = (bitmap.height - dimension) / 2
        return Bitmap.createBitmap(bitmap, x, y, dimension, dimension)
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
                else -> {}
            }

            val gedreht = if (!matrix.isIdentity) {
                Bitmap.createBitmap(rohBitmap, 0, 0, rohBitmap.width, rohBitmap.height, matrix, true)
            } else {
                rohBitmap
            }

            zuschneidenQuadrat(gedreht)
        } catch (_: Exception) {
            null
        }
    }

    private fun videoThumbnail(datei: File): Bitmap? {
        val retriever = MediaMetadataRetriever()
        return try {
            retriever.setDataSource(datei.absolutePath)
            val frame = retriever.getFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC) ?: return null
            zuschneidenQuadrat(frame)
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
