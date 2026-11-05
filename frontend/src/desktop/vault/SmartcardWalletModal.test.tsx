import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchDeviceAuthPublicKey, resolveDeviceAuthSession } from '@/api/vaultDeviceAuth'
import { useAuthStore } from '@/stores/authStore'
import { buildDeviceAuthQrValueV3, fingerprintPublicKey } from './deviceAuthCrypto'
import { SmartcardWalletModal } from './SmartcardWalletModal'
import { useVaultStore } from './vaultStore'

vi.mock('@/stores/authStore', () => ({
  useAuthStore: vi.fn(),
}))

vi.mock('./vaultStore', () => ({
  useVaultStore: vi.fn(),
}))

let erkannterCode: ((code: string) => void) | null = null

vi.mock('@/hooks/useBackgroundQrScanner', () => ({
  useBackgroundQrScanner: (opts: { onDetected?: (code: string) => void }) => {
    erkannterCode = opts.onDetected ?? null
    return {
      videoRef: { current: null },
      isScanning: true,
      isDetected: false,
      error: null,
      start: vi.fn(),
      stop: vi.fn(),
      reset: vi.fn(),
    }
  },
}))

vi.mock('@/api/vaultDeviceAuth', () => ({
  fetchDeviceAuthPublicKey: vi.fn(),
  resolveDeviceAuthSession: vi.fn(),
}))

vi.mock('./deviceAuthCrypto', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./deviceAuthCrypto')>()
  return { ...orig, encryptAuthPayload: vi.fn(async () => 'chiffre-aus-test') }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string) => fallback || _k,
  }),
}))

