import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { teamsApi, type TeamDetail, type TeamRole, type TeamServer } from '@/api/teams'
import { TeamRoleForm } from './TeamRoleForm'

vi.mock('@/api/teams', () => ({
  teamsApi: {
    createRole: vi.fn(),
    updateRole: vi.fn(),
  },
}))

beforeAll(async () => {
  await i18n.changeLanguage('de')
})

const teamOhneFreigaben = { id: 2, name: 'Betrieb', servers: [] } as unknown as TeamDetail

const haltbar: TeamServer[] = [
  { server_id: 7, server_name: 'Valheim', permission_keys: ['server.view', 'server.start'] },
  { server_id: 8, server_name: 'Rust', permission_keys: ['server.view', 'server.stop'] },
]

function zeige(props: Partial<React.ComponentProps<typeof TeamRoleForm>> = {}) {
  const onSaved = vi.fn()
  render(
    <TeamRoleForm
      team={teamOhneFreigaben}
      assignable={haltbar}
      role={null}
      onSaved={onSaved}
      onCancel={vi.fn()}
      {...props}
    />,
  )
  return { onSaved }
}

describe('TeamRoleForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('bietet Server aus dem Gründer-Deckel an, ohne Team-Freigabe', () => {
    zeige()

    // Keine Team-Freigabe nötig (F4): beide gehaltenen Server stehen bereit.
    expect(screen.getByLabelText('Serverrechte für Valheim')).toBeInTheDocument()
    expect(screen.getByLabelText('Serverrechte für Rust')).toBeInTheDocument()
  })

  it('wählt Ansehen automatisch dazu und speichert die Freigabe', async () => {
    const rolle = { id: 11, name: 'Mitglied' } as TeamRole
    vi.mocked(teamsApi.createRole).mockResolvedValue(rolle)
    const { onSaved } = zeige()

    fireEvent.change(screen.getByPlaceholderText('z. B. Moderator, Entwickler, Redakteur'), {
      target: { value: 'Moderator' },
    })
    fireEvent.click(screen.getByLabelText('Serverrechte für Valheim'))
    fireEvent.click(await screen.findByRole('option', { name: 'Server starten' }))
    fireEvent.click(screen.getByRole('button', { name: 'Rolle erstellen' }))

    await waitFor(() =>
      expect(teamsApi.createRole).toHaveBeenCalledWith(
        2,
        expect.objectContaining({
          name: 'Moderator',
          server_grants: [{ server_id: 7, permission_keys: ['server.start', 'server.view'] }],
        }),
      ),
    )
    expect(onSaved).toHaveBeenCalledWith(rolle)
  })

  it('meldet entfallene Freigaben und speichert ohne sie', async () => {
    const alt: TeamRole = {
      id: 11, team_id: 2, name: 'Mitglied', description: '', color: '#10b981',
      can_access_vault: true, can_manage_skills: false, can_manage_memory: false,
      is_default: true, is_admin: false, created_at: '2026-08-09T10:00:00Z',
      permission_keys: [],
      server_grants: [
        { server_id: 9, server_name: 'Ehemalig', permission_keys: ['server.view'] },
        { server_id: 7, server_name: 'Valheim', permission_keys: ['server.view'] },
      ],
    } as TeamRole
    vi.mocked(teamsApi.updateRole).mockResolvedValue(alt)
    zeige({ role: alt })

    // Server 9 hält der Gründer nicht mehr: Hinweis steht, Speichern filtert.
    expect(await screen.findByText(i18n.t('teams.serverGrantsEntfallen'))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.save') }))

    await waitFor(() =>
      expect(teamsApi.updateRole).toHaveBeenCalledWith(
        2,
        11,
        expect.objectContaining({
          server_grants: [{ server_id: 7, permission_keys: ['server.view'] }],
        }),
      ),
    )
  })
})
