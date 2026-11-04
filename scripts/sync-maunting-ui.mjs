import { cpSync, existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

/**
 * Spiegelt `frontend/packages/maunting-ui` in das private Bibliotheks-Repo.
 *
 * Quelle der Wahrheit bleibt das MSM-Repository. Das private Repo ist die
 * Sicherung und die Veröffentlichungsfläche, kein zweiter Entwicklungsort.
 *
 *   node scripts/sync-maunting-ui.mjs           # Bericht
 *   node scripts/sync-maunting-ui.mjs --write   # kopieren
 *
 * Ziel: `MAUNTING_UI_REPO`, sonst `../maunting-ui`, sonst
 * `../maunting-design-dna` (der bisherige Name).
 */
const root = process.cwd()
const quelle = path.join(root, 'frontend', 'packages', 'maunting-ui')
const ziel =
  process.env.MAUNTING_UI_REPO ||
  [path.join(root, '..', 'maunting-ui'), path.join(root, '..', 'maunting-design-dna')].find(existsSync)

if (!existsSync(quelle)) throw new Error(`Quelle fehlt: ${quelle}`)
if (!ziel) throw new Error('Kein Ziel-Repo gefunden. Setze MAUNTING_UI_REPO.')

const AUSSCHLUSS = new Set(['node_modules', 'storybook-static', 'dist', '.turbo'])

function liste(dir, praefix = '') {
  const eintraege = []
  for (const name of readdirSync(dir)) {
    if (AUSSCHLUSS.has(name)) continue
    const voll = path.join(dir, name)
    const relativ = path.join(praefix, name)
    if (statSync(voll).isDirectory()) eintraege.push(...liste(voll, relativ))
    else eintraege.push(relativ)
  }
  return eintraege
}

const dateien = liste(quelle)
console.log(`Quelle: ${quelle}`)
console.log(`Ziel:   ${ziel}`)
console.log(`${dateien.length} Dateien: ${dateien.slice(0, 8).join(', ')}${dateien.length > 8 ? ' …' : ''}`)

if (!process.argv.includes('--write')) {
  console.log('Bericht only. Mit --write kopieren.')
} else {
  cpSync(quelle, ziel, {
    recursive: true,
    force: true,
    filter: (pfad) => !AUSSCHLUSS.has(path.basename(pfad)),
  })
  console.log('Kopiert. Im Ziel-Repo prüfen, alte Dateien entfernen, dann committen.')
}
