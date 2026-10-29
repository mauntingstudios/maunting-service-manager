/**
 * Client-seitige Ende-zu-Ende-Verschlüsselung (E2EE) für Notizen und Kalendereinträge in MSM.
 *
 * Invarianten:
 * - Der Server ist ein blindes Zero-Knowledge-Relais und erhält NIEMALS Klartext.
 * - Ciphertexte im Netzwerk und in der Datenbank tragen verbindliche Versionspräfixe:
 *     - Notizen:  `sv-note-v1:<base64(IV || ciphertext || authTag)>`
 *     - Kalender: `sv-cal-v1:<base64(IV || ciphertext || authTag)>`
 * - Kryptographie: DIS @msdis/shield mit AES-256-GCM und AAD-Bindung an die jeweilige Eintrags-UID.
 * - Schlüsselverwaltung: Lokaler per-User-Schlüssel (AES-GCM-256), persistent im Keystore / Storage.
 *   Bei Kopplung eines Neugeräts (APK / Desktop) wird der Schlüssel über den E2EE-Handover übergeben.
 * - Übergabe zwischen eigenen Geräten: nur an Geräte, die das Verzeichnis unter **diesem** Konto
 *   führt, versiegelt gegen deren Schlüssel von dort, und nur angenommen mit der Unterschrift eines
 *   solchen Geräts (`uebergabeDaten`). In die eigene Geräte-Mailbox darf jeder Freund, jedes
 *   Gruppenmitglied und jedes Gegenüber eines Direktchats Steuerumschläge legen; dass sich ein
 *   Umschlag öffnen lässt, sagt deshalb nur, *für* wen er ist — nie, von wem.
 */

import {
  encryptString,
  decryptString,
  importAesGcmRawKey,
} from '@msdis/shield/aead'
import {
  formatEnvelope,
  parseEnvelope,
  type VersionedCipherEnvelopeSpec,
} from '@msdis/shield/format-versioning'
import {
  DisDecryptionError,
  base64ToBytes,
  bytesToBase64,
} from '@msdis/shield/core'
import { signiere } from './absenderSignatur'
import { angemeldetesKonto } from '@/lib/angemeldetesKonto'
import { eigenesGeraet, pruefeGeraeteBeleg, type EigenesGeraet } from './e2eeGeraet'
import { getE2eeGeraete } from '@/api/social'
import {
  holeKontoschluessel,
  setzeKontoschluessel,
  type KontoschluesselStand,
} from '@/api/notizschluessel'

export const NOTE_ENVELOPE_SPEC: VersionedCipherEnvelopeSpec = {
  currentPrefix: 'sv-note-v1:',
  familyPrefix: 'sv-note-',
  subject: 'note ciphertext envelope',
}

export const CALENDAR_ENVELOPE_SPEC: VersionedCipherEnvelopeSpec = {
  currentPrefix: 'sv-cal-v1:',
  familyPrefix: 'sv-cal-',
  subject: 'calendar ciphertext envelope',
}

export const NOTE_CIPHERTEXT_PREFIX = 'sv-note-v1:'
export const CALENDAR_CIPHERTEXT_PREFIX = 'sv-cal-v1:'

/**
 * Generiert eine standardkonforme UUIDv4 für lokale Notiz- und Termin-Entitäten.
 */
export function generateClientEntityId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

const STORAGE_KEY_PREFIX = 'msm_e2ee_notes_key_'
const keyCache = new Map<number, CryptoKey>()
const rawKeyMemoryStore = new Map<number, string>()
const syncedInSession = new Set<number>()

/**
 * Die Kennung, unter der bis zum 22.09.2026 **jeder** Schlüssel landete.
 *
 * Der Schreibpfad in `offlineSync` reichte den `userId`-Parameter nicht durch,
 * also griff hier der Vorgabewert 1 — unabhängig davon, wer angemeldet war.
 * Der Lesepfad gab die echte Kennung mit und fand nichts. Für jedes Konto mit
 * einer anderen Kennung als 1 blieb damit alles Chiffretext.
 *
 * Der Schreibfehler ist behoben. Was unter dieser Kennung liegt, muss aber
 * weiter erreichbar bleiben, sonst wäre der gesamte Bestand verloren.
 */
const ALTSCHLUESSEL_KENNUNG = 1

const bestaetigteGeraeteFuerNotizen = new Set<string>()

export function bestaetigeGeraetFuerNotizenSchluessel(userId: number, deviceId: string): void {
  bestaetigteGeraeteFuerNotizen.add(`${userId}:${deviceId}`)
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(`msm_notes_approved_devices:${userId}`)
      const list: string[] = raw ? JSON.parse(raw) : []
      if (!list.includes(deviceId)) {
        list.push(deviceId)
        localStorage.setItem(`msm_notes_approved_devices:${userId}`, JSON.stringify(list))
      }
    }
  } catch {}
}

