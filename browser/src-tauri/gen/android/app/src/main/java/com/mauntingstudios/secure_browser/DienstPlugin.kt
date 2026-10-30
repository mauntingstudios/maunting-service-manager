package com.mauntingstudios.secure_browser

import android.Manifest
import android.app.Activity
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

/**
 * Steuerung des Dauerdienstes von der Oberfläche aus.
 *
 * Die Oberfläche ruft `dienst_starten`, `dienst_stoppen`, `dienst_stand` und
 * `dienst_akku_befreien`; `dienst.rs` reicht sie hier als `starten`,
 * `stoppen`, `laeuft` und `akkuBefreien` durch. Geprüft
 * wird hier nur die Form — den Ausweis prüft der Server. Er darf nur zuhören,
 * wird beim Abmelden widerrufen und ist je Gerät abschaltbar.
 */
@InvokeArg
class DienstStartArgs {
    var ausweis: String = ""
    var basis: String = ""
}

@TauriPlugin
class DienstPlugin(private val activity: Activity) : Plugin(activity) {

    @Command
    fun starten(invoke: Invoke) {
        val args = try {
            invoke.parseArgs(DienstStartArgs::class.java)
        } catch (e: Exception) {
            invoke.reject("Unvollständige Anfrage")
            return
        }
        // Ein Ausweis ist 64 Hexzeichen; alles andere wäre ein Tippfehler und
        // würde still einen Dienst starten, der nie etwas hört.
        if (args.ausweis.length != 64 || !args.basis.startsWith("http")) {
            invoke.reject("Unvollständiger Kanal-Ausweis")
            return
        }
        val ctx = activity.applicationContext
        Hintergrunddienst.einrichten(ctx, args.ausweis, args.basis)
        Hintergrunddienst.starten(ctx)

        // Ab Android 13 darf ohne diese Erlaubnis keine Meldung erscheinen —
        // der Dienst liefe, aber niemand sähe etwas.
        if (Build.VERSION.SDK_INT >= 33 &&
            activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 4201)
        }
        invoke.resolve()
    }

    @Command
    fun stoppen(invoke: Invoke) {
        Hintergrunddienst.stoppen(activity.applicationContext)
        invoke.resolve()
    }

    @Command
    fun laeuft(invoke: Invoke) {
        val ctx = activity.applicationContext
        val energie = activity.getSystemService(Context.POWER_SERVICE) as PowerManager
        val manager = NotificationManagerCompat.from(activity)
        // Die App-Berechtigung allein genügt nicht: der Kanal „Nachrichten“
        // kann zusätzlich stummgestellt sein. Dann bleibt die Warnung sichtbar.
        val meldungskanal = manager.getNotificationChannel(Hintergrunddienst.KANAL_MELDUNG)
        val erlaubt = manager.areNotificationsEnabled() &&
            meldungskanal?.importance != NotificationManager.IMPORTANCE_NONE
        invoke.resolve(
            JSObject().apply {
                put("aktiv", Hintergrunddienst.istEingeschaltet(ctx))
                put("akkuBefreit", energie.isIgnoringBatteryOptimizations(activity.packageName))
                put("benachrichtigungenErlaubt", erlaubt)
            },
        )
    }

    /** Öffnet die Benachrichtigungseinstellungen genau dieser App. */
    @Command
    fun einstellungenOeffnen(invoke: Invoke) {
        try {
            val absicht = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                putExtra(Settings.EXTRA_APP_PACKAGE, activity.packageName)
            }
            activity.startActivity(absicht)
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject(e.message ?: "Einstellungen nicht erreichbar")
        }
    }

    /**
     * Fragt die Akku-Ausnahme an.
     *
     * Ohne sie beenden Samsung und Xiaomi den Dienst nach Stunden still — und
     * genau das ist der Unterschied zwischen „kommt an" und „kommt manchmal
     * an". Der Dialog gehört dem System; wir öffnen ihn nur.
     */
    @Command
    fun akkuBefreien(invoke: Invoke) {
        try {
            val energie = activity.getSystemService(Context.POWER_SERVICE) as PowerManager
            if (!energie.isIgnoringBatteryOptimizations(activity.packageName)) {
                activity.startActivity(
                    Intent(
                        Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                        Uri.parse("package:${activity.packageName}"),
                    ),
                )
            }
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject(e.message ?: "Akku-Ausnahme nicht erreichbar")
        }
    }
}
