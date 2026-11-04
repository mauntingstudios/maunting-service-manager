/** Die Ansichten des Tresors an einer Stelle — Navigation und Inhalt lesen dieselbe Liste. */
export type VaultAnsicht = 'uebersicht' | 'tresor' | 'fotos' | 'dateien' | 'zahlung' | 'archiv' | 'papierkorb'

export interface VaultAnsichtEintrag {
  id: VaultAnsicht
  labelKey: string
}

export const TRESOR_ANSICHTEN: VaultAnsichtEintrag[] = [
  { id: 'uebersicht', labelKey: 'mss.vault.dashboard.uebersicht' },
  { id: 'tresor', labelKey: 'mss.vault.ansicht.tresor' },
  { id: 'fotos', labelKey: 'mss.vault.ansicht.fotos' },
  { id: 'dateien', labelKey: 'mss.vault.ansicht.dateien' },
  { id: 'zahlung', labelKey: 'mss.vault.ansicht.zahlung' },
  { id: 'archiv', labelKey: 'mss.vault.ansicht.archiv' },
  { id: 'papierkorb', labelKey: 'mss.vault.ansicht.papierkorb' },
]

export function istTresorAnsicht(wert: string): wert is VaultAnsicht {
  return TRESOR_ANSICHTEN.some((eintrag) => eintrag.id === wert)
}
