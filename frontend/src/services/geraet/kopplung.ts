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
  let ok = false
  for (const ziel of ziele) {
    try {
      await sendeKontoSchluesselAnGeraet({
        device_id: ziel.device_id,
        public_key: ziel.public_key,
      })
      ok = true
    } catch {
      // Ein nicht erreichbares Geraet haelt die uebrigen nicht auf.
    }
  }
  return ok
}
