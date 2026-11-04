import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DRITTANBIETER_HINWEIS_STORAGE_KEY,
  ThirdPartyPrivacyDialog,
  bestaetigeDrittanbieterHinweis,
  istDrittanbieterHinweisBestaetigt,
} from './ThirdPartyPrivacyDialog'

describe('ThirdPartyPrivacyDialog & Storage-Logik', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('ist standardmäßig unbestätigt', () => {
    expect(istDrittanbieterHinweisBestaetigt()).toBe(false)
  })

  it('speichert dauerhafte Bestätigung mit Haken ("nie wieder")', () => {
    bestaetigeDrittanbieterHinweis(true)
    expect(istDrittanbieterHinweisBestaetigt()).toBe(true)
    const stored = JSON.parse(window.localStorage.getItem(DRITTANBIETER_HINWEIS_STORAGE_KEY) || '{}')
    expect(stored.dismissed).toBe(true)
    expect(stored.snoozedUntil).toBeUndefined()
  })

  it('speichert 24-Stunden-Snooze ohne Haken', () => {
    const jetzt = 1_000_000
    bestaetigeDrittanbieterHinweis(false)
    const stored = JSON.parse(window.localStorage.getItem(DRITTANBIETER_HINWEIS_STORAGE_KEY) || '{}')
    expect(stored.dismissed).toBe(false)
    expect(stored.snoozedUntil).toBeGreaterThan(Date.now())

    // Innerhalb von 24h gültig
    expect(istDrittanbieterHinweisBestaetigt(DRITTANBIETER_HINWEIS_STORAGE_KEY, Date.now() + 1000)).toBe(true)

    // Nach 24h abgelaufen
    expect(istDrittanbieterHinweisBestaetigt(DRITTANBIETER_HINWEIS_STORAGE_KEY, Date.now() + 25 * 60 * 60 * 1000)).toBe(false)
  })

  it('rendert den Dialog mit Hinweisen zu Telegram, Discord, Instagram und WhatsApp', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()

    render(
      <ThirdPartyPrivacyDialog
        open={true}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )

    expect(screen.getByText(/Hinweis zur Datensicherheit bei Drittanbietern/i)).toBeInTheDocument()
    expect(screen.getByText(/Telegram:/i)).toBeInTheDocument()
    expect(screen.getByText(/Discord:/i)).toBeInTheDocument()
    expect(screen.getByText(/Instagram:/i)).toBeInTheDocument()
    expect(screen.getByText(/WhatsApp:/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Diesen Hinweis nicht mehr anzeigen/i)).toBeInTheDocument()
  })

  it('ruft onCancel auf beim Klick auf Abbrechen', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()

    render(
      <ThirdPartyPrivacyDialog
        open={true}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Abbrechen/i }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('bestätigt mit 24h-Stummschaltung bei Fortfahren ohne Haken', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()

    render(
      <ThirdPartyPrivacyDialog
        open={true}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Verstanden & fortfahren/i }))
    expect(onConfirm).toHaveBeenCalledWith(false)
    expect(istDrittanbieterHinweisBestaetigt()).toBe(true)
  })

  it('bestätigt dauerhaft, wenn der Haken gesetzt ist', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()

    render(
      <ThirdPartyPrivacyDialog
        open={true}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )

    const checkbox = screen.getByLabelText(/Diesen Hinweis nicht mehr anzeigen/i)
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: /Verstanden & fortfahren/i }))

    expect(onConfirm).toHaveBeenCalledWith(true)
    const stored = JSON.parse(window.localStorage.getItem(DRITTANBIETER_HINWEIS_STORAGE_KEY) || '{}')
    expect(stored.dismissed).toBe(true)
  })
})
