package com.mauntingstudios.smart_system.camera.capture

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.provider.MediaStore
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import com.mauntingstudios.smart_system.camera.core.FlashMode
import com.mauntingstudios.smart_system.camera.media.InternalMediaStore
import com.mauntingstudios.smart_system.camera.media.ThumbnailLoader
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executor

/**
 * Verantwortlich für Fotoaufnahmen mit maximaler nativer Bildqualität,
 * korrekter Flash-Steuerung und Speicherung im Standard-Kameraalbum (DCIM),
 * damit die automatische Hintergrund-Sicherung (KameraArbeit) neue Aufnahmen
 * erfassen und verschlüsselt in den Tresor laden kann.
 */
class PhotoCaptureController {

    private var imageCapture: ImageCapture? = null

    /**
     * Erstellt einen neuen [ImageCapture] Use-Case passend zur aktuellen Konfiguration.
     */
    fun createUseCase(flashMode: FlashMode, enableUltraHdr: Boolean = true): ImageCapture {
        val builder = ImageCapture.Builder()
            .setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY)
            .setFlashMode(flashMode.imageCaptureMode)

        // Ultra HDR auf Android 14+ (API 34) aktivieren, sofern gewünscht
        if (enableUltraHdr && Build.VERSION.SDK_INT >= 34) {
            try {
                builder.setOutputFormat(ImageCapture.OUTPUT_FORMAT_JPEG_ULTRA_HDR)
            } catch (_: Exception) {
                // Rückfall auf Standard-JPEG
            }
        }

        val useCase = builder.build()
        imageCapture = useCase
        return useCase
    }

    fun setFlashMode(flashMode: FlashMode) {
        imageCapture?.flashMode = flashMode.imageCaptureMode
    }

    /**
     * Löst eine Fotoaufnahme aus und registriert sie im MediaStore (DCIM/Camera).
     */
    fun takePhoto(
        context: Context,
        executor: Executor,
        listener: CaptureListener,
    ) {
        val capture = imageCapture ?: run {
            listener.onCaptureError(IllegalStateException("ImageCapture Use-Case nicht initialisiert"))
            return
        }

        if (!InternalMediaStore.hatAusreichendSpeicher(context, InternalMediaStore.MIN_SPEICHER_FOTO)) {
            listener.onCaptureError(IllegalStateException("Nicht genug freier Speicherplatz für Fotoaufnahme"))
            return
        }

        val zeitstempel = SimpleDateFormat("yyyyMMdd_HHmmss_SSS", Locale.US).format(Date())
        val dateiName = "IMG_$zeitstempel.jpg"

        val contentValues = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, dateiName)
            put(MediaStore.MediaColumns.MIME_TYPE, "image/jpeg")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                put(MediaStore.MediaColumns.RELATIVE_PATH, "DCIM/Camera")
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
        }

        val outputOptions = ImageCapture.OutputFileOptions.Builder(
            context.contentResolver,
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            contentValues
        ).build()

        listener.onCaptureStarted()

        capture.takePicture(
            outputOptions,
            executor,
            object : ImageCapture.OnImageSavedCallback {
                override fun onImageSaved(outputFileResults: ImageCapture.OutputFileResults) {
                    val uri = outputFileResults.savedUri
                    if (uri != null) {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                            val values = ContentValues().apply {
                                put(MediaStore.MediaColumns.IS_PENDING, 0)
                            }
                            try {
                                context.contentResolver.update(uri, values, null, null)
                            } catch (_: Exception) {
                            }
                        }
                        ThumbnailLoader.ladeFuerUri(context, uri) {
                            // Thumbnail im Speicher aktualisiert
                        }
                        listener.onPhotoSaved(uri)
                    } else {
                        listener.onCaptureError(IllegalStateException("Aufnahme-URI ist null"))
                    }
                }

                override fun onError(exception: ImageCaptureException) {
                    listener.onCaptureError(exception)
                }
            },
        )
    }
}
