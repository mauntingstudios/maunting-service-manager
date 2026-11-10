package com.mauntingstudios.smart_system.camera.capture

import android.content.Context
import android.os.Build
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import com.mauntingstudios.smart_system.camera.core.FlashMode
import com.mauntingstudios.smart_system.camera.media.InternalMediaStore
import com.mauntingstudios.smart_system.camera.media.ThumbnailLoader
import java.io.File
import java.util.concurrent.Executor

/**
 * Verantwortlich für Fotoaufnahmen mit maximaler nativer Bildqualität,
 * korrekter Flash-Steuerung und Ultra-HDR-Ausgabe auf unterstützten Geräten.
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
     * Löst eine Fotoaufnahme aus und speichert sie direkt im isolierten App-Speicher.
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

        val zielfile = InternalMediaStore.neueFotoDatei(context)
        val outputOptions = ImageCapture.OutputFileOptions.Builder(zielfile).build()

        listener.onCaptureStarted()

        capture.takePicture(
            outputOptions,
            executor,
            object : ImageCapture.OnImageSavedCallback {
                override fun onImageSaved(outputFileResults: ImageCapture.OutputFileResults) {
                    if (zielfile.exists() && zielfile.length() > 0) {
                        ThumbnailLoader.ladeFuer(zielfile) {
                            // Thumbnail im Speicher aktualisiert
                        }
                        listener.onPhotoSaved(zielfile)
                    } else {
                        listener.onCaptureError(IllegalStateException("Aufnahmedatei ist leer oder wurde nicht erstellt"))
                    }
                }

                override fun onError(exception: ImageCaptureException) {
                    InternalMediaStore.sicherLoeschen(zielfile)
                    listener.onCaptureError(exception)
                }
            },
        )
    }
}
