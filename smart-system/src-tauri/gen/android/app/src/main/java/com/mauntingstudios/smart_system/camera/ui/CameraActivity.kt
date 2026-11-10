package com.mauntingstudios.smart_system.camera.ui

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import android.view.animation.OvershootInterpolator
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.mauntingstudios.smart_system.MainActivity
import com.mauntingstudios.smart_system.R
import com.mauntingstudios.smart_system.camera.capture.CaptureListener
import com.mauntingstudios.smart_system.camera.core.CameraEngine
import com.mauntingstudios.smart_system.camera.core.CameraExtension
import com.mauntingstudios.smart_system.camera.core.FlashMode
import com.mauntingstudios.smart_system.camera.media.InternalMediaStore
import com.mauntingstudios.smart_system.camera.media.ThumbnailLoader
import java.io.File

/**
 * Native Kamera-Activity für Maunting Smart System.
 *
 * Bietet schnellen Start ohne WebView-Overhead, vollständige CameraX-Steuerung,
 * Hardware-Extensions (HDR, Nachtmodus), Gesten (Touch-to-Focus, Pinch-to-Zoom)
 * und direkte lokale Speicherung im isolierten App-Speicher.
 */
class CameraActivity : AppCompatActivity() {

    private lateinit var cameraEngine: CameraEngine

    private lateinit var previewView: androidx.camera.view.PreviewView
    private lateinit var focusRing: View
    private lateinit var btnBack: ImageButton
    private lateinit var btnFlash: ImageButton
    private lateinit var btnHdr: ImageButton
    private lateinit var btnNight: ImageButton
    private lateinit var txtModePhoto: TextView
    private lateinit var txtModeVideo: TextView
    private lateinit var btnThumbnailContainer: FrameLayout
    private lateinit var imgThumbnail: ImageView
    private lateinit var btnShutter: FrameLayout
    private lateinit var shutterInner: View
    private lateinit var btnSwitchLens: ImageButton

