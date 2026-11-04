import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ColorPicker } from './ColorPicker'

function oeffne(wert = '#3b82f6') {
  const onChange = vi.fn()
  render(<ColorPicker value={wert} onChange={onChange} />)
  fireEvent.click(screen.getByRole('button', { name: 'Farbpalette öffnen' }))
  return { onChange }
}

describe('ColorPicker', () => {
  it('zeigt Presets und Hex-Eingabe wie bisher', () => {
    const onChange = vi.fn()
    render(<ColorPicker value="#10b981" onChange={onChange} />)

    expect(screen.getByRole('radio', { name: 'Smaragd', checked: true })).toBeInTheDocument()
    expect(screen.getByLabelText('Hex-Farbwert')).toHaveValue('10B981')

    fireEvent.click(screen.getByRole('radio', { name: 'Rose' }))
    expect(onChange).toHaveBeenCalledWith('#f43f5e')
  })

  it('öffnet die Palette am Auslöser und schließt mit Escape', async () => {
    oeffne()

    const dialog = await screen.findByRole('dialog', { name: 'Eigene Farbe wählen' })
    expect(dialog).toBeInTheDocument()
    // Portal heißt: direkt an body, außerhalb jedes Überlauf-Containers.
    expect(dialog.parentElement).toBe(document.body)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Eigene Farbe wählen' })).not.toBeInTheDocument()
  })

  it('stellt den Farbton per Regler ein', async () => {
    const { onChange } = oeffne()
    const regler = await screen.findByLabelText('Farbton')

    fireEvent.change(regler, { target: { value: '0' } })

    // Ton 0 bei Sättigung/Helligkeit von Blau: ein reines Rot.
    expect(onChange).toHaveBeenCalledWith('#f63b3b')
  })

  it('stellt Sättigung und Helligkeit per Tastatur ein', async () => {
    const { onChange } = oeffne()
    const feld = await screen.findByRole('slider', { name: 'Sättigung und Helligkeit' })

    fireEvent.keyDown(feld, { key: 'ArrowLeft' })

    expect(onChange).toHaveBeenCalledTimes(1)
    const hex = onChange.mock.calls[0][0] as string
    expect(hex).toMatch(/^#[0-9a-f]{6}$/)
    expect(hex).not.toBe('#3b82f6')
  })

  it('stellt Sättigung und Helligkeit per Zeiger ein', async () => {
    const { onChange } = oeffne()
    const feld = await screen.findByRole('slider', { name: 'Sättigung und Helligkeit' })
    Object.defineProperty(feld, 'getBoundingClientRect', {
      value: () => ({
        left: 0, top: 0, width: 200, height: 160,
        right: 200, bottom: 160, x: 0, y: 0, toJSON: () => ({}),
      }),
    })

    // Rechts oben: volle Sättigung, volle Helligkeit, Ton bleibt Blau.
    fireEvent.pointerDown(feld, { clientX: 200, clientY: 0, buttons: 1, pointerId: 1 })

    expect(onChange).toHaveBeenCalledTimes(1)
    const hex = onChange.mock.calls[0][0] as string
    expect(hex).toMatch(/^#[0-9a-f]{6}$/)
    expect(hex).not.toBe('#3b82f6')
  })

  it('nimmt weiter Hex aus dem Eingabefeld', () => {
    const onChange = vi.fn()
    render(<ColorPicker value="#3b82f6" onChange={onChange} />)

    fireEvent.change(screen.getByLabelText('Hex-Farbwert'), { target: { value: 'ff0000' } })
    expect(onChange).toHaveBeenCalledWith('#ff0000')
  })
})
