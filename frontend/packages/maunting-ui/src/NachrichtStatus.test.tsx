import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NachrichtStatus } from './NachrichtStatus'

describe('NachrichtStatus', () => {
  it('rendert den Status queued mit Uhr und passendem aria-label', () => {
    render(<NachrichtStatus status="queued" />)
    const el = screen.getByRole('img', { name: 'Wird gesendet...' })
    expect(el).toBeDefined()
  })

  it('rendert den Status sent mit einfachem Haken', () => {
    render(<NachrichtStatus status="sent" />)
    const el = screen.getByRole('img', { name: 'Gesendet' })
    expect(el).toBeDefined()
  })

  it('rendert den Status delivered mit Standardtext', () => {
    render(<NachrichtStatus status="delivered" />)
    const el = screen.getByRole('img', { name: 'Zugestellt' })
    expect(el).toBeDefined()
  })

  it('verwendet den KI-Empfängernamen für delivered und read', () => {
    const { rerender } = render(<NachrichtStatus status="delivered" empfaengerName="Singra" />)
    expect(screen.getByRole('img', { name: 'An Singra übergeben' })).toBeDefined()

    rerender(<NachrichtStatus status="read" empfaengerName="Singra" />)
    expect(screen.getByRole('img', { name: 'Von Singra gelesen' })).toBeDefined()
  })

  it('akzeptiert ein explizit übergebenes Label', () => {
    render(<NachrichtStatus status="read" label="Benutzerdefiniertes Label" />)
    expect(screen.getByRole('img', { name: 'Benutzerdefiniertes Label' })).toBeDefined()
  })

  it('rendert fehlgeschlagenen Status ohne Retry als Bild', () => {
    render(<NachrichtStatus status="failed" />)
    expect(screen.getByRole('img', { name: 'Fehlgeschlagen' })).toBeDefined()
  })

  it('rendert fehlgeschlagenen Status mit onErneutSenden als interaktiven Button', async () => {
    const onRetry = vi.fn()
    render(
      <NachrichtStatus
        status="failed"
        onErneutSenden={onRetry}
        erneutSendenLabel="Erneut versuchen"
      />
    )
    const btn = screen.getByRole('button', { name: 'Erneut versuchen' })
    expect(btn).toBeDefined()

    await userEvent.click(btn)
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
