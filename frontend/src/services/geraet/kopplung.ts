/**
 * Kopplung: Der neue Weg uebergibt keinen Verlauf mehr, sondern die
 * Konto-Identitaet. Der Verlauf liegt ohnehin in `e2ee_messages` und wird vom
 * neuen Geraet mit dem Chat-Schluessel gelesen.
 */

import { sendeKontoSchluesselAnGeraet } from '../accountKeys'

export interface UebergabeZiel {
  device_id: string
  public_key: string
  label?: string
  family?: string | null
  created_at?: string
  paired_at?: string | null
}

export interface KopplungsStatus {
  redeemed?: boolean
  neue_geraete?: UebergabeZiel[]
  verlauf_abgelegt?: boolean
  label?: string
  family?: string | null
  expired?: boolean
}

export async function uebergebeVerlauf(
  _code: string,
  ziele: UebergabeZiel[],
): Promise<boolean> {
  let ok = ziele.length > 0
  for (const ziel of ziele) {
    try {
      await sendeKontoSchluesselAnGeraet({
        device_id: ziel.device_id,
        public_key: ziel.public_key,
      })
    } catch {
      // Ein nicht erreichbares Geraet haelt die uebrigen nicht auf, aber die
      // Übergabe gilt nur als vollständig, wenn jedes Ziel den Bund hat.
      ok = false
    }
  }
  return ok
}
