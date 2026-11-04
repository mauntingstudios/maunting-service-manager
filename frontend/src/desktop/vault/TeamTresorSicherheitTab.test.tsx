import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { teamsApi } from '@/api/teams'
import { TeamTresorSicherheitTab } from './TeamTresorSicherheitTab'
import { useTeamVaultStore } from './teamVaultStore'

vi.mock('@/api/teams', () => ({
  teamsApi: {
    list: vi.fn(),
    getVaultSalt: vi.fn(),
  },
}))

vi.mock('../tauri', () => ({
  biometrieSpeicherVerfuegbar: vi.fn().mockResolvedValue(true),
  biometrieSpeicherFragtSelbst: vi.fn().mockResolvedValue(true),
  biometrieSpeichern: vi.fn().mockResolvedValue(undefined),
  biometrieEntsperren: vi.fn().mockResolvedValue('pwd'),
  biometrieLoeschen: vi.fn().mockResolvedValue(undefined),
}))

describe('TeamTresorSicherheitTab', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    vi.mocked(teamsApi.list).mockResolvedValue([])
    vi.mocked(teamsApi.getVaultSalt).mockResolvedValue({
      is_setup: true,
      salt: 'c2FsdA==',
      bucket_id: 'bucket-dev',
      needs_rotation: false,
      is_owner: true,
    })
    useTeamVaultStore.setState({
      teamId: 2,
      isInitialized: true,
      isUnlocked: true,
      autoLockMinutes: 5,
      lockOnWindowBlur: false,
      leakCheckEnabled: true,
      isBiometricsSupported: true,
      isBiometricsEnabled: false,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('bindet die Sektion an den aktiven Team-Tresor aus dem Store, ohne die Team-Liste zu laden', async () => {
    render(
      <MemoryRouter>
        <TeamTresorSicherheitTab />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(teamsApi.getVaultSalt).toHaveBeenCalledWith(2)
    })
    expect(screen.getByRole('switch', { name: i18n.t('mss.vault.beiFensterwechsel') })).toBeInTheDocument()
    // Kein Team-Dropdown mehr: die Sektion gilt global für den aktiven Tresor.
    expect(teamsApi.list).not.toHaveBeenCalled()
    expect(screen.queryByText(i18n.t('teams.chooseTeam'))).not.toBeInTheDocument()
  })

  it('zeigt ohne aktiven Team-Tresor einen Hinweis mit Weg zu den Teams', () => {
    useTeamVaultStore.setState({ teamId: null })

    render(
      <MemoryRouter>
        <TeamTresorSicherheitTab />
      </MemoryRouter>,
    )

    expect(screen.getByText(i18n.t('teams.vaultSecurityNeedsTeam'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: i18n.t('teams.vaultUnlock') })).toBeInTheDocument()
    expect(teamsApi.getVaultSalt).not.toHaveBeenCalled()
    expect(teamsApi.list).not.toHaveBeenCalled()
  })

  it('zeigt gesperrt denselben Weg zu den Teams wie ohne aktiven Tresor', () => {
    // Kein Passwortfeld in den Einstellungen: entsperrt wird unter Teams.
    useTeamVaultStore.setState({ isUnlocked: false })

    render(
      <MemoryRouter>
        <TeamTresorSicherheitTab />
      </MemoryRouter>,
    )

    expect(screen.getByText(i18n.t('teams.vaultSecurityNeedsTeam'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: i18n.t('teams.vaultUnlock') })).toBeInTheDocument()
    expect(screen.queryByText(i18n.t('teams.vaultUnlockDesc'))).not.toBeInTheDocument()
  })

  it('erlaubt das Umschalten von Fensterwechsel und Leckprüfung', async () => {
    render(
      <MemoryRouter>
        <TeamTresorSicherheitTab />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: i18n.t('mss.vault.beiFensterwechsel') })).toBeInTheDocument()
    })

    const blurSwitch = screen.getByRole('switch', { name: i18n.t('mss.vault.beiFensterwechsel') })
    expect(blurSwitch).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(blurSwitch)
    expect(blurSwitch).toHaveAttribute('aria-checked', 'true')
    expect(localStorage.getItem('mss_team_vault_lock_blur_2')).toBe('true')

    const leakSwitch = screen.getByRole('switch', { name: i18n.t('mss.vault.leckPruefung') })
    expect(leakSwitch).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(leakSwitch)
    expect(leakSwitch).toHaveAttribute('aria-checked', 'false')
    expect(localStorage.getItem('mss_team_vault_leak_check_2')).toBe('false')
  })
})
