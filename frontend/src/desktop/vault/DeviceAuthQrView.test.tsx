import { render, screen, waitFor } from '@testing-library/react'
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

vi.mock('./deviceAuthCrypto', () => ({
  generateEphemeralAuthKeyPair: vi.fn(),
  decryptAuthPayload: vi.fn(),
}))

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
})
