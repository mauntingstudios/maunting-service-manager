/**
 * Das Wake-Word ist der Name der KI: Singra.
 *
 * Bis 05.10.2026 kam es aus dem frei wählbaren Rufnamen des Kontos. Wer damals
 * auf einen eigenen Namen (oder den Standard „Assistent“) kalibriert hat, soll
 * den Hinweis zum Neueinsprechen sehen — trainiert wird aber nur noch auf
 * Singra, egal was das Konto früher trug.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const wakewordTrainierenMock = vi.fn().mockResolvedValue(undefined)
const wakewordAufnehmenMock = vi.fn().mockResolvedValue(undefined)
const wakewordStandMock = vi.fn()

vi.mock('./tauri', () => ({
  konfigLaden: vi.fn().mockResolvedValue({ wakeword_aktiv: false, wakeword_schwelle: 0.45 }),
  konfigAendern: vi.fn().mockResolvedValue({ wakeword_aktiv: false, wakeword_schwelle: 0.45 }),
  wakewordAufnehmen: (nummer: number) => wakewordAufnehmenMock(nummer),
  wakewordLauschen: vi.fn().mockResolvedValue(undefined),
  wakewordStand: () => wakewordStandMock(),
  wakewordTrainieren: (wort: string) => wakewordTrainierenMock(wort),
  wakewordZuruecksetzen: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }))
vi.mock('@/lib/errungenschaft', () => ({ meldeErrungenschaft: vi.fn() }))

import i18n from '@/i18n'
import { duckingTestReset, istDuckingAktiv } from '@/lib/audioDucking'
import { WakewordEinrichtung } from './WakewordEinrichtung'

describe('WakewordEinrichtung', () => {
  beforeEach(() => {
    localStorage.clear()
    duckingTestReset()
    wakewordTrainierenMock.mockClear()
    wakewordAufnehmenMock.mockReset().mockResolvedValue(undefined)
    wakewordStandMock.mockResolvedValue({
      aufnahmen: 6,
      trainiert: true,
      lauscht: false,
      wort: 'Assistent',
    })
  })

  afterEach(() => {
    duckingTestReset()
  })

  it('nennt Singra als Wake-Word und bietet das Neueinsprechen an', async () => {
    render(<WakewordEinrichtung />)

    expect(await screen.findByText('Singra')).toBeInTheDocument()
    expect(
      await screen.findByText(i18n.t('mss.wakeword.neuKalibrieren', { alt: 'Assistent', neu: 'Singra' })),
    ).toBeInTheDocument()
  })

  it('trainiert immer auf Singra', async () => {
    render(<WakewordEinrichtung />)

    const knopf = await screen.findByRole('button', { name: i18n.t('mss.wakeword.trainieren') })
    await waitFor(() => expect(knopf).toBeEnabled())
    fireEvent.click(knopf)

    await waitFor(() => expect(wakewordTrainierenMock).toHaveBeenCalledWith('Singra'))
  })

  it('aktiviert Ducking während der Wake-Word-Kalibrierung und gibt es immer frei', async () => {
    let duckingWaehrendAufnahme = false
    let stand = 0
    wakewordStandMock.mockImplementation(async () => ({
      aufnahmen: stand,
      gesamt: 6,
      trainiert: false,
      lauscht: false,
      wort: null,
    }))
    wakewordAufnehmenMock.mockImplementation(async () => {
      duckingWaehrendAufnahme = istDuckingAktiv()
      stand = 6
    })

    render(<WakewordEinrichtung />)

    const kalibrierenBtn = await screen.findByRole('button', { name: i18n.t('mss.wakeword.kalibrierungStarten') })
    await waitFor(() => expect(kalibrierenBtn).toBeEnabled())

    await act(async () => {
      fireEvent.click(kalibrierenBtn)
    })

    await waitFor(() => expect(wakewordAufnehmenMock).toHaveBeenCalled())
    expect(duckingWaehrendAufnahme).toBe(true)
    expect(istDuckingAktiv()).toBe(false)
  })
})
