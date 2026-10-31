import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { teamsApi, type Team } from '@/api/teams'
import { TransferToTeamVaultModal } from './TransferToTeamVaultModal'
import { useTeamVaultStore } from './teamVaultStore'
import { useVaultStore } from './vaultStore'
import type { VaultItem } from './vaultEintrag'

vi.mock('@/api/teams', () => ({
  teamsApi: {
    list: vi.fn(),
  },
}))

const mockItem: VaultItem = {
  id: 'item-1',
  service: 'Gemeinsames Netflix',
  category: 'login',
  username: 'familie@example.com',
  password: 'Password123!',
  createdAt: 0,
  updatedAt: 0,
  revision: 1,
}

const mockTeams: Team[] = [
  {
    id: 1,
    name: 'Persönlich',
    is_personal: true,
    owner_user_id: 1,
    is_owner: true,
    can_manage_skills: true,
    can_manage_memory: true,
    member_count: 1,
    created_at: '2026-10-31T00:00:00Z',
  },
  {
    id: 2,
    name: 'Familien-Team',
    is_personal: false,
    owner_user_id: 1,
    is_owner: true,
    can_manage_skills: true,
    can_manage_memory: true,
    member_count: 3,
    created_at: '2026-10-31T00:00:00Z',
  },
]

describe('TransferToTeamVaultModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(teamsApi.list).mockResolvedValue(mockTeams)
    useTeamVaultStore.setState({
      isUnlocked: true,
      teamId: 2,
      saveItem: vi.fn().mockResolvedValue('new-id'),
      unlock: vi.fn().mockResolvedValue(true),
    })
    useVaultStore.setState({
      deleteItem: vi.fn().mockResolvedValue(undefined),
    })
  })

  it('zeigt Dialog mit Element-Name und Übertragungsoptionen', async () => {
    render(<TransferToTeamVaultModal open={true} onOpenChange={vi.fn()} item={mockItem} />)

    expect(screen.getByText(i18n.t('teams.transferToTeam'))).toBeInTheDocument()
    expect(screen.getByText('Gemeinsames Netflix')).toBeInTheDocument()
    expect(await screen.findByText(i18n.t('teams.transferSelectTeam'))).toBeInTheDocument()
    expect(screen.getByText(i18n.t('teams.transferMode'))).toBeInTheDocument()
  })

  it('zeigt Passwort-Eingabe, wenn der Team-Tresor gesperrt ist', async () => {
    useTeamVaultStore.setState({ isUnlocked: false })

    render(<TransferToTeamVaultModal open={true} onOpenChange={vi.fn()} item={mockItem} />)

    expect(await screen.findByPlaceholderText(i18n.t('mss.vault.masterPasswort'))).toBeInTheDocument()
  })
})
