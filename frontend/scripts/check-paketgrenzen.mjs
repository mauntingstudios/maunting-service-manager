import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

/**
 * Zieht die Grenze um `@maunting/ui`.
 *
 * Das Paket darf nur wenige Dinge kennen: React, i18n, Lucide, Motion, Radix
 * und die eigenen relativen Dateien. `@/…`, Stores, Router und Tauri machen aus
 * der Bibliothek wieder eine App — und aus jedem Import einen Zyklus.
 *
 * Zusätzlich: eine Datei unter `src/components/ui`, die bereits aus
 * `@maunting/ui` re-exportiert, darf nur noch importieren und exportieren. Kein
 * JSX, keine Funktion, keine zweite Implementierung.
 */

const root = process.cwd()
const packageSrc = path.join(root, 'packages', 'maunting-ui', 'src')
const shimDir = path.join(root, 'src', 'components', 'ui')

const ERLAUBT = new Set([
  'react',
  'react-dom',
  'react/jsx-runtime',
  'react-i18next',
  'i18next',
  'lucide-react',
  'motion',
  'motion/react',
  'clsx',
  'tailwind-merge',
  'class-variance-authority',
])
const ERLAUBT_PRAEFIX = ['@radix-ui/']
const CSS = /\.css$/

const IMPORT = /(?:from\s*|import\s*\(\s*|vi\.mock\s*\(\s*)['"]([^'"]+)['"]/g

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

const fehler = []

for (const file of await files(packageSrc)) {
  const source = await readFile(file, 'utf8')
  const relativ = path.relative(root, file).replace(/\\/g, '/')
  for (const match of source.matchAll(IMPORT)) {
    const spezifizierer = match[1]
    if (spezifizierer.startsWith('.')) continue
    if (CSS.test(spezifizierer)) continue
    if (ERLAUBT.has(spezifizierer)) continue
    if (ERLAUBT_PRAEFIX.some(praefix => spezifizierer.startsWith(praefix))) continue
    fehler.push(`${relativ}: importiert "${spezifizierer}" — das Paket kennt nur React, i18n, Lucide, Motion, Radix und relative Pfade`)
  }
}

for (const file of await files(shimDir)) {
  const source = await readFile(file, 'utf8')
  if (!source.includes("from '@maunting/ui'")) continue
  const ohneKommentare = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
  const relativ = path.relative(root, file).replace(/\\/g, '/')
  if (/<[A-Za-z]/.test(ohneKommentare)) {
    fehler.push(`${relativ}: Shim enthält JSX — er darf nur re-exportieren`)
  }
  if (/\b(?:function|class)\s+[A-Za-z_]/.test(ohneKommentare) || /\b(?:const|let|var)\s+[A-Za-z_]\w*\s*=/.test(ohneKommentare)) {
    fehler.push(`${relativ}: Shim enthält eigene Logik — er darf nur re-exportieren`)
  }
}

if (fehler.length) {
  console.error(`\nPaketgrenzen verletzt (${fehler.length}):\n  ${fehler.join('\n  ')}\n`)
  process.exitCode = 1
} else {
  console.log('paketgrenzen: sauber')
}
