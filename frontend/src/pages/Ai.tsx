import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Menu, MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  aiApi,
  type AiAttachment,
  type AiConversationSummary,
  type AiProject,
  type AiVoiceConfig,
} from '@/api/ai'
import { api } from '@/api/client'
import { AiAutonomyButton } from '@/components/ai/AiAutonomyButton'
import { AiChat } from '@/components/ai/AiChat'
import { PRIMARY_CHAT_SCOPE, type AiChatScope } from '@/components/ai/chatScope'
import { AufgabenAnsicht } from '@/components/ai/AufgabenAnsicht'
import { GuardianAnsicht } from '@/components/ai/GuardianAnsicht'
import { WorkerAnsicht } from '@/components/ai/WorkerAnsicht'
import { SprachAnsicht } from '@/components/ai/voice/SprachAnsicht'
import {
  SingraSidebar,
  type SingraSection,
} from '@/components/ai/singra/SingraSidebar'
import { SingraProjectsView } from '@/components/ai/singra/SingraProjectsView'
import { SingraKnowledgeView } from '@/components/ai/singra/SingraKnowledgeView'
import { SingraMemoryView } from '@/components/ai/singra/SingraMemoryView'
import { SingraFilesView } from '@/components/ai/singra/SingraFilesView'
import { SingraToolsView } from '@/components/ai/singra/SingraToolsView'
import { SingraHistoryView } from '@/components/ai/singra/SingraHistoryView'
import { useHasPermission } from '@/hooks/useHasPermission'
import { aiChatPreferenceKeys, readAiProviderChoice } from '@/lib/aiChatPreferences'
import { browserWahlInsKontoUebernehmen } from '@/lib/aiProviderKonto'
import { still } from '@/lib/still'
import { useAuthStore } from '@/stores/authStore'
import { useAiGenerationStore } from '@/stores/aiGenerationStore'
import { confirm } from '@/stores/confirmStore'
import { toast } from '@/stores/toastStore'

interface ServerOption {
  id: number
  name: string
}

type Ansicht = 'text' | 'sprache' | 'guardian' | 'worker' | 'aufgaben'

const ANSICHTEN: readonly Ansicht[] = ['text', 'sprache', 'guardian', 'worker', 'aufgaben']
const BEREICHE: readonly SingraSection[] = [
  'chat',
  'projekte',
  'wissen',
  'dateien',
  'erinnerungen',
  'tools',
  'verlauf',
]

function ansichtAusAbfrage(wert: string | null, id: string | null): Ansicht {
  const ansicht = (ANSICHTEN as readonly string[]).includes(wert ?? '')
    ? (wert as Ansicht)
    : 'text'
  return ansicht === 'worker' && !id ? 'text' : ansicht
}

function bereichAusAbfrage(wert: string | null): SingraSection {
  return (BEREICHE as readonly string[]).includes(wert ?? '')
    ? (wert as SingraSection)
    : 'chat'
}

function Umschalter({ aktiv, onClick, icon, label, shortLabel }: {
  aktiv: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  shortLabel?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={aktiv}
      aria-label={label}
      className={[
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
        'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 shrink-0',
        aktiv
          ? 'border-outline-variant/60 bg-surface-container-low/50 text-on-surface-variant hover:text-on-surface'
          : 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/20',
      ].join(' ')}
    >
      {icon}
      <span>{shortLabel || label}</span>
    </button>
  )
}