export function istGeraetBestaetigtFuerNotizenSchluessel(userId: number, deviceId: string): boolean {
  if (bestaetigteGeraeteFuerNotizen.has(`${userId}:${deviceId}`)) return true
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(`msm_notes_approved_devices:${userId}`)
      if (!raw) return false
      const list: string[] = JSON.parse(raw)
      return Array.isArray(list) && list.includes(deviceId)
    }
  } catch {
    return false
  }
  return false
}

/**
 * Leert den In-Memory-Schlüsselcache (z. B. bei Session-Wipe oder Tests).
 */
export function clearNotesKeyCache(): void {
  keyCache.clear()
  rawKeyMemoryStore.clear()
  syncedInSession.clear()
  bestaetigteGeraeteFuerNotizen.clear()
  nebenOhneAblage.clear()
  nebenImRam.clear()
  kontoAbdruck.clear()
  laufenderAbgleich.clear()
  laufendesErzeugen.clear()
  letzterAbgleich.clear()
  neuBelegt.clear()
}

/**
 * Ein anderes Fenster derselben Ablage hat den Schlüssel gewechselt.
 *
 * Die Desktop-App hat Hauptfenster und Overlay, jedes mit eigenem Speicher.
 * Bis 5.0.4 schrieb das eine weiter mit dem Schlüssel, den es zuerst gelesen
 * hatte, nachdem das andere den des Kontos übernommen hatte — für die übrigen
 * Geräte Blob. `storage` kommt nur in den *anderen* Fenstern an.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (!e.key?.startsWith(STORAGE_KEY_PREFIX)) return
    const userId = Number(e.key.slice(STORAGE_KEY_PREFIX.length))
    if (!Number.isInteger(userId)) return
    keyCache.delete(userId)
    rawKeyMemoryStore.delete(userId)
    letzterAbgleich.delete(userId)
    // Dieselbe Meldung wie beim Übernehmen hier: Notizen und Kalender dieses
    // Fensters entschlüsseln neu.
    window.dispatchEvent(new CustomEvent('msm:notes-key-updated', { detail: { userId } }))
  })
}

/**
 * Prüft synchron, ob für diesen Benutzer bereits ein lokaler Notizenschlüssel vorliegt.
 */
export function hasUserNotesKey(userId: number = 1): boolean {
  if (keyCache.has(userId) || rawKeyMemoryStore.has(userId)) {
    return true
  }
  const storageKey = `${STORAGE_KEY_PREFIX}${userId}`
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return !!window.localStorage.getItem(storageKey)
    }
  } catch {}
  return false
}

/**
 * Gibt den bestehenden Schlüssel des Nutzers zurück, falls vorhanden.
 * Versucht bei Fehlen einen Mailbox-Abruf, erzeugt aber NIEMALS selbstständig einen neuen Zufallsschlüssel.
 */
export async function getUserNotesKey(userId: number = 1): Promise<CryptoKey | null> {
  const cached = keyCache.get(userId)
  if (cached) {
    return cached
  }

  const storageKey = `${STORAGE_KEY_PREFIX}${userId}`
  let rawBase64: string | null = null

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      rawBase64 = window.localStorage.getItem(storageKey)
    }
  } catch {}

  if (!rawBase64) {
    rawBase64 = rawKeyMemoryStore.get(userId) ?? null
  }

  if (!rawBase64) {
    try {
      const received = await checkAndReceiveDeviceNotesKey(userId)
      if (received) {
        rawBase64 = exportUserNotesKey(userId)
      }
    } catch {}
  }

  if (!rawBase64) {
    return null
  }

  const rawBytes = base64ToBytes(rawBase64)
  const importedKey = await importAesGcmRawKey(rawBytes, ['encrypt', 'decrypt'])
  keyCache.set(userId, importedKey)
  return importedKey
}

/**
 * Ermittelt oder erzeugt den symmetrischen AES-256-GCM E2EE-Schlüssel für Notizen & Kalender.
 * Bleibt rein auf dem Client und wird NIEMALS an den Server übertragen.
 */
export function getOrCreateUserNotesKey(userId: number = 1): Promise<CryptoKey> {
  const cached = keyCache.get(userId)
  if (cached) {
    if (!syncedInSession.has(userId)) {
      syncedInSession.add(userId)
      void syncNotesKeyToPairedDevices(userId).catch(() => {})
    }
    return Promise.resolve(cached)
  }
  // Ein Lauf je Konto. Seit dem Warten auf den Kontoschlüssel dauert einer
  // Sekunden; zwei zugleich (Notiz und Termin, zwei Speichervorgänge) erzeugten
  // sonst je einen Schlüssel, und der zweite überschriebe den ersten — mit dem
  // eben Gespeicherten darunter (Durchsicht 30.09.2026).
  const schon = laufendesErzeugen.get(userId)
  if (schon) return schon
  const lauf = holeOderErzeuge(userId).finally(() => laufendesErzeugen.delete(userId))
  laufendesErzeugen.set(userId, lauf)
  return lauf
}

