/**
 * Wo ein Chat-Hintergrund steht: je Konto in der IndexedDB, versiegelt.
 *
 * **Was sich mit 27.10.2026 ändert.** Bis dahin lag eine Wahl für den ganzen
 * Messenger (und eine für den KI-Bereich) offen im `localStorage`. Ein eigenes
 * Bild pro Chat war nicht möglich, und ein zweites Konto im selben Browser sah
 * die Wahl des ersten. Jetzt gibt es:
 *
 * * `global:messenger` — die Vorgabe für alle Direktchats,
 * * `direkt:<peerId>` — der eigene Hintergrund eines Direktchats,
 * * `global:ki` — der KI-Bereich, unverändert getrennt.
 *
 * Gruppen haben **keinen** persönlichen Schlüssel. Ihr Hintergrund gehört der
 * Gruppe und liegt verschlüsselt beim Server (`gruppenInfo.ts`); alle
 * Mitglieder sehen denselben.
 *
 * Die Ablage selbst steht in `ablage.ts`; hier liegen Auswahl, Prüfung,
 * Rückfall und die einmalige Übernahme des Altbestands.
 */

import { angemeldetesKonto } from '@/lib/angemeldetesKonto'
import { istOffen } from '@/services/lokaleVersiegelung'
import {
  direkterSchluessel,
  entferneDirekteHintergruende,
  globalerSchluessel,
  leseHintergrundAblage,
  loescheHintergrundAblage,
  schreibeHintergrundAblage,
} from './ablage'
import { HINTERGRUND_VORLAGEN, STANDARD_VORLAGE, type HintergrundId } from './vorlagen'

export type ChatHintergrundBereich = 'messenger' | 'ki'

export interface ChatHintergrundKonfiguration {
  preset: HintergrundId
  /** Das eigene Bild als Data-URL; nur bei `preset: 'custom'` gesetzt. */
  customDataUrl?: string
  /** 0–75 Prozent Abdunkelung, damit Text auf jedem Bild lesbar bleibt. */
  dimLevel: number
}

/** Der Platz, dessen Hintergrund eine Fläche zeigt. */
export type ChatHintergrundScope =
  | { art: 'global'; bereich: ChatHintergrundBereich }
  | { art: 'direkt'; peerId: number }

export const STANDARD_HINTERGRUND: ChatHintergrundKonfiguration = {
  preset: STANDARD_VORLAGE,
  dimLevel: 25,
}

export const CHAT_HINTERGRUND_EVENT = 'msm:chat-hintergrund'

const GUELTIGE_IDS: readonly HintergrundId[] = [
  ...HINTERGRUND_VORLAGEN.map((vorlage) => vorlage.id),
  'custom',
]

/** Ein eigenes Bild darf so groß sein; die Dialoge verkleinern vorher. */
const MAX_BILD_ZEICHEN = 3 * 1024 * 1024

const ALTE_SCHLUESSEL = {
  messenger: 'msm_hintergrund:messenger',
  ki: 'msm_hintergrund:ki',
} as const
const ALTER_MESSENGER_SCHLUESSEL = 'msm_chat_wallpaper_config'

export function scopeSchluessel(scope: ChatHintergrundScope): string {
  return scope.art === 'direkt'
    ? direkterSchluessel(scope.peerId)
    : globalerSchluessel(scope.bereich)
}

/** Der Schlüssel des globalen Bereichs; bleibt für bestehende Aufrufer. */
export function hintergrundSchluessel(bereich: ChatHintergrundBereich): string {
  return globalerSchluessel(bereich)
}

function alsBild(wert: unknown): string | undefined {
  if (typeof wert !== 'string') return undefined
  if (wert.length > MAX_BILD_ZEICHEN) return undefined
  return /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(wert)
    ? wert
    : undefined
}

