import { useEffect, useState } from 'react'
import { Bookmark, ChevronDown, ChevronUp, Gauge, User } from 'lucide-react'
import { teamsApi, type Team } from '@/api/teams'
import { AiMemoryManager } from '@/components/ai/AiMemoryManager'
import { AiUsageCard } from '@/components/ai/AiUsageCard'
import { Dropdown, Spinner } from '@maunting/ui'

export function SingraMemoryView() {
  const [sharedTeams, setSharedTeams] = useState<Team[]>([])
  const [selectedScope, setSelectedScope] = useState<string>('personal')
  const [showUsage, setShowUsage] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    teamsApi
      .list()
      .then((rows) => {
        if (!active) return
        // Nur Teams anzeigen, bei denen der Benutzer berechtigt ist
        setSharedTeams(rows.filter((r) => !r.is_personal && (r.is_owner || r.can_manage_memory)))
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
      ? null
      : sharedTeams.find((t) => String(t.id) === selectedScope) ?? null

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-surface px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-5">
        {/* Calm Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-outline-variant/25 bg-surface-container-low/40 p-5">
          <div className="flex items-start gap-3 max-w-xl">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Bookmark className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="font-headline text-lg font-semibold text-on-surface">
                Erinnerungen
              </h2>
              <p className="text-xs text-on-surface-variant mt-0.5 leading-relaxed">
                Was Singra sich über deine Vorlieben, Abläufe oder dein Team merkt. Du kannst jeden Eintrag jederzeit anpassen, anheften oder entfernen.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {sharedTeams.length === 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant/30 bg-surface-container px-3 py-1.5 text-xs font-medium text-on-surface-variant">
                <User className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                Persönlich
              </span>
            ) : (
              <div className="w-52">
                <Dropdown
                  value={selectedScope}
                  onChange={setSelectedScope}
                  options={[
                    { value: 'personal', label: 'Persönlich' },
                    ...sharedTeams.map((team) => ({
                      value: String(team.id),
                      label: `Team: ${team.name}`,
                    })),
                  ]}
                  aria-label="Gedächtnisbereich auswählen"
                />
              </div>
            )}
          </div>
        </div>

        <AiMemoryManager
          compactModalForm={true}
          scope={
            activeTeam
              ? {
                  kind: 'team',
                  teamId: activeTeam.id,
                  canManage: activeTeam.can_manage_memory ?? true,
                }
              : { kind: 'user' }
          }
        />

        {/* Optional Usage Disclosure */}
        <div className="pt-2">
          <button
            type="button"
            onClick={() => setShowUsage((v) => !v)}
            className="inline-flex items-center gap-2 rounded-full border border-outline-variant/25 bg-surface-container-low/40 px-3.5 py-1.5 text-xs font-medium text-on-surface-variant hover:text-on-surface transition-colors"
          >
            <Gauge className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            <span>Nutzung & Kontingent {showUsage ? 'ausblenden' : 'anzeigen'}</span>
            {showUsage ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>

          {showUsage && (
            <div className="mt-3">
              <AiUsageCard />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
