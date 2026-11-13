package com.mauntingstudios.smart_system.camera.core

import androidx.camera.core.CameraInfo
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture

/**
 * Zustandsobjekte und Aufzählungen für die native Kamera.
 *
 * Verwaltet Ausrichtung, Blitz, Aufnahmemodus und Funktionszustände
 * ohne unnötige Abstraktionen.
 */

enum class LensFacing(val selector: CameraSelector) {
    BACK(CameraSelector.DEFAULT_BACK_CAMERA),
    FRONT(CameraSelector.DEFAULT_FRONT_CAMERA);

    fun toggle(): LensFacing = if (this == BACK) FRONT else BACK
}

enum class FlashMode(val imageCaptureMode: Int) {
    OFF(ImageCapture.FLASH_MODE_OFF),
    ON(ImageCapture.FLASH_MODE_ON),
    AUTO(ImageCapture.FLASH_MODE_AUTO);

    fun next(): FlashMode = when (this) {
        OFF -> ON
        ON -> AUTO
        AUTO -> OFF
    }
}

enum class CaptureMode {
    PHOTO,
    VIDEO;

    fun toggle(): CaptureMode = if (this == PHOTO) VIDEO else PHOTO
}

enum class CameraExtension {
    NONE,
    HDR,
    NIGHT
}

data class ZoomState(
    val minZoom: Float = 1.0f,
    val maxZoom: Float = 1.0f,
    val currentZoom: Float = 1.0f,
    val linearZoom: Float = 0.0f,
)

sealed class CameraEngineState {
    object Uninitialized : CameraEngineState()
    object Initializing : CameraEngineState()
    data class Ready(val cameraInfo: CameraInfo) : CameraEngineState()
    data class Error(val cause: Throwable) : CameraEngineState()
}
