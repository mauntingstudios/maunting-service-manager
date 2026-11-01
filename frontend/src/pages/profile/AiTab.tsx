import { useEffect, useState } from 'react'
import { Bot } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { teamsApi, type Team } from '@/api/teams'
import { AiMemoryManager } from '@/components/ai/AiMemoryManager'
import { AiSkillManager } from '@/components/ai/AiSkillManager'
import { AiUsageCard } from '@/components/ai/AiUsageCard'
import { useHasPermission } from '@/hooks/useHasPermission'

/**
 * Der persönliche KI-Bereich im Profil.
 *
 * Beherbergt alles, was dem Benutzer selbst gehört:
 * - Sein persönliches Gedächtnis (AiMemoryManager)
 * - Seine persönlichen KI-Skills (gebunden an sein persönliches Team)
 * - Sein individuelles KI-Nutzungskontingent (AiUsageCard)
 */
export function AiTab() {
  const { t } = useTranslation()
  const canUseSkills = useHasPermission('ai.skills.use')
  const [personalTeam, setPersonalTeam] = useState<Team | null>(null)

  useEffect(() => {
    let active = true
    if (canUseSkills) {
      teamsApi.list()
        .then((rows) => {
          if (active) {
            const found = rows.find((r) => r.is_personal) ?? null
            setPersonalTeam(found)
          }
        })
        .catch(() => {
          // Keine störende Meldung: ohne Teamliste bleibt der Bereich verborgen
        })
    }
    return () => { active = false }
  }, [canUseSkills])

  return (
    <section className="space-y-6" aria-labelledby="ai-profile-title">
      <div className="msm-card p-6">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-secondary" aria-hidden="true" />
          <h2 id="ai-profile-title" className="font-headline text-title-lg font-semibold text-on-surface">
            {t('ai.profile.title')}
          </h2>
        </div>
        <p className="mt-2 max-w-3xl text-sm text-on-surface-variant">
          {t('ai.profile.description')}
        </p>
      </div>

      <AiUsageCard />
      <AiMemoryManager />

      {canUseSkills && personalTeam && (
        <AiSkillManager
          scope={{
            kind: 'team',
            teamId: personalTeam.id,
            personal: true,
            canManage: personalTeam.can_manage_skills ?? true,
          }}
        />
      )}
    </section>
  )
}
