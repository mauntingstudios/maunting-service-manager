import { readFileSync } from 'node:fs'

/**
 * Findet Übersetzungsschlüssel mit demselben Text in beiden Sprachen.
 *
 * Nur ein Bericht: Ob zwei gleiche Texte dieselbe Bedeutung haben, entscheidet
 * ein Mensch. Die Ausgabe ist nach Gruppen sortiert, die größten zuerst.
 */
const de = JSON.parse(readFileSync('src/locales/de.json', 'utf8'))
const en = JSON.parse(readFileSync('src/locales/en.json', 'utf8'))

function flatten(baum, praefix = '', ziel = new Map()) {
  for (const [name, wert] of Object.entries(baum)) {
    const pfad = praefix ? `${praefix}.${name}` : name
    if (wert && typeof wert === 'object' && !Array.isArray(wert)) flatten(wert, pfad, ziel)
    else ziel.set(pfad, String(wert))
  }
  return ziel
}

const deutsch = flatten(de)
const englisch = flatten(en)
const gruppen = new Map()
for (const [pfad, text] of deutsch) {
  const englischText = englisch.get(pfad)
  if (englischText === undefined) continue
  const schluessel = `${text}\u0000${englischText}`
  if (!gruppen.has(schluessel)) gruppen.set(schluessel, [])
  gruppen.get(schluessel).push(pfad)
}

const mehrfach = [...gruppen.values()]
  .filter((pfade) => pfade.length > 1)
  .sort((a, b) => b.length - a.length)

const limit = process.argv.includes('--all') ? mehrfach.length : 40
for (const pfade of mehrfach.slice(0, limit)) {
  const text = deutsch.get(pfade[0])
  console.log(`\n${pfade.length}× „${text}“`)
  for (const pfad of pfade) console.log(`  ${pfad}`)
}
console.log(`\n${mehrfach.length} Gruppen mit mehr als einem Schlüssel.`)
