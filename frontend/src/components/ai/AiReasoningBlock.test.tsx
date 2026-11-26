import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, beforeEach } from 'vitest'

import i18n from '@/i18n'
import { AiReasoningBlock, extractReasoningHeading } from './AiReasoningBlock'

describe('extractReasoningHeading', () => {
  it('picks the latest markdown heading while streaming and first heading when done', () => {
    const content = [
      '### Analysiere Nginx-Konfiguration',
      'Prüfe die Proxy-Header...',
      '**Validiere SSL-Zertifikatpfade:**',
      'Alles konsistent.',
    ].join('\n')

    expect(extractReasoningHeading(content, true)).toBe('Validiere SSL-Zertifikatpfade')
    expect(extractReasoningHeading(content, false)).toBe('Analysiere Nginx-Konfiguration')
  })

  it('returns null when no headings exist', () => {
    expect(extractReasoningHeading('Einfacher Gedankengang ohne Überschrift.', false)).toBeNull()
  })
})

describe('AiReasoningBlock', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de')
  })

  it('renders extracted heading in collapsible header and toggles body on click', () => {
    render(
      <AiReasoningBlock
        content={'**Prüfe Firewall-Regeln**\nPort 25565 ist offen.'}
        streaming={false}
      />,
    )

    const toggle = screen.getByRole('button')
    expect(toggle).toHaveTextContent('Prüfe Firewall-Regeln')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/Port 25565 ist offen\./)).toBeNull()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/Port 25565 ist offen\./)).toBeInTheDocument()
  })
})
