/**
 * Der Vordergrunddienst auf Android — einschalten, ausschalten, Stand lesen.
 *
 * **Warum ein eigener Ausweis.** Der Zugangstoken des Panels lebt 15 Minuten.
 * Ein Dienst, der sich damit verbindet, verstummt nach einer Viertelstunde —
 * genau in dem Fall, für den es ihn gibt. Beim Einschalten wird deshalb einmal
 * ein Kanal-Ausweis angelegt (`POST /notifications/channels`), gegen einen
 * frischen Nachweis. Er gilt, bis er widerrufen wird, und der Dienst erneuert
 * ihn nie selbst: zwei Rotationen auf derselben Familie würden sie sperren.
 *
 * **Was der Dienst darf.** Nur zuhören. Er liest den Ereignisstrom, meldet
 * seine Präsenz als „hintergrund" und zeigt eine Meldung, wenn der Server
 * **ihn** als Zusteller wählt (`melden`). Zeigt ein offenes Fenster dieselbe
 * Nachricht, bleibt er still — das entscheidet der Server, nicht der Dienst.
 *
 * **Wo der Ausweis liegt.** In den privaten Einstellungen der App
 * (`SharedPreferences`), nicht im localStorage: die Oberfläche braucht ihn
 * nach dem Einschalten nie wieder. Nur die Kennung des Kanals bleibt hier, um
 * ihn beim Ausschalten widerrufen zu können.
 */

import { invoke } from '@tauri-apps/api/core'

import { api } from '@/api/client'
import { getEffectiveApiUrl } from '@/config/api'
import { getStorageItem, removeStorageItem, setStorageItem } from '@/lib/offlineAblage'

const KANAL_ABLAGE = 'msm:hintergrundkanal'

/** Läuft die App auf einem Android-Gerät? Nur dort gibt es den Dienst. */
export function aufAndroid(): boolean {
  return typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)
}

function inTauri(): boolean {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
}

/** Der Dienst ist nur auf Android und nur in der App verfügbar. */
export function dienstVerfuegbar(): boolean {
  return aufAndroid() && inTauri()
}

/**
 * Die Adresse des Panels — zur Zeit des Aufrufs, nicht beim Laden des Moduls.
 *
 * In der App setzt erst `konfigLaden()` die Laufzeitadresse; ein beim Import
 * eingefrorener Wert wäre `tauri.localhost` und der Dienst verbände sich mit
 * sich selbst.
 */
function panelBasis(): string {
  const absolut = getEffectiveApiUrl()
  if (absolut) return absolut
  return typeof window !== 'undefined' && window.location?.origin ? window.location.origin : ''
}

export interface DienstStand {
  aktiv: boolean
  /** Ist die App von der Akku-Optimierung ausgenommen? */
  akkuBefreit: boolean
  /** Darf Android die Meldungen des Dienstes überhaupt zeigen? */
  benachrichtigungenErlaubt: boolean
}

export async function stand(): Promise<DienstStand> {
  if (!dienstVerfuegbar()) return { aktiv: false, akkuBefreit: false, benachrichtigungenErlaubt: false }
  try {
    return await invoke<DienstStand>('dienst_stand')
  } catch {
    return { aktiv: false, akkuBefreit: false, benachrichtigungenErlaubt: false }
  }
}

function merkeKanal(id: number | null): void {
  if (id === null) removeStorageItem(KANAL_ABLAGE)
  else setStorageItem(KANAL_ABLAGE, String(id))
}

function gemerkterKanal(): number | null {
  const roh = getStorageItem(KANAL_ABLAGE)
  const zahl = Number(roh)
  return Number.isFinite(zahl) && zahl > 0 ? zahl : null
}

/**
 * Einschalten: Ausweis anlegen, Dienst starten, Akku-Ausnahme anbieten.
 *
 * Der Ausweis ist ein reiner Lese-Zugang für den Ereignisstrom. Die gültige
 * Sitzung genügt; er wird beim Abmelden widerrufen und ist je Gerät widerrufbar.
 *
 * Gibt `false` zurück, wenn der Dienst hier nicht verfügbar ist oder das
 * Anlegen scheitert — der Aufrufer zeigt dann den Grund.
 */
export async function einschalten(label?: string): Promise<boolean> {
  if (!dienstVerfuegbar()) return false

  let kanal: { id: number; token: string }
  try {
    kanal = await api<{ id: number; token: string }>('/notifications/channels', {
      method: 'POST',
      body: JSON.stringify({ label: (label || 'Android').slice(0, 64) }),
    })
  } catch {
    return false
  }
  merkeKanal(kanal.id)

  await invoke('dienst_starten', {
    ausweis: kanal.token,
    basis: panelBasis(),
  })
  // Die Akku-Ausnahme ist der Unterschied zwischen „kommt an" und „kommt
  // manchmal an": ohne sie beendet Samsung/Xiaomi den Dienst nach Stunden.
  await invoke('dienst_akku_befreien').catch(() => {})
  return true
}

/**
 * Nach dem Start den Dienst an den Kontoschalter angleichen.
 *
 * An: läuft er nicht, wird er gestartet; aus: ein noch laufender Dienst wird
 * gestoppt. So wirkt ein Ausschalten auf einem anderen Gerät spätestens beim
 * nächsten Start auch hier.
 */
export async function sicherstellen(erlaubt: boolean): Promise<void> {
  if (!dienstVerfuegbar()) return
  const lage = await stand()
  if (!erlaubt) {
    if (lage.aktiv) await ausschalten()
    return
  }
  if (lage.aktiv) return
  await einschalten('Android')
}

/**
 * Ausschalten: Dienst stoppen und den Ausweis widerrufen.
 *
 * Beides, und in dieser Reihenfolge: erst hört der Dienst auf, dann verliert er
 * seinen Ausweis. Andersherum liefe er kurz gegen ein bereits gesperrtes Konto.
 */
export async function ausschalten(): Promise<void> {
  if (!dienstVerfuegbar()) return
  const kanal = gemerkterKanal()
  await invoke('dienst_stoppen').catch(() => {})
  merkeKanal(null)
  if (kanal !== null) {
    await api(`/notifications/channels/${kanal}`, { method: 'DELETE' }).catch(() => {})
  }
}
