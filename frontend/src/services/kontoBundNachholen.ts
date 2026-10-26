/**
 * Ein freigegebenes Gerät ohne Kontoschlüssel nachholen.
 *
 * Der einmalige Transfer bei der Freigabe kann am Netz scheitern. Der Server
 * kennt das Gerät dann als freigegeben, aber ohne Bund; es kann keinen
 * Chat-Schlüssel öffnen. Dieses Modul prüft die eigenen freigegebenen Geräte
 * und schickt den Bund erneut. 409 ist ein Erfolg.
 */

import { getOwnE2eeAccountBundle } from '@/api/social'
import { angemeldetesKonto } from '@/lib/angemeldetesKonto'
import { sendeKontoSchluesselAnGeraet } from './accountKeys'
import { geraeteVon } from './geraet/geraeteVerzeichnis'

let laeuft: Promise<void> | null = null
let nochEinmal = false

export function stosseKontoBundNachholenAn(): Promise<void> {
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
  const geraete = await geraeteVon(konto)
  for (const geraet of geraete) {
    if (angemeldetesKonto() !== konto) return
    if (geraet.is_approved === false) continue
    try {
      // 200: der Bund liegt bereits. 404: nachholen. 409 im Transfer ist
      // ebenfalls Erfolg.
      await getOwnE2eeAccountBundle(geraet.device_id)
    } catch (fehler) {
      if (statusVon(fehler) !== 404) continue
      // Nach dem Warten kann ein anderes Konto angemeldet sein; dessen
      // Geräteliste gehört nicht zu diesem Lauf.
      if (angemeldetesKonto() !== konto) return
      await sendeKontoSchluesselAnGeraet({
        device_id: geraet.device_id,
        public_key: geraet.public_key,
      }).catch(() => {})
    }
  }
}
