package com.mauntingstudios.smart_system.camera.capture

import java.io.File

/**
 * Ereignis-Listener für Aufnahmevorgänge der Kamera.
 */
interface CaptureListener {
    /** Wird unmittelbar beim Betätigen des Auslösers aufgerufen (z. B. für haptisches Feedback). */
    fun onCaptureStarted() {}

    /** Foto wurde erfolgreich auf den Datenträger geschrieben. */
    fun onPhotoSaved(file: File) {}

    /** Aufnahme ist fehlgeschlagen. */
    fun onCaptureError(error: Throwable) {}

    /** Statusänderung der Videoaufzeichnung. */
    fun onVideoRecordingChanged(isRecording: Boolean) {}

    /** Video wurde erfolgreich auf den Datenträger geschrieben. */
    fun onVideoSaved(file: File) {}
}