const laufendesErzeugen = new Map<number, Promise<CryptoKey>>()

async function holeOderErzeuge(userId: number): Promise<CryptoKey> {
  const storageKey = `${STORAGE_KEY_PREFIX}${userId}`
  let rawBase64: string | null = null

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      rawBase64 = window.localStorage.getItem(storageKey)
    }
  } catch {
    // LocalStorage ggf. gesperrt
  }

  if (!rawBase64) {
    rawBase64 = rawKeyMemoryStore.get(userId) ?? null
  }

  // Falls der Schlüssel lokal noch fehlt, versuchen wir ihn aus der Geräte-Mailbox zu empfangen
  if (!rawBase64) {
    try {
      const received = await checkAndReceiveDeviceNotesKey(userId)
      if (received) {
        const afterReceive = exportUserNotesKey(userId)
        if (afterReceive) {
          rawBase64 = afterReceive
        }
      }
    } catch {
      // Fehler beim Mailbox-Abruf ignorieren
    }
  }

  if (!rawBase64) {
    rawBase64 = await aufKontoschluesselWarten(userId)
  }

  // Hier wird der Altbestand unter der Kennung 1 **nicht** übernommen, obwohl
  // er oft genau der gesuchte Schlüssel wäre. Er ist mehrdeutig: auf einem
  // geteilten Gerät gehört er dem Konto 1, und eine Übernahme ohne Nachweis
  // gäbe dem zweiten Konto den Schlüssel des ersten. Die Übernahme steht in
  // `altschluesselUebernehmen` und verlangt einen Beleg.
  if (!rawBase64) {
    // 32 Bytes kryptographischer Zufall (256-Bit)
    const randomBytes = new Uint8Array(32)
    if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
      window.crypto.getRandomValues(randomBytes)
    } else if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
      globalThis.crypto.getRandomValues(randomBytes)
    } else {
      for (let i = 0; i < 32; i++) {
        randomBytes[i] = Math.floor(Math.random() * 256)
      }
    }
    rawBase64 = bytesToBase64(randomBytes)
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(storageKey, rawBase64)
      }
    } catch {}
    rawKeyMemoryStore.set(userId, rawBase64)

    syncedInSession.add(userId)
    // Automatische Verteilung an andere bereits gekoppelte Geräte des Benutzers im Hintergrund
    void syncNotesKeyToPairedDevices(userId).catch(() => {})
  } else if (!syncedInSession.has(userId)) {
    syncedInSession.add(userId)
    void syncNotesKeyToPairedDevices(userId).catch(() => {})
  }

  const rawBytes = base64ToBytes(rawBase64)
  const importedKey = await importAesGcmRawKey(rawBytes, ['encrypt', 'decrypt'])
  keyCache.set(userId, importedKey)
  return importedKey
}

/**
 * Setzt oder importiert einen Schlüssel (z. B. nach Geräte-Kopplung oder Übernahme).
 * Triggert bei erfolgreichem Setzen ein globales 'msm:notes-key-updated' Event zur Nach-Entschlüsselung.
 */
export async function setUserNotesKey(userId: number, rawBase64: string): Promise<CryptoKey> {
  const storageKey = `${STORAGE_KEY_PREFIX}${userId}`
  // Ein ersetzter Schlüssel bleibt zum Lesen da — beim Übernehmen des
  // Kontoschlüssels wie beim Koppeln (`verlaufsUebergabe`). Sonst wäre alles,
  // was mit ihm geschrieben wurde, auf diesem Gerät verloren.
  const bisher = exportUserNotesKey(userId)
  if (bisher && bisher !== rawBase64) merkeNebenschluessel(userId, bisher)
  // Ein anderer Schlüssel: der letzte Abgleich sagt über ihn nichts.
  letzterAbgleich.delete(userId)
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(storageKey, rawBase64)
    }
  } catch {}
  rawKeyMemoryStore.set(userId, rawBase64)

  const rawBytes = base64ToBytes(rawBase64)
  const importedKey = await importAesGcmRawKey(rawBytes, ['encrypt', 'decrypt'])
  keyCache.set(userId, importedKey)

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('msm:notes-key-updated', { detail: { userId, rawKey: rawBase64 } })
    )
  }

  return importedKey
}

/**
 * Exportiert den Schlüssel als Base64-String zur sicheren Übertragung an ein gekoppeltes Neugerät.
 */
export function exportUserNotesKey(userId: number = 1): string | null {
  const storageKey = `${STORAGE_KEY_PREFIX}${userId}`
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const stored = window.localStorage.getItem(storageKey)
      if (stored) return stored
    }
  } catch {}
  return rawKeyMemoryStore.get(userId) ?? null
}

