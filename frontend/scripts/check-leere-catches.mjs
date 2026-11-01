/**
 * Prüft auf leere catch-Blöcke im Frontend-Quelltext (Hardening WP2.5).
 *
 * Stellt sicher, dass die Anzahl unkommentierter/leerer catch-Blöcke die definierte
 * Baseline von 319 nicht überschreitet. Jeder absichtlich stumme Fehler soll
 * mit still(err, kontext) dokumentiert werden.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC_DIR = path.resolve(__dirname, '../src')

// Baseline gemäß msm-hardening-plan.md WP2.5
const BASELINE_MAX = 279

function walk(dir) {
  let results = []
  const list = fs.readdirSync(dir)
  for (const file of list) {
    const full = path.join(dir, file)
    const stat = fs.statSync(full)
    if (stat.isDirectory()) {
      if (file !== 'node_modules' && file !== 'dist') {
        results = results.concat(walk(full))
      }
    } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      results.push(full)
    }
  }
  return results
}

const files = walk(SRC_DIR)
let emptyCount = 0
const emptyCatchRegex = /catch\s*(?:\([^)]*\))?\s*\{(?:\s*|\s*\/\/[^\n]*\s*|\s*\/\*[\s\S]*?\*\/\s*)\}/g

const findings = []

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8')
  const matches = content.match(emptyCatchRegex)
  if (matches) {
    emptyCount += matches.length
    findings.push({ file: path.relative(SRC_DIR, file), count: matches.length })
  }
}

console.log(`[check-leere-catches] Gefundene leere catch-Blöcke: ${emptyCount} (Maximal erlaubt: ${BASELINE_MAX})`)

if (emptyCount > BASELINE_MAX) {
  console.error(`FEHLER: Die Anzahl leerer catch-Blöcke (${emptyCount}) überschreitet die Baseline von ${BASELINE_MAX}!`)
  console.error(`Bitte verwende still(err, 'kontext') aus '@/lib/still' statt leerer Blöcke.`)
  process.exit(1)
} else {
  console.log(`OK: Baseline eingehalten (${emptyCount} <= ${BASELINE_MAX}).`)
  process.exit(0)
}