/** Nachsichtig lesen: alles Unbekannte fällt auf den Standard zurück. */
function ausRohdaten(roh: unknown): ChatHintergrundKonfiguration {
  let gelesen: Partial<ChatHintergrundKonfiguration> & Record<string, unknown>
  try {
    if (typeof roh === 'string') {
      gelesen = JSON.parse(roh) as typeof gelesen
    } else if (roh && typeof roh === 'object') {
      gelesen = roh as typeof gelesen
    } else {
      return STANDARD_HINTERGRUND
    }
  } catch {
    return STANDARD_HINTERGRUND
  }
  if (!gelesen || typeof gelesen !== 'object') return STANDARD_HINTERGRUND

  const preset = GUELTIGE_IDS.includes(gelesen.preset as HintergrundId)
    ? (gelesen.preset as HintergrundId)
    : STANDARD_VORLAGE
  const customDataUrl = alsBild(gelesen.customDataUrl)
  const dimWert =
    typeof gelesen.dimLevel === 'number' && Number.isFinite(gelesen.dimLevel)
      ? gelesen.dimLevel
      : STANDARD_HINTERGRUND.dimLevel
  return {
    preset: preset === 'custom' && !customDataUrl ? STANDARD_VORLAGE : preset,
    customDataUrl,
    dimLevel: Math.min(75, Math.max(0, Math.round(dimWert))),
  }
}

function istStandard(konfiguration: ChatHintergrundKonfiguration): boolean {
  return (
    konfiguration.preset === STANDARD_HINTERGRUND.preset &&
    !konfiguration.customDataUrl &&
    konfiguration.dimLevel === STANDARD_HINTERGRUND.dimLevel
  )
}

function melde(schluessel: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent(CHAT_HINTERGRUND_EVENT, { detail: { schluessel } }),
  )
}

/**
 * Den alten, kontolosen Bestand einmalig übernehmen.
 *
 * Danach sind die alten Schlüssel weg. Ein Zustand ohne angemeldetes Konto
 * oder ohne offenes Siegel wird **nicht** übernommen: die Wahl läge sonst im
 * Klartext eines Kontos, das gerade gar nicht arbeitet. Stattdessen bleibt der
 * Merker aus, und der nächste Aufruf versucht es erneut.
 */
let migrationLauf: Promise<void> | null = null

async function migriereAltbestand(): Promise<void> {
  const konto = angemeldetesKonto()
  if (konto === null || !istOffen() || typeof localStorage === 'undefined') return
  const marke = `msm:hintergrund_migriert:konto:${konto}`
  const besitz = 'msm:hintergrund_altbesitz'
  try {
    if (localStorage.getItem(marke) === 'true') return
    const bisherigerBesitzer = Number(localStorage.getItem(besitz) || 0)
    if (bisherigerBesitzer && bisherigerBesitzer !== konto) {
      // Die alte, kontolose Wahl gehört einem anderen Konto auf diesem Gerät.
      // Sie wird nicht übernommen; sonst sähe das zweite Konto den Hintergrund
      // des ersten.
      localStorage.removeItem(ALTE_SCHLUESSEL.messenger)
      localStorage.removeItem(ALTE_SCHLUESSEL.ki)
      localStorage.removeItem(ALTER_MESSENGER_SCHLUESSEL)
      localStorage.setItem(marke, 'true')
      return
    }
    if (!bisherigerBesitzer) localStorage.setItem(besitz, String(konto))
  } catch {
    return
  }
  if (migrationLauf) return migrationLauf

  migrationLauf = (async () => {
    try {
      const alt = {
        messenger:
          localStorage.getItem(ALTE_SCHLUESSEL.messenger) ??
          localStorage.getItem(ALTER_MESSENGER_SCHLUESSEL),
        ki: localStorage.getItem(ALTE_SCHLUESSEL.ki),
      }
      const vorhanden = await leseHintergrundAblage()
      for (const bereich of ['messenger', 'ki'] as const) {
        const roh = alt[bereich]
        const ziel = globalerSchluessel(bereich)
        if (!roh || vorhanden.has(ziel)) continue
        await schreibeHintergrundAblage(ziel, ausRohdaten(roh) as unknown as Record<string, unknown>)
      }
      localStorage.removeItem(ALTE_SCHLUESSEL.messenger)
      localStorage.removeItem(ALTE_SCHLUESSEL.ki)
      localStorage.removeItem(ALTER_MESSENGER_SCHLUESSEL)
      localStorage.setItem(marke, 'true')
    } catch {
      // Versiegelt oder Speicher voll: beim nächsten Aufruf erneut.
    } finally {
      migrationLauf = null
    }
  })()
  return migrationLauf
}

