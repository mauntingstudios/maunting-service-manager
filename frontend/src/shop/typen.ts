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
  hardwareCpuModel?: string | null
  hardwareRamType?: string | null
  hardwareStorageType?: string | null
  platforms?: string[]
  lifetimePreisCent?: number | null
  allowGameSwitch?: boolean
  ddosProvider?: string | null
  ddosProfile?: string | null
  ddosGameAware?: boolean
  geschaetzteSetupSekunden?: number
}

export type LaufzeitMonate = 1 | 3 | 12
export type AbrechnungsModus = 'prepaid' | 'subscription' | 'lifetime'

export interface Konfiguration {
  ramGb: number
  cpu: number
  slots: number
  laufzeitMonate: LaufzeitMonate
  abrechnungsModus?: AbrechnungsModus
  mods: boolean
  kiZugang: boolean
  preferredNodeId?: number | null
  standortName?: string | null
  standortAufpreisCent?: number
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
  standortCent: number
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
    abrechnungsModus: 'prepaid',
    mods: false,
    kiZugang: false,
  }
}
