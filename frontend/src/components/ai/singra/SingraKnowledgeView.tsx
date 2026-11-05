import { useEffect, useState } from 'react'
import { BookOpen, Users, User } from 'lucide-react'
import { teamsApi, type Team } from '@/api/teams'
import { AiSkillManager } from '@/components/ai/AiSkillManager'
import { AiSkillDirectory } from '@/components/ai/AiSkillDirectory'
import { Dropdown, Spinner } from '@maunting/ui'

export function SingraKnowledgeView() {
  const [personalTeam, setPersonalTeam] = useState<Team | null>(null)
  const [sharedTeams, setSharedTeams] = useState<Team[]>([])
  const [selectedScope, setSelectedScope] = useState<string>('personal')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    teamsApi
      .list()
      .then((rows) => {
        if (!active) return
        const personal = rows.find((r) => r.is_personal) ?? null
        const shared = rows.filter((r) => !r.is_personal)
        setPersonalTeam(personal)
        setSharedTeams(shared)
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  if (loading) {
    return (
      <div className="flex h-full flex-1 items-center justify-center">
        <Spinner size="lg" className="text-primary" />
      </div>
    )
  }

  const activeTeam =
    selectedScope === 'personal'
      ? personalTeam
      : sharedTeams.find((t) => String(t.id) === selectedScope) ?? personalTeam

  const isPersonal = selectedScope === 'personal' || activeTeam?.is_personal

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-surface px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Header + Scope Switcher (Persönlich vs. Team) */}
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-outline-variant/30 bg-surface-container-low/45 p-5">
          <div className="max-w-xl">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <BookOpen className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="font-headline text-lg font-semibold text-on-surface">
                  Wissen & Abläufe (Skills)
                </h2>
                <p className="text-xs text-on-surface-variant">
                  Wiederkehrende Anleitungen, Prozeduren und Fachwissen für Singra — wahlweise nur für dich persönlich oder geteilt im Team.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 min-w-52">
            {sharedTeams.length === 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/12 px-3 py-2 text-xs font-medium text-primary">
                <User className="h-3.5 w-3.5" aria-hidden="true" />
                Persönlich
              </span>
            ) : (
              <div className="w-60">
                <Dropdown
                  value={selectedScope}
                  onChange={setSelectedScope}
                  options={[
                    {
                      value: 'personal',
                      label: 'Persönlich',
                      hint: 'Nur für dein Konto sichtbar',
                    },
                    ...sharedTeams.map((team) => ({
                      value: String(team.id),
                      label: `Team: ${team.name}`,
                      hint: 'Für alle Mitglieder dieses Teams',
                    })),
                  ]}
                  aria-label="Wissensbereich auswählen"
                />
              </div>
            )}
          </div>
        </div>

        {/* Active Scope Banner */}
        <div className="flex items-center gap-2 px-1 text-xs text-on-surface-variant">
          {isPersonal ? (
            <>
              <User className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              <span>
                Aktiver Bereich: <strong className="text-on-surface">Persönlich</strong>
              </span>
            </>
          ) : (
            <>
              <Users className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              <span>
                Aktiver Bereich:{' '}
                <strong className="text-on-surface">Team {activeTeam?.name}</strong>
              </span>
            </>
          )}
        </div>

        {activeTeam && (
          <AiSkillManager
            scope={{
              kind: 'team',
              teamId: activeTeam.id,
              personal: Boolean(activeTeam.is_personal),
              canManage: activeTeam.can_manage_skills ?? true,
            }}
          />
        )}

        <AiSkillDirectory />
      </div>
    </div>
  )
}
