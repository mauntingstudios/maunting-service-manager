/**
 * Das Server-Aufräumen einer gelöschten Nachricht als dauerhafter Auftrag.
 *
 * Die lokale Zeile ist bereits ein Grabstein. Dieser Auftrag nimmt die
 * Serverkopie und die hochgeladenen Blobs mit. Nur ein endgültiger Fehler
 * (404/410, fremder Blob 403) gibt auf; Netz und 5xx bleiben offen.
 */

import { deleteChatMessage, loescheChatMedium } from '@/api/social'
import { angemeldetesKonto } from '@/lib/angemeldetesKonto'
import {
  ladeLoeschAuftraege,
  loescheLoeschauftrag,
  loescheMedium,
  schreibeLoeschauftrag,
  type LoeschAuftrag,
} from './messengerLocalStore'
import { chatMediaBlobCache } from './klartextSpeicher'

const MAX_VERSUCHE = 6
const RUECKZUG_MS = [30_000, 2 * 60_000, 10 * 60_000, 60 * 60_000, 6 * 60 * 60_000]
const ENDGUELTIG = new Set([400, 403, 404, 410, 422])

export type LoeschGrund = 'erledigt' | 'medienGeblieben' | 'aufgegeben'
export type LoeschMelder = (
  auftrag: LoeschAuftrag,
  grund: LoeschGrund,
  medienGeblieben: number,
) => void

let melder: LoeschMelder | null = null

export function setzeLoeschMelder(neu: LoeschMelder | null): () => void {
  melder = neu
  return () => {
    if (melder === neu) melder = null
  }
}

let laeuft: Promise<void> | null = null
let nochEinmal = false

export function stosseLoeschungenAn(): Promise<void> {
  if (laeuft) {
    nochEinmal = true
    return laeuft
  }
  laeuft = (async () => {
    try {
      do {
        nochEinmal = false
        await einLauf()
      } while (nochEinmal)
    } catch {
      // Hintergrundarbeit; der nächste Anlass liest wieder.
    } finally {
      laeuft = null
    }
  })()
  return laeuft
}

function statusVon(fehler: unknown): number | null {
  const status = (fehler as { status?: unknown } | null)?.status
  return typeof status === 'number' ? status : null
}

async function einLauf(): Promise<void> {
  const konto = angemeldetesKonto()
  if (konto === null) return
  const jetzt = Date.now()
  for (const auftrag of await ladeLoeschAuftraege()) {
    if (angemeldetesKonto() !== konto) return
    const versuche = Number(auftrag.versuche) || 0
    if ((Number(auftrag.naechsterVersuch) || 0) > jetzt) continue

    let offen = false
    let geblieben = 0

    if (auftrag.clientUuid) {
      try {
        await deleteChatMessage(auftrag.clientUuid)
      } catch (fehler) {
        const status = statusVon(fehler)
        if (status === 404 || status === 410) {
          // Schon weg; das ist das Ziel.
        } else if (status !== null && ENDGUELTIG.has(status)) {
          await aufgeben(auftrag, 'aufgegeben', 0)
          continue
        } else {
          offen = true
        }
      }
    }

    for (const medium of auftrag.medien ?? []) {
      try {
        await loescheMedium(medium.mediaId)
      } catch {
        offen = true
        continue
      }
      chatMediaBlobCache.delete(medium.mediaId)
      try {
        await loescheChatMedium(medium.mediaId)
      } catch (fehler) {
        const status = statusVon(fehler)
        if (status === 404 || status === 410) {
          // bereits weg
        } else if (status === 403) {
          // Ein fremder Blob gehört dem Hochladenden; nicht wiederholen.
          geblieben += 1
        } else if (status !== null && ENDGUELTIG.has(status)) {
          geblieben += 1
        } else {
          offen = true
        }
      }
    }

    if (offen) {
      const naechste = versuche + 1
      if (naechste >= MAX_VERSUCHE) {
        await aufgeben(auftrag, 'aufgegeben', geblieben)
        continue
      }
      await schreibeLoeschauftrag({
        ...auftrag,
        versuche: naechste,
        naechsterVersuch: jetzt + RUECKZUG_MS[Math.min(naechste - 1, RUECKZUG_MS.length - 1)],
      }).catch(() => {})
      continue
    }

    await loescheLoeschauftrag(auftrag.id).catch(() => {})
    melder?.(auftrag, geblieben > 0 ? 'medienGeblieben' : 'erledigt', geblieben)
  }
}

async function aufgeben(
  auftrag: LoeschAuftrag,
  grund: LoeschGrund,
  medienGeblieben: number,
): Promise<void> {
  await loescheLoeschauftrag(auftrag.id).catch(() => {})
  melder?.(auftrag, grund, medienGeblieben)
}
