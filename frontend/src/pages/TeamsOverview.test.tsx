import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { TeamsOverview } from '../components/teams/TeamsOverview'
import type { Team, TeamDetail, TeamInvitation } from '@/api/teams'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string | Record<string, unknown>) => {
      if (typeof defaultValue === 'string') return defaultValue
      if (typeof defaultValue === 'object' && defaultValue !== null && 'name' in defaultValue) {
        return `Hallo, ${defaultValue.name}`
      }
      if (key === 'teams.eyebrow') return 'Organisation & Teams'
      if (key === 'teams.title') return 'Deine Teams'
      if (key === 'teams.overviewSubtitle') return 'Zusammenarbeiten, Wissen teilen und Projekte gemeinsam umsetzen.'
      if (key === 'teams.statTeams') return 'Teams'
      if (key === 'teams.statMembers') return 'Mitglieder'
      if (key === 'teams.statProjects') return 'Projekte'
      if (key === 'teams.statVaults') return 'Team-Tresore'
      if (key === 'teams.myTeams') return 'Meine Teams'
      if (key === 'teams.invitations') return 'Einladungen'
      if (key === 'teams.archive') return 'Archiv'
      if (key === 'teams.createTeam') return 'Team erstellen'
      if (key === 'teams.searchGlobal') return 'Suchen ...'
      if (key === 'teams.searchPlaceholder') return 'Teams durchsuchen ...'
      if (key === 'teams.openAction') return 'Öffnen'
      return key
    },
  }),
}))

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (state: { user: { username: string; display_name: string } }) => unknown) =>
    selector({ user: { username: 'admin', display_name: 'Max Mustermann' } }),
}))

const mockTeams: Team[] = [
  {
    id: 1,
    name: 'Operation EchoFall',
    is_personal: false,
    is_owner: true,
    member_count: 5,
    server_count: 2,
    role_count: 3,
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 2,
    name: 'MSM – Entwicklung',
    is_personal: false,
    is_owner: false,
    member_count: 3,
    server_count: 1,
    role_count: 1,
    created_at: '2026-02-01T00:00:00Z',
  },
  {
    id: 3,
    name: 'Server-Team',
    is_personal: false,
    is_owner: true,
    member_count: 4,
    server_count: 3,
    role_count: 2,
    created_at: '2026-03-01T00:00:00Z',
  },
]

const mockDetail: TeamDetail = {
  id: 1,
  name: 'Operation EchoFall',
  is_personal: false,
  is_owner: true,
  can_manage_memory: true,
  can_manage_skills: true,
  can_access_vault: true,
  members: [
    { user_id: 1, username: 'admin', display_name: 'Max Mustermann', role_id: 1, role_name: 'Admin' },
    { user_id: 2, username: 'dev1', display_name: 'Erika', role_id: 2, role_name: 'Entwickler' },
  ],
  servers: [],
  roles: [],
  invitations: [],
}

const mockInvitations: TeamInvitation[] = [
  {
    id: 10,
    team_id: 99,
    team_name: 'Community Discord',
    user_id: 1,
    can_manage_memory: false,
    can_manage_skills: false,
    can_access_vault: false,
    created_at: '2026-04-01T00:00:00Z',
  },
]

