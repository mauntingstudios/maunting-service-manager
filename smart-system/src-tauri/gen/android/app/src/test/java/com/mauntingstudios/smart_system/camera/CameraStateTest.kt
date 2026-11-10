package com.mauntingstudios.smart_system.camera

import com.mauntingstudios.smart_system.camera.core.CameraEngineState
import com.mauntingstudios.smart_system.camera.core.CameraExtension
import com.mauntingstudios.smart_system.camera.core.CaptureMode
import com.mauntingstudios.smart_system.camera.core.FlashMode
import com.mauntingstudios.smart_system.camera.core.LensFacing
import com.mauntingstudios.smart_system.camera.core.ZoomState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Prüft Zustandsübergänge der Kamera-Steuerung.
 */
class CameraStateTest {

    @Test
    fun `Objektivwechsel schaltet zwischen Rueckseite und Front um`() {
        assertEquals(LensFacing.FRONT, LensFacing.BACK.toggle())
        assertEquals(LensFacing.BACK, LensFacing.FRONT.toggle())
    }

    @Test
    fun `Blitz schaltet zyklisch zwischen Aus, Ein und Auto`() {
        assertEquals(FlashMode.ON, FlashMode.OFF.next())
        assertEquals(FlashMode.AUTO, FlashMode.ON.next())
        assertEquals(FlashMode.OFF, FlashMode.AUTO.next())
    }

    @Test
    fun `Modus schaltet zwischen Foto und Video um`() {
        assertEquals(CaptureMode.VIDEO, CaptureMode.PHOTO.toggle())
        assertEquals(CaptureMode.PHOTO, CaptureMode.VIDEO.toggle())
    }

    @Test
    fun `Kamera-Extensions sind wohldefiniert`() {
        val extensions = CameraExtension.values()
        assertEquals(3, extensions.size)
        assertTrue(extensions.contains(CameraExtension.NONE))
        assertTrue(extensions.contains(CameraExtension.HDR))
        assertTrue(extensions.contains(CameraExtension.NIGHT))
    }

    @Test
    fun `ZoomState haelt Standardwerte konsistent`() {
        val zoom = ZoomState(minZoom = 1.0f, maxZoom = 8.0f, currentZoom = 2.0f, linearZoom = 0.25f)
        assertEquals(1.0f, zoom.minZoom, 0.001f)
        assertEquals(8.0f, zoom.maxZoom, 0.001f)
        assertEquals(2.0f, zoom.currentZoom, 0.001f)
        assertEquals(0.25f, zoom.linearZoom, 0.001f)
    }

    @Test
    fun `CameraEngineState bildet Initialisierungsphasen sauber ab`() {
        val uninit: CameraEngineState = CameraEngineState.Uninitialized
        val init: CameraEngineState = CameraEngineState.Initializing
        val error: CameraEngineState = CameraEngineState.Error(IllegalStateException("Sensor defekt"))

        assertTrue(uninit is CameraEngineState.Uninitialized)
        assertTrue(init is CameraEngineState.Initializing)
        assertTrue(error is CameraEngineState.Error)
        assertEquals("Sensor defekt", (error as CameraEngineState.Error).cause.message)
    }
}
