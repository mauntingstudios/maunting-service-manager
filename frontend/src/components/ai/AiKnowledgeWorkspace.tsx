import { useMemo, useState, type ReactNode } from 'react'
import { Bot, Brain, Sparkles } from 'lucide-react'
import { TabBar, type TabDef } from '@maunting/ui'
import { AiMemoryManager } from './AiMemoryManager'
import { AiSkillManager } from './AiSkillManager'
import type { AiKnowledgeScope, AiSkillScope } from './knowledgeScope'

export type AiKnowledgeSection = 'memory' | 'skills'

export interface AiKnowledgeWorkspaceProps {
  /** Titel des KI-Wissensbereichs */
  title: string
  /** Erklärender Text */
  description?: string
  /** Scope für das Gedächtnis / Erinnerungen */
  memoryScope?: AiKnowledgeScope
  /** Scope für Fähigkeiten / Skills (falls vorhanden) */
  skillScope?: AiSkillScope | null
  /** Ob Skills für diesen Benutzer/Bereich aktiviert sind */
  canUseSkills?: boolean
  /** Optionale Zusatzkarte über den Tabs (z. B. AiUsageCard im Profil) */
  topContent?: ReactNode
  /** Optionale externe Steuerung des aktiven Tabs */
  activeSection?: AiKnowledgeSection
  onSectionChange?: (section: AiKnowledgeSection) => void
  className?: string
}

/**
 * Zentraler, modularer KI-Wissensarbeitsbereich (Single Source of Truth).
 *
 * Wird sowohl im Benutzerprofil (persönliche Erinnerungen & Skills)
 * als auch in der Teamübersicht (Wissen des Teams & Team-Skills) verwendet.
 * Bietet eine einheitliche Tab-Struktur, aufgeräumte Karten und ein
 * durchgängiges, intuitives Bedienkonzept ohne Formular-Überladung.
 */
export function AiKnowledgeWorkspace({
  title,
  description,
  memoryScope,
  skillScope,
  canUseSkills = true,
  topContent,
  activeSection: controlledSection,
  onSectionChange,
  className = '',
}: AiKnowledgeWorkspaceProps) {
  const [internalSection, setInternalSection] = useState<AiKnowledgeSection>('memory')

  const isControlled = controlledSection !== undefined
  const active = isControlled ? controlledSection : internalSection

  const hasSkills = Boolean(canUseSkills && skillScope)

  const tabs: TabDef<AiKnowledgeSection>[] = useMemo(() => [
    { id: 'memory', labelKey: 'ai.profile.tabMemory', icon: Brain },
    ...(hasSkills ? [{ id: 'skills' as const, labelKey: 'ai.profile.tabSkills', icon: Sparkles }] : []),
  ], [hasSkills])

  const handleTabChange = (next: AiKnowledgeSection) => {
    if (onSectionChange) {
      onSectionChange(next)
    }
    if (!isControlled) {
      setInternalSection(next)
    }
  }

  return (
    <section className={`space-y-6 ${className}`} aria-labelledby="ai-knowledge-workspace-title">
      {/* Header Panel */}
      <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-low/60 p-5 sm:p-6 backdrop-blur-md shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-secondary/15 text-secondary border border-secondary/25">
            <Bot className="h-5 w-5" aria-hidden="true" />
          </div>
          <h2
            id="ai-knowledge-workspace-title"
            className="font-headline text-lg sm:text-xl font-bold tracking-tight text-on-surface"
          >
            {title}
          </h2>
        </div>
        {description && (
          <p className="mt-2 text-xs sm:text-sm text-on-surface-variant max-w-2xl leading-relaxed">
            {description}
          </p>
        )}
      </div>

      {topContent}

      {/* Tab-Auswahl zwischen Gedächtnis und Skills */}
      {tabs.length > 1 && (
        <div className="border-b border-outline-variant/30 pb-1">
          <TabBar
            tabs={tabs}
            active={active}
            onChange={handleTabChange}
            ariaLabel={title}
          />
        </div>
      )}

      {/* Gedächtnis-Ansicht */}
      <div className={active === 'memory' ? 'block' : 'hidden'}>
        <AiMemoryManager scope={memoryScope} compactModalForm />
      </div>

      {/* Skills-Ansicht */}
      {hasSkills && skillScope && (
        <div className={active === 'skills' ? 'block' : 'hidden'}>
          <AiSkillManager scope={skillScope} />
        </div>
      )}
    </section>
  )
}