/**
 * Liest den Altschlüssel (Kennung 1) — rein lokal, ohne Netz, ohne Erzeugung.
 *
 * Absichtlich getrennt von `getUserNotesKey`: dort hängt ein Mailbox-Abruf
 * daran, und dort gilt die Zusage „ein Schlüssel gehört genau einem Konto".
 * Diese Funktion bricht die Zusage nicht, sie reicht nur einen Kandidaten
 * heraus. Wer ihn benutzt, muss selbst belegen, dass er ihm gehört — siehe
 * `altschluesselUebernehmen`.
 */
export async function altschluessel(): Promise<CryptoKey | null> {
  const zwischengespeichert = keyCache.get(ALTSCHLUESSEL_KENNUNG)
  if (zwischengespeichert) return zwischengespeichert

  const roh = exportUserNotesKey(ALTSCHLUESSEL_KENNUNG)
  if (!roh) return null

  try {
    const schluessel = await importAesGcmRawKey(base64ToBytes(roh), ['encrypt', 'decrypt'])
    keyCache.set(ALTSCHLUESSEL_KENNUNG, schluessel)
    return schluessel
  } catch {
    return null
  }
}

/**
 * Schreibt den Altschlüssel unter die echte Kennung um.
 *
 * Nur aufrufen, wenn erwiesen ist, dass er diesem Konto gehört — und der
 * einzige brauchbare Beweis ist, dass er eine Zeile entschlüsselt, die der
 * Server diesem Konto ausgeliefert hat. Ein Konto bekommt nur die eigenen
 * Zeilen; was sich damit öffnen lässt, war nie fremd.
 *
 * Überschreibt nie einen vorhandenen Schlüssel: liegt unter der echten Kennung
 * schon einer, ist er die Wahrheit und der Altbestand nur noch Geschichte.
 */
export async function altschluesselUebernehmen(userId: number): Promise<boolean> {
  if (userId === ALTSCHLUESSEL_KENNUNG) return false
  if (hasUserNotesKey(userId)) return false

  const roh = exportUserNotesKey(ALTSCHLUESSEL_KENNUNG)
  if (!roh) return false

  // `setUserNotesKey` legt ab, cached, und meldet `msm:notes-key-updated` —
  // daraufhin holt `redecryptPendingOfflineNotesAndCalendar` den Spiegel nach,
  // der bis eben nur Chiffretext hielt.
  await setUserNotesKey(userId, roh)
  return true
}

// ── Ein Schlüssel je Konto ──
//
// Bis 30.09.2026 behielt jedes Gerät den Schlüssel, den es sich beim ersten
// Speichern selbst gemacht hatte: `getOrCreateUserNotesKey` wartete nicht auf
// die Übergabe, und kam sie danach, verteidigte das Gerät seinen eigenen. Was
// eines schrieb, zeigten die anderen als `sv-note-v1:`-Blob — gemessen am
// 30.09. an zwei Geräten desselben Kontos mit zwei Abdrücken.
//
// Jetzt nennt der Server den Abdruck des Schlüssels, der gilt (nie den
// Schlüssel). Das erste Gerät, das einen hat, setzt ihn. Ein Gerät mit einem
// anderen holt sich den des Kontos über die unterschriebene Übergabe und
// behält seinen bisherigen als **Nebenschlüssel**: nur zum Lesen, bis
// `offlineSync` alles damit Geschriebene neu verschlüsselt hat.

const NEBEN_PREFIX = 'msm_e2ee_notes_nebenschluessel_'
/** Nebenschlüssel, wo es keine Ablage gibt — wie `rawKeyMemoryStore`. */
const nebenOhneAblage = new Map<number, string[]>()
const nebenImRam = new Map<string, CryptoKey>()

function nebenschluesselRoh(userId: number): string[] {
  let liste: unknown = nebenOhneAblage.get(userId)
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const roh = window.localStorage.getItem(`${NEBEN_PREFIX}${userId}`)
      if (roh) liste = JSON.parse(roh)
    }
  } catch {}
  return Array.isArray(liste) ? liste.filter((x): x is string => typeof x === 'string' && x !== '') : []
}

function merkeNebenschluessel(userId: number, roh: string): boolean {
  const liste = nebenschluesselRoh(userId)
  if (liste.includes(roh)) return false
  liste.push(roh)
  nebenOhneAblage.set(userId, liste)
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(`${NEBEN_PREFIX}${userId}`, JSON.stringify(liste))
    }
  } catch {}
  return true
}

/**
 * Die Nebenschlüssel dieses Kontos auf diesem Gerät — nur zum Lesen.
 *
 * Frühere eigene Schlüssel und die anderer eigener Geräte, sofern deren
 * Übergabe unterschrieben ankam. Verschlüsselt wird damit nie.
 */
export async function nebenschluessel(userId: number): Promise<CryptoKey[]> {
  const aktuell = exportUserNotesKey(userId)
  const schluessel: CryptoKey[] = []
  for (const roh of nebenschluesselRoh(userId)) {
    if (roh === aktuell) continue
    let k = nebenImRam.get(roh)
    if (!k) {
      try {
        k = await importAesGcmRawKey(base64ToBytes(roh), ['decrypt'])
      } catch {
        continue
      }
      nebenImRam.set(roh, k)
    }
    schluessel.push(k)
  }
  return schluessel
}

