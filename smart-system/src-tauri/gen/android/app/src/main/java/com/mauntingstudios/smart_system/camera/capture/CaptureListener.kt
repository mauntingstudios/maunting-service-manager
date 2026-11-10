package com.mauntingstudios.smart_system.camera.capture

import android.net.Uri
import java.io.File

/**
 * Ereignis-Listener für Aufnahmevorgänge der Kamera.
 */
interface CaptureListener {
    /** Wird unmittelbar beim Betätigen des Auslösers aufgerufen (z. B. für haptisches Feedback). */
    fun onCaptureStarted() {}

    /** Foto wurde erfolgreich auf den Datenträger geschrieben. */
    fun onPhotoSaved(file: File) {}

    /** Foto wurde im MediaStore / Speicher abgelegt. */
    fun onPhotoSaved(uri: Uri) {}

    /** Aufnahme ist fehlgeschlagen. */
    fun onCaptureError(error: Throwable) {}

    /** Statusänderung der Videoaufzeichnung. */
    fun onVideoRecordingChanged(isRecording: Boolean) {}

    /** Video wurde erfolgreich auf den Datenträger geschrieben. */
    fun onVideoSaved(file: File) {}

    /** Video wurde im MediaStore / Speicher abgelegt. */
    fun onVideoSaved(uri: Uri) {}
}
