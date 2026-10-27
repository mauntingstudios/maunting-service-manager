/**
 * Ist gerade ein Gespräch offen?
 *
 * Hängt davon ab, ob die Hülle ihre eigene Kopfzeile zeigt. Der Messenger legt
 * die offene Unterhaltung in die Adresse (`?userId=`, `?groupId=` oder
 * `?contact=`), damit ein Neuladen und ein Link dasselbe Gespräch öffnen — die
 * Hüllen können daraus lesen, ohne den Messenger zu kennen.
 *
 * Gebraucht wird es an genau zwei Stellen: Web-Hülle und MSM am Handy blenden
 * ihre Leiste aus, solange ein Chat offen ist, damit der Chat oben beginnt.
 */
export function chatIstOffen(suche: string): boolean {
  const params = new URLSearchParams(suche.startsWith('?') ? suche : `?${suche}`)
  for (const key of ['userId', 'contact', 'groupId']) {
    const wert = params.get(key)
    if (wert && wert.trim()) return true
  }
  return false
}