/** Macht `roh` zum Schlüssel dieses Geräts; der bisherige wird Nebenschlüssel (`setUserNotesKey`). */
async function kontoschluesselUebernehmen(userId: number, roh: string): Promise<void> {
  if (exportUserNotesKey(userId) === roh) return
  // Meldet `msm:notes-key-updated`; `offlineSync` lädt daraufhin neu und
  // verschlüsselt, was nur der alte öffnete.
  await setUserNotesKey(userId, roh)
}

/**
 * Abdruck des Kontoschlüssels — nur, wenn die Unterschrift darunter von einem
 * vertrauten eigenen Gerät stammt (`pruefeStand`). Fehlt der Eintrag, weiß
 * dieses Gerät es nicht; das ist kein „keiner".
 */
const kontoAbdruck = new Map<number, string>()
const laufenderAbgleich = new Map<number, Promise<Abgleichstand>>()
/**
 * Der letzte Abgleich, gleich welcher Ausgang. Notizen laden bei jedem
 * Ereignis neu, im Ausweichbetrieb alle zehn Sekunden; öfter als einmal in der
 * Minute muss niemand den Server fragen. Ein neuer eigener Schlüssel
 * (`setUserNotesKey`) und die Meldung des Servers (`kontoAbdruckVergessen`)
 * räumen den Eintrag sofort.
 */
const letzterAbgleich = new Map<number, { stand: Abgleichstand; am: number }>()
const ABGLEICH_FRIST_MS = 60 * 1000
/**
 * Konten, deren Eintrag dieses Gerät in dieser Sitzung schon einmal neu belegt
 * hat. Zwei Geräte, die einander nicht vertrauen, stellten sonst im Wechsel um.
 */
const neuBelegt = new Set<number>()

/** Der Abdruck des Schlüssels, mit dem dieses Gerät schreibt, oder `null`. */
export async function eigenerAbdruck(userId: number): Promise<string | null> {
  const roh = exportUserNotesKey(userId)
  return roh ? abdruckVon(roh) : null
}

/**
 * Was ein Gerät unterschreibt, wenn es den Kontoschlüssel setzt — dieselben
 * Bytes wie `NotesService.kontoschluessel_daten` im Backend.
 *
 * Der Stand gehört hinein und wächst nur: eine Unterschrift passt auf genau
 * einen und lässt sich später nicht wieder vorlegen — auch dann nicht, wenn
 * der Eintrag zu einem früheren Abdruck zurückgekehrt ist. Mit dem Vorgänger
 * statt des Stands ging das bis zur Durchsicht vom 30.09.2026.
 */
export function kontoschluesselDaten(
  userId: number,
  abdruck: string,
  stand: number,
  geraet: string,
): string {
  return `msm:notes-kontoschluessel:v2:${userId}:${abdruck}:${stand}:${geraet}`
}

/**
 * Gilt der Eintrag? Nur mit der Unterschrift eines vertrauten eigenen Geräts.
 *
 * Bis zur Durchsicht vom 30.09.2026 glaubte jedes Gerät dem Server den Abdruck
 * ohne Beleg. Wer eine Sitzung hatte — oder der Server selbst —, konnte ihn auf
 * den Schlüssel eines entfernten Geräts stellen, und alle Geräte wären auf
 * diesen umgestiegen.
 *
 * - `echt`: belegt.
 * - `unbelegt`: die Unterschrift stimmt nicht, oder ihr Gerät steht gar nicht
 *   mehr im Verzeichnis (entfernt). Dann darf ein Gerät ihn neu belegen.
 * - `fremd`: das Gerät ist freigegeben, aber diesem hier nicht vertraut — etwa
 *   eines, dessen Freigabe es nicht nachprüfen kann. Nicht gültig, aber auch
 *   kein Grund, einem womöglich echten Gerät den Eintrag wegzunehmen: zwei
 *   solche stellten ihn sonst im Wechsel um (Durchsicht 30.09.2026).
 * - `offen`: das Verzeichnis war nicht zu erreichen — weder ja noch nein.
 */
async function pruefeStand(
  userId: number,
  stand: KontoschluesselStand,
): Promise<'echt' | 'unbelegt' | 'fremd' | 'offen'> {
  if (!stand.abdruck || !stand.geraet || !stand.signatur) return 'unbelegt'
  const beleg = await pruefeGeraeteBeleg(
    userId,
    stand.geraet,
    kontoschluesselDaten(userId, stand.abdruck, stand.stand, stand.geraet),
    stand.signatur,
  )
  if (beleg === 'offen') return 'offen'
  if (beleg === 'echt') return 'echt'
  if (beleg !== 'unbekannt') return 'unbelegt'
  // Nicht unter den vertrauten. Entfernt — oder nur nicht nachprüfbar?
  try {
    const roh = await getE2eeGeraete(userId)
    return roh.some((g) => g.device_id === stand.geraet) ? 'fremd' : 'unbelegt'
  } catch {
    return 'offen'
  }
}

