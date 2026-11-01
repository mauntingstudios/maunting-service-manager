import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

describe('Leere Catches Baseline (Hardening WP2.5)', () => {
  const BASELINE_MAX = 279

  function walk(dir: string): string[] {
    let results: string[] = []
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

  it('überschreitet nicht die Baseline von 279 leeren catch-Blöcken', () => {
    const srcDir = path.resolve(__dirname, '..')
    const files = walk(srcDir)
    let emptyCount = 0
    const emptyCatchRegex = /catch\s*(?:\([^)]*\))?\s*\{(?:\s*|\s*\/\/[^\n]*\s*|\s*\/\*[\s\S]*?\*\/\s*)\}/g

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8')
      const matches = content.match(emptyCatchRegex)
      if (matches) {
        emptyCount += matches.length
      }
    }

    expect(emptyCount).toBeLessThanOrEqual(BASELINE_MAX)
  })
})
