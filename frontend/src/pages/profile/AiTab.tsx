import { useEffect, useMemo, useState } from 'react'
import { Bot, Brain, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { teamsApi, type Team } from '@/api/teams'
import { AiMemoryManager } from '@/components/ai/AiMemoryManager'
import { AiSkillManager } from '@/components/ai/AiSkillManager'
import { AiUsageCard } from '@/components/ai/AiUsageCard'
import { TabBar, TabDef } from '@maunting/ui'
import { useHasPermission } from '@/hooks/useHasPermission'

export type AiTabSection = 'memory' | 'skills'

/**
 * Der persönliche KI-Bereich im Profil.
 *
 * Beherbergt alles, was dem Benutzer selbst gehört:
 * - Sein persönliches Gedächtnis (AiMemoryManager)
 * - Seine persönlichen KI-Skills (gebunden an sein persönliches Team)
 * - Sein individuelles KI-Nutzungskontingent (AiUsageCard)
 *
 * Beide Wissensbereiche (Gedächtnis & Skills) sind per Tab sauber getrennt,
 * sodass man direkt zu den Skills springen kann, ohne erst an endlosen
 * Erinnerungen vorbeiscrollen zu müssen.
 */
export function AiTab() {
  const { t } = useTranslation()
  const canUseSkills = useHasPermission('ai.skills.use')
  const [personalTeam, setPersonalTeam] = useState<Team | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()

  const tabs: TabDef<AiTabSection>[] = useMemo(() => [
    { id: 'memory', labelKey: 'ai.profile.tabMemory', icon: Brain },
    ...(canUseSkills && personalTeam
      ? [{ id: 'skills' as const, labelKey: 'ai.profile.tabSkills', icon: Sparkles }]
      : []),
  ], [canUseSkills, personalTeam])

  const sectionParam = searchParams.get('section')
  const activeSection: AiTabSection =
    sectionParam === 'skills' && canUseSkills && personalTeam ? 'skills' : 'memory'

  const handleTabChange = (next: AiTabSection) => {
    const nextParams = new URLSearchParams(searchParams)
    if (next === 'skills') {
      nextParams.set('section', 'skills')
    } else {
      nextParams.delete('section')
    }
    setSearchParams(nextParams, { replace: true })
  }

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

      {tabs.length > 1 && (
        <TabBar
          tabs={tabs}
          active={activeSection}
          onChange={handleTabChange}
          ariaLabel={t('ai.profile.title')}
        />
      )}

      {activeSection === 'memory' && <AiMemoryManager />}

      {activeSection === 'skills' && personalTeam && (
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
