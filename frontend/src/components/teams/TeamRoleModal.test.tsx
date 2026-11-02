import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { teamsApi, type TeamDetail, type TeamRole } from '@/api/teams'
import { toast } from '@/stores/toastStore'
import { TeamRoleModal } from './TeamRoleModal'

vi.mock('@/api/teams', () => ({
  teamsApi: {
    createRole: vi.fn(),
    updateRole: vi.fn(),
  },
}))

vi.mock('@/stores/toastStore', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const mockTeam: TeamDetail = {
  id: 10,
  name: 'DevOps Team',
  is_personal: false,
  owner_user_id: 1,
  is_owner: true,
  can_manage_skills: true,
  can_manage_memory: true,
  member_count: 3,
  created_at: '2026-08-01T10:00:00Z',
  members: [],
  servers: [
    {
      server_id: 5,
      server_name: 'Prod-Server',
      permission_keys: ['server.view', 'server.start', 'server.stop'],
    },
  ],
  invitations: [],
  roles: [],
}

const mockRole: TeamRole = {
  id: 42,
  team_id: 10,
  name: 'Operator',
  description: 'Serverbetreuung',
  color: '#10b981',
  can_access_vault: true,
  can_manage_skills: false,
  can_manage_memory: false,
  is_default: false,
  is_admin: false,
  created_at: '2026-08-02T10:00:00Z',
  permission_keys: ['team.members.invite'],
  server_grants: [
    {
      server_id: 5,
      server_name: 'Prod-Server',
      permission_keys: ['server.view'],
    },
  ],
  members_count: 2,
}

describe('TeamRoleModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders creation form when role is null and submits valid payload', async () => {
    const onSaved = vi.fn()
    const onOpenChange = vi.fn()
    vi.mocked(teamsApi.createRole).mockResolvedValue({
      ...mockRole,
      id: 99,
      name: 'Entwickler',
    })

    render(
      <TeamRoleModal
        open={true}
        onOpenChange={onOpenChange}
        team={mockTeam}
        role={null}
        onSaved={onSaved}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Rolle erstellen' })).toBeInTheDocument()

    // Fill role name
    const nameInput = screen.getByPlaceholderText('z. B. Moderator, Entwickler, Redakteur')
    fireEvent.change(nameInput, { target: { value: 'Entwickler' } })

    // Save
    const saveButton = screen.getByRole('button', { name: 'Rolle erstellen' })
    fireEvent.click(saveButton)

    await waitFor(() => {
      expect(teamsApi.createRole).toHaveBeenCalledWith(10, expect.objectContaining({
        name: 'Entwickler',
        is_admin: false,
      }))
      expect(onSaved).toHaveBeenCalled()
      expect(onOpenChange).toHaveBeenCalledWith(false)
      expect(toast.success).toHaveBeenCalled()
    })
  })

  it('populates fields when editing an existing role and updates', async () => {
    const onSaved = vi.fn()
    const onOpenChange = vi.fn()
    vi.mocked(teamsApi.updateRole).mockResolvedValue({
      ...mockRole,
      name: 'Senior Operator',
    })

    render(
      <TeamRoleModal
        open={true}
        onOpenChange={onOpenChange}
        team={mockTeam}
        role={mockRole}
        onSaved={onSaved}
      />,
    )

    expect(screen.getByText('Rolle bearbeiten')).toBeInTheDocument()
    const nameInput = screen.getByDisplayValue('Operator')
    fireEvent.change(nameInput, { target: { value: 'Senior Operator' } })

    const saveButton = screen.getByRole('button', { name: /Speichern/i })
    fireEvent.click(saveButton)

    await waitFor(() => {
      expect(teamsApi.updateRole).toHaveBeenCalledWith(10, 42, expect.objectContaining({
        name: 'Senior Operator',
      }))
      expect(onSaved).toHaveBeenCalled()
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })

  it('hides granular sections and shows notice when Administrator toggle is active', async () => {
    render(
      <TeamRoleModal
        open={true}
        onOpenChange={vi.fn()}
        team={mockTeam}
        role={null}
        onSaved={vi.fn()}
      />,
    )

    const adminSwitch = screen.getByLabelText('Administrator')
    fireEvent.click(adminSwitch)

    expect(await screen.findByText('Administrator-Rolle aktiviert')).toBeInTheDocument()
    expect(screen.queryByText('Funktionale Berechtigungen')).not.toBeInTheDocument()
  })
})