/**
 * Setzt den eigenen als Kontoschlüssel, unterschrieben von diesem Gerät, als
 * Stand `stand` (einer mehr als der geltende).
 *
 * Liefert den belegten Abdruck danach — den eigenen, oder den eines Geräts,
 * das schneller war —, sonst `null`. Ein Gerät, das noch nicht freigegeben ist,
 * weist der Server ab.
 */
async function belegen(userId: number, eigen: string, stand: number): Promise<string | null> {
  let ich: EigenesGeraet
  try {
    ich = await eigenesGeraet()
  } catch {
    return null
  }
  let danach: KontoschluesselStand
  let signatur: string
  try {
    signatur = await signiere(
      kontoschluesselDaten(userId, eigen, stand, ich.kennung),
      ich.signaturPaar.privateKeyJwk,
    )
    danach = await setzeKontoschluessel({ abdruck: eigen, stand, geraet: ich.kennung, signatur })
  } catch {
    return null
  }
  if (!danach.abdruck) return null
  if (danach.abdruck === eigen && danach.signatur === signatur) return eigen
  return (await pruefeStand(userId, danach)) === 'echt' ? danach.abdruck : null
}

/**
 * Ist der Schlüssel dieses Geräts der des Kontos?
 *
 * `null`, solange dieses Gerät das nicht weiß — dann verhält es sich wie
 * vorher. Nur ein klares Nein hält es davon ab, seinen Schlüssel zu verteilen:
 * es gäbe sonst einen weiter, der gleich wieder abgelöst wird.
 */
export async function eigenerIstKontoschluessel(userId: number): Promise<boolean | null> {
  const marke = kontoAbdruck.get(userId)
  if (!marke) return null
  return (await eigenerAbdruck(userId)) === marke
}

/** Nach einer Meldung des Servers, dass sich der Kontoschlüssel geändert hat. */
export function kontoAbdruckVergessen(userId: number): void {
  kontoAbdruck.delete(userId)
  letzterAbgleich.delete(userId)
}

/**
 * - `passt`: dieses Gerät hat den Kontoschlüssel.
 * - `uebernommen`: hatte einen anderen und hat jetzt den des Kontos.
 * - `wartet`: hat ihn nicht; die Anfrage an die anderen Geräte ist gestellt.
 * - `unbekannt`: der Server war nicht zu fragen, oder es gibt keinen belegten.
 */
export type Abgleichstand = 'passt' | 'uebernommen' | 'wartet' | 'unbekannt'

/**
 * Bringt dieses Gerät auf den Schlüssel des Kontos.
 *
 * Notizen und Kalender laden zugleich; ein zweiter Aufruf wartet auf den
 * ersten, statt denselben Weg noch einmal zu gehen.
 */
export function kontoschluesselAbgleichen(userId: number): Promise<Abgleichstand> {
  const zuletzt = letzterAbgleich.get(userId)
  if (zuletzt && Date.now() - zuletzt.am < ABGLEICH_FRIST_MS) {
    return Promise.resolve(zuletzt.stand === 'uebernommen' ? 'passt' : zuletzt.stand)
  }
  const schon = laufenderAbgleich.get(userId)
  if (schon) return schon
  const lauf = abgleichen(userId)
    .then((stand) => {
      letzterAbgleich.set(userId, { stand, am: Date.now() })
      return stand
    })
    .finally(() => laufenderAbgleich.delete(userId))
  laufenderAbgleich.set(userId, lauf)
  return lauf
}

async function abgleichen(userId: number): Promise<Abgleichstand> {
  let stand: KontoschluesselStand
  try {
    stand = await holeKontoschluessel()
  } catch {
    return 'unbekannt'
  }
  const eigen = await eigenerAbdruck(userId)
  let marke: string | null

  if (!stand.abdruck) {
    // Noch keiner festgelegt: der erste, der einen hat, setzt ihn. Waren zwei
    // zugleich dran, gewinnt der eine, und der andere richtet sich nach ihm.
    if (!eigen) return 'unbekannt'
    marke = await belegen(userId, eigen, stand.stand + 1)
  } else {
    const beleg = await pruefeStand(userId, stand)
    if (beleg === 'offen' || beleg === 'fremd') return 'unbekannt'
    if (beleg === 'echt') {
      marke = stand.abdruck
    } else {
      // Die Unterschrift ist falsch, oder ihr Gerät wurde entfernt. Dann gilt
      // er nicht, und dieses Gerät belegt den Eintrag mit dem eigenen neu —
      // über den bisherigen hinweg, einmal je Sitzung. Ist das der eigene
      // Schlüssel, weil sein Unterzeichner entfernt wurde, bleibt es derselbe.
      if (!eigen || neuBelegt.has(userId)) return 'unbekannt'
      neuBelegt.add(userId)
      marke = await belegen(userId, eigen, stand.stand + 1)
    }
  }
  if (!marke) return 'unbekannt'
  kontoAbdruck.set(userId, marke)
  if (eigen === marke) return 'passt'

  // Vielleicht liegt er schon hier — etwa, weil dieses Gerät ihn früher hatte.
  // Unbedenklich, weil `marke` belegt ist: ein vertrautes Gerät steht für
  // genau diesen Schlüssel ein.
  for (const roh of nebenschluesselRoh(userId)) {
    if ((await abdruckVon(roh)) === marke) {
      await kontoschluesselUebernehmen(userId, roh)
      return 'uebernommen'
    }
  }

  // Der Notizenschluessel steckt im Konto-Schluesselbund; ein Abruf holt ihn,
  // wenn ein anderes Geraet ihn dort hinterlegt hat.
  void requestNotesKeyFromPairedDevices(userId).catch(() => false)
  if ((await eigenerAbdruck(userId)) === marke) return 'uebernommen'
  return 'wartet'
}

