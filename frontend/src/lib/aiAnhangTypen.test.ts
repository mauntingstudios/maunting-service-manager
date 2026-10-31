import { describe, expect, it } from 'vitest'

import { anhangArt, dateiArt, lesbareGroesse } from './aiAnhangTypen'

describe('aiAnhangTypen', () => {
  it('erkennt Bilder an Typ oder Endung', () => {
    expect(dateiArt(new File(['x'], 'foto.webp', { type: '' }))).toBe('image')
    expect(dateiArt(new File(['x'], 'ohne-endung', { type: 'image/png' }))).toBe('image')
  })

  it('erkennt Text- und Codeformate ohne Sperrliste', () => {
    for (const name of ['einkauf.md', 'daten.json', 'index.ts', 'start.sh', 'bild.svg', 'Dockerfile']) {
      expect(dateiArt(new File(['x'], name, { type: '' }))).toBe('text')
    }
  })

  it('erkennt Dokumente', () => {
    expect(dateiArt(new File(['x'], 'bericht.pdf', { type: 'application/pdf' }))).toBe('document')
    expect(anhangArt('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'a.docx')).toBe('document')
  })

  it('faellt fuer Unbekanntes auf binaer zurueck', () => {
    expect(dateiArt(new File(['x'], 'daten.bin', { type: 'application/octet-stream' }))).toBe('binary')
  })

  it('formatiert Groessen deutsch und lesbar', () => {
    expect(lesbareGroesse(900)).toBe('900 B')
    expect(lesbareGroesse(2048)).toBe('2 KB')
    expect(lesbareGroesse(1.5 * 1024 * 1024)).toBe('1,5 MB')
  })
})
