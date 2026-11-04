import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import ts from 'typescript'

/**
 * Stellt Importe und Re-Exports von den alten Design-Pfaden auf `@maunting/ui`
 * und die neuen App-Pfade um.
 *
 * Der Codemod rät nicht am Text: er liest die Shim-Dateien, die nach dem Umzug
 * an den Altpfaden stehen. Steht dort `export * from '@maunting/ui'`, gehören
 * alle Symbole ins Paket. Steht dort ein App-Pfad, gehören sie dorthin. Das
 * Barrel `@/Singra/UI` wird Symbol für Symbol aufgelöst.
 *
 *   node scripts/codemod-ui.mjs           # Bericht
 *   node scripts/codemod-ui.mjs --write   # schreiben
 *   node scripts/codemod-ui.mjs --check   # rot bei verbleibendem Altpfad
 */

const root = process.cwd()
const write = process.argv.includes('--write')
const check = process.argv.includes('--check')
const paketZiel = '@maunting/ui'
const legacyDir = path.join(root, 'src', 'Singra', 'UI')
const uiDir = path.join(root, 'src', 'components', 'ui')

const isTest = name => /\.(?:test|spec)\.(?:ts|tsx)$/.test(name)

async function files(directory, out = []) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const current = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist') await files(current, out)
    } else if (/\.(?:ts|tsx)$/.test(entry.name)) {
      out.push(current)
    }
  }
  return out
}

async function shimZiel(specifier) {
  let datei = null
  if (specifier.startsWith('@/Singra/UI/')) {
    datei = path.join(legacyDir, specifier.slice('@/Singra/UI/'.length))
  } else if (specifier.startsWith('@/components/ui/')) {
    datei = path.join(uiDir, specifier.slice('@/components/ui/'.length))
  } else {
    return null
  }
  for (const kandidat of [datei, `${datei}.tsx`, `${datei}.ts`, path.join(datei, 'index.tsx'), path.join(datei, 'index.ts')]) {
    try {
      const inhalt = await readFile(kandidat, 'utf8')
      const treffer = inhalt.match(/export \* from ['"]([^'"]+)['"]/)
      return treffer ? treffer[1] : null
    } catch {
      // nächster Kandidat
    }
  }
  return null
}

const appMap = new Map()
const paketSymbole = new Set()

