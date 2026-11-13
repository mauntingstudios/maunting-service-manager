package com.mauntingstudios.smart_system.camera.ui

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
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
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import com.mauntingstudios.smart_system.camera.R
import com.mauntingstudios.smart_system.camera.capture.CaptureListener
import com.mauntingstudios.smart_system.camera.core.CameraEngine
import com.mauntingstudios.smart_system.camera.core.CameraExtension
import com.mauntingstudios.smart_system.camera.core.CaptureMode
import com.mauntingstudios.smart_system.camera.core.FlashMode
import com.mauntingstudios.smart_system.camera.media.InternalMediaStore
import com.mauntingstudios.smart_system.camera.media.ThumbnailLoader
import java.io.File
import java.util.Locale

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
    private lateinit var txtRecordingTimer: TextView
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
    private var letztesAufnahmeUri: Uri? = null

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

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }

        passeWindowInsetsAn()

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

    override fun onPause() {
        super.onPause()
        if (::cameraEngine.isInitialized && cameraEngine.isRecordingVideo) {
            cameraEngine.stopVideoRecording()
        }
    }

    private fun hatKameraBerechtigung(): Boolean {
        return ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.CAMERA
        ) == PackageManager.PERMISSION_GRANTED
    }

    private fun passeWindowInsetsAn() {
        val root = findViewById<View>(R.id.cameraRoot)
        val topBar = findViewById<View>(R.id.topBar)
        val bottomBar = findViewById<View>(R.id.bottomBar)
        val timer = findViewById<View>(R.id.txtRecordingTimer)

        val baseTopPadding = topBar.paddingTop
        val baseBottomPadding = bottomBar.paddingBottom
        val density = resources.displayMetrics.density

        ViewCompat.setOnApplyWindowInsetsListener(root) { _, windowInsets ->
            val insets = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )

            // Obere Steuerleiste sicher unterhalb der Statusleiste / Notch platzieren
            topBar.updatePadding(
                top = insets.top + baseTopPadding
            )

            // Untere Leiste über der Navigationsleiste platzieren
            bottomBar.updatePadding(
                bottom = insets.bottom + baseBottomPadding
            )

            // Video-Timer dynamisch unter der Leiste ausrichten
            val timerParams = timer.layoutParams as? FrameLayout.LayoutParams
            if (timerParams != null) {
                timerParams.topMargin = insets.top + (68 * density).toInt()
                timer.layoutParams = timerParams
            }

            windowInsets
        }
    }

    private fun initialisiereViews() {
        previewView = findViewById(R.id.previewView)
        focusRing = findViewById(R.id.focusRing)
        txtRecordingTimer = findViewById(R.id.txtRecordingTimer)
        btnBack = findViewById(R.id.btnBack)
        btnFlash = findViewById(R.id.btnFlash)
        btnHdr = findViewById(R.id.btnHdr)
        btnNight = findViewById(R.id.btnNight)
        txtModePhoto = findViewById(R.id.txtModePhoto)
        txtModeVideo = findViewById(R.id.txtModeVideo)
        btnThumbnailContainer = findViewById(R.id.btnThumbnailContainer)
        imgThumbnail = findViewById(R.id.imgThumbnail)

        val kreisOutline = object : android.view.ViewOutlineProvider() {
            override fun getOutline(view: View, outline: android.graphics.Outline) {
                outline.setOval(0, 0, view.width, view.height)
            }
        }
        btnThumbnailContainer.outlineProvider = kreisOutline
        btnThumbnailContainer.clipToOutline = true
        imgThumbnail.outlineProvider = kreisOutline
        imgThumbnail.clipToOutline = true

        btnShutter = findViewById(R.id.btnShutter)
        shutterInner = findViewById(R.id.shutterInner)
        btnSwitchLens = findViewById(R.id.btnSwitchLens)
    }

    private fun konfiguriereGesten() {
        scaleGestureDetector = ScaleGestureDetector(
            this,
            object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
                override fun onScale(detector: ScaleGestureDetector): Boolean {
                    cameraEngine.applyZoomFactor(detector.scaleFactor)
                    return true
                }
            }
        )

        var startY = 0f
        var isDraggingExposure = false
        val touchSlop = ViewConfiguration.get(this).scaledTouchSlop

        previewView.setOnTouchListener { view, event ->
            scaleGestureDetector.onTouchEvent(event)

            if (event.pointerCount > 1) {
                isDraggingExposure = false
                return@setOnTouchListener true
            }

            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    startY = event.y
                    isDraggingExposure = false
                }
                MotionEvent.ACTION_MOVE -> {
                    val deltaY = startY - event.y
                    if (Math.abs(deltaY) > touchSlop) {
                        isDraggingExposure = true
                        cameraEngine.stepExposure(if (deltaY > 0) 1 else -1)
                        startY = event.y
                    }
                }
                MotionEvent.ACTION_UP -> {
                    if (!isDraggingExposure && !scaleGestureDetector.isInProgress) {
                        zeigeFokusRing(event.x, event.y)
                        cameraEngine.focusAt(event.x, event.y)
                        view.performClick()
                    }
                    isDraggingExposure = false
                }
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

        txtModePhoto.setOnClickListener {
            if (cameraEngine.isRecordingVideo) return@setOnClickListener
            wechsleModus(CaptureMode.PHOTO)
        }

        txtModeVideo.setOnClickListener {
            if (cameraEngine.isRecordingVideo) return@setOnClickListener
            wechsleModus(CaptureMode.VIDEO)
        }

        btnShutter.setOnClickListener {
            if (cameraEngine.captureMode == CaptureMode.PHOTO) {
                loeseFotoAus()
            } else {
                toggleVideoAufnahme()
            }
        }

        btnThumbnailContainer.setOnClickListener {
            oeffneTresorOderVorschau()
        }
    }

    private fun wechsleModus(modus: CaptureMode) {
        cameraEngine.switchCaptureMode(modus)
        val density = resources.displayMetrics.density
        val size66 = (66 * density).toInt()

        if (modus == CaptureMode.PHOTO) {
            txtModePhoto.setTextColor(Color.WHITE)
            txtModePhoto.setTypeface(null, Typeface.BOLD)
            txtModeVideo.setTextColor(Color.parseColor("#80ffffff"))
            txtModeVideo.setTypeface(null, Typeface.NORMAL)

            shutterInner.setBackgroundResource(R.drawable.bg_shutter_inner)
            val params = shutterInner.layoutParams
            params.width = size66
            params.height = size66
            shutterInner.layoutParams = params

            val features = cameraEngine.currentFeatureSet
            btnHdr.visibility = if (features?.isHdrSupported == true) View.VISIBLE else View.GONE
            btnNight.visibility = if (features?.isNightSupported == true) View.VISIBLE else View.GONE
            aktualisiereBlitzIcon(cameraEngine.flashMode)
        } else {
            txtModeVideo.setTextColor(Color.WHITE)
            txtModeVideo.setTypeface(null, Typeface.BOLD)
            txtModePhoto.setTextColor(Color.parseColor("#80ffffff"))
            txtModePhoto.setTypeface(null, Typeface.NORMAL)

            shutterInner.setBackgroundResource(R.drawable.bg_shutter_video_idle)
            val params = shutterInner.layoutParams
            params.width = size66
            params.height = size66
            shutterInner.layoutParams = params

            btnHdr.visibility = View.GONE
            btnNight.visibility = View.GONE
            aktualisiereBlitzIcon(if (cameraEngine.isTorchEnabled) FlashMode.ON else FlashMode.OFF)
        }
    }

    private fun starteKamera() {
        cameraEngine = CameraEngine(this, this, previewView)

        cameraEngine.setOnFeaturesUpdatedListener { features ->
            runOnUiThread {
                btnFlash.visibility = if (features.hasFlash) View.VISIBLE else View.GONE
                if (cameraEngine.captureMode == CaptureMode.PHOTO) {
                    btnHdr.visibility = if (features.isHdrSupported) View.VISIBLE else View.GONE
                    btnNight.visibility = if (features.isNightSupported) View.VISIBLE else View.GONE
                } else {
                    btnHdr.visibility = View.GONE
                    btnNight.visibility = View.GONE
                }
            }
        }

        cameraEngine.start {
            runOnUiThread {
                aktualisiereBlitzIcon(cameraEngine.flashMode)
            }
        }
    }

    private fun loeseFotoAus() {
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
                // Fotoaufnahme gestartet
            }

            override fun onPhotoSaved(uri: Uri) {
                runOnUiThread {
                    letztesAufnahmeUri = uri
                    ThumbnailLoader.ladeFuerUri(this@CameraActivity, uri) { bmp ->
                        if (bmp != null) {
                            imgThumbnail.setImageBitmap(bmp)
                            imgThumbnail.animate().alpha(1.0f).setDuration(200).start()
                        }
                    }
                }
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

    private fun toggleVideoAufnahme() {
        haptikFeedback()
        if (cameraEngine.isRecordingVideo) {
            cameraEngine.stopVideoRecording()
        } else {
            starteVideoAufnahme()
        }
    }

    private fun starteVideoAufnahme() {
        val density = resources.displayMetrics.density
        val size38 = (38 * density).toInt()

        shutterInner.setBackgroundResource(R.drawable.bg_shutter_video_recording)
        val params = shutterInner.layoutParams
        params.width = size38
        params.height = size38
        shutterInner.layoutParams = params

        txtRecordingTimer.text = "00:00"
        txtRecordingTimer.visibility = View.VISIBLE

        txtModePhoto.isEnabled = false
        txtModeVideo.isEnabled = false
        btnSwitchLens.isEnabled = false
        btnSwitchLens.alpha = 0.4f

        cameraEngine.startVideoRecording(
            listener = object : CaptureListener {
                override fun onVideoRecordingChanged(isRecording: Boolean) {
                    runOnUiThread {
                        if (!isRecording) {
                            setzeVideoUiZurueck()
                        }
                    }
                }

                override fun onVideoSaved(uri: Uri) {
                    runOnUiThread {
                        setzeVideoUiZurueck()
                        letztesAufnahmeUri = uri
                        ThumbnailLoader.ladeFuerUri(this@CameraActivity, uri) { bmp ->
                            if (bmp != null) {
                                imgThumbnail.setImageBitmap(bmp)
                                imgThumbnail.animate().alpha(1.0f).setDuration(200).start()
                            }
                        }
                    }
                }

                override fun onVideoSaved(file: File) {
                    runOnUiThread {
                        setzeVideoUiZurueck()
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
                        setzeVideoUiZurueck()
                        Toast.makeText(this@CameraActivity, error.localizedMessage ?: "Aufnahmefehler", Toast.LENGTH_SHORT).show()
                    }
                }
            },
            onDurationUpdate = { dauerMs ->
                runOnUiThread {
                    val gesamtSek = dauerMs / 1000
                    val min = gesamtSek / 60
                    val sek = gesamtSek % 60
                    txtRecordingTimer.text = String.format(Locale.US, "%02d:%02d", min, sek)
                }
            }
        )
    }

    private fun setzeVideoUiZurueck() {
        val density = resources.displayMetrics.density
        val size66 = (66 * density).toInt()

        shutterInner.setBackgroundResource(R.drawable.bg_shutter_video_idle)
        val params = shutterInner.layoutParams
        params.width = size66
        params.height = size66
        shutterInner.layoutParams = params

        txtRecordingTimer.visibility = View.GONE
        txtModePhoto.isEnabled = true
        txtModeVideo.isEnabled = true
        btnSwitchLens.isEnabled = true
        btnSwitchLens.alpha = 1.0f
    }

    private fun aktualisiereLetztesThumbnail() {
        ThumbnailLoader.ladeNeuestesAusMediaStore(this) { bmp, uri ->
            if (bmp != null && uri != null) {
                letztesAufnahmeUri = uri
                imgThumbnail.setImageBitmap(bmp)
                imgThumbnail.alpha = 1.0f
            } else {
                val ausstehende = InternalMediaStore.ausstehendeAufnahmen(this)
                ThumbnailLoader.ladeNeuestes(ausstehende) { localBmp ->
                    if (localBmp != null) {
                        imgThumbnail.setImageBitmap(localBmp)
                        imgThumbnail.alpha = 1.0f
                    } else {
                        imgThumbnail.setImageDrawable(null)
                        imgThumbnail.alpha = 0.0f
                    }
                }
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
        try {
            val decorView = window?.decorView
            val ok = decorView?.performHapticFeedback(
                HapticFeedbackConstants.CONFIRM
            ) ?: false

            if (!ok) {
                if (Build.VERSION.SDK_INT >= 31) {
                    val vibratorManager = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
                    vibratorManager?.defaultVibrator?.vibrate(
                        VibrationEffect.createPredefined(VibrationEffect.EFFECT_CLICK)
                    )
                } else {
                    @Suppress("DEPRECATION")
                    val vibrator = getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
                    @Suppress("DEPRECATION")
                    vibrator?.vibrate(VibrationEffect.createOneShot(35, VibrationEffect.DEFAULT_AMPLITUDE))
                }
            }
        } catch (_: Throwable) {
            // Haptik darf niemals den Aufnahmeablauf beeinträchtigen
        }
    }

    /**
     * Das Vorschaubild führt in die MSS-App: Dort zeigt der Tresor die
     * Aufnahme, und die Kamera-Sicherung lädt sie hoch, sobald sie an ist.
     * Die Kamera-App selbst kennt den Tresor nicht (eigene App, eigene Daten).
     */
    private fun oeffneTresorOderVorschau() {
        val intent = Intent().apply {
            setClassName(MSS_PAKET, MSS_HAUPTAKTIVITAET)
            action = MSS_ACTION_OPEN_VAULT
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP
            letztesAufnahmeUri?.let {
                putExtra("aufnahmeUri", it.toString())
                data = it
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
        }
        try {
            startActivity(intent)
        } catch (_: Exception) {
            Toast.makeText(this, "Maunting Smart System ist nicht installiert.", Toast.LENGTH_LONG).show()
        }
    }

    private companion object {
        const val MSS_PAKET = "com.mauntingstudios.smart_system"
        const val MSS_HAUPTAKTIVITAET = "com.mauntingstudios.smart_system.MainActivity"
        const val MSS_ACTION_OPEN_VAULT = "com.mauntingstudios.smart_system.OPEN_VAULT"
    }
}