/**
 * Wartet kurz auf den Kontoschlüssel, bevor ein Gerät ohne Schlüssel sich
 * einen eigenen macht.
 *
 * Nur, wenn es einen belegten Kontoschlüssel gibt: dann hat ihn ein anderes
 * Gerät, und ein eigener hieße, dass das, was dieses Gerät jetzt speichert,
 * für die anderen Blob bleibt, bis es neu verschlüsselt ist. Ist nach ein paar
 * Sekunden nichts da, geht es trotzdem weiter — lieber mit eigenem Schlüssel
 * speichern als gar nicht; `abgleichen` holt den des Kontos später nach.
 */
async function aufKontoschluesselWarten(userId: number): Promise<string | null> {
  if (!kontoAbdruck.has(userId)) return null
  return exportUserNotesKey(userId)
}


/**
 * Ein Fingerabdruck des Schluessels: genug, um einen neuen zu erkennen, und zu
 * wenig, um auf den alten zu schliessen.
 */
async function abdruckVon(rawKey: string): Promise<string> {
  const hash = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`msm:notes-key-abdruck:v1:${rawKey}`),
  )
  return bytesToBase64(new Uint8Array(hash)).slice(0, 22)
}

/**
 * Der Notizenschluessel reist im Konto-Schluesselbund.
 *
 * Jedes freigegebene Geraet oeffnet denselben Bund mit seinem Geraeteschluessel
 * und bekommt damit auch den Notizenschluessel. Es gibt keine eigene
 * Geraete-Mailbox und keinen zweiten Uebergabeweg mehr.
 */
export async function syncNotesKeyToPairedDevices(userId: number = 1): Promise<number> {
  const roh = exportUserNotesKey(userId)
  if (!roh || !angemeldetesKonto()) return 0
  try {
    const { ensureAccountKeys } = await import('./accountKeys')
    await ensureAccountKeys()
    return 1
  } catch {
    return 0
  }
}

/** Holt den Bund, wenn dieses Geraet noch keinen Notizenschluessel hat. */
export async function requestNotesKeyFromPairedDevices(userId: number = 1): Promise<boolean> {
  if (hasUserNotesKey(userId)) return false
  if (!angemeldetesKonto()) return false
  try {
    const { ensureAccountKeys } = await import('./accountKeys')
    await ensureAccountKeys()
  } catch {
    return false
  }
  return hasUserNotesKey(userId)
}

/** Steuerumschlaege der alten Geraete-Mailbox gibt es nicht mehr. */
export async function processNotesKeyControlEnvelope(
  _ciphertextEnvelope: string,
  _userId: number = 1,
): Promise<boolean> {
  return false
}

/**
 * Prueft, ob der Bund den Notizenschluessel mitbringt. Der frueher noetige
 * Mailbox-Scan entfaellt; der Bund wird beim Laden des Kontos geholt.
 */
export async function checkAndReceiveDeviceNotesKey(userId: number = 1): Promise<boolean> {
  // Der Bund kommt beim Anmelden und bei der Geraetefreigabe. Ein Abruf im
  // Lesepfad wuerde nur blockieren, wenn der Server gerade nicht antwortet.
  void userId
  return hasUserNotesKey(userId)
}

/** Anfragen anderer Geraete werden nicht mehr ueber eine Mailbox beantwortet. */
export async function checkAndRespondToDeviceKeyRequests(_userId: number = 1): Promise<number> {
  return 0
}

// ── Notizen Verschlüsselung & Entschlüsselung ──

export async function encryptNoteTitle(
  title: string,
  noteUid: string,
  key?: CryptoKey,
  userId?: number,
): Promise<string> {
  if (!title) return ''
  if (title.startsWith(NOTE_CIPHERTEXT_PREFIX)) return title

  const resolvedKey = key ?? (await getOrCreateUserNotesKey(userId))
  const aad = `msm:note:${noteUid}`
  const ciphertextBase64 = await encryptString(title.trim(), resolvedKey, aad)
  return formatEnvelope(NOTE_ENVELOPE_SPEC, ciphertextBase64)
}

