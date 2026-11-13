import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '@/api/vaultDeviceAuth'
import * as crypto from './deviceAuthCrypto'
import { DeviceAuthQrView } from './DeviceAuthQrView'
import { useAuthStore } from '@/stores/authStore'

vi.mock('@/stores/authStore', () => ({
  useAuthStore: vi.fn(),
}))

vi.mock('@/api/vaultDeviceAuth', () => ({
  createDeviceAuthSession: vi.fn(),
  getDeviceAuthSessionStatus: vi.fn(),
}))

vi.mock('./deviceAuthCrypto', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./deviceAuthCrypto')>()
  return {
    ...orig,
    generateEphemeralAuthKeyPair: vi.fn(),
    decryptAuthPayload: vi.fn(),
    // Echtes `crypto.subtle.digest` loest unter Fake-Timern je nach Last des
    // Rechners erst nach mehreren Advances auf. Dann steht das Polling-
    // Intervall spaeter, es feuert weniger als 16 Mal, und der Test scheitert
    // ohne Fehler im Code (CI 13.11.2026). Der Abdruck ist hier nicht das
    // Thema, deshalb fest.
    fingerprintPublicKey: vi.fn(),
  }
})

describe('DeviceAuthQrView Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useAuthStore).mockReturnValue({
      user: { id: 42, username: 'tester' },
    } as any)

    vi.mocked(crypto.generateEphemeralAuthKeyPair).mockResolvedValue({
      publicKeyBase64: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0mockkey',
      privateKey: {} as CryptoKey,
    })
    vi.mocked(crypto.fingerprintPublicKey).mockResolvedValue('abdruck1')

    vi.mocked(api.createDeviceAuthSession).mockResolvedValue({
      session_id: 'session-xyz-123',
      session_token: 'token-abc-456',
      resolve_token: 'resolve-token-789',
      expires_at: '2026-11-02T16:00:00Z',
      purpose: 'authorize',
    })

    vi.mocked(api.getDeviceAuthSessionStatus).mockResolvedValue({
      status: 'pending',
    })
  })

  it('erzeugt Session und zeigt QR-Code mit Wartehinweis', async () => {
    render(
      <DeviceAuthQrView
        purpose="authorize"
        onSuccess={vi.fn()}
      />,
    )

    expect(screen.getByText('Erzeuge sichere Zero-Knowledge Session...')).toBeInTheDocument()

    await waitFor(() => {
      expect(crypto.generateEphemeralAuthKeyPair).toHaveBeenCalled()
      expect(api.createDeviceAuthSession).toHaveBeenCalledWith(
        'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0mockkey',
        'authorize',
        expect.any(String),
      )
    })

    expect(await screen.findByText('Warte auf Smartphone-Scan (Zero-Knowledge E2EE)...')).toBeInTheDocument()
  })

  it('loest onSuccess aus, sobald der Session-Status resolved ist', async () => {
    const onSuccess = vi.fn()
    vi.mocked(crypto.decryptAuthPayload).mockResolvedValue({
      action: 'authorize',
      bucketId: 'test-bucket-id',
    })

    vi.mocked(api.getDeviceAuthSessionStatus).mockResolvedValueOnce({
      status: 'resolved',
      encrypted_payload: 'encrypted-base64-payload',
      purpose: 'authorize',
    })

    render(
      <DeviceAuthQrView
        purpose="authorize"
        onSuccess={onSuccess}
      />,
    )

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith({
        action: 'authorize',
        bucketId: 'test-bucket-id',
      })
    })

    expect(await screen.findByText('Erfolgreich freigegeben!')).toBeInTheDocument()
  })

  it('zeigt Fehler an und ruft onSuccess nicht auf, wenn decryptAuthPayload fehlschlägt', async () => {
    const onSuccess = vi.fn()
    vi.mocked(crypto.decryptAuthPayload).mockRejectedValue(new Error('Decryption failed'))

    vi.mocked(api.getDeviceAuthSessionStatus).mockResolvedValueOnce({
      status: 'resolved',
      encrypted_payload: 'manipulierter-payload',
      purpose: 'authorize',
    })

    render(
      <DeviceAuthQrView
        purpose="authorize"
        onSuccess={onSuccess}
      />,
    )

    expect(await screen.findByText('Fehler beim Entschlüsseln der Freigabe-Daten.')).toBeInTheDocument()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('vernichtet den ephemeren privaten RSA-Schluessel sofort nach erfolgreicher Entschluesselung', async () => {
    const onSuccess = vi.fn()
    vi.mocked(crypto.decryptAuthPayload).mockResolvedValue({
      action: 'authorize',
      bucketId: 'test-bucket-id',
    })

    vi.mocked(api.getDeviceAuthSessionStatus).mockResolvedValueOnce({
      status: 'resolved',
      encrypted_payload: 'encrypted-base64-payload',
      purpose: 'authorize',
    })

    const { container } = render(
      <DeviceAuthQrView
        purpose="authorize"
        onSuccess={onSuccess}
      />,
    )

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled()
    })

    // Nach erfolgreicher Entschluesselung MUSS der ephemere private RSA-Schluessel zerstoert/genullt sein
    const root = container.querySelector('[data-has-key]')
    expect(root).not.toBeNull()
    expect(root).toHaveAttribute('data-has-key', 'false')
  })

  it('bricht Polling ab und zeigt Hinweis, wenn Session expired ist', async () => {
    vi.mocked(api.getDeviceAuthSessionStatus).mockResolvedValueOnce({
      status: 'expired',
    })

    const { container } = render(
      <DeviceAuthQrView
        purpose="authorize"
        onSuccess={vi.fn()}
      />,
    )

    expect(await screen.findByText('Session abgelaufen. Bitte erneut versuchen.')).toBeInTheDocument()
    const root = container.querySelector('[data-has-key]')
    expect(root).toHaveAttribute('data-has-key', 'false')
  })

  it('bricht Polling nach 15 aufeinanderfolgenden Fehlern ab', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(api.getDeviceAuthSessionStatus).mockRejectedValue(new Error('Network disconnected'))

      const { container } = render(
        <DeviceAuthQrView
          purpose="authorize"
          onSuccess={vi.fn()}
        />,
      )

      // Initial session generation; danach steht das Polling-Intervall.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50)
      })
      expect(screen.getByText('Warte auf Smartphone-Scan (Zero-Knowledge E2EE)...')).toBeInTheDocument()

      // 15 polling intervals a 800ms
      for (let i = 0; i < 16; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(800)
        })
      }

      expect(screen.getByText('Verbindung zum Server verloren oder Sitzung ungültig.')).toBeInTheDocument()
      const root = container.querySelector('[data-has-key]')
      expect(root).toHaveAttribute('data-has-key', 'false')
    } finally {
      vi.useRealTimers()
    }
  })

  it('stoppt das Polling sofort bei 404 und vernichtet den privaten RSA-Schluessel', async () => {
    const error404 = new Error('Session nicht gefunden.') as any
    error404.status = 404
    vi.mocked(api.getDeviceAuthSessionStatus).mockRejectedValueOnce(error404)

    const { container } = render(
      <DeviceAuthQrView
        purpose="authorize"
        onSuccess={vi.fn()}
      />,
    )

    expect(await screen.findByText('Session nicht gefunden oder abgelaufen.')).toBeInTheDocument()
    const root = container.querySelector('[data-has-key]')
    expect(root).toHaveAttribute('data-has-key', 'false')
  })

  it('vernichtet den privaten RSA-Schluessel beim Unmount der Komponente', async () => {
    const { unmount } = render(
      <DeviceAuthQrView
        purpose="authorize"
        onSuccess={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(crypto.generateEphemeralAuthKeyPair).toHaveBeenCalled()
    })

    // Unmount MUSS cleanup ausfuehren und darf keine Keys leaken
    unmount()
  })
})