async function lesePlatz(
  scope: ChatHintergrundScope,
): Promise<ChatHintergrundKonfiguration | null> {
  await migriereAltbestand()
  const karte = await leseHintergrundAblage()
  const eigen = karte.get(scopeSchluessel(scope))
  if (eigen) return ausRohdaten(eigen)
  if (scope.art === 'direkt') {
    const global = karte.get(globalerSchluessel('messenger'))
    if (global) return ausRohdaten(global)
  }
  return null
}

/** Der Hintergrund dieses Platzes, mit Rückfall auf die Messenger-Vorgabe. */
export async function ladeHintergrundFuerScope(
  scope: ChatHintergrundScope,
): Promise<ChatHintergrundKonfiguration> {
  try {
    return (await lesePlatz(scope)) ?? STANDARD_HINTERGRUND
  } catch {
    return STANDARD_HINTERGRUND
  }
}

/** Der globale Hintergrund eines Bereichs. */
export async function ladeChatHintergrund(
  bereich: ChatHintergrundBereich,
): Promise<ChatHintergrundKonfiguration> {
  return ladeHintergrundFuerScope({ art: 'global', bereich })
}

async function schreibePlatz(
  scope: ChatHintergrundScope,
  konfiguration: ChatHintergrundKonfiguration,
): Promise<boolean> {
  const sauber = ausRohdaten(konfiguration)
  try {
    await migriereAltbestand()
    const schluessel = scopeSchluessel(scope)
    if (istStandard(sauber)) {
      await loescheHintergrundAblage(schluessel)
    } else {
      await schreibeHintergrundAblage(
        schluessel,
        sauber as unknown as Record<string, unknown>,
      )
    }
    melde(schluessel)
    return true
  } catch {
    return false
  }
}

export async function speichereHintergrundFuerScope(
  scope: ChatHintergrundScope,
  konfiguration: ChatHintergrundKonfiguration,
): Promise<boolean> {
  return schreibePlatz(scope, konfiguration)
}

export async function speichereChatHintergrund(
  bereich: ChatHintergrundBereich,
  konfiguration: ChatHintergrundKonfiguration,
): Promise<boolean> {
  return schreibePlatz({ art: 'global', bereich }, konfiguration)
}

/**
 * „Für alle Chats": die Vorgabe schreiben und die direkten Ausnahmen löschen.
 *
 * Ohne das Löschen bliebe ein Chat, den jemand früher anders eingestellt hat,
 * bei seiner alten Wahl — „für alle" wäre dann nur „für alle, die noch nichts
 * Eigenes haben". Die Rückfrage davor stellt der Dialog.
 */
export async function wendeAufAlleDirektchatsAn(
  konfiguration: ChatHintergrundKonfiguration,
): Promise<boolean> {
  const ok = await schreibePlatz({ art: 'global', bereich: 'messenger' }, konfiguration)
  if (!ok) return false
  try {
    await entferneDirekteHintergruende()
    melde(globalerSchluessel('messenger'))
    return true
  } catch {
    return false
  }
}

/** Ob es eigene Direktchat-Hintergründe gibt, die „für alle" ersetzen würde. */
export async function hatDirekteHintergruende(): Promise<boolean> {
  try {
    const karte = await leseHintergrundAblage()
    return [...karte.keys()].some((schluessel) => schluessel.startsWith('direkt:'))
  } catch {
    return false
  }
}

/**
 * Auf Änderungen hören — im eigenen Fenster über das Ereignis oben, aus einem
 * zweiten Tab über `storage`.
 */
export function beobachteChatHintergrund(beiAenderung: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  const ausEigenemFenster = () => beiAenderung()
  const ausAnderemTab = (ereignis: StorageEvent) => {
    if (ereignis.key?.includes('hintergrund')) beiAenderung()
  }
  window.addEventListener(CHAT_HINTERGRUND_EVENT, ausEigenemFenster)
  window.addEventListener('storage', ausAnderemTab)
  return () => {
    window.removeEventListener(CHAT_HINTERGRUND_EVENT, ausEigenemFenster)
    window.removeEventListener('storage', ausAnderemTab)
  }
}
