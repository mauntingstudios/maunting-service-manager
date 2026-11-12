import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { decodeHtmlEntities, FormatierterText, parseHtmlSnippet } from './FormatierterText'

describe('FormatierterText & parseHtmlSnippet', () => {
  it('löst HTML-Entities sauber auf', () => {
    expect(decodeHtmlEntities('Rockstar &amp; 2K &quot;Games&quot; &#39;GTA&#39;')).toBe(
      "Rockstar & 2K \"Games\" 'GTA'",
    )
  })

  it('formatiert <strong>- und <b>-Tags als Fettschrift', () => {
    render(<FormatierterText text="Das Spiel <strong>GTA 6</strong> ist von <b>Rockstar</b>." />)
    const strong = screen.getByText('GTA 6')
    expect(strong.tagName).toBe('STRONG')
    expect(strong).toHaveClass('font-semibold')

    const b = screen.getByText('Rockstar')
    expect(b.tagName).toBe('STRONG')
  })

  it('verwirft unsichere Tags wie <script> oder <a> ohne Textverlust', () => {
    render(
      <FormatierterText text="Wichtig: <script>alert(1)</script><a href='http://evil.example'>Linktext</a> bleibt." />,
    )
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText(/Linktext bleibt/)).toBeInTheDocument()
  })

  it('formatiert <em>, <i> und <mark>', () => {
    render(
      <FormatierterText text="Dies ist <em>kursiv</em> und <mark>hervorgehoben</mark>." />,
    )
    const em = screen.getByText('kursiv')
    expect(em.tagName).toBe('EM')
    const mark = screen.getByText('hervorgehoben')
    expect(mark.tagName).toBe('MARK')
  })

  it('behandelt unvollständige oder fehlende Tags robust', () => {
    render(<FormatierterText text="Offenes <strong>Tag am Ende" />)
    expect(screen.getByText('Tag am Ende').tagName).toBe('STRONG')
  })

  it('gibt bei leerem Text null zurück', () => {
    expect(parseHtmlSnippet('')).toBeNull()
    expect(parseHtmlSnippet(null)).toBeNull()
  })
})
