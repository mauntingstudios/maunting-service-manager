package com.mauntingstudios.smart_system.camera.capabilities

import android.util.Range
import android.util.Rational
import androidx.camera.core.CameraInfo
import androidx.camera.core.CameraSelector
import androidx.camera.extensions.ExtensionMode
import androidx.camera.extensions.ExtensionsManager

/**
 * Ermittelte Fähigkeiten des aktuell aktiven Kamerasensors.
 */
data class CameraFeatureSet(
    val hasFlash: Boolean,
    val isHdrSupported: Boolean,
    val isNightSupported: Boolean,
    val zoomRange: Range<Float>,
    val exposureRange: Range<Int>,
    val exposureStep: Rational,
)

/**
 * Laufzeiterkennung der verfügbaren Hardwarefunktionen des Kamerasensors
 * und der installierten Hersteller-Extensions.
 */
object CameraCapabilityDetector {

    fun detect(
        cameraInfo: CameraInfo,
        selector: CameraSelector,
        extensionsManager: ExtensionsManager?,
    ): CameraFeatureSet {
        val hasFlash = cameraInfo.hasFlashUnit()
        val isHdr = extensionsManager?.isExtensionAvailable(selector, ExtensionMode.HDR) ?: false
        val isNight = extensionsManager?.isExtensionAvailable(selector, ExtensionMode.NIGHT) ?: false

        val zoomRatio = cameraInfo.zoomState.value
        val zoomRange = if (zoomRatio != null) {
            Range(zoomRatio.minZoomRatio, zoomRatio.maxZoomRatio)
        } else {
            Range(1.0f, 1.0f)
        }

        val exposure = cameraInfo.exposureState
        val exposureRange = exposure.exposureCompensationRange
        val exposureStep = exposure.exposureCompensationStep

        return CameraFeatureSet(
            hasFlash = hasFlash,
            isHdrSupported = isHdr,
            isNightSupported = isNight,
            zoomRange = zoomRange,
            exposureRange = exposureRange,
            exposureStep = exposureStep,
        )
    }
}
