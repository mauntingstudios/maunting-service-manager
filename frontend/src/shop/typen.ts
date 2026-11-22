export interface ShopSpiel {
  /** Blueprint-ID aus backend/blueprints/native — derselbe Schluessel wie spaeter im Katalog. */
  id: string
  name: string
  game: string
  category: string
  beschreibung: { de: string; en: string }
  tags: string[]
  unterstuetztMods: boolean
  unterstuetztWorkshop: boolean
  motiv: string
  /** Optionales Steam-Header-Bild; ohne Angabe rendert SpielArtwork den Gradient. */
  bildUrl?: string
  grundpreisCent: number
  ramStufenGb: number[]
  standardRamGb: number
  ramStepGb?: number
  preisProGbCent: number
  cpuStufen: number[]
  standardCpu: number
  cpuStep?: number
  preisProKernCent: number
  slotStufen: number[]
  standardSlots: number
  slotStep?: number
  preisProSlotCent: number
  kiZugangCent: number
  verfuegbar?: boolean
}

export type LaufzeitMonate = 1 | 3 | 12

export interface Konfiguration {
  ramGb: number
  cpu: number
  slots: number
  laufzeitMonate: LaufzeitMonate
  mods: boolean
  kiZugang: boolean
}

export interface KassenEntwurf {
  spielId: string
  tarifId?: number
  konfiguration: Konfiguration
}

export interface PreisAufschluesselung {
  grundpreisCent: number
  ramCent: number
  cpuCent: number
  slotsCent: number
  kiCent: number
  monatCent: number
  rabattProzent: number
  gesamtCent: number
}

export function standardKonfiguration(spiel: ShopSpiel): Konfiguration {
  return {
    ramGb: spiel.standardRamGb,
    cpu: spiel.standardCpu,
    slots: spiel.standardSlots,
    laufzeitMonate: 1,
    mods: false,
    kiZugang: false,
  }
}