// Das Barrel nennt jedes Symbol einzeln. Jeder Eintrag wird über den Shim zu
// seinem echten Ziel aufgelöst.
const barrelDatei = path.join(legacyDir, 'index.ts')
const barrel = ts.createSourceFile(barrelDatei, await readFile(barrelDatei, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
for (const stmt of barrel.statements) {
  if (!ts.isExportDeclaration(stmt) || !stmt.moduleSpecifier || !ts.isStringLiteral(stmt.moduleSpecifier)) continue
  if (!stmt.exportClause || !ts.isNamedExports(stmt.exportClause)) continue
  const quelle = stmt.moduleSpecifier.text
  const ziel = quelle.startsWith('.')
    ? await shimZiel(`@/Singra/UI/${quelle.slice(2)}`)
    : quelle.startsWith('@/components/ui/')
      ? await shimZiel(quelle)
      : quelle
  if (!ziel) continue
  for (const element of stmt.exportClause.elements) {
    const name = (element.propertyName ?? element.name).text
    if (ziel === paketZiel) paketSymbole.add(name)
    else appMap.set(name, ziel)
  }
}

const LEGACY = /^@\/(?:Singra\/UI(?:\/|$)|components\/ui\/)/
const LEGACY_TEXT = /@\/(?:Singra\/UI|components\/ui)/

function importText(art, typeOnly, elemente, ziel) {
  const namen = elemente.map(element => {
    const importiert = (element.propertyName ?? element.name).text
    return element.propertyName ? `${importiert} as ${element.name.text}` : importiert
  })
  return `${art} ${typeOnly ? 'type ' : ''}{ ${namen.join(', ')} } from '${ziel}'`
}

async function planDatei(dateiname, text) {
  const source = ts.createSourceFile(dateiname, text, ts.ScriptTarget.Latest, true, dateiname.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const edits = []
  const warnungen = []

  for (const stmt of source.statements) {
    if (!stmt.moduleSpecifier || !ts.isStringLiteral(stmt.moduleSpecifier)) continue
    const spezifizierer = stmt.moduleSpecifier.text
    if (!LEGACY.test(spezifizierer)) continue

    if (ts.isExportDeclaration(stmt)) {
      if (!stmt.exportClause || !ts.isNamedExports(stmt.exportClause)) {
        warnungen.push(`${dateiname}: export * aus ${spezifizierer} bleibt vorerst stehen`)
        continue
      }
      const ziel = spezifizierer === '@/Singra/UI' ? null : await shimZiel(spezifizierer)
      if (!ziel) {
        warnungen.push(`${dateiname}: Re-Export aus ${spezifizierer} bleibt vorerst stehen`)
        continue
      }
      edits.push({
        start: stmt.getStart(source),
        end: stmt.getEnd(),
        text: importText('export', stmt.isTypeOnly, stmt.exportClause.elements, ziel),
      })
      continue
    }

    if (!ts.isImportDeclaration(stmt)) continue
    const clause = stmt.importClause
    if (!clause) {
      const ziel = await shimZiel(spezifizierer)
      if (ziel) edits.push({ start: stmt.getStart(source), end: stmt.getEnd(), text: `import '${ziel}'` })
      continue
    }
    if (clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) {
      warnungen.push(`${dateiname}: Default-/Namespace-Import aus ${spezifizierer} bleibt vorerst stehen`)
      continue
    }

    const ziele = new Map()
    let unbekannt = null
    if (spezifizierer === '@/Singra/UI') {
      for (const element of clause.namedBindings.elements) {
        const name = (element.propertyName ?? element.name).text
        const ziel = appMap.get(name) ?? (paketSymbole.has(name) ? paketZiel : null)
        if (!ziel) {
          unbekannt = name
          break
        }
        if (!ziele.has(ziel)) ziele.set(ziel, [])
        ziele.get(ziel).push(element)
      }
    } else {
      const ziel = await shimZiel(spezifizierer)
      if (ziel) ziele.set(ziel, [...clause.namedBindings.elements])
    }

    if (unbekannt) {
      warnungen.push(`${dateiname}: ${unbekannt} aus ${spezifizierer} ist keinem Ziel zugeordnet — Import bleibt stehen`)
      continue
    }
    if (!ziele.size) {
      warnungen.push(`${dateiname}: ${spezifizierer} ist kein bekannter Shim — Import bleibt stehen`)
      continue
    }

    const teile = [...ziele].map(([ziel, elemente]) => importText('import', clause.isTypeOnly, elemente, ziel))
    edits.push({ start: stmt.getStart(source), end: stmt.getEnd(), text: teile.join('\n') })
  }

  const aufrufe = []
  const besuch = knoten => {
    if (ts.isCallExpression(knoten) && knoten.arguments.length > 0 && ts.isStringLiteral(knoten.arguments[0])) {
      const arg = knoten.arguments[0]
      if (!LEGACY.test(arg.text)) return
      const istMock = ts.isPropertyAccessExpression(knoten.expression) && knoten.expression.name.text === 'mock'
      const istImport = knoten.expression.kind === ts.SyntaxKind.ImportKeyword
      if (!istMock && !istImport) return
      aufrufe.push({ arg, istMock, spezifizierer: arg.text })
    }
    ts.forEachChild(knoten, besuch)
  }
  besuch(source)

  for (const aufruf of aufrufe) {
    const ziel = aufruf.spezifizierer === '@/Singra/UI' ? paketZiel : await shimZiel(aufruf.spezifizierer)
    if (!ziel) {
      warnungen.push(`${dateiname}: ${aufruf.istMock ? 'vi.mock' : 'import()'} aus ${aufruf.spezifizierer} bleibt stehen`)
      continue
    }
    if (aufruf.spezifizierer === '@/Singra/UI') {
      warnungen.push(`${dateiname}: vi.mock/import() auf das Barrel wird zu ${ziel} — Verhalten prüfen`)
    }
    edits.push({ start: aufruf.arg.getStart(source) + 1, end: aufruf.arg.getEnd() - 1, text: ziel })
  }

  if (!edits.length) return { text, warnungen }
  const sortiert = edits.sort((a, b) => b.start - a.start)
  let neu = text
  for (const edit of sortiert) neu = neu.slice(0, edit.start) + edit.text + neu.slice(edit.end)
  return { text: neu, warnungen }
}

const dateien = (await files(path.join(root, 'src'))).filter(datei => {
  if (datei.startsWith(`${legacyDir}${path.sep}`) || datei.startsWith(`${uiDir}${path.sep}`)) return false
  return true
})

let geaendert = 0
let verbleibend = 0
const rest = []
const warnungen = []
for (const datei of dateien) {
  const text = await readFile(datei, 'utf8')
  if (!LEGACY_TEXT.test(text)) continue
  const ergebnis = await planDatei(datei, text)
  warnungen.push(...ergebnis.warnungen)
  if (ergebnis.text !== text) {
    geaendert += 1
    if (write) await writeFile(datei, ergebnis.text, 'utf8')
  }
  if (LEGACY_TEXT.test(ergebnis.text)) {
    verbleibend += 1
    rest.push(path.relative(root, datei).replace(/\\/g, '/'))
  }
}

console.log(`codemod-ui: ${geaendert} Dateien ${write ? 'geschrieben' : 'zu ändern'}, ${verbleibend} mit Rest-Altpfad`)
for (const datei of rest) console.log(`  Rest: ${datei}`)
for (const warnung of [...new Set(warnungen)]) console.log(`  ${warnung}`)

if (check && (geaendert > 0 || verbleibend > 0)) {
  console.error('\nEs verbleiben Altpfade. Erst --write laufen lassen, dann die Warnungen prüfen.')
  process.exitCode = 1
}
