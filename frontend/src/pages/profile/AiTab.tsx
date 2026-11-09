import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { teamsApi, type Team } from '@/api/teams'
import { AiKnowledgeWorkspace, type AiKnowledgeSection } from '@/components/ai/AiKnowledgeWorkspace'
import { AiUsageCard } from '@/components/ai/AiUsageCard'
import { useHasPermission } from '@/hooks/useHasPermission'

export type { AiKnowledgeSection as AiTabSection }

/**
 * Der persönliche KI-Bereich im Profil.
 *
 * Nutzt die zentrale, modulare AiKnowledgeWorkspace-Komponente,
 * sodass persönliches Wissen und Team-Wissen exakt dieselbe
 * saubere Tab-Struktur und Design-DNA teilen.
 */
export function AiTab() {
  const { t } = useTranslation()
  const canUseSkills = useHasPermission('ai.skills.use')
  const [personalTeam, setPersonalTeam] = useState<Team | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()

  const sectionParam = searchParams.get('section')
  const activeSection: AiKnowledgeSection =
    sectionParam === 'skills' && canUseSkills && personalTeam ? 'skills' : 'memory'

  const handleTabChange = (next: AiKnowledgeSection) => {
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
    <AiKnowledgeWorkspace
      title={t('ai.profile.title')}
      description={t('ai.profile.description')}
      memoryScope={{ kind: 'user' }}
      skillScope={personalTeam ? {
        kind: 'team',
        teamId: personalTeam.id,
        personal: true,
        canManage: personalTeam.can_manage_skills ?? true,
      } : null}
      canUseSkills={canUseSkills}
      topContent={<AiUsageCard />}
      activeSection={activeSection}
      onSectionChange={handleTabChange}
    />
  )
}

