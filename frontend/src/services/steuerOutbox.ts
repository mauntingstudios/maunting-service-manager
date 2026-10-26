/**
 * Dauerhafte Wirkungen: Bearbeiten, Reaktion, Anheften und Verfall.
 *
 * Der sofortige Versuch bleibt der schnelle Weg. Scheitert er an Netz, 429
 * oder 5xx, liegt der Auftrag in der kontogebundenen Ablage und wird später
 * erneut gebaut. Endgültige Ablehnungen nehmen die lokale Wirkung zurück.
 */

import {
  legeSteuerAuftragAn,
  loadLocalMessages,
  loescheSteuerAuftrag,
  schreibeSteuerAuftrag,
  updateMessageInLocalStore,
  type SteuerAuftrag,
} from './messengerLocalStore'
import { anheftung, setzeAnheftung } from './nachrichtAnheftung'
import { setzeVerfallsfrist, verfallStand } from './nachrichtVerfall'
import {
  SteuerAbgewiesenError,
  SteuerOutboxVollError,
  type SteuerAusgang,
  type SteuerEintrag,
} from './wirkungTypen'

/** Wohin eine Wirkung gehört. Der Chat wird beim Senden frisch aufgelöst. */
export interface Wirkungsziel {
  mailbox: string
  chatType: 'direct' | 'group'
  chatId: number
  peerId?: number | null
  groupId?: number | null
  mitglieder: number[]
  istEigentuemer?: boolean
}

/** Der eigentliche Versand; wirft bei jedem Fehler. */
export type SendeWirkung = (ziel: Wirkungsziel, eintrag: SteuerEintrag) => Promise<void>

export const MAX_VERSUCHE = 6
const RUECKZUG_MS = [30_000, 2 * 60_000, 10 * 60_000, 60 * 60_000, 6 * 60 * 60_000]
const ENDGUELTIG = new Set([400, 403, 404, 410, 422])

export function steuerRueckzugMs(versuche: number): number {
  return RUECKZUG_MS[Math.min(Math.max(0, versuche), RUECKZUG_MS.length - 1)]
}

export function istEndgueltigAbgelehnt(fehler: unknown): boolean {
  const status = Number((fehler as { status?: unknown } | null)?.status)
  return ENDGUELTIG.has(status)
}

function neueKennung(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `steuer-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** Versucht sofort und reiht bei einem vorübergehenden Fehler ein. */
export async function sendeWirkungMitOutbox(
  ziel: Wirkungsziel,
  eintrag: SteuerEintrag,
  senden: SendeWirkung,
): Promise<SteuerAusgang> {
  if (!ziel.mailbox || !eintrag?.typ) throw new SteuerAbgewiesenError(null)

  try {
    await senden(ziel, eintrag)
    return 'gesendet'
  } catch (fehler) {
    if (istEndgueltigAbgelehnt(fehler)) {
      throw new SteuerAbgewiesenError(
        Number((fehler as { status?: unknown }).status) || null,
      )
    }
  }

  const jetzt = Date.now()
  const auftrag: SteuerAuftrag = {
    id: neueKennung(),
    mailbox: ziel.mailbox,
    art: ziel.chatType === 'group' ? 'gruppe' : 'direkt',
    chatType: ziel.chatType,
    chatId: ziel.chatId,
    peerId: ziel.peerId ?? null,
    groupId: ziel.groupId ?? null,
    mitglieder: [...ziel.mitglieder],
    istEigentuemer: Boolean(ziel.istEigentuemer),
    typ: eintrag.typ,
    ziel: eintrag.ziel ?? null,
    zielId: typeof eintrag.zielId === 'number' ? eintrag.zielId : null,
    felder: eintrag.felder,
    ruecknahme: eintrag.ruecknahme as Record<string, unknown> | undefined,
    versuche: 1,
    naechsterVersuch: jetzt + steuerRueckzugMs(0),
    angelegtAm: jetzt,
  }
  if (!(await legeSteuerAuftragAn(auftrag))) {
    throw new SteuerOutboxVollError()
  }
  return 'eingereiht'
}

export async function merkeSteuerFehlversuch(
  auftrag: SteuerAuftrag,
  jetzt: number,
): Promise<void> {
  const versuche = auftrag.versuche + 1
  await schreibeSteuerAuftrag({
    ...auftrag,
    versuche,
    naechsterVersuch: jetzt + steuerRueckzugMs(versuche - 1),
  })
}

export async function vergissSteuerAuftrag(id: string): Promise<void> {
  await loescheSteuerAuftrag(id)
}

function gleicheReaktionen(
  a: Record<string, number[]> | undefined,
  b: Record<string, number[]> | undefined,
): boolean {
  const links = a ?? {}
  const rechts = b ?? {}
  if (Object.keys(links).length !== Object.keys(rechts).length) return false
  return Object.keys(links).every((name) => {
    const x = [...(links[name] ?? [])].sort((m, n) => m - n)
    const y = [...(rechts[name] ?? [])].sort((m, n) => m - n)
    return x.length === y.length && x.every((wert, i) => wert === y[i])
  })
}

/** Nimmt eine endgültig gescheiterte Wirkung zurück, aber nur ihren Stand. */
export async function nimmWirkungZurueck(auftrag: SteuerAuftrag): Promise<void> {
  const ruecknahme = auftrag.ruecknahme
  if (!ruecknahme || ruecknahme.art === 'keine') return

  if (ruecknahme.art === 'anheftung') {
    const vorher = ruecknahme.vorher as { clientUuid: string; stand: string }
    const nachher = ruecknahme.nachher as { clientUuid: string; stand: string }
    if (anheftung(auftrag.mailbox).clientUuid !== nachher.clientUuid) return
    setzeAnheftung(auftrag.mailbox, vorher.clientUuid, vorher.stand)
    return
  }
  if (ruecknahme.art === 'verfall') {
    const vorher = ruecknahme.vorher as { sekunden: number; stand: string }
    const nachher = ruecknahme.nachher as { sekunden: number; stand: string }
    if (verfallStand(auftrag.mailbox).sekunden !== nachher.sekunden) return
    setzeVerfallsfrist(auftrag.mailbox, vorher.sekunden, vorher.stand)
    return
  }

  const zeilen = await loadLocalMessages(auftrag.mailbox)
  const ziel = ruecknahme.ziel as string | null | undefined
  const zielId = ruecknahme.zielId as number | null | undefined
  const zeile = zeilen.find(
    (m) => (ziel != null && m.clientUuid === ziel) || (typeof zielId === 'number' && m.id === zielId),
  )
  if (!zeile) return
  const schluessel = zeile.clientUuid ?? zeile.id

  if (ruecknahme.art === 'reaktion') {
    const nachher = ruecknahme.nachher as Record<string, number[]> | undefined
    if (!gleicheReaktionen(zeile.reaktionen, nachher)) return
    await updateMessageInLocalStore(auftrag.mailbox, schluessel, {
      reaktionen: ruecknahme.vorher as Record<string, number[]>,
    })
    return
  }
  if (ruecknahme.art === 'bearbeitung') {
    const nachher = ruecknahme.nachher as { text: string }
    if (zeile.text !== nachher.text) return
    await updateMessageInLocalStore(
      auftrag.mailbox,
      schluessel,
      ruecknahme.vorher as Record<string, unknown>,
    )
  }
}
