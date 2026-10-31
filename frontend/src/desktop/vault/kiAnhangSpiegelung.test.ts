import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  KI_ORDNER_NAME,
  KI_SPIEGELUNG_KEY,
  kiSpiegelungAktiv,
  setKiSpiegelungAktiv,
  spiegleAnhangInTresor,
  spiegelWarteschlangeAbarbeiten,
} from './kiAnhangSpiegelung'
import { useVaultStore } from './vaultStore'

describe('kiAnhangSpiegelung', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    useVaultStore.setState({
      isUnlocked: false,
      userKey: null,
      items: [],
      ordnerAnlegen: vi.fn().mockResolvedValue('ordner-uuid-1'),
      dateiHinzufuegen: vi.fn().mockResolvedValue('datei-uuid-1'),
    })
  })

  it('liest und setzt den Schalter in localStorage', () => {
    expect(kiSpiegelungAktiv()).toBe(false)
    setKiSpiegelungAktiv(true)
    expect(localStorage.getItem(KI_SPIEGELUNG_KEY)).toBe('true')
    expect(kiSpiegelungAktiv()).toBe(true)

    setKiSpiegelungAktiv(false)
    expect(localStorage.getItem(KI_SPIEGELUNG_KEY)).toBe('false')
    expect(kiSpiegelungAktiv()).toBe(false)
  })

  it('tut nichts, wenn die Spiegelung ausgeschaltet ist', async () => {
    setKiSpiegelungAktiv(false)
    const file = new File(['inhalt'], 'test.txt', { type: 'text/plain' })
    await spiegleAnhangInTresor(file)

    expect(useVaultStore.getState().dateiHinzufuegen).not.toHaveBeenCalled()
  })

  it('legt Ordner KI-Anhänge an und fuegt Datei hinzu, wenn Tresor entsperrt ist', async () => {
    setKiSpiegelungAktiv(true)
    const mockUserKey = {} as CryptoKey
    useVaultStore.setState({
      isUnlocked: true,
      userKey: mockUserKey,
      items: [],
    })

    const file = new File(['hallo'], 'bericht.pdf', { type: 'application/pdf' })
    await spiegleAnhangInTresor(file)

    expect(useVaultStore.getState().ordnerAnlegen).toHaveBeenCalledWith(KI_ORDNER_NAME)
    expect(useVaultStore.getState().dateiHinzufuegen).toHaveBeenCalledWith(file, 'ordner-uuid-1')
  })

  it('verwendet bestehenden KI-Anhänge Ordner, wenn vorhanden', async () => {
    setKiSpiegelungAktiv(true)
    const mockUserKey = {} as CryptoKey
    useVaultStore.setState({
      isUnlocked: true,
      userKey: mockUserKey,
      items: [
        {
          id: 'existierender-ordner-id',
          service: KI_ORDNER_NAME,
          category: 'ordner',
          username: '',
          password: '',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          revision: 1,
        },
      ],
    })

    const file = new File(['bild'], 'foto.png', { type: 'image/png' })
    await spiegleAnhangInTresor(file)

    expect(useVaultStore.getState().ordnerAnlegen).not.toHaveBeenCalled()
    expect(useVaultStore.getState().dateiHinzufuegen).toHaveBeenCalledWith(file, 'existierender-ordner-id')
  })
})
