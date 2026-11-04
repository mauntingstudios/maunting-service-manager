import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

/**
 * Zählt, wie viele Stellen noch aus den alten Design-Pfaden importieren.
 *
 * Der Umbau zieht die Komponenten nach `packages/maunting-ui`. Bis dahin ist
 * die Zahl ein Fortschrittsmaß, danach ein Verbot: `--max=0` lässt keinen
 * Legacy-Import mehr durch. Gezählt werden nur Aufrufer außerhalb der beiden
 * Altverzeichnisse — die Dateien dort importieren sich naturgemäß gegenseitig.
 */

const root = process.cwd()
const sourceDir = path.join(root, 'src')
const legacyDirs = [
  path.join(root, 'src', 'Singra', 'UI'),
  path.join(root, 'src', 'components', 'ui'),
]

const IMPORT = /(?:from\s*|import\s*\(\s*|vi\.mock\s*\(\s*)['"](@\/Singra\/UI(?:\/[^'"]*)?|@\/components\/ui(?:\/[^'"]*)?)['"]/g

const isTest = name => /\.(?:test|spec)\.(?:ts|tsx)$/.test(name)

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
    return /\.(?:ts|tsx)$/.test(entry.name) ? [current] : []
  }))
  return found.flat()
}

const funde = []
for (const file of await files(sourceDir)) {
  if (legacyDirs.some(dir => file.startsWith(`${dir}${path.sep}`))) continue
  const source = await readFile(file, 'utf8')
  for (const match of source.matchAll(IMPORT)) {
    funde.push({
      datei: path.relative(root, file).replace(/\\/g, '/'),
      spezifizierer: match[1],
      test: isTest(path.basename(file)),
    })
  }
}

const maxArg = process.argv.find(argument => argument.startsWith('--max='))
const max = maxArg ? Number(maxArg.slice('--max='.length)) : null

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ anzahl: funde.length, funde }, null, 2))
} else {
  const jeDatei = new Map()
  for (const fund of funde) jeDatei.set(fund.datei, (jeDatei.get(fund.datei) ?? 0) + 1)
  const top = [...jeDatei].sort((a, b) => b[1] - a[1]).slice(0, 15)
  console.log(`Legacy-UI-Importe: ${funde.length} in ${jeDatei.size} Dateien`)
  console.log(`  davon Tests: ${funde.filter(fund => fund.test).length}`)
  for (const [datei, anzahl] of top) console.log(String(anzahl).padStart(5), datei)
}

if (max !== null && funde.length > max) {
  console.error(`\nErlaubt sind höchstens ${max} Legacy-UI-Importe, gefunden ${funde.length}.`)
  process.exitCode = 1
}
