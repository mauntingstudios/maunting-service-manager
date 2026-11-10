import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const zustand = vi.hoisted(() => ({ wert: {} as Record<string, any> }))
const navigateMock = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  useLocation: () => ({ pathname: '/chat', search: '', hash: '', state: null, key: 'test' }),
}))
vi.mock('@/desktop/vault/vaultStore', () => ({
  useVaultStore: (auswahl: (state: Record<string, any>) => unknown) => auswahl(zustand.wert),
}))
vi.mock('@/desktop/vault/tresorMiniaturen', () => ({
  useMiniatur: () => 'blob:mini',
}))
vi.mock('@/desktop/vault/tresorDateien', () => ({
  blobLesen: vi.fn(),
}))
vi.mock('@/desktop/vault/tresorOrdner', () => ({
  sichtbareEintraege: (items: unknown[]) => items,
}))
vi.mock('@/services/bildSticker', () => ({
  blobAlsDatenUrl: vi.fn(async () => 'data:image/jpeg;base64,AAAA'),
}))

import { blobLesen } from '@/desktop/vault/tresorDateien'
import { TresorBildWaehler } from './TresorBildWaehler'

const BILD = {
  id: 'v1',
  service: 'foto.jpg',
  category: 'datei',
  datei: {
    typ: 'image/jpeg',
    original: { id: 'b1', echt: 1 },
    miniatur: { id: 'm1', echt: 1 },
  },
}

function setzeZustand(ueberschreiben: Record<string, any> = {}) {
  zustand.wert = {
    isInitialized: true,
    isUnlocked: false,
    isUnlocking: false,
    unlockError: null,
    items: [],
    userKey: null,
    unlock: vi.fn(async () => true),
    ...ueberschreiben,
  }
  return zustand.wert
}

function zeige() {
  const onWaehlen = vi.fn()
  const onAbbrechen = vi.fn()
  render(<TresorBildWaehler onWaehlen={onWaehlen} onAbbrechen={onAbbrechen} />)
  return { onWaehlen, onAbbrechen }
}

describe('TresorBildWaehler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(blobLesen).mockReset()
    navigateMock.mockReset()
  })

  it('sagt, wenn der Tresor noch nicht eingerichtet ist', () => {
    setzeZustand({ isInitialized: false })
    zeige()
    expect(screen.getByText('Der Tresor ist auf diesem Gerät noch nicht eingerichtet.')).toBeInTheDocument()
  })

  it('leitet zum Tresor, statt das Passwort hier abzufragen', () => {
    setzeZustand()
    zeige()

    expect(screen.queryByLabelText('Master-Passwort')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Tresor öffnen' }))

    expect(navigateMock).toHaveBeenCalledTimes(1)
    const ziel = String(navigateMock.mock.calls[0][0])
    expect(ziel.startsWith('/tresor?zurueck=')).toBe(true)
    expect(decodeURIComponent(ziel)).toContain('/chat?fotoSticker=tresor')
  })

  it('zeigt keine Bilder, wenn der Tresor leer ist', () => {
    setzeZustand({ isUnlocked: true, userKey: {} as CryptoKey, items: [] })
    zeige()
    expect(screen.getByText('Im Tresor liegen keine Bilder.')).toBeInTheDocument()
  })

  it('meldet, wenn ein Bild nicht gelesen werden kann', async () => {
    setzeZustand({ isUnlocked: true, userKey: {} as CryptoKey, items: [BILD] })
    vi.mocked(blobLesen).mockRejectedValueOnce(new Error('kaputt'))
    zeige()

    fireEvent.click(screen.getByRole('button', { name: 'foto.jpg' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Das Bild aus dem Tresor konnte nicht geladen werden.',
    )
  })

  it('reicht ein gelesenes Tresor-Bild weiter', async () => {
    setzeZustand({ isUnlocked: true, userKey: {} as CryptoKey, items: [BILD] })
    vi.mocked(blobLesen).mockResolvedValueOnce(new Blob(['x'], { type: 'image/jpeg' }))
    const { onWaehlen } = zeige()

    fireEvent.click(screen.getByRole('button', { name: 'foto.jpg' }))

    await waitFor(() => expect(onWaehlen).toHaveBeenCalledWith('data:image/jpeg;base64,AAAA'))
  })
})
