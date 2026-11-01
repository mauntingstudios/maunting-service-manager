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

  it('dreht sich bei Klick um und zeigt Card-ID', () => {
    render(<MauntingCard />)
    const card = screen.getByRole('button', { name: /Maunting Card umdrehen/i })

    // Vor dem Flip ist die Card-ID im DOM vorhanden
    expect(screen.getByText('MSM-E3B0-C442-98FC')).toBeInTheDocument()

    // Flip auslösen
    fireEvent.click(card)

    // Entsperren Button ist auf der Rückseite sichtbar
    expect(screen.getByText('PIN eingeben')).toBeInTheDocument()
  })

  it('öffnet Entsperr-Dialog bei Klick auf PIN eingeben', () => {
    render(<MauntingCard />)
    const unlockBtn = screen.getByText('PIN eingeben')
    fireEvent.click(unlockBtn)

    expect(screen.getByPlaceholderText('Karten-Passwort / PIN')).toBeInTheDocument()
  })
})