export function Ai({
  appFaehigkeiten,
}: {
  appFaehigkeiten?: {
    computer_use?: boolean | null
    artifact_install?: boolean | null
  }
} = {}) {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.user)
  const canChat = useHasPermission('ai.chat.use')
  const canSpeak = useHasPermission('ai.voice.use')
  const canUseAutonomy = useHasPermission('ai.autonomous.use')
  const canManageTasks = useHasPermission('ai.tasks.manage')
  const [sprachkonfiguration, setSprachkonfiguration] = useState<AiVoiceConfig | null>(null)
  const [servers, setServers] = useState<ServerOption[]>([])
  const [suchParameter, setzeSuchParameter] = useSearchParams()

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [conversations, setConversations] = useState<AiConversationSummary[]>([])
  const [projects, setProjects] = useState<AiProject[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [activeProjectId, setActiveProjectId] = useState<string | undefined>(undefined)
  const [activeProjectName, setActiveProjectName] = useState<string | undefined>(undefined)
  const [pendingAttachmentToChat, setPendingAttachmentToChat] = useState<AiAttachment | null>(null)

  const projectMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const p of projects) {
      map[p.id] = p.name
    }
    return map
  }, [projects])

  const providerId =
    user?.ai_provider_id
    ?? (user?.id ? readAiProviderChoice(aiChatPreferenceKeys(user.id).provider) : null)

  useEffect(() => {
    void browserWahlInsKontoUebernehmen()
  }, [])

  const workerId = suchParameter.get('id')
  const gewuenscht = ansichtAusAbfrage(suchParameter.get('ansicht'), workerId)
  const ansicht: Ansicht =
    (gewuenscht === 'sprache' && !sprachkonfiguration)
      || (gewuenscht === 'aufgaben' && !canManageTasks)
      ? 'text'
      : gewuenscht

  const activeSection = bereichAusAbfrage(suchParameter.get('bereich'))

  const setzeAnsicht = (neu: Ansicht) => {
    const naechste = new URLSearchParams(suchParameter)
    if (neu === 'text') naechste.delete('ansicht')
    else naechste.set('ansicht', neu)
    if (neu !== 'worker') naechste.delete('id')
    setzeSuchParameter(naechste, { replace: true })
  }

  const setActiveSection = (section: SingraSection) => {
    const naechste = new URLSearchParams(suchParameter)
    if (section === 'chat') naechste.delete('bereich')
    else naechste.set('bereich', section)
    naechste.delete('ansicht')
    naechste.delete('id')
    setzeSuchParameter(naechste, { replace: true })
  }

  const loadConversations = useCallback(async () => {
    if (!canChat || typeof aiApi.listConversations !== 'function') return
    try {
      const [list, projectList] = await Promise.all([
        aiApi.listConversations(),
        aiApi.listProjects().catch(() => [] as AiProject[]),
      ])
      setConversations(list)
      setProjects(projectList)
      setActiveConversationId((prev) => {
        if (prev) return prev
        return list.length > 0 ? list[0].id : null
      })
    } catch (err) {
      still(err, 'ai.listConversations')
    }
  }, [canChat])

  useEffect(() => {
    void loadConversations()
  }, [loadConversations])

  useEffect(() => {
    const refreshHandler = () => {
      void loadConversations()
    }
    window.addEventListener('singra-refresh-conversations', refreshHandler)
    return () => {
      window.removeEventListener('singra-refresh-conversations', refreshHandler)
    }
  }, [loadConversations])

  const handleSelectConversation = useCallback(
    (id: string) => {
      const conv = conversations.find((c) => c.id === id)
      setActiveConversationId(id)
      if (conv?.project_id) {
        setActiveProjectId(conv.project_id)
        const proj = projects.find((p) => p.id === conv.project_id)
        setActiveProjectName(proj?.name)
      } else {
        setActiveProjectId(undefined)
        setActiveProjectName(undefined)
      }
      setActiveSection('chat')
    },
    [conversations, projects],
  )

  useEffect(() => {
    if (activeConversationId) {
      useAiGenerationStore.getState().markConversationSeen(activeConversationId)
    }
  }, [activeConversationId])

  const handleNewChat = async () => {
    setActiveProjectId(undefined)
    setActiveProjectName(undefined)
    if (typeof aiApi.createConversation === 'function') {
      try {
        const created = await aiApi.createConversation({ title: 'Neue Unterhaltung' })
        setConversations((prev) => [created, ...prev])
        setActiveConversationId(created.id)
        setActiveSection('chat')
        return
      } catch (err) {
        still(err, 'ai.createConversation')
        toast.error('Neue Unterhaltung konnte nicht angelegt werden.')
      }
    }
    setActiveConversationId(null)
    setActiveSection('chat')
  }

  const handleRenameConversation = async (conv: AiConversationSummary, newTitle: string) => {
    try {
      const updated = await aiApi.updateConversation(conv.id, { title: newTitle })
      setConversations((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
    } catch (err) {
      still(err, 'ai.renameConversation')
      toast.error('Unterhaltung konnte nicht umbenannt werden.')
    }
  }

  const handleTogglePinConversation = async (conv: AiConversationSummary) => {
    try {
      const updated = await aiApi.updateConversation(conv.id, { pinned: !conv.pinned })
      setConversations((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
    } catch (err) {
      still(err, 'ai.pinConversation')
      toast.error('Status konnte nicht gespeichert werden.')
    }
  }

  const handleDeleteConversation = async (conv: AiConversationSummary) => {
    const ok = await confirm({
      title: 'Unterhaltung löschen',
      message: `Möchtest du die Unterhaltung „${conv.title}“ wirklich löschen?`,
      confirmText: 'Löschen',
      danger: true,
    })
    if (!ok) return
    try {
      await aiApi.deleteConversation(conv.id)
      setConversations((prev) => prev.filter((c) => c.id !== conv.id))
      if (activeConversationId === conv.id) {
        setActiveConversationId(null)
      }
      toast.success('Unterhaltung gelöscht.')
    } catch (err) {
      still(err, 'ai.deleteConversation')
      toast.error('Unterhaltung konnte nicht gelöscht werden.')
    }
  }

  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{ projectId?: string }>
      if (custom.detail?.projectId) {
        setActiveProjectId(custom.detail.projectId)
        setActiveSection('projekte')
      }
    }
    const openConvHandler = (event: Event) => {
      const custom = event as CustomEvent<{ conversationId?: string }>
      const convId = custom.detail?.conversationId
      if (!convId) return
      if (convId === 'new') {
        void handleNewChat()
        return
      }
      handleSelectConversation(convId)
    }
    window.addEventListener('singra-open-project', handler)
    window.addEventListener('singra-open-conversation', openConvHandler)
    return () => {
      window.removeEventListener('singra-open-project', handler)
      window.removeEventListener('singra-open-conversation', openConvHandler)
    }
  }, [handleNewChat])

  useEffect(() => {
    if (!canSpeak) return
    let lebt = true
    aiApi
      .getVoiceConfig(providerId ?? undefined)
      .then((konfiguration) => {
        if (!lebt) return
        if (konfiguration.available) {
          setSprachkonfiguration(konfiguration)
          return
        }
        console.info(
          'Sprachmodus nicht verfuegbar: OpenAI Realtime oder der Legacy-Weg ' +
            'aus Transkriptionsmodell und ElevenLabs ist nicht vollständig eingerichtet.',
          konfiguration,
        )
      })
      .catch((fehler: unknown) => {
        console.error(
          'Sprachmodus: /api/ai/voice/config ist nicht abrufbar. Prüfe Backend, ' +
            'Datenbankmigration und Provider-Konfiguration.',
          fehler,
        )
      })
    return () => {
      lebt = false
    }
  }, [canSpeak, providerId])

  useEffect(() => {
    if (!canUseAutonomy || ansicht !== 'sprache') return
    let lebt = true
    api<ServerOption[]>('/servers')
      .then((liste) => {
        if (lebt) setServers(liste)
      })
      .catch(() => undefined)
    return () => {
      lebt = false
    }
  }, [ansicht, canUseAutonomy])

  if (!canChat) {
    return (
      <div className="msm-page">
        <div className="msm-card p-6 text-sm text-on-surface-variant">{t('ai.chat.noPermission')}</div>
      </div>
    )
  }

  const chatScope: AiChatScope =
    activeConversationId || activeProjectId
      ? {
          kind: 'primary',
          conversationId: activeConversationId ?? undefined,
          projectId: activeProjectId,
        }
      : PRIMARY_CHAT_SCOPE

  return (
    <div className="flex h-full w-full min-h-0 flex-1 flex-col overflow-hidden bg-surface">
      {ansicht !== 'text' && (
        <div className="flex shrink-0 items-center justify-between sm:justify-end gap-1.5 sm:gap-2 px-3 py-2 border-b border-outline-variant/30 bg-surface-container-low/40">
          <div className="flex items-center justify-between w-full sm:w-auto gap-2">
            <Umschalter
              aktiv={false}
              onClick={() => setzeAnsicht('text')}
              icon={<MessageSquare className="h-4 w-4" aria-hidden="true" />}
              label={t('ai.voice.toTextMode')}
            />
            {canUseAutonomy && ansicht === 'sprache' && <AiAutonomyButton servers={servers} />}
          </div>
        </div>
      )}

      {ansicht === 'sprache' && sprachkonfiguration ? (
        <SprachAnsicht
          konfiguration={sprachkonfiguration}
          aufChat={() => setzeAnsicht('text')}
          providerId={providerId}
        />
      ) : ansicht === 'guardian' ? (
        <GuardianAnsicht />
      ) : ansicht === 'aufgaben' ? (
        <AufgabenAnsicht />
      ) : ansicht === 'worker' && workerId ? (
        <WorkerAnsicht key={workerId} conversationId={workerId} />
      ) : (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <SingraSidebar
            activeSection={activeSection}
            onSelectSection={setActiveSection}
            conversations={conversations}
            activeConversationId={activeConversationId}
            onSelectConversation={handleSelectConversation}
            onNewChat={() => void handleNewChat()}
            onTogglePinConversation={(conv) => void handleTogglePinConversation(conv)}
            onDeleteConversation={(conv) => void handleDeleteConversation(conv)}
            mobileDrawerOpen={mobileMenuOpen}
            onCloseMobileDrawer={() => setMobileMenuOpen(false)}
          />

          <div className="flex min-w-0 min-h-0 flex-1 flex-col overflow-hidden">
            {activeSection !== 'chat' && (
              <div className="flex lg:hidden shrink-0 items-center justify-between border-b border-outline-variant/20 bg-surface-container-lowest/80 backdrop-blur-xl px-3 py-2">
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(true)}
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-colors"
                  aria-label="Singra Navigation öffnen"
                >
                  <Menu className="h-5 w-5" />
                </button>
                <span className="font-semibold text-sm text-on-surface capitalize">
                  {activeSection === 'projekte'
                    ? 'Projekte'
                    : activeSection === 'wissen'
                      ? 'Wissen'
                      : activeSection === 'tools'
                        ? 'Tools'
                        : activeSection === 'dateien'
                          ? 'KI-Speicher'
                          : activeSection === 'erinnerungen'
                            ? 'Erinnerungen'
                            : activeSection === 'verlauf'
                              ? 'Verlauf'
                              : activeSection}
                </span>
                <button
                  type="button"
                  onClick={() => setActiveSection('chat')}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline px-2.5 py-1 rounded-lg bg-primary/10 transition-colors"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  <span>Chat</span>
                </button>
              </div>
            )}

            {activeSection === 'projekte' ? (
              <SingraProjectsView
                initialProjectId={activeProjectId}
                onOpenProjectChat={(projectId, conversationId) => {
                  setActiveProjectId(projectId)
                  setActiveConversationId(conversationId ?? null)
                  const proj = projects.find((p) => p.id === projectId)
                  setActiveProjectName(proj?.name)
                  setActiveSection('chat')
                }}
              />
            ) : activeSection === 'wissen' ? (
              <SingraKnowledgeView />
            ) : activeSection === 'erinnerungen' ? (
              <SingraMemoryView />
            ) : activeSection === 'dateien' ? (
              <SingraFilesView
                activeConversationId={activeConversationId}
                onUseFileInChat={(att) => {
                  setPendingAttachmentToChat(att)
                  setActiveSection('chat')
                }}
              />
            ) : activeSection === 'tools' ? (
              <SingraToolsView
                appFaehigkeiten={appFaehigkeiten}
              />
            ) : activeSection === 'verlauf' ? (
              <SingraHistoryView
                conversations={conversations}
                activeConversationId={activeConversationId}
                projectMap={projectMap}
                onSelectConversation={handleSelectConversation}
                onNewChat={() => void handleNewChat()}
                onRenameConversation={handleRenameConversation}
                onTogglePinConversation={handleTogglePinConversation}
                onDeleteConversation={handleDeleteConversation}
              />
            ) : (
              <AiChat
                key={`${activeConversationId ?? 'primary'}-${activeProjectId ?? 'none'}`}
                scope={chatScope}
                onSwitchMode={setzeAnsicht}
                canTasks={canManageTasks}
                hasVoice={Boolean(sprachkonfiguration)}
                appFaehigkeiten={appFaehigkeiten}
                singraShell
                onOpenMobileMenu={() => setMobileMenuOpen(true)}
                onOpenHistorySearch={() => setActiveSection('verlauf')}
                activeProjectName={activeProjectName}
                voiceConfig={sprachkonfiguration}
                onNewChat={() => void handleNewChat()}
                onResolveConversationId={(resolvedId) => setActiveConversationId((prev) => prev ?? resolvedId)}
                initialAttachment={pendingAttachmentToChat}
                onConsumeInitialAttachment={() => setPendingAttachmentToChat(null)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