describe('TeamsOverview Component', () => {
  const onOpenTeam = vi.fn()
  const onCreateTeam = vi.fn()
  const onEditTeam = vi.fn()
  const onArchiveToggle = vi.fn()
  const onDeleteTeam = vi.fn()
  const onLeaveTeam = vi.fn()
  const onAcceptInvitation = vi.fn()
  const onDeclineInvitation = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('renders the atmospheric header banner and KPI statistics', () => {
    render(
      <TeamsOverview
        teams={mockTeams}
        detail={mockDetail}
        invitations={mockInvitations}
        canCreate={true}
        busy={false}
        onOpenTeam={onOpenTeam}
        onCreateTeam={onCreateTeam}
        onEditTeam={onEditTeam}
        onArchiveToggle={onArchiveToggle}
        onDeleteTeam={onDeleteTeam}
        onLeaveTeam={onLeaveTeam}
        onAcceptInvitation={onAcceptInvitation}
        onDeclineInvitation={onDeclineInvitation}
      />
    )

    // Greeting banner with personalized name exists
    expect(screen.getByText(/admin!/i)).toBeInTheDocument()

    // 4 KPI metrics: 3 Teams, 12 Total Members (5+3+4), 3 Projects, 1 Team-Tresore
    expect(screen.getAllByText('3').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getAllByText('Teams').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Mitglieder')).toBeInTheDocument()
  })

  it('filters teams via real-time search input', () => {
    render(
      <TeamsOverview
        teams={mockTeams}
        detail={mockDetail}
        invitations={mockInvitations}
        canCreate={true}
        busy={false}
        onOpenTeam={onOpenTeam}
        onCreateTeam={onCreateTeam}
        onEditTeam={onEditTeam}
        onArchiveToggle={onArchiveToggle}
        onDeleteTeam={onDeleteTeam}
        onLeaveTeam={onLeaveTeam}
        onAcceptInvitation={onAcceptInvitation}
        onDeclineInvitation={onDeclineInvitation}
      />
    )

    expect(screen.getByText('Operation EchoFall')).toBeInTheDocument()
    expect(screen.getByText('MSM – Entwicklung')).toBeInTheDocument()
    expect(screen.getByText('Server-Team')).toBeInTheDocument()

    const searchInput = screen.getByPlaceholderText(/Teams durchsuchen/i)
    fireEvent.change(searchInput, { target: { value: 'EchoFall' } })

    expect(screen.getByText('Operation EchoFall')).toBeInTheDocument()
    expect(screen.queryByText('MSM – Entwicklung')).not.toBeInTheDocument()
    expect(screen.queryByText('Server-Team')).not.toBeInTheDocument()
  })

  it('navigates to invitations tab showing open invites', () => {
    render(
      <TeamsOverview
        teams={mockTeams}
        detail={mockDetail}
        invitations={mockInvitations}
        canCreate={true}
        busy={false}
        onOpenTeam={onOpenTeam}
        onCreateTeam={onCreateTeam}
        onEditTeam={onEditTeam}
        onArchiveToggle={onArchiveToggle}
        onDeleteTeam={onDeleteTeam}
        onLeaveTeam={onLeaveTeam}
        onAcceptInvitation={onAcceptInvitation}
        onDeclineInvitation={onDeclineInvitation}
      />
    )

    const invitationsTab = screen.getByRole('button', { name: /Einladungen/i })
    fireEvent.click(invitationsTab)

    expect(screen.getByText('Community Discord')).toBeInTheDocument()
  })

  it('triggers onOpenTeam when clicking Öffnen on a team card', () => {
    render(
      <TeamsOverview
        teams={mockTeams}
        detail={mockDetail}
        invitations={mockInvitations}
        canCreate={true}
        busy={false}
        onOpenTeam={onOpenTeam}
        onCreateTeam={onCreateTeam}
        onEditTeam={onEditTeam}
        onArchiveToggle={onArchiveToggle}
        onDeleteTeam={onDeleteTeam}
        onLeaveTeam={onLeaveTeam}
        onAcceptInvitation={onAcceptInvitation}
        onDeclineInvitation={onDeclineInvitation}
      />
    )

    const openButtons = screen.getAllByRole('button', { name: /Öffnen/i })
    fireEvent.click(openButtons[0])
    expect(onOpenTeam).toHaveBeenCalledWith(1)
  })

  it('triggers onCreateTeam when clicking the create team button', () => {
    render(
      <TeamsOverview
        teams={mockTeams}
        detail={mockDetail}
        invitations={mockInvitations}
        canCreate={true}
        busy={false}
        onOpenTeam={onOpenTeam}
        onCreateTeam={onCreateTeam}
        onEditTeam={onEditTeam}
        onArchiveToggle={onArchiveToggle}
        onDeleteTeam={onDeleteTeam}
        onLeaveTeam={onLeaveTeam}
        onAcceptInvitation={onAcceptInvitation}
        onDeclineInvitation={onDeclineInvitation}
      />
    )

    const createButtons = screen.getAllByRole('button', { name: /Team erstellen/i })
    fireEvent.click(createButtons[0])
    expect(onCreateTeam).toHaveBeenCalled()
  })
})
