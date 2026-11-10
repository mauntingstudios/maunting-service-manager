import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAuthStore } from '@/stores/authStore'
import { MauntingCard } from './MauntingCardView'
import { useVaultStore } from './vaultStore'

vi.mock('@/stores/authStore', () => ({
  useAuthStore: vi.fn(),
}))

vi.mock('./vaultStore', () => ({
  useVaultStore: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string) => fallback || _k,
  }),
}))

vi.mock('./DeviceAuthQrView', () => ({
  DeviceAuthQrView: () => <div data-testid="mock-device-auth-qr">QR Scanner View</div>,
}))

describe('MauntingCard Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useAuthStore).mockReturnValue({
      user: {
        id: 1,
        username: 'MaikAdmin',
        avatar_url: '/test-avatar.png',
        created_at: '2026-01-01T00:00:00Z',
      },
    } as any)

    vi.mocked(useVaultStore).mockReturnValue({
      isInitialized: true,
      isUnlocked: false,
      isUnlocking: false,
      unlockError: null,
      bucketId: 'e3b0c44298fc1c149afbf4c8996fb924',
      unlock: vi.fn().mockResolvedValue(true),
      lock: vi.fn(),
      rotationState: null,
    } as any)
  })

  it('rendert Username und Status sauber auf der Vorderseite', () => {
    render(<MauntingCard />)
    expect(screen.getByText('MAIKADMIN')).toBeInTheDocument()
    expect(screen.getByText('GESPERRT')).toBeInTheDocument()
    expect(screen.getByText(/VALID THRU/i)).toBeInTheDocument()
  })

  it('zeigt Ablaufdatum basierend auf tatsaechlicher Schluesselrotation (vault_keys_rotated_at)', () => {
    vi.mocked(useAuthStore).mockReturnValue({
      user: {
        id: 1,
        username: 'MaikAdmin',
        avatar_url: '/test-avatar.png',
        created_at: '2022-01-01T00:00:00Z',
        vault_keys_rotated_at: '2026-06-15T00:00:00Z',
      },
    } as any)

    render(<MauntingCard />)
    expect(screen.getByText('06/28')).toBeInTheDocument()
    expect(screen.queryByText('01/24')).not.toBeInTheDocument()
  })

  it('verwendet vaultKeysRotatedAt aus dem Vault-Store, wenn user.vault_keys_rotated_at fehlt', () => {
    vi.mocked(useAuthStore).mockReturnValue({
      user: {
        id: 1,
        username: 'MaikAdmin',
        avatar_url: '/test-avatar.png',
        created_at: '2022-01-01T00:00:00Z',
      },
    } as any)

    vi.mocked(useVaultStore).mockReturnValue({
      isInitialized: true,
      isUnlocked: false,
      isDeviceAuthorized: true,
      bucketId: 'mock-bucket-12345678901234567890',
      getKnownBucketId: vi.fn().mockReturnValue('mock-bucket-12345678901234567890'),
      unlock: vi.fn(),
      authorizeDevice: vi.fn(),
      lock: vi.fn(),
      rotationState: null,
      vaultKeysRotatedAt: '2025-10-20T00:00:00Z',
    } as any)

    render(<MauntingCard />)
    expect(screen.getByText('10/27')).toBeInTheDocument()
    expect(screen.queryByText('01/24')).not.toBeInTheDocument()
  })


  it('dreht sich bei Klick um und zeigt Card-ID', () => {
    render(<MauntingCard />)
    const card = screen.getByRole('button', { name: /Maunting Card umdrehen/i })

    // Vor dem Flip ist die Card-ID im DOM vorhanden
    expect(screen.getByText('MSM-E3B0-C442-98FC')).toBeInTheDocument()

    // Flip auslösen
    fireEvent.click(card)

    // Entsperren Button ist auf der Rückseite sichtbar
    expect(screen.getByText('Karte entsperren')).toBeInTheDocument()
  })

  it('zeigt auch im gesperrten Zustand die echte Card-ID über getKnownBucketId statt Fallback', () => {
    vi.mocked(useVaultStore).mockReturnValue({
      isInitialized: true,
      isUnlocked: false,
      isUnlocking: false,
      unlockError: null,
      bucketId: null, // Im gesperrten Zustand ist die flüchtige bucketId im Store null
      getKnownBucketId: () => 'e3b0c44298fc1c149afbf4c8996fb924',
      unlock: vi.fn(),
      lock: vi.fn(),
      rotationState: null,
    } as any)

    render(<MauntingCard />)
    expect(screen.getByText('MSM-E3B0-C442-98FC')).toBeInTheDocument()
    expect(screen.queryByText('MSM-0000-0000-0001')).not.toBeInTheDocument()
  })

  it('öffnet Entsperr-Dialog bei Klick auf Karte entsperren', () => {
    render(<MauntingCard />)
    const unlockBtn = screen.getByText('Karte entsperren')
    fireEvent.click(unlockBtn)

    expect(screen.getByPlaceholderText('Dein bei der Einrichtung gewähltes Passwort')).toBeInTheDocument()
    expect(screen.getByText(/Das persönliche Passwort, das du bei der Erstellung deiner Smartcard/i)).toBeInTheDocument()
  })

  it('zeigt Status GERÄT NICHT AUTORISIERT und öffnet Autorisierungs-Dialog', () => {
    const authorizeDevice = vi.fn().mockResolvedValue(true)
    vi.mocked(useVaultStore).mockReturnValue({
      isInitialized: true,
      isUnlocked: false,
      isDeviceAuthorized: false,
      isUnlocking: false,
      unlockError: null,
      bucketId: 'e3b0c44298fc1c149afbf4c8996fb924',
      unlock: vi.fn(),
      authorizeDevice,
      lock: vi.fn(),
      rotationState: null,
    } as any)

    render(<MauntingCard />)
    expect(screen.getByText('GERÄT NICHT AUTORISIERT')).toBeInTheDocument()

    const authBtn = screen.getByText('Gerät autorisieren')
    expect(authBtn).toBeInTheDocument()
    fireEvent.click(authBtn)

    // Dialog-Titel "Gerät autorisieren" ist im Header sichtbar
    expect(screen.getAllByText('Gerät autorisieren').length).toBeGreaterThanOrEqual(1)
  })

  it('wechselt zwischen Smartphone-Scan und Karten-Passwort-Reiter im Autorisierungs-Dialog', () => {
    vi.mocked(useVaultStore).mockReturnValue({
      isInitialized: true,
      isUnlocked: false,
      isDeviceAuthorized: false,
      isUnlocking: false,
      unlockError: null,
      bucketId: 'e3b0c44298fc1c149afbf4c8996fb924',
      unlock: vi.fn(),
      authorizeDevice: vi.fn(),
      lock: vi.fn(),
      rotationState: null,
    } as any)

    render(<MauntingCard />)
    const authBtn = screen.getByText('Gerät autorisieren')
    fireEvent.click(authBtn)

    // Standardmäßig ist der QR-Scan-Tab aktiv
    expect(screen.getByTestId('mock-device-auth-qr')).toBeInTheDocument()

    // Wechsel zu Karten-Passwort
    const passwordTabBtn = screen.getByRole('button', { name: 'Karten-Passwort' })
    fireEvent.click(passwordTabBtn)

    expect(screen.getByPlaceholderText('Dein bei der Einrichtung gewähltes Passwort')).toBeInTheDocument()

    // Wechsel zurück zu QR
    const qrTabBtn = screen.getByRole('button', { name: 'Mit Smartphone scannen' })
    fireEvent.click(qrTabBtn)

    expect(screen.getByTestId('mock-device-auth-qr')).toBeInTheDocument()
  })
})
