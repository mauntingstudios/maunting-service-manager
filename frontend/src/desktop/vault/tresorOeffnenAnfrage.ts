import { create } from 'zustand'

export interface TresorOeffnenAnfrage {
  /** Ziel-Reiter im Tresor (`fotos` für Medien/Kamera, `dateien` für sonstige Dateien/Ordner). */
  ansicht: 'fotos' | 'dateien'
  /** Eindeutiger Auslösezähler, damit auch wiederholte Anfragen wirken. */
  nonce: number
  itemId?: string
  ordnerId?: string
  albumId?: string
  /** Von der MSS Kamera App gelieferte MediaStore-/Datei-URI (`msm:open-vault`). */
  aufnahmeUri?: string
  /** Kennzeichnet, dass der Aufruf aus der MSS Kamera App kam. */
  vonKamera?: boolean
}

let naechsteNonce = 1

export function neueOeffnenNonce(): number {
  return naechsteNonce++
}

/**
 * Extrahiert aus einer Android-MediaStore-URI (`content://media/.../12345`)
 * die numerische `medienId`, um sie mit `item.datei.quelle.medienId` abzugleichen.
 */
export function extractMedienIdAusUri(uri?: string | null): number | null {
  if (!uri) return null
  const match = uri.match(/\/(\d+)(?:[?#].*)?$/)
  if (!match) return null
  const id = Number(match[1])
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

interface State {
  anfrage: TresorOeffnenAnfrage | null
  anfordern: (req: Omit<TresorOeffnenAnfrage, 'nonce'>) => number
  erledigen: (nonce: number) => void
}

export const useTresorOeffnenAnfrage = create<State>((set) => ({
  anfrage: null,
  anfordern: (req) => {
    const nonce = neueOeffnenNonce()
    set({ anfrage: { ...req, nonce } })
    return nonce
  },
  erledigen: (nonce) =>
    set((s) => (s.anfrage?.nonce === nonce ? { anfrage: null } : s)),
}))
