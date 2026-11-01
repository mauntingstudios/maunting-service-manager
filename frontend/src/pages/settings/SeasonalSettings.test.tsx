import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { SeasonalSettings } from './SeasonalSettings'
import { EMPTY_PANEL_SETTINGS } from './types'

describe('SeasonalSettings', () => {
  beforeEach(() => {
    void i18n.changeLanguage('de')
  })

  it('meldet die Sofort-Aktivierung von Halloween', () => {
    const onChange = vi.fn()
    render(<SeasonalSettings settings={EMPTY_PANEL_SETTINGS} onChange={onChange} />)

    fireEvent.click(screen.getByRole('switch', { name: 'Halloween Immer an' }))

    expect(onChange).toHaveBeenCalledWith({ season_halloween_mode: 'on' })
  })

  it('meldet die Sofort-Aktivierung des MSM-Jubilaeums', () => {
    const onChange = vi.fn()
    render(<SeasonalSettings settings={EMPTY_PANEL_SETTINGS} onChange={onChange} />)

    fireEvent.click(screen.getByRole('switch', { name: 'MSM-Jubiläum (20. Mai) Immer an' }))

    expect(onChange).toHaveBeenCalledWith({ season_birthday_mode: 'on' })
  })

  it('meldet den Zeitplan von Weihnachten', () => {
    const onChange = vi.fn()
    render(<SeasonalSettings settings={{ ...EMPTY_PANEL_SETTINGS, season_christmas_mode: 'off' }} onChange={onChange} />)

    fireEvent.click(screen.getByRole('switch', { name: 'Weihnachten Automatisch' }))

    expect(onChange).toHaveBeenCalledWith({ season_christmas_mode: 'auto' })
  })

  it('uebernimmt ein eingegebenes Datum erst nach gueltiger Pruefung', () => {
    const onChange = vi.fn()
    render(<SeasonalSettings settings={EMPTY_PANEL_SETTINGS} onChange={onChange} />)

    const datum = screen.getAllByLabelText('Von Datum')[1]
    fireEvent.change(datum, { target: { value: '2510' } })
    fireEvent.blur(datum)

    expect(onChange).toHaveBeenCalledWith({ season_halloween_start: '10-25T00:00' })
  })

  it('meldet Aenderungen am Geburtstags-Zeitfenster', () => {
    const onChange = vi.fn()
    render(<SeasonalSettings settings={EMPTY_PANEL_SETTINGS} onChange={onChange} />)

    const datum = screen.getAllByLabelText('Von Datum')[0]
    fireEvent.change(datum, { target: { value: '1905' } })
    fireEvent.blur(datum)

    expect(onChange).toHaveBeenCalledWith({ season_birthday_start: '05-19T00:00' })
  })

  it('zeigt einen Fehler bei einem unmoeglichen Datum', () => {
    const onChange = vi.fn()
    render(<SeasonalSettings settings={EMPTY_PANEL_SETTINGS} onChange={onChange} />)

    const datum = screen.getAllByLabelText('Von Datum')[0]
    fireEvent.change(datum, { target: { value: '3201' } })
    fireEvent.blur(datum)

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByText('Bitte TT.MM. und eine Uhrzeit angeben.')).toBeInTheDocument()
  })
})
