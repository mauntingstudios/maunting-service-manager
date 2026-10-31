package com.mauntingstudios.secure_browser

import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.atomic.AtomicReference

/**
 * Der UI-Faden darf ein Fremdprotokoll nicht selbst öffnen: `TabsBruecke.weg`
 * ruft den Opener über die Tauri-Plugin-Brücke, die auf eine Antwort aus genau
 * diesem Faden wartet. Vor dem Fix stand die App hier bis zum ANR (30.10.2026,
 * OAuth-Rücksprung der Shop-App). Der Test ruft `weg` im Main-Thread auf; ohne
 * den Fix bliebe er dort hängen, mit dem Fix kehrt er sofort zurück.
 */
@RunWith(AndroidJUnit4::class)
class TabsBrueckeTest {
  @Before
  fun setUp() {
    MainActivity.beendeProzessBeimSchliessen = false
  }

  @Test(timeout = 60_000)
  fun externeAdresseKehrtAusDemUiFadenZurueck() {
    // Bewusst ohne `close()`: Der Abbau der Tauri-Activity reißt auf dem
    // Emulator den Prozess mit (FORTIFY im WebView-Abbau), bevor der Lauf sein
    // Ergebnis meldet. Der Testprozess endet ohnehin mit dem Lauf.
    val szenario = ActivityScenario.launch(MainActivity::class.java)
    warteAufBruecke(szenario)
    val antwort = AtomicReference<String?>()
    InstrumentationRegistry.getInstrumentation().runOnMainSync {
      // Kein Gerät bedient dieses Protokoll: der Opener scheitert, aber erst
      // nachdem `weg` zurückgekehrt ist. Vor dem Fix blockierte er hier.
      antwort.set(TabsBruecke.weg("tab-test", "zzz-kein-handler://x", false))
    }
    assertEquals("-", antwort.get())
  }

  /**
   * Eine Seite lädt die Haupt-WebView erst, wenn die Tauri-Umgebung steht;
   * erst dann ist die Brücke in Rust angemeldet (`tabs::android::init`).
   */
  private fun warteAufBruecke(szenario: ActivityScenario<MainActivity>) {
    val frist = System.currentTimeMillis() + 30_000
    while (System.currentTimeMillis() < frist) {
      var bereit = false
      szenario.onActivity { activity ->
        val ansicht = findeWebView(activity.window.decorView)
        bereit = ansicht?.url?.startsWith("http") == true && ansicht.progress == 100
      }
      if (bereit) return
      Thread.sleep(200)
    }
    throw AssertionError("Die Tauri-Brücke wurde nicht bereit")
  }

  private fun findeWebView(view: View): WebView? {
    if (view is WebView) return view
    if (view is ViewGroup) {
      for (i in 0 until view.childCount) {
        findeWebView(view.getChildAt(i))?.let { return it }
      }
    }
    return null
  }
}
