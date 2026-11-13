package com.mauntingstudios.smart_system.camera.core

import android.content.Context
import androidx.camera.core.Camera
import androidx.camera.core.CameraControl
import androidx.camera.core.CameraInfo
import androidx.camera.core.CameraSelector
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.Preview
import androidx.camera.extensions.ExtensionMode
import androidx.camera.extensions.ExtensionsManager
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.mauntingstudios.smart_system.camera.capabilities.CameraCapabilityDetector
import com.mauntingstudios.smart_system.camera.capabilities.CameraFeatureSet
import com.mauntingstudios.smart_system.camera.capture.CaptureListener
import com.mauntingstudios.smart_system.camera.capture.PhotoCaptureController
import com.mauntingstudios.smart_system.camera.capture.VideoCaptureController
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit

/**
 * Der zentrale Koordinator für die CameraX-Pipeline.
 *
 * Verwaltet Provider, Extensions, Lebenszyklusbindung, Fokus, Belichtung,
 * Zoom und Auslösung ohne Blockaden des UI-Threads.
 */
class CameraEngine(
    private val context: Context,
    private val lifecycleOwner: LifecycleOwner,
    private val previewView: PreviewView,
) {
    private val mainExecutor: Executor = ContextCompat.getMainExecutor(context)
    private var cameraProvider: ProcessCameraProvider? = null
    private var extensionsManager: ExtensionsManager? = null

    private var activeCamera: Camera? = null
    private val photoController = PhotoCaptureController()
    private val videoController = VideoCaptureController()

    var lensFacing: LensFacing = LensFacing.BACK
        private set
    var flashMode: FlashMode = FlashMode.OFF
        private set
    var extension: CameraExtension = CameraExtension.NONE
        private set
    var captureMode: CaptureMode = CaptureMode.PHOTO
        private set
    var isTorchEnabled: Boolean = false
        private set
    var currentExposureIndex: Int = 0
        private set

    val isRecordingVideo: Boolean
        get() = videoController.isRecording

    val currentZoomRatio: Float
        get() = activeCamera?.cameraInfo?.zoomState?.value?.zoomRatio ?: 1.0f

    var currentFeatureSet: CameraFeatureSet? = null
        private set

    private var onFeaturesUpdated: ((CameraFeatureSet) -> Unit)? = null
    private var onStateChanged: ((CameraEngineState) -> Unit)? = null

    fun setOnFeaturesUpdatedListener(listener: (CameraFeatureSet) -> Unit) {
        onFeaturesUpdated = listener
    }

    fun setOnStateChangedListener(listener: (CameraEngineState) -> Unit) {
        onStateChanged = listener
    }

    /**
     * Initialisiert den CameraProvider und ExtensionsManager asynchron.
     */
    fun start(onReady: () -> Unit = {}) {
        onStateChanged?.invoke(CameraEngineState.Initializing)

        val providerFuture = ProcessCameraProvider.getInstance(context)
        providerFuture.addListener({
            try {
                val provider = providerFuture.get()
                cameraProvider = provider

                // Extensions initialisieren
                val extFuture = ExtensionsManager.getInstanceAsync(context, provider)
                extFuture.addListener({
                    extensionsManager = try {
                        extFuture.get()
                    } catch (_: Exception) {
                        null
                    }
                    bindUseCases()
                    onReady()
                }, mainExecutor)
            } catch (e: Exception) {
                onStateChanged?.invoke(CameraEngineState.Error(e))
            }
        }, mainExecutor)
    }

    /**
     * Bindet Preview und die passenden Use-Cases an den aktuellen Lebenszyklus.
     */
    fun bindUseCases() {
        val provider = cameraProvider ?: return

        provider.unbindAll()

        val baseSelector = lensFacing.selector
        val extManager = extensionsManager

        val preview = Preview.Builder().build().also {
            it.surfaceProvider = previewView.surfaceProvider
        }

        try {
            val camera = if (captureMode == CaptureMode.VIDEO) {
                // Extensions sind im Videomodus nicht verfügbar; direkte Bindung an Basissensor
                val videoUseCase = videoController.createUseCase()
                provider.bindToLifecycle(
                    lifecycleOwner,
                    baseSelector,
                    preview,
                    videoUseCase
                )
            } else {
                // Foto-Modus: Prüfe gewählte Extension oder falle kontrolliert zurück
                val effectiveSelector = when (extension) {
                    CameraExtension.HDR -> {
                        if (extManager != null && extManager.isExtensionAvailable(baseSelector, ExtensionMode.HDR)) {
                            extManager.getExtensionEnabledCameraSelector(baseSelector, ExtensionMode.HDR)
                        } else {
                            extension = CameraExtension.NONE
                            baseSelector
                        }
                    }
                    CameraExtension.NIGHT -> {
                        if (extManager != null && extManager.isExtensionAvailable(baseSelector, ExtensionMode.NIGHT)) {
                            extManager.getExtensionEnabledCameraSelector(baseSelector, ExtensionMode.NIGHT)
                        } else {
                            extension = CameraExtension.NONE
                            baseSelector
                        }
                    }
                    CameraExtension.NONE -> baseSelector
                }

                val imageCapture = photoController.createUseCase(
                    flashMode = flashMode,
                    enableUltraHdr = (extension != CameraExtension.NIGHT)
                )

                provider.bindToLifecycle(
                    lifecycleOwner,
                    effectiveSelector,
                    preview,
                    imageCapture
                )
            }

            activeCamera = camera

            // Taschenlampe im Videomodus wiederherstellen
            if (isTorchEnabled && captureMode == CaptureMode.VIDEO && camera.cameraInfo.hasFlashUnit()) {
                camera.cameraControl.enableTorch(true)
            }

            // Fähigkeiten des gewählten Sensors ermitteln
            val features = CameraCapabilityDetector.detect(camera.cameraInfo, baseSelector, extManager)
            currentFeatureSet = features
            onFeaturesUpdated?.invoke(features)
            onStateChanged?.invoke(CameraEngineState.Ready(camera.cameraInfo))
        } catch (e: Exception) {
            onStateChanged?.invoke(CameraEngineState.Error(e))
        }
    }

    /**
     * Wechselt zwischen Foto- und Videoaufnahme.
     */
    fun switchCaptureMode(mode: CaptureMode) {
        if (captureMode == mode) return
        if (videoController.isRecording) {
            stopVideoRecording()
        }
        if (isTorchEnabled) {
            setTorch(false)
        }
        captureMode = mode
        bindUseCases()
    }

    /**
     * Wechselt zwischen Front- und Rückkamera.
     */
    fun switchLens() {
        if (videoController.isRecording) {
            stopVideoRecording()
        }
        isTorchEnabled = false
        lensFacing = lensFacing.toggle()
        bindUseCases()
    }

    /**
     * Schaltet die Beleuchtung um:
     * - Im Fotomodus: OFF -> ON -> AUTO -> OFF
     * - Im Videomodus: Taschenlampe EIN / AUS
     */
    fun toggleFlash(): FlashMode {
        if (captureMode == CaptureMode.VIDEO) {
            val neuerStatus = !isTorchEnabled
            setTorch(neuerStatus)
            return if (neuerStatus) FlashMode.ON else FlashMode.OFF
        }
        flashMode = flashMode.next()
        photoController.setFlashMode(flashMode)
        return flashMode
    }

    /**
     * Aktiviert oder deaktiviert die Dauerbeleuchtung (Torch).
     */
    fun setTorch(enabled: Boolean) {
        val control = activeCamera?.cameraControl ?: return
        if (activeCamera?.cameraInfo?.hasFlashUnit() == true) {
            isTorchEnabled = enabled
            control.enableTorch(enabled)
        }
    }

    /**
     * Aktiviert oder deaktiviert eine Kameraerweiterung (z. B. HDR oder Nachtmodus).
     */
    fun setCameraExtension(newExtension: CameraExtension) {
        if (extension == newExtension) return
        extension = newExtension
        bindUseCases()
    }

    /**
     * Fokussiert auf den übergebenen Punkt der Vorschau (Touch-to-Focus)
     * mit automatischer 3-Sekunden-Rückkehr zum kontinuierlichen Autofokus.
     */
    fun focusAt(x: Float, y: Float) {
        val control = activeCamera?.cameraControl ?: return
        val factory = previewView.meteringPointFactory
        val point = factory.createPoint(x, y)
        val action = FocusMeteringAction.Builder(point, FocusMeteringAction.FLAG_AF or FocusMeteringAction.FLAG_AE)
            .setAutoCancelDuration(3, TimeUnit.SECONDS)
            .build()
        control.startFocusAndMetering(action)
    }

    /**
     * Passt den linearen Zoom an (0.0f = weiteste Stufe, 1.0f = maximale Vergrößerung).
     */
    fun setLinearZoom(linear: Float) {
        val control = activeCamera?.cameraControl ?: return
        control.setLinearZoom(linear.coerceIn(0.0f, 1.0f))
    }

    /**
     * Passt das Zoomverhältnis direkt an (z. B. Preset-Stufen 1.0x, 2.0x).
     */
    fun setZoomRatio(ratio: Float) {
        val control = activeCamera?.cameraControl ?: return
        val features = currentFeatureSet ?: return
        val min = features.zoomRange.lower
        val max = features.zoomRange.upper
        control.setZoomRatio(ratio.coerceIn(min, max))
    }

    /**
     * Wendet einen relativen Zoom-Faktor auf die aktuelle Vergrößerung an (Pinch-to-Zoom).
     */
    fun applyZoomFactor(factor: Float) {
        val control = activeCamera?.cameraControl ?: return
        val current = currentZoomRatio
        val features = currentFeatureSet ?: return
        val min = features.zoomRange.lower
        val max = features.zoomRange.upper
        val target = (current * factor).coerceIn(min, max)
        control.setZoomRatio(target)
    }

    /**
     * Stellt den Belichtungskorrekturwert ein.
     */
    fun setExposureIndex(index: Int) {
        val control = activeCamera?.cameraControl ?: return
        val features = currentFeatureSet ?: return
        val clamped = index.coerceIn(features.exposureRange.lower, features.exposureRange.upper)
        currentExposureIndex = clamped
        control.setExposureCompensationIndex(clamped)
    }

    /**
     * Verschiebt die Belichtungskorrektur relativ um [delta] Stufen.
     */
    fun stepExposure(delta: Int) {
        setExposureIndex(currentExposureIndex + delta)
    }

    /**
     * Löst eine Fotoaufnahme aus.
     */
    fun takePhoto(listener: CaptureListener) {
        photoController.takePhoto(context, mainExecutor, listener)
    }

    /**
     * Startet eine neue Videoaufnahme.
     */
    fun startVideoRecording(listener: CaptureListener, onDurationUpdate: ((Long) -> Unit)? = null) {
        videoController.startRecording(context, mainExecutor, listener, onDurationUpdate)
    }

    /**
     * Beendet die laufende Videoaufnahme geordnet.
     */
    fun stopVideoRecording() {
        videoController.stopRecording()
    }

    /**
     * Bricht die Videoaufnahme sofort ab.
     */
    fun cancelVideoRecording() {
        videoController.cancelRecording()
    }
}
