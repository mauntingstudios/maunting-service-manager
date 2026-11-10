package com.mauntingstudios.smart_system.camera

import com.mauntingstudios.smart_system.camera.core.CaptureMode
import com.mauntingstudios.smart_system.camera.core.FlashMode
import com.mauntingstudios.smart_system.camera.core.LensFacing
import org.junit.Assert.assertEquals
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
}
