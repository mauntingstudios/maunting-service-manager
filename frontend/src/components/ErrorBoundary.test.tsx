import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { ErrorBoundary } from './ErrorBoundary'

function Kaputt(): JSX.Element {
  throw new Error('geheimer Pfad /srv/panel/secrets.env')
}

describe('ErrorBoundary', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de')
    // React meldet den abgefangenen Fehler selbst auf der Konsole. Im Test ist
    // das nur Rauschen.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('zeigt die Ersatzkarte statt eines leeren Baums', () => {
    const { container } = render(
      <ErrorBoundary>
        <Kaputt />
      </ErrorBoundary>,
    )

    expect(screen.getByRole('heading', { name: 'Diese Ansicht konnte nicht geladen werden' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Neu laden' })).toBeInTheDocument()
    expect(container).not.toBeEmptyDOMElement()
  })

  it('zeigt die Fehlermeldung selbst nicht an', () => {
    render(
      <ErrorBoundary>
        <Kaputt />
      </ErrorBoundary>,
    )

    expect(document.body.textContent).not.toContain('/srv/panel/secrets.env')
  })

  it('lässt fehlerfreie Kinder unverändert durch', () => {
    render(
      <ErrorBoundary>
        <p>Alles gut</p>
      </ErrorBoundary>,
    )

    expect(screen.getByText('Alles gut')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Neu laden' })).not.toBeInTheDocument()
  })

  it('zeigt eine Fehler-ID an', () => {
    render(
      <ErrorBoundary>
        <Kaputt />
      </ErrorBoundary>,
    )

    expect(document.body.textContent).toMatch(/ID:\s*[a-zA-Z0-9-]+/)
  })

  it('ruft den onError Callback mit Fehler und ID auf', () => {
    const onError = vi.fn()
    render(
      <ErrorBoundary onError={onError}>
        <Kaputt />
      </ErrorBoundary>,
    )

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error)
    expect(typeof onError.mock.calls[0][1]).toBe('string')
    expect(onError.mock.calls[0][1].length).toBeGreaterThan(0)
  })
})