export async function encryptNoteContent(
  content: string,
  noteUid: string,
  key?: CryptoKey,
  userId?: number,
): Promise<string> {
  if (!content) return ''
  if (content.startsWith(NOTE_CIPHERTEXT_PREFIX)) return content

  const resolvedKey = key ?? (await getOrCreateUserNotesKey(userId))
  const aad = `msm:note:${noteUid}:content`
  const ciphertextBase64 = await encryptString(content, resolvedKey, aad)
  return formatEnvelope(NOTE_ENVELOPE_SPEC, ciphertextBase64)
}

export async function decryptNoteTitle(
  ciphertext: string,
  noteUid: string,
  key?: CryptoKey,
  userId?: number,
): Promise<string> {
  if (!ciphertext) return ''
  if (!ciphertext.startsWith(NOTE_CIPHERTEXT_PREFIX)) {
    // Altdaten im Klartext
    return ciphertext
  }

  const resolvedKey = key ?? (await getUserNotesKey(userId ?? 1))
  if (!resolvedKey) {
    throw new DisDecryptionError(`Kein Notizenschlüssel vorhanden für Entschlüsselung von ${noteUid}.`)
  }

  const parsed = parseEnvelope(NOTE_ENVELOPE_SPEC, ciphertext)
  const aad = `msm:note:${noteUid}`

  try {
    return await decryptString(parsed.payload, resolvedKey, aad)
  } catch (err) {
    // Fallback falls AAD-Format abweicht
    try {
      return await decryptString(parsed.payload, resolvedKey)
    } catch {
      throw new DisDecryptionError(`Notiz-Titel für ${noteUid} konnte nicht entschlüsselt werden.`)
    }
  }
}

export async function decryptNoteContent(
  ciphertext: string,
  noteUid: string,
  key?: CryptoKey,
  userId?: number,
): Promise<string> {
  if (!ciphertext) return ''
  if (!ciphertext.startsWith(NOTE_CIPHERTEXT_PREFIX)) {
    return ciphertext
  }

  const resolvedKey = key ?? (await getUserNotesKey(userId ?? 1))
  if (!resolvedKey) {
    throw new DisDecryptionError(`Kein Notizenschlüssel vorhanden für Entschlüsselung von ${noteUid}.`)
  }

  const parsed = parseEnvelope(NOTE_ENVELOPE_SPEC, ciphertext)
  const aad = `msm:note:${noteUid}:content`

  try {
    return await decryptString(parsed.payload, resolvedKey, aad)
  } catch (err) {
    try {
      return await decryptString(parsed.payload, resolvedKey)
    } catch {
      throw new DisDecryptionError(`Notiz-Inhalt für ${noteUid} konnte nicht entschlüsselt werden.`)
    }
  }
}

// ── Kalender Verschlüsselung & Entschlüsselung ──

export async function encryptCalendarField(
  text: string | null | undefined,
  eventUid: string,
  fieldName: 'title' | 'description' | 'location' | 'recurrence',
  key?: CryptoKey,
  userId?: number,
): Promise<string> {
  if (!text) return ''
  if (text.startsWith(CALENDAR_CIPHERTEXT_PREFIX)) return text

  const resolvedKey = key ?? (await getOrCreateUserNotesKey(userId))
  const aad = `msm:cal:${eventUid}:${fieldName}`
  const ciphertextBase64 = await encryptString(text, resolvedKey, aad)
  return formatEnvelope(CALENDAR_ENVELOPE_SPEC, ciphertextBase64)
}

export async function decryptCalendarField(
  ciphertext: string | null | undefined,
  eventUid: string,
  fieldName: 'title' | 'description' | 'location' | 'recurrence',
  key?: CryptoKey,
  userId?: number,
): Promise<string> {
  if (!ciphertext) return ''
  if (!ciphertext.startsWith(CALENDAR_CIPHERTEXT_PREFIX)) {
    return ciphertext
  }

  const resolvedKey = key ?? (await getUserNotesKey(userId ?? 1))
  if (!resolvedKey) {
    throw new DisDecryptionError(`Kein Kalenderschlüssel vorhanden für Entschlüsselung von ${fieldName} (${eventUid}).`)
  }

  const parsed = parseEnvelope(CALENDAR_ENVELOPE_SPEC, ciphertext)
  const aad = `msm:cal:${eventUid}:${fieldName}`

  try {
    return await decryptString(parsed.payload, resolvedKey, aad)
  } catch (err) {
    try {
      return await decryptString(parsed.payload, resolvedKey)
    } catch {
      throw new DisDecryptionError(`Kalenderfeld ${fieldName} für ${eventUid} konnte nicht entschlüsselt werden.`)
    }
  }
}
