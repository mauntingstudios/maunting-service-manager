/**
 * Die Outbox der Wirkungen abarbeiten.
 *
 * Ein Lauf zur Zeit. Ein Anstoß währenddessen wird genau einmal nachgeholt.
 * Wechselt das Konto, endet der Lauf, damit keine Wirkung mit der Sitzung des
 * nächsten Kontos hinausgeht.
 */

import { angemeldetesKonto } from '@/lib/angemeldetesKonto'
import { ladeSteuerAuftraege, type SteuerAuftrag } from './messengerLocalStore'
import {
  istEndgueltigAbgelehnt,
  MAX_VERSUCHE,
  merkeSteuerFehlversuch,
  nimmWirkungZurueck,
  vergissSteuerAuftrag,
  type SendeWirkung,
  type Wirkungsziel,
} from './steuerOutbox'

export type SteuerOutboxGrund = 'abgelehnt' | 'aufgegeben'
export type SteuerOutboxMelder = (auftrag: SteuerAuftrag, grund: SteuerOutboxGrund) => void

let melder: SteuerOutboxMelder | null = null

export function setzeSteuerOutboxMelder(neu: SteuerOutboxMelder | null): () => void {
  melder = neu
  return () => {
    if (melder === neu) melder = null
  }
}

export interface LaufOptionen {
  jetzt?: () => number
}

let laeuft: Promise<void> | null = null
let nochEinmal = false

export function stosseSteuerOutboxAn(
  senden: SendeWirkung,
  optionen: LaufOptionen = {},
): Promise<void> {
  if (laeuft) {
    nochEinmal = true
    return laeuft
  }
  laeuft = (async () => {
    try {
      do {
        nochEinmal = false
        await einLauf(senden, optionen)
      } while (nochEinmal)
    } catch {
      // Hintergrundarbeit. Der nächste Anlass liest wieder.
    } finally {
      laeuft = null
    }
  })()
  return laeuft
}

function zielAus(auftrag: SteuerAuftrag): Wirkungsziel {
  return {
    mailbox: auftrag.mailbox,
    chatType: auftrag.chatType,
    chatId: auftrag.chatId,
    peerId: auftrag.peerId ?? null,
    groupId: auftrag.groupId ?? null,
    mitglieder: auftrag.mitglieder ?? [],
    istEigentuemer: Boolean(auftrag.istEigentuemer),
  }
}

async function einLauf(senden: SendeWirkung, { jetzt = () => Date.now() }: LaufOptionen): Promise<void> {
  const konto = angemeldetesKonto()
  if (konto === null) return
  const zeit = jetzt()
  for (const auftrag of await ladeSteuerAuftraege()) {
    if (angemeldetesKonto() !== konto) return
    if (auftrag.naechsterVersuch > zeit) continue

    try {
      await senden(zielAus(auftrag), {
        typ: auftrag.typ,
        felder: auftrag.felder,
        ziel: auftrag.ziel ?? null,
        zielId: auftrag.zielId ?? null,
        ruecknahme: auftrag.ruecknahme,
      })
      await vergissSteuerAuftrag(auftrag.id)
    } catch (fehler) {
      if (angemeldetesKonto() !== konto) return
      if (istEndgueltigAbgelehnt(fehler)) {
        await aufgeben(auftrag, 'abgelehnt')
        continue
      }
      const versuche = auftrag.versuche + 1
      if (versuche >= MAX_VERSUCHE) {
        await aufgeben(auftrag, 'aufgegeben')
        continue
      }
      await merkeSteuerFehlversuch(auftrag, zeit).catch(() => {})
    }
  }
}

async function aufgeben(auftrag: SteuerAuftrag, grund: SteuerOutboxGrund): Promise<void> {
  await nimmWirkungZurueck(auftrag).catch(() => {})
  await vergissSteuerAuftrag(auftrag.id).catch(() => {})
  melder?.(auftrag, grund)
}
