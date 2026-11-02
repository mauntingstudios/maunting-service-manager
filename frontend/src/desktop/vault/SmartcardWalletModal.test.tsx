import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAuthStore } from '@/stores/authStore'
import { SmartcardWalletModal } from './SmartcardWalletModal'
import { useVaultStore } from './vaultStore'

vi.mock('@/stores/authStore', () => ({
  useAuthStore: vi.fn(),
}))

vi.mock('./vaultStore', () => ({
  useVaultStore: vi.fn(),
}))

vi.mock('@/hooks/useBackgroundQrScanner', () => ({
  useBackgroundQrScanner: () => ({
    videoRef: { current: null },
    isScanning: true,
    isDetected: false,
    error: null,
    start: vi.fn(),
    stop: vi.fn(),
    reset: vi.fn(),
  }),
}))

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
})
