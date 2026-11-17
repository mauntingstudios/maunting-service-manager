import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Globe } from 'lucide-react'
import { DownloadKnopf, DownloadZeile } from './DownloadKnopf'

const PROPS = {
  href: 'https://example.invalid/app.exe',
  icon: <Globe className="w-4 h-4" />,
  titel: 'Beispiel-App',
  subtext: 'App für Windows',
  tooltip: 'Beispiel-App herunterladen',
}

describe('DownloadKnopf', () => {
  it('verlinkt den Download mit Namen und Hinweis', () => {
    render(<DownloadKnopf {...PROPS} />)

    const link = screen.getByRole('link', { name: 'Beispiel-App herunterladen' })
    expect(link).toHaveAttribute('href', 'https://example.invalid/app.exe')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer noopener')
    // Der Name steht auch zugeklappt im DOM — für Screenreader und Tests.
    expect(link).toHaveTextContent('Beispiel-App')
  })
})

describe('DownloadZeile', () => {
  it('verlinkt den Download als sichtbare Zeile', () => {
    render(<DownloadZeile {...PROPS} />)

    const link = screen.getByRole('link', { name: 'Beispiel-App herunterladen' })
    expect(link).toHaveAttribute('href', 'https://example.invalid/app.exe')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveTextContent('Beispiel-App')
    expect(link).toHaveTextContent('App für Windows')
  })
})
