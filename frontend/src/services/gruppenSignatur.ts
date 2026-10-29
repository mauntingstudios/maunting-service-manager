/**
 * Die Unterschrift der Gruppenblöcke — Name, Beschreibung, Bild, Rollen.
 *
 * **Der Kontext.** Alle Blöcke einer Gruppe werden unter `group:<kennung>`
 * unterschrieben, nicht unter der Postfachkennung. Die Postfachkennung einer
 * Gruppe wird an zwei Stellen verschieden hergeleitet — einmal als Hash über
 * die Kennung, einmal als `group:<id>` — und welcher davon im Client gerade
 * benutzt wird, hängt davon ab, wer den Block öffnet. Ein Block, der unter dem
 * einen Kontext unterschrieben und unter dem anderen geprüft wird, gilt beiden
 * als gefälscht. Darum steht hier eine eigene, feste Kennung.
 *
 * **Das unbekannte Gerät.** Die Signatur nennt das Gerät des Schreibers, und
 * ein Leser kann sie nur prüfen, wenn er dessen Gerät kennt. Zwei Mitglieder
 * einer Gruppe, die ihre Geräte nicht freigegeben haben, kennen sich
 * gegenseitig nicht — und könnten so den Namen der Gruppe nicht lesen. Für
 * Gruppenblöcke ist das der Normalfall, nicht der Ausnahmefall.
 *
 * Deshalb gilt hier: Ein Gerät, das dem Leser **nicht bekannt** ist, macht
 * den Block nicht ungültig. Der Block ist mit dem Gruppenschlüssel
 * verschlüsselt, und den haben nur Mitglieder; die Schreibberechtigung hat
 * der Server geprüft. Ein Gerät, das dem Leser **bekannt** ist, dessen
 * Signatur aber nicht stimmt, bleibt eine Fälschung.
 */

import { signaturSchluesselVon } from './e2eeGeraet'
import { pruefeNutzlast } from './nutzlastSignatur'

/** Der Signaturkontext aller Gruppenblöcke. */
export function gruppenSignaturKontext(groupId: number): string {
  return `group:${groupId}`
}

export type GruppenSignaturPruefung =
  /** Die Signatur ist echt. */
  | { art: 'geprueft'; vonKonto: number }
  /** Das Gerät des Schreibers ist dem Leser unbekannt; der Block gilt. */
  | { art: 'unbekanntesGeraet'; vonKonto: number }
  /** Die Signatur ist falsch. */
  | { art: 'gefaelscht'; vonKonto: number }

/**
 * Prüft die Unterschrift einer Gruppennutzlast.
 *
 * `kontextId` ist der Signaturkontext (`group:<kennung>`), nicht die
 * Postfachkennung.
 */
export async function pruefeGruppenSignatur(
  roh: Record<string, unknown>,
  kontextId: string,
): Promise<GruppenSignaturPruefung> {
  const beleg = await pruefeNutzlast(kontextId, roh)
  if (beleg.art === 'geprueft') return { art: 'geprueft', vonKonto: beleg.vonKonto }
  if (beleg.art === 'unsigniert') return { art: 'gefaelscht', vonKonto: 0 }
  const geraet = typeof roh.von_geraet === 'string' ? roh.von_geraet : ''
  const bekannt = await signaturSchluesselVon(beleg.behauptet, geraet)
  if (!bekannt) return { art: 'unbekanntesGeraet', vonKonto: beleg.behauptet }
  return { art: 'gefaelscht', vonKonto: beleg.behauptet }
}
