import { Check, Mail, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@maunting/ui'

import type { TeamInvitation } from '@/api/teams'
import { Avatar } from '@/components/app/Avatar'

function OfferedRoleBadge({ invitation }: { invitation: TeamInvitation }) {
  if (!invitation.team_role_name) return null
  return (
    <span className="rounded-full bg-surface-container-high px-2.5 py-1 text-xs font-medium text-on-surface-variant">
      {invitation.team_role_name}
    </span>
  )
}

function InvitationsBlock({
  kennung,
  titel,
  hinweis,
  einladungen,
  busy,
  onAnnehmen,
  onAblehnen,
}: {
  kennung: string
  titel: string
  hinweis: string
  einladungen: TeamInvitation[]
  busy: boolean
  onAnnehmen: (invitation: TeamInvitation) => void
  onAblehnen: (invitation: TeamInvitation) => void
}) {
  const { t } = useTranslation()
  if (einladungen.length === 0) return null

  return (
    <section className="rounded-xl border border-primary/30 bg-primary/5 p-4" aria-labelledby={kennung}>
      <div className="flex items-center gap-2">
        <Mail className="h-4 w-4 text-primary" aria-hidden="true" />
        <h2 id={kennung} className="font-headline text-sm font-semibold text-on-surface">
          {titel}
        </h2>
      </div>
      <p className="mt-1 text-xs text-on-surface-variant">{hinweis}</p>

      <ul className="mt-3 space-y-2">
        {einladungen.map((invitation) => (
          <li
            key={invitation.team_id}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-outline-variant/40 bg-surface p-3"
          >
            <span className="min-w-[10rem] flex-1 text-sm text-on-surface">
              <span className="font-semibold">{invitation.team_name}</span>
              {invitation.invited_by_username && (
                <span className="ml-2 text-xs text-on-surface-variant">
                  {t('teams.invitedBy', { name: invitation.invited_by_username })}
                </span>
              )}
            </span>
            <OfferedRoleBadge invitation={invitation} />
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => onAnnehmen(invitation)}
                aria-label={`${t('teams.acceptInvitation')}: ${invitation.team_name}`}
              >
                <Check className="h-4 w-4 mr-1" aria-hidden="true" />
                {t('teams.acceptInvitation')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => onAblehnen(invitation)}
                aria-label={`${t('teams.declineInvitation')}: ${invitation.team_name}`}
              >
                <X className="h-4 w-4 mr-1" aria-hidden="true" />
                {t('teams.declineInvitation')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Banner mit eigenen Team-Einladungen oberhalb des Arbeitsbereichs. */
export function TeamInvitationsBanner({
  meineBeitritte,
  busy,
  onAcceptInvitation,
  onDeclineInvitation,
}: {
  meineBeitritte: TeamInvitation[]
  busy: boolean
  onAcceptInvitation: (invitation: TeamInvitation) => void
  onDeclineInvitation: (invitation: TeamInvitation) => void
}) {
  const { t } = useTranslation()
  if (meineBeitritte.length === 0) return null

  return (
    <div className="shrink-0 space-y-2 border-b border-outline-variant/40 bg-surface-container-low/40 p-3 sm:px-6">
      <InvitationsBlock
        kennung="team-my-invitations"
        titel={t('teams.myInvitations')}
        hinweis={t('teams.myInvitationsHint')}
        einladungen={meineBeitritte}
        busy={busy}
        onAnnehmen={onAcceptInvitation}
        onAblehnen={onDeclineInvitation}
      />
    </div>
  )
}

/** Liste ausstehender Einladungen für Berechtigte im Mitglieder-Reiter. */
export function PendingInvitationsGroup({
  kennung,
  titel,
  status,
  hinweis,
  einladungen,
}: {
  kennung: string
  titel: string
  status: string
  hinweis: string
  einladungen: TeamInvitation[]
}) {
  if (einladungen.length === 0) return null

  return (
    <div className="mt-4">
      <h3 id={kennung} className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
        {titel}
      </h3>
      <ul className="mt-2 space-y-2" aria-labelledby={kennung}>
        {einladungen.map((invitation) => (
          <li
            key={invitation.user_id}
            className="flex flex-wrap items-center gap-4 rounded-xl border border-dashed border-outline-variant/50 bg-surface-container-low/20 p-3.5"
          >
            <div className="flex min-w-[8rem] flex-1 items-center gap-3">
              <Avatar src={invitation.avatar_url} name={invitation.username} size="sm" />
              <span className="text-sm font-semibold text-on-surface">
                {invitation.username}
              </span>
            </div>
            <OfferedRoleBadge invitation={invitation} />
            <span className="text-xs text-on-surface-variant font-medium">{status}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-xs text-on-surface-variant">{hinweis}</p>
    </div>
  )
}