    private lateinit var scaleGestureDetector: ScaleGestureDetector

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { ergebnisse ->
        val kameraOk = ergebnisse[Manifest.permission.CAMERA] ?: false
        if (kameraOk) {
            starteKamera()
        } else {
            Toast.makeText(this, R.string.kamera_keine_berechtigung, Toast.LENGTH_LONG).show()
            finish()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_camera)

        initialisiereViews()
        konfiguriereGesten()
        konfiguriereButtons()

        if (hatKameraBerechtigung()) {
            starteKamera()
        } else {
            permissionLauncher.launch(
                arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)
            )
        }
    }

    override fun onResume() {
        super.onResume()
        aktualisiereLetztesThumbnail()
    }

    private fun hatKameraBerechtigung(): Boolean {
        return ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.CAMERA
        ) == PackageManager.PERMISSION_GRANTED
    }

    private fun initialisiereViews() {
        previewView = findViewById(R.id.previewView)
        focusRing = findViewById(R.id.focusRing)
        btnBack = findViewById(R.id.btnBack)
        btnFlash = findViewById(R.id.btnFlash)
        btnHdr = findViewById(R.id.btnHdr)
        btnNight = findViewById(R.id.btnNight)
        txtModePhoto = findViewById(R.id.txtModePhoto)
        txtModeVideo = findViewById(R.id.txtModeVideo)
        btnThumbnailContainer = findViewById(R.id.btnThumbnailContainer)
        imgThumbnail = findViewById(R.id.imgThumbnail)
        btnShutter = findViewById(R.id.btnShutter)
        shutterInner = findViewById(R.id.shutterInner)
        btnSwitchLens = findViewById(R.id.btnSwitchLens)
    }

    private fun konfiguriereGesten() {
        scaleGestureDetector = ScaleGestureDetector(
            this,
            object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
                override fun onScale(detector: ScaleGestureDetector): Boolean {
                    cameraEngine.setZoomRatio(detector.scaleFactor)
                    return true
                }
            }
        )

        previewView.setOnTouchListener { view, event ->
            scaleGestureDetector.onTouchEvent(event)

            if (event.action == MotionEvent.ACTION_UP && !scaleGestureDetector.isInProgress) {
                zeigeFokusRing(event.x, event.y)
                cameraEngine.focusAt(event.x, event.y)
                view.performClick()
            }
            true
        }
    }

    private fun zeigeFokusRing(x: Float, y: Float) {
        val halbeBreite = focusRing.width / 2f
        val halbeHoehe = focusRing.height / 2f

        focusRing.x = x - halbeBreite
        focusRing.y = y - halbeHoehe
        focusRing.alpha = 1.0f
        focusRing.scaleX = 1.3f
        focusRing.scaleY = 1.3f
        focusRing.visibility = View.VISIBLE

        focusRing.animate()
            .scaleX(1.0f)
            .scaleY(1.0f)
            .setDuration(220)
            .setInterpolator(OvershootInterpolator())
            .withEndAction {
                focusRing.animate()
                    .alpha(0.0f)
                    .setStartDelay(1800)
                    .setDuration(400)
                    .withEndAction { focusRing.visibility = View.GONE }
                    .start()
            }
            .start()
    }

    private fun konfiguriereButtons() {
        btnBack.setOnClickListener {
            finish()
        }

        btnFlash.setOnClickListener {
            val neuerModus = cameraEngine.toggleFlash()
            aktualisiereBlitzIcon(neuerModus)
        }

        btnHdr.setOnClickListener {
            val aktiv = (cameraEngine.extension == CameraExtension.HDR)
            val ziel = if (aktiv) CameraExtension.NONE else CameraExtension.HDR
            cameraEngine.setCameraExtension(ziel)
            btnHdr.isSelected = (ziel == CameraExtension.HDR)
            btnHdr.setColorFilter(if (btnHdr.isSelected) Color.parseColor("#38bdf8") else Color.WHITE)
        }

        btnNight.setOnClickListener {
            val aktiv = (cameraEngine.extension == CameraExtension.NIGHT)
            val ziel = if (aktiv) CameraExtension.NONE else CameraExtension.NIGHT
            cameraEngine.setCameraExtension(ziel)
            btnNight.isSelected = (ziel == CameraExtension.NIGHT)
            btnNight.setColorFilter(if (btnNight.isSelected) Color.parseColor("#facc15") else Color.WHITE)
        }

        btnSwitchLens.setOnClickListener {
            btnSwitchLens.animate().rotationBy(180f).setDuration(250).start()
            cameraEngine.switchLens()
        }

        btnShutter.setOnClickListener {
            loeseAus()
        }

        btnThumbnailContainer.setOnClickListener {
            oeffneTresorOderVorschau()
        }
    }

    private fun starteKamera() {
        cameraEngine = CameraEngine(this, this, previewView)

        cameraEngine.setOnFeaturesUpdatedListener { features ->
            runOnUiThread {
                btnFlash.visibility = if (features.hasFlash) View.VISIBLE else View.GONE
                btnHdr.visibility = if (features.isHdrSupported) View.VISIBLE else View.GONE
                btnNight.visibility = if (features.isNightSupported) View.VISIBLE else View.GONE
            }
        }

        cameraEngine.start {
            runOnUiThread {
                aktualisiereBlitzIcon(cameraEngine.flashMode)
            }
        }
    }

    private fun loeseAus() {
        haptikFeedback()

        shutterInner.animate()
            .scaleX(0.82f)
            .scaleY(0.82f)
            .setDuration(80)
            .withEndAction {
                shutterInner.animate().scaleX(1.0f).scaleY(1.0f).setDuration(120).start()
            }
            .start()

        cameraEngine.takePhoto(object : CaptureListener {
            override fun onCaptureStarted() {
                // Aufnahme läuft
            }

            override fun onPhotoSaved(file: File) {
                runOnUiThread {
                    ThumbnailLoader.ladeFuer(file) { bmp ->
                        if (bmp != null) {
                            imgThumbnail.setImageBitmap(bmp)
                            imgThumbnail.animate().alpha(1.0f).setDuration(200).start()
                        }
                    }
                }
            }

            override fun onCaptureError(error: Throwable) {
                runOnUiThread {
                    Toast.makeText(this@CameraActivity, error.localizedMessage ?: "Aufnahmefehler", Toast.LENGTH_SHORT).show()
                }
            }
        })
    }

    private fun aktualisiereLetztesThumbnail() {
        val ausstehende = InternalMediaStore.ausstehendeAufnahmen(this)
        ThumbnailLoader.ladeNeuestes(ausstehende) { bmp ->
            if (bmp != null) {
                imgThumbnail.setImageBitmap(bmp)
                imgThumbnail.alpha = 1.0f
            } else {
                imgThumbnail.setImageDrawable(null)
                imgThumbnail.alpha = 0.0f
            }
        }
    }

    private fun aktualisiereBlitzIcon(modus: FlashMode) {
        when (modus) {
            FlashMode.OFF -> {
                btnFlash.setImageResource(R.drawable.ic_flash_off)
                btnFlash.setColorFilter(Color.WHITE)
            }
            FlashMode.ON -> {
                btnFlash.setImageResource(R.drawable.ic_flash_on)
                btnFlash.setColorFilter(Color.parseColor("#facc15"))
            }
            FlashMode.AUTO -> {
                btnFlash.setImageResource(R.drawable.ic_flash_auto)
                btnFlash.setColorFilter(Color.parseColor("#38bdf8"))
            }
        }
    }

    private fun haptikFeedback() {
        if (Build.VERSION.SDK_INT >= 31) {
            val vibratorManager = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
            val vibrator = vibratorManager?.defaultVibrator
            vibrator?.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_CLICK))
        } else {
            @Suppress("DEPRECATION")
            val vibrator = getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
            @Suppress("DEPRECATION")
            vibrator?.vibrate(VibrationEffect.createOneShot(35, VibrationEffect.DEFAULT_AMPLITUDE))
        }
    }

    private fun oeffneTresorOderVorschau() {
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        startActivity(intent)
    }
}
