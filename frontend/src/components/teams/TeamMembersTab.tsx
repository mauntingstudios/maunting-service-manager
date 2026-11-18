import { Crown, Trash2, UserPlus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button, Dropdown, MultiSelect, RoleBadge } from '@maunting/ui'

import type { TeamDetail, TeamInvitation, TeamMember } from '@/api/teams'
import { Avatar } from '@/components/app/Avatar'
import { StatusDot } from '@/components/social/StatusIndicator'
import type { TeamPreviewAccess } from '@/stores/rolePreviewStore'
import { PendingInvitationsGroup } from './TeamInvitationsSection'

export interface MemberCandidateOption {
  id: number
  username: string
}

export interface TeamMembersTabProps {
  team: TeamDetail
  access: TeamPreviewAccess
  benutzerId: number | null
  kandidaten: MemberCandidateOption[]
  newMemberId: string | null
  busy: boolean
  offeneBeitritte: TeamInvitation[]
  onKandidat: (id: string | null) => void
  onEinladen: () => void
  onSetMemberRoles: (member: TeamMember, roleIds: number[]) => void
  onEntfernen: (member: TeamMember) => void
}

/**
 * Mitglieder-Reiter des Team-Arbeitsbereichs (Einladen, Rollenzuweisung und
 * ausstehende Einladungen; Rechte laufen ausschließlich über Team-Rollen).
 */
export function TeamMembersTab({
  team,
  access,
  benutzerId,
  kandidaten,
  newMemberId,
  busy,
  offeneBeitritte,
  onKandidat,
  onEinladen,
  onSetMemberRoles,
  onEntfernen,
}: TeamMembersTabProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const spalten = 'md:grid-cols-[minmax(0,1.4fr)_minmax(14rem,1fr)_2.75rem]'
  const roleOptions = (team.roles || []).map((r) => ({ value: String(r.id), label: r.name }))

  return (
    <section className="space-y-6 w-full" aria-labelledby="team-members">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 id="team-members" className="font-headline text-lg font-semibold text-on-surface">
            {t('teams.members')}
          </h3>
          <p className="text-xs sm:text-sm text-on-surface-variant">
            {t(
              'teams.membersRoleDrivenHint',
              'Berechtigungen für Skills, Gedächtnis, Tresor und Server vergibst du über Team-Rollen.',
            )}
          </p>
        </div>

        {access.canInvite && kandidaten.length > 0 && (
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <div className="min-w-[12rem] flex-1 sm:w-60 sm:flex-none">
              <Dropdown
                value={newMemberId}
                onChange={onKandidat}
                options={kandidaten.map((user) => ({ value: String(user.id), label: user.username }))}
                placeholder={t('teams.selectUser')}
                disabled={busy}
                aria-label={t('teams.inviteMember')}
              />
            </div>
            <Button type="button" size="sm" disabled={busy || !newMemberId} onClick={onEinladen}>
              <UserPlus className="h-4 w-4 mr-1.5" aria-hidden="true" />
              {t('teams.inviteMember')}
            </Button>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-outline-variant/40 bg-surface shadow-sm">
        <div
          aria-hidden="true"
          className={`hidden gap-4 border-b border-outline-variant/40 bg-surface-container-low/40 px-4 py-3 font-label-md text-label-sm uppercase tracking-wider text-on-surface-variant md:grid ${spalten}`}
        >
          <span>{t('teams.member')}</span>
          <span>{t('teams.roles')}</span>
          <span />
        </div>
        <ul className="divide-y divide-outline-variant/30">
          {team.members.map((member) => {
            const ich = member.user_id === benutzerId
            const canEditRoles = access.canManageRoles && member.role !== 'owner'
            const memberRoleValues = (
              member.roles?.map((r) => String(r.id)) ??
              (member.role_ids?.map(String) ?? (member.team_role_id ? [String(member.team_role_id)] : []))
            )
            const memberRoles = member.roles ?? []

            return (
              <li
                key={member.user_id}
                className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3.5 md:gap-4 ${spalten}`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <button
                    type="button"
                    onClick={() => navigate(`/user/${member.user_id}`)}
                    className="relative shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    aria-label={t('teams.profilAnsehen', { name: member.username })}
                  >
                    <Avatar src={member.avatar_url} name={member.username} size="sm" />
                    <StatusDot
                      status={member.presence?.status || 'invisible'}
                      size="sm"
                      className="absolute bottom-0 right-0"
                      portal
                    />
                  </button>
                  <span className="min-w-0">
                    <button
                      type="button"
                      onClick={() => navigate(`/user/${member.user_id}`)}
                      className="block max-w-full truncate rounded text-sm font-semibold text-on-surface hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      {member.username}
                    </button>
                    <span className="mt-0.5 flex items-center gap-1.5 text-xs text-on-surface-variant font-normal">
                      {member.role === 'owner' ? (
                        <span className="inline-flex items-center gap-1 text-primary font-medium">
                          <Crown className="h-3 w-3" aria-hidden="true" />
                          {t('teams.founder')}
                        </span>
                      ) : t('teams.member')}
                      {ich && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-primary font-medium">{t('teams.you')}</span>
                        </>
                      )}
                    </span>
                    {canEditRoles && memberRoles.length > 0 && (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {memberRoles.map((r) => (
                          <RoleBadge
                            key={r.id}
                            name={r.name}
                            color={r.color}
                            icon={r.icon}
                            isAdmin={r.is_admin}
                            size="sm"
                          />
                        ))}
                      </span>
                    )}
                  </span>
                </div>
                <div className="flex justify-end md:order-last">
                  {access.canKick && !ich && member.role !== 'owner' && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => onEntfernen(member)}
                      aria-label={`${t('teams.removeMember')}: ${member.username}`}
                    >
                      <Trash2 className="h-4 w-4 text-status-destructive" aria-hidden="true" />
                    </Button>
                  )}
                </div>

                {/* Rollen-Zuweisung */}
                <div className="col-span-2 flex flex-col justify-center gap-1 md:col-span-1 min-w-[10rem]">
                  <span className="text-xs font-semibold text-on-surface-variant md:hidden">{t('teams.roles')}</span>
                  {canEditRoles ? (
                    <MultiSelect
                      options={roleOptions}
                      values={memberRoleValues}
                      onChange={(selectedIds) => onSetMemberRoles(member, selectedIds.map(Number))}
                      disabled={busy}
                      placeholder={t('teams.assignRoles')}
                      aria-label={`${t('teams.roles')}: ${member.username}`}
                    />
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {memberRoles.map((r) => (
                        <RoleBadge
                          key={r.id}
                          name={r.name}
                          color={r.color}
                          icon={r.icon}
                          isAdmin={r.is_admin}
                          size="sm"
                        />
                      ))}
                      {memberRoles.length === 0 && (
                        <span className="text-xs text-on-surface-variant/70 italic">-</span>
                      )}
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      {(access.isFounder || access.canInvite) && (
        <div className="space-y-4 pt-2">
          <PendingInvitationsGroup
            kennung="team-pending-invitations"
            titel={t('teams.pendingInvitations')}
            status={t('teams.invitationPending')}
            hinweis={t('teams.pendingInvitationsHint')}
            einladungen={offeneBeitritte}
          />
        </div>
      )}
    </section>
  )
}