describe('SmartcardWalletModal Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useAuthStore).mockReturnValue({
      user: {
        id: 1,
        username: 'MaikMobile',
        avatar_url: '/test-avatar.png',
        created_at: '2026-01-01T00:00:00Z',
      },
    } as any)

    vi.mocked(useVaultStore).mockReturnValue({
      isInitialized: true,
      isUnlocked: true,
      isDeviceAuthorized: true,
      bucketId: 'e3b0c44298fc1c149afbf4c8996fb924',
      unlock: vi.fn().mockResolvedValue(true),
      lock: vi.fn(),
      rotationState: null,
    } as any)
  })

  it('rendert nichts, wenn isOpen false ist', () => {
    const { container } = render(<SmartcardWalletModal isOpen={false} onClose={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('rendert Vollbild-Wallet-Modus mit Karte und Scan-Hinweis wenn isOpen true ist', () => {
    render(<SmartcardWalletModal isOpen={true} onClose={vi.fn()} />)

    expect(screen.getByRole('dialog', { name: 'Smartcard Wallet-Modus' })).toBeInTheDocument()
    expect(screen.getByText('An Zielgerät halten zum Freigeben')).toBeInTheDocument()
    expect(screen.getByText('MAIKMOBILE')).toBeInTheDocument()
  })

  it('schließt das Modal beim Klick auf den X-Button', () => {
    const onClose = vi.fn()
    render(<SmartcardWalletModal isOpen={true} onClose={onClose} />)

    const closeBtn = screen.getByRole('button', { name: 'Schließen' })
    fireEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalled()
  })

  it('löst einen gescannten v2-Code mit seinem Aufloese-Token auf', async () => {
    vi.mocked(resolveDeviceAuthSession).mockResolvedValue({ success: true })
    render(<SmartcardWalletModal isOpen={true} onClose={vi.fn()} />)
    expect(erkannterCode).not.toBeNull()

    erkannterCode!(JSON.stringify({
      v: 2,
      sid: 'a1b2c3d4e5f67890',
      pk: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0abcdef1234567890',
      p: 'authorize',
      uid: 1,
      rt: 'aufloese-token-aus-dem-qr-code',
    }))

    await waitFor(() => {
      expect(resolveDeviceAuthSession).toHaveBeenCalledWith(
        'a1b2c3d4e5f67890',
        'chiffre-aus-test',
        'aufloese-token-aus-dem-qr-code',
      )
    })
  })

  it('holt bei einem kurzen v3-Code den Schluessel nach und loest auf', async () => {
    const schluessel = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0abcdef1234567890'
    const fp = await fingerprintPublicKey(schluessel)
    vi.mocked(fetchDeviceAuthPublicKey).mockResolvedValue({ public_key: schluessel, purpose: 'authorize' })
    vi.mocked(resolveDeviceAuthSession).mockResolvedValue({ success: true })
    render(<SmartcardWalletModal isOpen={true} onClose={vi.fn()} />)
    expect(erkannterCode).not.toBeNull()

    erkannterCode!(buildDeviceAuthQrValueV3(
      'a1b2c3d4e5f67890',
      'authorize',
      'aufloese-token-aus-dem-qr-code',
      fp,
    ))

    await waitFor(() => {
      expect(fetchDeviceAuthPublicKey).toHaveBeenCalledWith(
        'a1b2c3d4e5f67890',
        'aufloese-token-aus-dem-qr-code',
      )
      expect(resolveDeviceAuthSession).toHaveBeenCalledWith(
        'a1b2c3d4e5f67890',
        'chiffre-aus-test',
        'aufloese-token-aus-dem-qr-code',
      )
    })
    expect(await screen.findByText('Zielgerät erfolgreich autorisiert!')).toBeInTheDocument()
  })

  it('loest bei einem untergeschobenen Schluessel nicht auf', async () => {
    vi.mocked(fetchDeviceAuthPublicKey).mockResolvedValue({
      public_key: 'fremder-schluessel-vom-server',
      purpose: 'authorize',
    })
    render(<SmartcardWalletModal isOpen={true} onClose={vi.fn()} />)
    expect(erkannterCode).not.toBeNull()

    erkannterCode!(buildDeviceAuthQrValueV3(
      'a1b2c3d4e5f67890',
      'authorize',
      'aufloese-token-aus-dem-qr-code',
      'passtnie1',
    ))

    await waitFor(() => {
      expect(fetchDeviceAuthPublicKey).toHaveBeenCalled()
    })
    expect(resolveDeviceAuthSession).not.toHaveBeenCalled()
    expect(await screen.findByText('Sicherheitswarnung: Der Schlüssel passt nicht zum QR-Code.')).toBeInTheDocument()
  })

  it('ruft resolve ohne Aufloese-Token nicht auf', async () => {
    render(<SmartcardWalletModal isOpen={true} onClose={vi.fn()} />)
    expect(erkannterCode).not.toBeNull()

    // v1-Code von vor dem Fix: kein rt, kein Netzaufruf.
    erkannterCode!(JSON.stringify({
      v: 1,
      sid: 'a1b2c3d4e5f67890',
      pk: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0abcdef1234567890',
      p: 'authorize',
      uid: 1,
    }))
    // v2 ohne rt: manipuliert, ebenfalls kein Netzaufruf.
    erkannterCode!(JSON.stringify({
      v: 2,
      sid: 'a1b2c3d4e5f67890',
      pk: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0abcdef1234567890',
      p: 'authorize',
      uid: 1,
    }))

    await waitFor(() => {
      expect(resolveDeviceAuthSession).not.toHaveBeenCalled()
    })
  })

  it('fragt bei Stufe-2-Entsperrung (unlock) ohne aktive Biometrie das Master-Passwort ab und überträgt den Schlüssel', async () => {
    const schluessel = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0abcdef1234567890'
    const fp = await fingerprintPublicKey(schluessel)
    const deriveWalletUnlockPayload = vi.fn().mockResolvedValue({
      keyBase64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      bucketId: 'bucket-123',
      bucketAuthToken: 'auth-token-123',
    })

    localStorage.setItem('mss:vault_server_bucket', 'bucket-123')
    vi.mocked(useVaultStore).mockReturnValue({
      isInitialized: true,
      isUnlocked: false,
      isDeviceAuthorized: true,
      isBiometricsEnabled: false,
      isBiometricsSupported: false,
      bucketId: null,
      getKnownBucketId: () => 'bucket-123',
      deriveWalletUnlockPayload,
      unlock: vi.fn(),
      lock: vi.fn(),
      rotationState: null,
    } as any)

    vi.mocked(fetchDeviceAuthPublicKey).mockResolvedValue({ public_key: schluessel, purpose: 'unlock' })
    vi.mocked(resolveDeviceAuthSession).mockResolvedValue({ success: true })

    render(<SmartcardWalletModal isOpen={true} onClose={vi.fn()} />)
    erkannterCode!(buildDeviceAuthQrValueV3(
      'a1b2c3d4e5f67890',
      'unlock',
      'aufloese-token-aus-dem-qr-code',
      fp,
    ))

    const pwInput = await screen.findByLabelText('Master-Passwort')
    expect(resolveDeviceAuthSession).not.toHaveBeenCalled()

    fireEvent.change(pwInput, { target: { value: 'mein-sicheres-passwort-123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Entsperren' }))

    await waitFor(() => {
      expect(deriveWalletUnlockPayload).toHaveBeenCalledWith('mein-sicheres-passwort-123')
      expect(resolveDeviceAuthSession).toHaveBeenCalledWith(
        'a1b2c3d4e5f67890',
        'chiffre-aus-test',
        'aufloese-token-aus-dem-qr-code',
      )
    })
    expect(await screen.findByText('Zielgerät erfolgreich entsperrt!')).toBeInTheDocument()
    localStorage.removeItem('mss:vault_server_bucket')
  })
})
