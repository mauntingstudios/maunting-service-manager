import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

/**
 * Zeigt den Ist-Stand des Designsystems: was exportiert wird, wo es liegt und
 * wer es importiert. Nur Ausgabe, kein Gate — das Gegenstück zu
 * `check-ui-importe.mjs` für die Portierung.
 */

const root = process.cwd()
const quellen = [
  path.join(root, 'src', 'Singra', 'UI'),
  path.join(root, 'src', 'components', 'ui'),
  path.join(root, 'packages', 'maunting-ui', 'src'),
]

const EXPORT = /export\s+(?:type\s+)?(?:const|function|class|interface|type|enum)?\s*\{?([^;{}]*)\}?/g

async function files(directory) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }
  const found = await Promise.all(entries.map(async entry => {
    const current = path.join(directory, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : files(current)
    return /\.(?:ts|tsx)$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name) ? [current] : []
  }))
  return found.flat()
}

for (const quelle of quellen) {
  const gefunden = await files(quelle)
  if (!gefunden.length) continue
  console.log(`\n${path.relative(root, quelle).replace(/\\/g, '/')} (${gefunden.length} Dateien)`)
  for (const file of gefunden.sort()) {
    const source = await readFile(file, 'utf8')
    const namen = new Set()
    for (const match of source.matchAll(EXPORT)) {
      const roh = match[1]?.trim()
      if (!roh) continue
      for (const teil of roh.split(',')) {
        const name = teil.replace(/\btype\b/, '').split(/\s+as\s+/).pop()?.trim()
        if (name && /^[A-Za-z_$][\w$]*$/.test(name)) namen.add(name)
      }
    }
    const rel = path.relative(quelle, file).replace(/\\/g, '/')
    if (namen.size) console.log(`  ${rel}: ${[...namen].join(', ')}`)
  }
}

const IMPORT = /from\s*['"](@\/Singra\/UI(?:\/[^'"]*)?|@\/components\/ui(?:\/[^'"]*)?)['"]/g
const zaehler = new Map()
async function scan(directory) {
  for (const file of await files(directory)) {
    const source = await readFile(file, 'utf8')
    for (const match of source.matchAll(IMPORT)) {
      zaehler.set(match[1], (zaehler.get(match[1]) ?? 0) + 1)
    }
  }
}
await scan(path.join(root, 'src'))

console.log('\nImporte:')
for (const [spezifizierer, anzahl] of [...zaehler].sort((a, b) => b[1] - a[1])) {
  console.log(String(anzahl).padStart(5), spezifizierer)
}
