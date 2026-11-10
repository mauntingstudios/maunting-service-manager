package com.mauntingstudios.smart_system.camera.capture

import android.Manifest
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import androidx.camera.video.FallbackStrategy
import androidx.camera.video.MediaStoreOutputOptions
import androidx.camera.video.PendingRecording
import androidx.camera.video.Quality
import androidx.camera.video.QualitySelector
import androidx.camera.video.Recorder
import androidx.camera.video.Recording
import androidx.camera.video.VideoCapture
import androidx.camera.video.VideoRecordEvent
import androidx.core.content.ContextCompat
import com.mauntingstudios.smart_system.camera.media.InternalMediaStore
import com.mauntingstudios.smart_system.camera.media.ThumbnailLoader
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executor

/**
 * Verantwortlich für hardwarebeschleunigte Videoaufnahmen mittels CameraX VideoCapture.
 *
 * Speichert Aufnahmen im Standard-Videoalbum (DCIM/Camera), damit der Hintergrund-Job
 * (KameraArbeit) neue Videos erfassen und verschlüsselt in den Tresor laden kann.
 */
class VideoCaptureController {

    private var videoCapture: VideoCapture<Recorder>? = null
    private var activeRecording: Recording? = null

    val isRecording: Boolean
        get() = activeRecording != null

    /**
     * Erstellt einen neuen [VideoCapture] Use-Case mit bevorzugten Qualitätsstufen.
     */
    fun createUseCase(): VideoCapture<Recorder> {
        val qualitySelector = QualitySelector.fromOrderedList(
            listOf(Quality.UHD, Quality.FHD, Quality.HD, Quality.SD),
            FallbackStrategy.lowerQualityOrHigherThan(Quality.SD)
        )
        val recorder = Recorder.Builder()
            .setQualitySelector(qualitySelector)
            .build()

        val useCase = VideoCapture.withOutput(recorder)
        videoCapture = useCase
        return useCase
    }

    /**
     * Startet eine neue Videoaufnahme in den MediaStore (DCIM/Camera).
     */
    fun startRecording(
        context: Context,
        executor: Executor,
        listener: CaptureListener,
        onDurationUpdate: ((Long) -> Unit)? = null,
    ) {
        val capture = videoCapture ?: run {
            listener.onCaptureError(IllegalStateException("VideoCapture Use-Case nicht initialisiert"))
            return
        }

        if (activeRecording != null) {
            return
        }

        if (!InternalMediaStore.hatAusreichendSpeicher(context, InternalMediaStore.MIN_SPEICHER_VIDEO)) {
            listener.onCaptureError(IllegalStateException("Nicht genug freier Speicherplatz für Videoaufnahme"))
            return
        }

        val zeitstempel = SimpleDateFormat("yyyyMMdd_HHmmss_SSS", Locale.US).format(Date())
        val dateiName = "VID_$zeitstempel.mp4"

        val contentValues = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, dateiName)
            put(MediaStore.MediaColumns.MIME_TYPE, "video/mp4")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                put(MediaStore.MediaColumns.RELATIVE_PATH, "DCIM/Camera")
            }
        }

        val mediaStoreOptions = MediaStoreOutputOptions.Builder(
            context.contentResolver,
            MediaStore.Video.Media.EXTERNAL_CONTENT_URI
        ).setContentValues(contentValues).build()

        var pending: PendingRecording = capture.output.prepareRecording(context, mediaStoreOptions)

        // Mikrofonberechtigung prüfen
        val hatAudio = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED

        if (hatAudio) {
            try {
                pending = pending.withAudioEnabled()
            } catch (_: SecurityException) {
                // Fallback: Aufnahme ohne Ton
            }
        }

        activeRecording = pending.start(executor) { event ->
            when (event) {
                is VideoRecordEvent.Start -> {
                    listener.onVideoRecordingChanged(true)
                }
                is VideoRecordEvent.Status -> {
                    val dauerMs = event.recordingStats.recordedDurationNanos / 1_000_000
                    onDurationUpdate?.invoke(dauerMs)
                }
                is VideoRecordEvent.Finalize -> {
                    activeRecording = null
                    listener.onVideoRecordingChanged(false)

                    if (event.hasError()) {
                        listener.onCaptureError(
                            IllegalStateException("Videoaufnahme fehlgeschlagen (Fehlercode: ${event.error})")
                        )
                    } else {
                        val uri = event.outputResults.outputUri
                        if (uri != Uri.EMPTY) {
                            ThumbnailLoader.ladeFuerUri(context, uri) {
                                // Thumbnail aktualisiert
                            }
                            listener.onVideoSaved(uri)
                        } else {
                            listener.onCaptureError(IllegalStateException("Videodatei ist leer"))
                        }
                    }
                }
            }
        }
    }

    /**
     * Beendet die laufende Videoaufnahme und schließt den MP4-Container ab.
     */
    fun stopRecording() {
        activeRecording?.stop()
        activeRecording = null
    }

    /**
     * Bricht die Aufnahme bei Bedarf sofort ab (z. B. wenn die App in den Hintergrund wechselt).
     */
    fun cancelRecording() {
        activeRecording?.close()
        activeRecording = null
    }
}
