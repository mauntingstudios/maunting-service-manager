import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { teamsApi, type Team } from '@/api/teams'
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

const mockTeams: Team[] = [
  {
    id: 1,
    name: 'Persoenlich',
    is_personal: true,
    owner_user_id: 1,
    is_owner: true,
    can_manage_skills: true,
    can_manage_memory: true,
    member_count: 1,
    created_at: '2026-08-09T10:00:00Z',
  },
  {
    id: 2,
    name: 'Dev Team',
    is_personal: false,
    owner_user_id: 1,
    is_owner: true,
    can_manage_skills: true,
    can_manage_memory: true,
    member_count: 3,
    created_at: '2026-08-09T10:00:00Z',
  },
]

describe('TeamTresorSicherheitTab', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.mocked(teamsApi.list).mockResolvedValue(mockTeams)
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

  it('lädt Teams und zeigt das echte Team an', async () => {
    render(
      <MemoryRouter>
        <TeamTresorSicherheitTab />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getAllByText('Dev Team')[0]).toBeInTheDocument()
    })
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
