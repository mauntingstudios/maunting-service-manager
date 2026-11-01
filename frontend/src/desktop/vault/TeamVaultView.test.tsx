import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { TeamVaultView } from './TeamVaultView'
import { useTeamVaultStore } from './teamVaultStore'
import type { TeamDetail } from '@/api/teams'

const mockTeam: TeamDetail = {
  id: 42,
  name: 'Familie Mueller',
  is_personal: false,
  owner_user_id: 1,
  is_owner: true,
  can_manage_skills: true,
  can_manage_memory: true,
  member_count: 2,
  created_at: '2026-10-31T00:00:00Z',
  members: [],
  servers: [],
  invitations: [],
}

describe('TeamVaultView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useTeamVaultStore.setState({
      teamId: 42,
      bucketId: null,
      salt: null,
      isInitialized: false,
      isUnlocked: false,
      needsRotation: false,
      isOwner: true,
      canAccessVault: true,
      items: [],
      loadStatus: vi.fn(),
      setup: vi.fn(),
      unlock: vi.fn(),
      rotatePassword: vi.fn(),
      lock: vi.fn(),
      saveItem: vi.fn(),
      deleteItem: vi.fn(),
    })
  })

  it('zeigt den Setup-Dialog für den Gründer, wenn der Tresor noch nicht eingerichtet ist', () => {
    useTeamVaultStore.setState({ isInitialized: false, isOwner: true })

    render(<TeamVaultView team={mockTeam} />)

    expect(screen.getByRole('heading', { name: i18n.t('teams.vaultSetup') })).toBeInTheDocument()
    expect(screen.getByPlaceholderText(i18n.t('mss.vault.masterPasswort'))).toBeInTheDocument()
    expect(screen.getByPlaceholderText(i18n.t('teams.vaultRepeatPassword'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: new RegExp(i18n.t('teams.vaultGeneratePassword')) })).toBeInTheDocument()
  })

  it('zeigt Nicht-Eingerichtet-Hinweis für Nicht-Owner', () => {
    useTeamVaultStore.setState({ isInitialized: false, isOwner: false })

    render(<TeamVaultView team={{ ...mockTeam, is_owner: false }} />)

    expect(screen.getByText(i18n.t('teams.vaultNotSetup'))).toBeInTheDocument()
    expect(screen.getByText(i18n.t('teams.vaultNotSetupDesc'))).toBeInTheDocument()
  })

  it('zeigt den Entsperren-Dialog, wenn der Tresor eingerichtet aber gesperrt ist', () => {
    useTeamVaultStore.setState({ isInitialized: true, isUnlocked: false })

    render(<TeamVaultView team={mockTeam} />)

    expect(screen.getByText(i18n.t('teams.vaultUnlock'))).toBeInTheDocument()
    expect(screen.getByPlaceholderText(i18n.t('mss.vault.masterPasswort'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: new RegExp(i18n.t('mss.vault.entsperren')) })).toBeInTheDocument()
  })

  it('zeigt Rotations-Warnbanner und öffnet Rotations-Dialog', () => {
    useTeamVaultStore.setState({ isInitialized: true, isUnlocked: true, needsRotation: true, isOwner: true })

    render(<TeamVaultView team={mockTeam} />)

    expect(screen.getByText(i18n.t('teams.vaultRotationTitle'))).toBeInTheDocument()
    const rotBtn = screen.getByRole('button', { name: new RegExp(i18n.t('teams.vaultRotateBtn')) })
    expect(rotBtn).toBeInTheDocument()

    fireEvent.click(rotBtn)
    // Dialog geöffnet mit PasswordInput
    expect(screen.getAllByPlaceholderText(i18n.t('mss.vault.masterPasswort')).length).toBeGreaterThan(0)
    expect(screen.getByPlaceholderText(i18n.t('teams.vaultRepeatPassword'))).toBeInTheDocument()
  })

  it('zeigt die Schranke (Zutritt verwehrt), wenn can_access_vault false ist', () => {
    useTeamVaultStore.setState({ isInitialized: true, isUnlocked: false, canAccessVault: false })

    render(<TeamVaultView team={{ ...mockTeam, can_access_vault: false }} />)

    expect(screen.getByRole('heading', { name: i18n.t('teams.vaultAccessDenied') })).toBeInTheDocument()
    expect(screen.getByText(i18n.t('teams.vaultAccessDeniedDesc'))).toBeInTheDocument()
    // Sicherstellen, dass kein Entsperr-Passwortfeld gerendert wird
    expect(screen.queryByPlaceholderText(i18n.t('mss.vault.masterPasswort'))).not.toBeInTheDocument()
  })
})
