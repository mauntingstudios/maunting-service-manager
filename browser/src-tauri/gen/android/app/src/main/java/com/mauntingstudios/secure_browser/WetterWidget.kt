package com.mauntingstudios.secure_browser

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import org.json.JSONArray
import java.time.OffsetDateTime
import java.time.ZoneId

/**
 * Wandelt den internen Lageschlüssel (z. B. "bewoelkt") in die lokalisierte
 * Anzeige mit echten Umlauten um ("Bewölkt").
 */
internal fun lageText(context: Context, lage: String?): String {
  return when (lage?.lowercase()) {
    "klar" -> context.getString(R.string.widget_wetter_lage_klar)
    "teils" -> context.getString(R.string.widget_wetter_lage_teils)
    "bewoelkt" -> context.getString(R.string.widget_wetter_lage_bewoelkt)
    "regen" -> context.getString(R.string.widget_wetter_lage_regen)
    "schnee" -> context.getString(R.string.widget_wetter_lage_schnee)
    null, "" -> ""
    else -> lage.replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }
  }
}

/** Liefert das passende Lucide-Vektorsymbol für die Wetterlage. */
internal fun lageSymbol(lage: String?): Int {
  return when (lage?.lowercase()) {
    "klar" -> R.drawable.widget_wetter_klar
    "teils" -> R.drawable.widget_wetter_teils
    "bewoelkt" -> R.drawable.widget_wetter_bewoelkt
    "regen" -> R.drawable.widget_wetter_regen
    "schnee" -> R.drawable.widget_wetter_schnee
    else -> R.drawable.widget_wetter_teils
  }
}

/**
 * Formatiert den ISO-8601-Zeitstempel einer Vorhersagestunde in die lokale
 * 24-Stunden-Uhrzeit (z. B. "14:00").
 */
internal fun stundeZeitFormatieren(zeitStr: String?): String {
  if (zeitStr.isNullOrBlank()) return "–"
  return try {
    val odt = OffsetDateTime.parse(zeitStr)
    val lokal = odt.atZoneSameInstant(ZoneId.systemDefault())
    String.format("%02d:00", lokal.hour)
  } catch (_: Exception) {
    val treffer = Regex("T(\\d{2}):").find(zeitStr)
    if (treffer != null) "${treffer.groupValues[1]}:00" else zeitStr
  }
}

/**
 * Das Wetter-Widget auf dem Startbildschirm. Es zeichnet die Werte, die
 * `WetterWorker` zuletzt geschrieben hat; der Worker läuft auch bei
 * geschlossener App und holt die Vorhersage ausschließlich über MSM.
 */
class WetterWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, verwalter: AppWidgetManager, kennungen: IntArray) {
    zeichnen(context, verwalter, kennungen)
    WetterWorker.planen(context)
  }

  override fun onReceive(context: Context, intent: Intent) {
    super.onReceive(context, intent)
    if (intent.action == AKTION_WETTER_AKTUALISIERT) {
      zeichnenAlle(context)
    } else if (intent.action == AKTION_WETTER_ANHEFTEN) {
      anheften(context)
    }
  }

  override fun onEnabled(context: Context) {
    WetterWorker.planen(context)
  }

  override fun onDisabled(context: Context) {
    WetterWorker.abbrechen(context)
  }

  companion object {
    const val ABLAGE = "wetter_widget"
    const val AKTION_WETTER_AKTUALISIERT = "com.mauntingstudios.secure_browser.WETTER_AKTUALISIERT"
    const val AKTION_WETTER_ANHEFTEN = "com.mauntingstudios.secure_browser.WETTER_ANHEFTEN"

    fun zeichnenAlle(context: Context) {
      val verwalter = AppWidgetManager.getInstance(context)
      zeichnen(context, verwalter, verwalter.getAppWidgetIds(ComponentName(context, WetterWidget::class.java)))
    }

    fun lage(context: Context): String {
      val verwalter = AppWidgetManager.getInstance(context)
      return when {
        verwalter.getAppWidgetIds(ComponentName(context, WetterWidget::class.java)).isNotEmpty() -> "liegt"
        verwalter.isRequestPinAppWidgetSupported -> "anheftbar"
        else -> "nein"
      }
    }

    fun anheften(context: Context): Boolean {
      val verwalter = AppWidgetManager.getInstance(context)
      return verwalter.isRequestPinAppWidgetSupported &&
        verwalter.requestPinAppWidget(ComponentName(context, WetterWidget::class.java), null, null)
    }

    private fun zeichnen(context: Context, verwalter: AppWidgetManager, kennungen: IntArray) {
      if (kennungen.isEmpty()) return
      val ablage = context.getSharedPreferences(ABLAGE, Context.MODE_PRIVATE)
      val ort = ablage.getString("ort", null)
      val temp = ablage.getString("temp", null)
      val lage = ablage.getString("lage", "")
      val stundenRoh = ablage.getString("stunden", null)
      val warnungTitel = ablage.getString("warnung_titel", null)
      val bereit = ort != null && temp != null

      val stundenArray = if (!stundenRoh.isNullOrBlank()) {
        try { JSONArray(stundenRoh) } catch (_: Exception) { null }
      } else null

      val stundenIds = listOf(
        Triple(R.id.wetter_stunde1_zeit, R.id.wetter_stunde1_icon, R.id.wetter_stunde1_temp),
        Triple(R.id.wetter_stunde2_zeit, R.id.wetter_stunde2_icon, R.id.wetter_stunde2_temp),
        Triple(R.id.wetter_stunde3_zeit, R.id.wetter_stunde3_icon, R.id.wetter_stunde3_temp),
      )

      kennungen.forEach { kennung ->
        val ansicht = RemoteViews(context.packageName, R.layout.widget_wetter).apply {
          // Kopfzeile: Symbol, Titel, Ort
          setImageViewResource(R.id.wetter_header_icon, if (bereit) lageSymbol(lage) else R.drawable.widget_wetter_teils)
          setTextViewText(R.id.wetter_header_titel, context.getString(R.string.widget_wetter_name))
          setTextViewText(R.id.wetter_ort, ort ?: "")

          // Aktuelles Wetter
          setTextViewText(R.id.wetter_temp, temp ?: "–")
          setTextViewText(
            R.id.wetter_lage,
            if (bereit) lageText(context, lage) else context.getString(R.string.widget_wetter_nicht_konfiguriert),
          )

          // Amtliche Warnungen (z. B. DWD): nur bei Vorliegen einblenden
          if (!warnungTitel.isNullOrBlank() && bereit) {
            setViewVisibility(R.id.wetter_warnung_container, View.VISIBLE)
            setTextViewText(R.id.wetter_warnung_text, warnungTitel)
          } else {
            setViewVisibility(R.id.wetter_warnung_container, View.GONE)
          }

          // 3-Stunden-Vorhersage
          if (stundenArray != null && stundenArray.length() > 0 && bereit) {
            val anzahl = minOf(3, stundenArray.length())
            for (i in 0 until anzahl) {
              val s = stundenArray.getJSONObject(i)
              val (zeitId, iconId, tempId) = stundenIds[i]
              setTextViewText(zeitId, stundeZeitFormatieren(s.optString("zeit", "")))
              setImageViewResource(iconId, lageSymbol(s.optString("lage", "teils")))
              setTextViewText(tempId, s.optString("temp", "–"))
            }
          } else {
            stundenIds.forEach { (zeitId, iconId, tempId) ->
              setTextViewText(zeitId, "–")
              setImageViewResource(iconId, R.drawable.widget_wetter_teils)
              setTextViewText(tempId, "–")
            }
          }

          setOnClickPendingIntent(R.id.wetter_flaeche, start(context))
        }
        verwalter.updateAppWidget(kennung, ansicht)
      }
    }

    private fun start(context: Context): PendingIntent {
      val absicht = Intent(context, MainActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      return PendingIntent.getActivity(
        context,
        0,
        absicht,
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )
    }
  }
}
