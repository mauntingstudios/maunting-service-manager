import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, Check, HardDrive, MessageSquarePlus, Paperclip, Plug, Sparkles, Upload, X, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  aiApi,
  type AiActionProposal,
  type AiAttachment,
  type AiConversationDetail,
  type AiMessage,
  type AiProviderAvailable,
  type AiRunInfo,
  type AiSkillSummary,
  type AiVoiceConfig,
} from '@/api/ai'
import { api, SanitizedApiError } from '@/api/client'
import { Ablageflaeche, Button, Kurzinfo, Spinner, VoiceRecordingBar } from '@maunting/ui'
import { AiNachrichtenMenue, AiWeiterleitenDialog } from './AiNachrichtenMenue'
import { AiModellBlatt } from './AiModellBlatt'
import { AiChatComposerHinweise } from './AiChatComposerHinweise'
import { AiChatHeader } from './AiChatHeader'
import { AiChatModellPille } from './AiChatModellPille'
import { AiChatPlusMenue } from './AiChatPlusMenue'
import { AiChatSendeleiste } from './AiChatSendeleiste'
import { AiChatVerlaufListe } from './AiChatVerlaufListe'
import { aiChatPreferenceKeys } from '@/lib/aiChatPreferences'
import { browserWahlInsKontoUebernehmen } from '@/lib/aiProviderKonto'
import { ChatHintergrund, ChatHintergrundDialog } from '@/features/chatHintergrund'
import { useAuthStore } from '@/stores/authStore'
import { useAiGenerationStore } from '@/stores/aiGenerationStore'
import { confirm } from '@/stores/confirmStore'
import { toast } from '@/stores/toastStore'
import { AiSpeicherDrawer } from './anhaenge/AiSpeicherDrawer'
import { useAnhangUpload } from './anhaenge/useAnhangUpload'
import { AiSkillModal } from './AiSkillModal'
import { mergeEntries } from './AiVerlauf'
import { WorkerLeiste } from './WorkerLeiste'
import { WorkerSplitLayout } from './WorkerSplitLayout'
import { useAiLauf } from './useAiLauf'
import { useAiDiktat } from './useAiDiktat'
import { useAiGeoAnalyse } from './useAiGeoAnalyse'
import { useAiNachrichtenAktionen } from './useAiNachrichtenAktionen'
import { useAiProviderModell } from './useAiProviderModell'
import { useAiVerlaufScroll } from './useAiVerlaufScroll'
import { ActiveProcessesCard } from './geo/ActiveProcessesCard'
import { RegionalAnalysisLayout } from './geo/RegionalAnalysisLayout'
import { AI_ZUSTELLUNG_EVENT } from '@/lib/aiZustellung'
import { AI_ENTWURF_EVENT, entwurfNehmen } from '@/lib/aiEntwurf'
import { useHasPermission } from '@/hooks/useHasPermission'
import { SprachAnsicht } from './voice/SprachAnsicht'
import { SingraScenicBackground } from './singra/SingraEmptyState'
import { CameraSnapshotModal } from '@/components/social/CameraSnapshotModal'
import { chatScopeApi, PRIMARY_CHAT_SCOPE, type AiChatScope } from './chatScope'
import { still } from '@/lib/still'

interface ServerOption {
  id: number
  name: string
}

/** Wie oft das Tipp-Signal höchstens gesendet wird. */
const TIPP_TAKT_MS = 10_000

/** Wie oft der offene Chat nach Fremdem sieht (analog Guardian-Fenster). */
const NACHSEHEN_MS = 20_000

export interface AiChatProps {
  onSwitchMode?: (mode: 'sprache' | 'guardian' | 'aufgaben') => void
  canTasks?: boolean
  hasVoice?: boolean
  /** Primärchat (Default) oder ein Dokumentfenster. Der Primärchat bleibt unverändert. */
  scope?: AiChatScope
  eingebettet?: boolean
  showTasks?: boolean
  showGuardian?: boolean
  showWorkers?: boolean
  /** Aktiviert die ruhige Singra-Oberfläche mit Tageszeit-Kulisse, Starter-Karten und Inline-Sprachmodus. */
  singraShell?: boolean
  isSidebarCollapsed?: boolean
  onToggleSidebar?: () => void
  onOpenMobileMenu?: () => void
  onOpenHistorySearch?: () => void
  activeProjectName?: string | null
  voiceConfig?: AiVoiceConfig | null
  /** Meldet die Modellwahl nach aussen, damit der eingebettete Sprachmodus sie nutzt. */
  onProviderChange?: (providerId: number | null) => void
  /** Neuer Chat über Menü oder Slash-Befehl */
  onNewChat?: () => void
  /** Wird gefeuert, wenn die Unterhaltungs-ID vom Server aufgelöst wurde */
  onResolveConversationId?: (id: string) => void
  /** Datei sofort an den Chat binden (z. B. aus KI-Speicher) */
  initialAttachment?: AiAttachment | null
  onConsumeInitialAttachment?: () => void
  /** Beispielschlüssel für den leeren Chat; Standard bleibt der Serverchat. */
  beispielSchluessel?: readonly string[]
  /** Nur die App. Das Panel laesst das Feld weg. */
  appFaehigkeiten?: {
    computer_use?: boolean | null
    artifact_install?: boolean | null
  }
}

const SERVER_BEISPIELE = ['logs', 'network', 'mods'] as const

export function AiChat({
  onSwitchMode,
  canTasks = false,
  hasVoice = false,
  scope = PRIMARY_CHAT_SCOPE,
  eingebettet = false,
  showTasks = true,
  showGuardian = true,
  showWorkers = true,
  singraShell = false,
  isSidebarCollapsed = false,
  onToggleSidebar,
  onOpenMobileMenu,
  onOpenHistorySearch,
  activeProjectName,
  voiceConfig,
  onProviderChange,
  onNewChat,
  onResolveConversationId,
  initialAttachment,
  onConsumeInitialAttachment,
  beispielSchluessel = SERVER_BEISPIELE,
  appFaehigkeiten,
}: AiChatProps = {}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const canAttach = useHasPermission('ai.attachments.use')
  const canUseAutonomy = useHasPermission('ai.autonomous.use')
  const canUseMemory = useHasPermission('ai.memory.use')
  const canUseSkills = useHasPermission('ai.skills.use')
  const canUseVoice = useHasPermission('ai.voice.use')

  const currentUser = useAuthStore((state) => state.user)
  const userId = currentUser?.id ?? 'anonym'
  const merkSchluessel = useMemo(() => aiChatPreferenceKeys(userId), [userId])

  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const scopeIdentityKey =
    scope.kind === 'docs'
      ? `docs:${scope.documentUid}`
      : scope.isDraft
        ? `draft:${scope.projectId ?? 'global'}`
        : `primary:${scope.conversationId ?? ''}:${scope.projectId ?? ''}`
  const chatApi = useMemo(
    () => chatScopeApi(scopeRef.current, () => scopeRef.current.kind === 'docs' ? scopeRef.current.selection : undefined),
    [scopeIdentityKey],
  )
  const lastResolvedDraftIdRef = useRef<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const [skillsModalOpen, setSkillsModalOpen] = useState(false)
  const [hintergrundOffen, setzeHintergrundOffen] = useState(false)
  const [inlineVoiceActive, setInlineVoiceActive] = useState(false)
  const [currentConversationTitle, setCurrentConversationTitle] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<AiAttachment[]>([])
  const [servers, setServers] = useState<ServerOption[]>([])
  const [memoryNoticeDue, setMemoryNoticeDue] = useState(false)
  const [input, setInput] = useState('')
  const [editingMessage, setEditingMessage] = useState<AiMessage | null>(null)
  const [replyingTo, setReplyingTo] = useState<AiMessage | null>(null)
  const [actionMenuMessage, setActionMenuMessage] = useState<AiMessage | null>(null)
  const [forwardMessages, setForwardMessages] = useState<AiMessage[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [dragging, setDragging] = useState(false)
  const [laufBeimOeffnen, setLaufBeimOeffnen] = useState<AiRunInfo | null>(null)
  const [queuedMessages, setQueuedMessages] = useState<string[]>([])
  const [menueOffen, setMenueOffen] = useState(false)
  const [speicherOffen, setSpeicherOffen] = useState(false)
  const [kameraOffen, setKameraOffen] = useState(false)
  const [slashMenuAbgewiesen, setSlashMenuAbgewiesen] = useState(false)
  const [slashIndex, setSlashIndex] = useState(0)
  const [skills, setSkills] = useState<AiSkillSummary[]>([])
  const [reloading, setReloading] = useState(false)
  const [eingabeSchmal, setEingabeSchmal] = useState(false)
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null)

  const currentScopeConvId = scope.kind === 'primary' ? (scope.conversationId ?? null) : null
  const currentScopeProjectId = scope.kind === 'primary' ? (scope.projectId ?? null) : null
  useEffect(() => {
    setSelectedWorkerId(null)
  }, [currentScopeConvId, currentScopeProjectId])

  const dragDepthRef = useRef(0)
  const letztesTippSignalRef = useRef(0)
  const eingabeRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const eingabeKompakt = eingebettet || eingabeSchmal

  const {
    providerId,
    selectedModel,
    modelModalOpen,
    setModelModalOpen,
    modelSearchQuery,
    setModelSearchQuery,
    denken,
    contextStatus,
    setContextStatus,
    availableProviders,
    aktiverProvider,
    aktiverProviderMitModell,
    providerModelle,
    gefilterteModelle,
    syncGeladeneProviders,
    ladeKontext,
    waehleModell,
    waehleDenken,
    waehleProvider,
  } = useAiProviderModell({
    userId,
    hasUserId: Boolean(currentUser?.id),
    merkSchluessel,
    chatApi,
    mountedRef,
    onProviderChange,
  })

  const {
    entries,
    setEntries,
    streaming,
    laufendeWerkzeuge,
    runId,
    setRunId,
    merkeVorschlag,
    sendContent,
    haengeAn,
    stoppeLauf,
  } = useAiLauf({
    conversationId: scope.kind === 'primary' ? (scope.conversationId ?? null) : null,
    providerId,
    selectedModel,
    canAttach,
    denken,
    ladeKontext,
    setAttachments,
    appFaehigkeiten,
    onResolveConversationId: (newId) => {
      lastResolvedDraftIdRef.current = newId
      onResolveConversationId?.(newId)
    },
    api: chatApi,
  })

  const {
    geoData,
    geoOpen,
    setGeoOpen,
    newsFromSearch,
    verlaufEintraegeRef,
  } = useAiGeoAnalyse(entries, streaming, laufendeWerkzeuge)

  const {
    verlaufRef,
    bottomMarkerRef,
    messagesContainerRef,
    nachUntenMerken,
    resetNachLeeren,
    scrolleNachUnten,
    handleVerlaufScroll,
  } = useAiVerlaufScroll(loading, entries, geoOpen)

  const {
    dictationAvailable,
    dictating,
    transcribing,
    dictationQuota,
    dictationElapsed,
    dictationAudioLevel,
    diktatAbbrechen,
    diktatUmschalten,
  } = useAiDiktat({
    providerId,
    canUseVoice,
    input,
    setInput,
    inputRef,
    mountedRef,
  })

  const {
    starredIds,
    wahl,
    auswahlModus,
    gewaehlteNachrichten,
    handleToggleStar,
    handleCopyMessage,
    handleOpenMessageMenu,
    handleToggleSelectMessage,
    handleReplyToMessage,
    handleEditMessage,
    handleBulkCopy,
    handleBulkForward,
    handleBulkStar,
  } = useAiNachrichtenAktionen({
    entries,
    inputRef,
    setEditingMessage,
    setReplyingTo,
    setInput,
    setActionMenuMessage,
    setForwardMessages,
  })

  // Eingabefeld-Höhe synchronisieren
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    if (!input) {
      el.style.height = 'auto'
    } else {
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`
    }
  }, [input])

  useEffect(() => {
    const el = eingabeRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const beobachten = () => setEingabeSchmal(el.clientWidth < 760)
    beobachten()
    const beobachter = new ResizeObserver(beobachten)
    beobachter.observe(el)
    return () => beobachter.disconnect()
  }, [eingebettet])

  useEffect(() => {
    const handleCleared = () => {
      setEntries([])
      setContextStatus(null)
      setAttachments([])
    }
    window.addEventListener('msm:ai-chat-cleared', handleCleared)
    return () => {
      window.removeEventListener('msm:ai-chat-cleared', handleCleared)
    }
  }, [setContextStatus, setEntries])

  // Übergebener Entwurf oder ausgewähltes Vorschau-Element ins Eingabefeld
  useEffect(() => {
    const nehmen = () => {
      const text = entwurfNehmen()
      if (text) {
        setInput((bisher) => (bisher.trim() ? `${bisher}\n\n${text}` : text).slice(0, 16_000))
        requestAnimationFrame(() => inputRef.current?.focus())
      }
      try {
        const inspectPrompt = sessionStorage.getItem('singra-inspect-prompt')
        if (inspectPrompt) {
          sessionStorage.removeItem('singra-inspect-prompt')
          setInput((bisher) => (bisher.trim() ? `${bisher}\n\n${inspectPrompt}` : inspectPrompt).slice(0, 16_000))
          requestAnimationFrame(() => inputRef.current?.focus())
        }
      } catch (err) {
        still(err, 'ai.inspectPrompt')
      }
    }
    const handleInspectElement = (event: Event) => {
      const detail = (event as CustomEvent<{ selector?: string }>).detail
      try {
        const inspectPrompt = sessionStorage.getItem('singra-inspect-prompt')
        if (inspectPrompt) {
          sessionStorage.removeItem('singra-inspect-prompt')
          setInput((bisher) => (bisher.trim() ? `${bisher}\n\n${inspectPrompt}` : inspectPrompt).slice(0, 16_000))
          requestAnimationFrame(() => inputRef.current?.focus())
          return
        }
      } catch (err) {
        still(err, 'ai.inspectElement')
      }
      if (detail?.selector) {
        const fallback = `Bitte passe das Element \`${detail.selector}\` im aktuellen Projekt an: `
        setInput((bisher) => (bisher.trim() ? `${bisher}\n\n${fallback}` : fallback).slice(0, 16_000))
        requestAnimationFrame(() => inputRef.current?.focus())
      }
    }
    nehmen()
    window.addEventListener(AI_ENTWURF_EVENT, nehmen)
    window.addEventListener('singra-inspect-element', handleInspectElement)
    return () => {
      window.removeEventListener(AI_ENTWURF_EVENT, nehmen)
      window.removeEventListener('singra-inspect-element', handleInspectElement)
    }
  }, [scope])

  useEffect(() => {
    let active = true
    if (streaming) return
    if (
      lastResolvedDraftIdRef.current &&
      lastResolvedDraftIdRef.current === (scope.kind === 'primary' ? scope.conversationId : null)
    ) {
      return
    }
    Promise.all([
      aiApi.listProviders().catch((err) => {
        still(err, 'ai.listProviders')
        return [] as AiProviderAvailable[]
      }),
      chatApi.getConversation().catch((err) => {
        still(err, 'ai.getConversation')
        return {
          id: scope.kind === 'primary' ? (scope.conversationId ?? 'primary') : 'docs',
          kind: scope.kind,
          messages: [],
        } as unknown as AiConversationDetail
      }),
      chatApi.listActions().catch(() => [] as AiActionProposal[]),
      canAttach ? chatApi.listAttachments().catch(() => [] as AiAttachment[]) : Promise.resolve([] as AiAttachment[]),
      canUseAutonomy
        ? api<ServerOption[]>('/servers').catch(() => [] as ServerOption[])
        : Promise.resolve([] as ServerOption[]),
      canUseMemory
        ? aiApi.getMemoryPreference().catch(() => null)
        : Promise.resolve(null),
      chatApi.getActiveRun().catch(() => null),
    ])
      .then(([providerRows, conversation, actions, attachmentRows, serverRows, memoryPreference, aktiverLauf]) => {
        if (!active) return
        setLaufBeimOeffnen(aktiverLauf)
        setMemoryNoticeDue(Boolean(memoryPreference?.notice_due))
        if (providerRows && providerRows.length > 0) {
          syncGeladeneProviders(providerRows)
          void browserWahlInsKontoUebernehmen()
        }
        if (
          lastResolvedDraftIdRef.current &&
          lastResolvedDraftIdRef.current === (scope.kind === 'primary' ? scope.conversationId : null)
        ) {
          lastResolvedDraftIdRef.current = null
          return
        }
        if (conversation?.title && (!scope.kind || scope.kind !== 'primary' || !scope.isDraft)) {
          setCurrentConversationTitle(conversation.title)
        } else if (scope.kind === 'primary' && scope.isDraft) {
          setCurrentConversationTitle(null)
        }
        if (scope.kind === 'primary' && !scope.isDraft && !scope.conversationId && conversation?.id) {
          onResolveConversationId?.(conversation.id)
        }
        const geladen = mergeEntries(conversation?.messages ?? [], actions ?? [])
        verlaufEintraegeRef.current = geladen
        setEntries(geladen)
        setAttachments(attachmentRows ?? [])
        setServers((serverRows ?? []).map((row: ServerOption) => ({ id: row.id, name: row.name })))
        if (scope.kind === 'docs' && conversation?.id) {
          void chatApi
            .getActiveRun(conversation.id)
            .then((lauf) => {
              if (active) setLaufBeimOeffnen(lauf)
            })
            .catch(() => undefined)
        }
      })
      .catch((error: unknown) => {
        if (active) toast.error(error instanceof SanitizedApiError ? error.message : t('ai.chat.errors.load'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [canAttach, canUseAutonomy, canUseMemory, merkSchluessel.provider, t, chatApi, scope.kind, syncGeladeneProviders])

  useEffect(() => {
    if (!streaming && scope.kind === 'primary' && scope.conversationId) {
      lastResolvedDraftIdRef.current = null
      const cur = useAiGenerationStore.getState().generations[scope.conversationId]
      if (cur && cur.status === 'generating') {
        useAiGenerationStore.getState().finishGeneration(scope.conversationId, true)
      }
      window.dispatchEvent(new CustomEvent('singra-refresh-conversations'))
    }
  }, [streaming, scope])

  const meldeAnhangFehler = useCallback((text: string) => {
    toast.error(text)
  }, [])
  const {
    uploading,
    uploadFiles,
    remove: removeAttachment,
    vorschauen,
    clearPreviews,
  } = useAnhangUpload({
    aktiv: canAttach,
    gesperrt: streaming,
    setAttachments,
    onFehler: meldeAnhangFehler,
    uploadAttachment: chatApi.uploadAttachment,
    deleteAttachment: chatApi.deleteAttachment,
  })

  useEffect(() => {
    if (initialAttachment) {
      setAttachments((prev) => {
        if (prev.some((a) => a.id === initialAttachment.id)) return prev
        return [{ ...initialAttachment, message_id: null }, ...prev]
      })
      onConsumeInitialAttachment?.()
    }
  }, [initialAttachment, onConsumeInitialAttachment])

  useEffect(() => {
    if (typeof aiApi.listSkills === 'function') {
      aiApi
        .listSkills()
        .then((data) => {
          if (mountedRef.current) setSkills(data)
        })
        .catch(() => undefined)
    }
  }, [])

  const handleCameraCapture = useCallback((dataUrl: string) => {
    setKameraOffen(false)
    try {
      const parts = dataUrl.split(',')
      const mimeMatch = parts[0].match(/:(.*?);/)
      const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg'
      const binary = atob(parts[1])
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
      }
      const dateiname = `kamera_${Date.now()}.jpg`
      const file = new File([bytes], dateiname, { type: mime })
      void uploadFiles([file])
    } catch (err) {
      console.error('Kamerafoto konnte nicht verarbeitet werden:', err)
    }
  }, [uploadFiles])

  const handleStorageDelete = useCallback(async (anhang: AiAttachment, auchAusTresor: boolean) => {
    await removeAttachment(anhang)
    if (auchAusTresor) {
      try {
        const { useVaultStore } = await import('@/desktop/vault/vaultStore')
        const vaultStore = useVaultStore.getState()
        if (vaultStore.isUnlocked) {
          const vaultItem = vaultStore.items.find((i) => i.service === anhang.original_name)
          if (vaultItem) {
            await vaultStore.deleteItem(vaultItem.id)
          }
        }
      } catch (err) {
        still(err, 'ai.storage.deleteVault')
      }
    }
  }, [removeAttachment])

  const handleInsertIntoPrompt = useCallback((anhang: AiAttachment) => {
    setAttachments((prev) =>
      prev.some((a) => a.id === anhang.id)
        ? prev
        : [{ ...anhang, message_id: null }, ...prev],
    )
    setInput((prev) => (prev ? `${prev} [Datei: ${anhang.original_name}]` : `Beziehe dich bitte auf die Datei ${anhang.original_name}: `))
  }, [])

  const offeneAnhaenge = useMemo(
    () => attachments.filter((item) => item.message_id === null),
    [attachments],
  )

  const anhaengeJeNachricht = useMemo(() => {
    const karte = new Map<string, AiAttachment[]>()
    for (const item of attachments) {
      if (!item.message_id) continue
      const liste = karte.get(item.message_id)
      if (liste) liste.push(item)
      else karte.set(item.message_id, [item])
    }
    return karte
  }, [attachments])

  const clearHistory = useCallback(async () => {
    if (streaming) return
    const accepted = await confirm({
      title: t('ai.chat.clearTitle'),
      message: t('ai.chat.clearConfirm'),
      confirmText: t('ai.chat.clear'),
      danger: true,
    })
    if (!accepted) return
    try {
      await chatApi.clearHistory()
      resetNachLeeren()
      setEntries([])
      setAttachments([])
      clearPreviews()
      setContextStatus(null)
      window.dispatchEvent(new Event('msm:ai-chat-cleared'))
    } catch (error: unknown) {
      toast.error(error instanceof SanitizedApiError ? error.message : t('ai.chat.errors.delete'))
    }
  }, [chatApi, clearPreviews, resetNachLeeren, setContextStatus, setEntries, streaming, t])

  const slashBefehle = useMemo(() => {
    const aktionen = [
      {
        id: '/foto',
        label: '/foto',
        beschreibung: 'Foto mit Kamera aufnehmen und anfügen',
        icon: Camera,
        art: 'aktion' as const,
        ausfuehren: () => {
          setInput('')
          setKameraOffen(true)
        },
      },
      {
        id: '/speicher',
        label: '/speicher',
        beschreibung: 'KI-Speicher öffnen und Datei wählen',
        icon: HardDrive,
        art: 'aktion' as const,
        ausfuehren: () => {
          setInput('')
          setSpeicherOffen(true)
        },
      },
      {
        id: '/datei',
        label: '/datei',
        beschreibung: 'Datei von deinem Gerät hochladen',
        icon: Upload,
        art: 'aktion' as const,
        ausfuehren: () => {
          setInput('')
          fileInputRef.current?.click()
        },
      },
      {
        id: '/neu',
        label: '/neu',
        beschreibung: 'Neue frische Unterhaltung beginnen',
        icon: MessageSquarePlus,
        art: 'aktion' as const,
        ausfuehren: () => {
          setInput('')
          if (onNewChat) onNewChat()
          else void clearHistory()
        },
      },
      {
        id: '/tools',
        label: '/tools',
        beschreibung: 'MCP-Server, Integrationen & Werkzeuge öffnen',
        icon: Plug,
        art: 'aktion' as const,
        ausfuehren: () => {
          setInput('')
          navigate('/ai?bereich=tools')
        },
      },
      {
        id: '/mcp',
        label: '/mcp',
        beschreibung: 'MCP-Schnittstellen und Verbindungen verwalten',
        icon: Plug,
        art: 'aktion' as const,
        ausfuehren: () => {
          setInput('')
          navigate('/ai?bereich=tools')
        },
      },
    ]

    const skillBefehle = skills.map((s) => ({
      id: `/${s.skill_key}`,
      label: `/${s.skill_key}`,
      beschreibung: s.description || s.name,
      icon: Sparkles,
      art: 'skill' as const,
      ausfuehren: () => {
        setInput(`/${s.skill_key} `)
        requestAnimationFrame(() => inputRef.current?.focus())
      },
    }))

    return [...aktionen, ...skillBefehle]
  }, [skills, onNewChat, clearHistory, navigate])

  const zeigeSlashMenu =
    singraShell &&
    input.startsWith('/') &&
    !input.includes(' ') &&
    !slashMenuAbgewiesen

  const gefilterteSlashBefehle = useMemo(() => {
    if (!zeigeSlashMenu) return []
    const suchText = input.toLowerCase()
    return slashBefehle
      .filter(
        (b) =>
          b.id.toLowerCase().startsWith(suchText) ||
          b.beschreibung.toLowerCase().includes(suchText.slice(1)) ||
          b.label.toLowerCase().includes(suchText.slice(1)),
      )
      .slice(0, 7)
  }, [zeigeSlashMenu, input, slashBefehle])

  useEffect(() => {
    setSlashIndex(0)
  }, [gefilterteSlashBefehle.length])

  useEffect(() => {
    if (!streaming && queuedMessages.length > 0 && providerId) {
      const nextContent = queuedMessages[0]
      setQueuedMessages((q) => q.slice(1))
      void sendContent(nextContent)
    }
  }, [providerId, queuedMessages, sendContent, streaming])

  const autoAuftragGesendetRef = useRef(false)
  useEffect(() => {
    if (autoAuftragGesendetRef.current || loading || streaming || !providerId) return
    if (scope.kind !== 'primary' || !scope.projectId) return
    let auftrag: { projectId?: string; prompt?: string } | null = null
    try {
      const raw = sessionStorage.getItem('singra-auto-send-prompt')
      if (raw) auftrag = JSON.parse(raw) as { projectId?: string; prompt?: string }
    } catch (err) {
      still(err, 'ai.autoSendPrompt.read')
      return
    }
    if (!auftrag?.prompt || auftrag.projectId !== scope.projectId) return
    try {
      sessionStorage.removeItem('singra-auto-send-prompt')
    } catch (err) {
      still(err, 'ai.autoSendPrompt.remove')
    }
    autoAuftragGesendetRef.current = true
    window.dispatchEvent(new CustomEvent('msm:ai-message-sent'))
    nachUntenMerken()
    void sendContent(auftrag.prompt.slice(0, 16_000))
  }, [loading, nachUntenMerken, providerId, scope, sendContent, streaming])

  const enqueueMessage = useCallback((content: string) => {
    const text = content.trim()
    if (!text) return
    setQueuedMessages((q) => [...q, text])
    setInput('')
  }, [])

  const sendImmediatelyAndInterrupt = useCallback(async (content: string) => {
    const rawText = content.trim()
    const mitAnhaengen = offeneAnhaenge.length > 0
    if ((!rawText && !mitAnhaengen) || !providerId) return
    const text = replyingTo
      ? `> ${replyingTo.role === 'assistant' ? 'Singra' : 'Ich'}: ${replyingTo.content.trim().slice(0, 180).replace(/\n/g, ' ')}\n\n${rawText}`
      : rawText
    window.dispatchEvent(new CustomEvent('msm:ai-message-sent'))
    setInput('')
    setReplyingTo(null)
    nachUntenMerken()
    if (streaming) {
      await stoppeLauf()
    }
    await sendContent(text, mitAnhaengen)
  }, [nachUntenMerken, offeneAnhaenge.length, providerId, replyingTo, sendContent, stoppeLauf, streaming])

  const submitEdit = async (messageId: string, overrideText?: string) => {
    const content = (overrideText ?? input).trim()
    if (!content || !providerId || streaming) return
    try {
      await chatApi.editMessage(messageId, content)
    } catch (error: unknown) {
      toast.error(error instanceof SanitizedApiError ? error.message : t('ai.chat.errors.edit'))
      return
    }
    setEntries((current) => {
      const index = current.findIndex((item) => item.kind === 'message' && item.id === messageId)
      return index === -1 ? current : current.slice(0, index)
    })
    if (canAttach) {
      void aiApi.listAttachments()
        .then((rows) => { if (mountedRef.current) setAttachments(rows) })
        .catch(() => undefined)
    }
    setEditingMessage(null)
    setInput('')
    nachUntenMerken()
    await sendContent(content)
  }

  const send = async (event: React.FormEvent) => {
    event.preventDefault()
    if (uploading || !providerId) return
    if (editingMessage) {
      await submitEdit(editingMessage.id, input)
      return
    }
    const rawContent = input.trim()
    const mitAnhaengen = offeneAnhaenge.length > 0
    if (!rawContent && !mitAnhaengen) return
    const content = replyingTo
      ? `> ${replyingTo.role === 'assistant' ? 'Singra' : 'Ich'}: ${replyingTo.content.trim().slice(0, 180).replace(/\n/g, ' ')}\n\n${rawContent}`
      : rawContent
    window.dispatchEvent(new CustomEvent('msm:ai-message-sent'))
    if (streaming) {
      if (content) enqueueMessage(content)
      setReplyingTo(null)
      return
    }
    setInput('')
    setReplyingTo(null)
    nachUntenMerken()
    await sendContent(content, mitAnhaengen)
  }

  useEffect(() => {
    if (!laufBeimOeffnen) return
    setLaufBeimOeffnen(null)
    if (!laufBeimOeffnen.live) return
    setRunId(laufBeimOeffnen.id)
    void haengeAn(laufBeimOeffnen.id)
  }, [haengeAn, laufBeimOeffnen, setRunId])

  useEffect(() => {
    if (streaming) return
    let veraltet = false
    const nachladen = () => {
      void Promise.all([chatApi.getConversation(), chatApi.listActions()])
        .then(([conversation, actions]) => {
          if (veraltet || !mountedRef.current) return
          const geladen = mergeEntries(conversation.messages, actions)
          verlaufEintraegeRef.current = geladen
          setEntries(geladen)
        })
        .catch(() => undefined)
    }
    const takt = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') nachladen()
    }, NACHSEHEN_MS)
    const sichtbar = () => {
      if (document.visibilityState === 'visible') {
        nachladen()
        void ladeKontext()
      }
    }
    window.addEventListener(AI_ZUSTELLUNG_EVENT, nachladen)
    document.addEventListener('visibilitychange', sichtbar)
    return () => {
      veraltet = true
      window.clearInterval(takt)
      window.removeEventListener(AI_ZUSTELLUNG_EVENT, nachladen)
      document.removeEventListener('visibilitychange', sichtbar)
    }
  }, [chatApi, ladeKontext, setEntries, streaming, verlaufEintraegeRef])

  const manuellNachladen = useCallback(async () => {
    if (streaming || reloading) return
    setReloading(true)
    try {
      const [conversation, actions] = await Promise.all([
        chatApi.getConversation(),
        chatApi.listActions(),
        ladeKontext(),
      ])
      if (mountedRef.current && !streaming) {
        const geladen = mergeEntries(conversation.messages, actions)
        verlaufEintraegeRef.current = geladen
        setEntries(geladen)
      }
    } catch (err) {
      still(err, 'ai.chat.manualReload')
    } finally {
      if (mountedRef.current) {
        setReloading(false)
      }
    }
  }, [chatApi, streaming, reloading, ladeKontext, setEntries, verlaufEintraegeRef])

  const tippSignal = useCallback(() => {
    const jetzt = Date.now()
    window.dispatchEvent(new CustomEvent('msm:ai-user-typing'))
    if (jetzt - letztesTippSignalRef.current < TIPP_TAKT_MS) return
    letztesTippSignalRef.current = jetzt
    void chatApi.typing().catch(() => undefined)
  }, [chatApi])

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center" aria-label={t('common.loading')}>
        <Spinner size="lg" className="text-primary" />
      </div>
    )
  }

  const busy = streaming || uploading
  const empty = entries.length === 0

  return (
    <RegionalAnalysisLayout
      active={geoOpen}
      data={geoData}
      news={newsFromSearch}
      loading={streaming && laufendeWerkzeuge.some((w) => w.tool_name === 'analyze_region')}
      onClose={() => {
        nachUntenMerken()
        setGeoOpen(false)
        setTimeout(() => scrolleNachUnten(true), 50)
        setTimeout(() => scrolleNachUnten(true), 150)
        setTimeout(() => scrolleNachUnten(true), 350)
      }}
    >
      <WorkerSplitLayout
        workerId={geoOpen ? null : selectedWorkerId}
        onClose={() => setSelectedWorkerId(null)}
      >
      <section
        className={`relative flex min-h-0 flex-1 flex-col overflow-hidden ${eingebettet ? 'h-full' : ''}`}
        aria-label={t('ai.chat.title')}
        onDragEnter={(event) => {
          if (!canAttach || busy) return
          event.preventDefault()
          dragDepthRef.current += 1
          setDragging(true)
        }}
        onDragOver={(event) => { if (canAttach && !busy) event.preventDefault() }}
        onDragLeave={() => {
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
          if (dragDepthRef.current === 0) setDragging(false)
        }}
        onDrop={(event) => {
          if (!canAttach || busy) return
          event.preventDefault()
          dragDepthRef.current = 0
          setDragging(false)
          void uploadFiles(event.dataTransfer.files)
        }}
        onPaste={(event) => {
          const dateien = Array.from(event.clipboardData?.files ?? [])
          if (dateien.length === 0) {
            for (const eintrag of Array.from(event.clipboardData?.items ?? [])) {
              if (eintrag.kind !== 'file') continue
              const datei = eintrag.getAsFile()
              if (datei) dateien.push(datei)
            }
          }
          if (!canAttach || busy || dateien.length === 0) return
          event.preventDefault()
          void uploadFiles(dateien)
        }}
      >
        <ChatHintergrund bereich="ki" />
        {singraShell && empty && !inlineVoiceActive && (
          <SingraScenicBackground visible />
        )}

        <AiChatHeader
          singraShell={singraShell}
          eingebettet={eingebettet}
          isSidebarCollapsed={isSidebarCollapsed}
          onToggleSidebar={onToggleSidebar}
          onOpenMobileMenu={onOpenMobileMenu}
          activeProjectName={activeProjectName}
          currentConversationTitle={currentConversationTitle}
          availableProviders={availableProviders}
          providerId={providerId}
          onSelectProvider={waehleProvider}
          aktiverProviderMitModell={aktiverProviderMitModell}
          denken={denken}
          onSelectDenken={waehleDenken}
          busy={busy}
          streaming={streaming}
          reloading={reloading}
          empty={empty}
          canUseAutonomy={canUseAutonomy}
          servers={servers}
          scopeKind={scope.kind}
          canUseSkills={canUseSkills}
          onOpenSkills={() => setSkillsModalOpen(true)}
          showTasks={showTasks}
          canTasks={canTasks}
          showGuardian={showGuardian}
          onSwitchMode={onSwitchMode}
          onReload={() => void manuellNachladen()}
          onNewChat={onNewChat}
          menueOffen={menueOffen}
          setMenueOffen={setMenueOffen}
          onOpenHistorySearch={onOpenHistorySearch}
          onOpenGeo={() => setGeoOpen(true)}
          onOpenWallpaper={() => setzeHintergrundOffen(true)}
          onClearHistory={() => void clearHistory()}
          geoOpen={geoOpen}
          hasGeoData={!!geoData}
        />

        {showWorkers && (
          <WorkerLeiste
            singraShell={singraShell}
            projectId={scope.kind === 'primary' && scope.projectId ? scope.projectId : undefined}
            conversationId={
              scope.kind === 'primary' && !scope.projectId
                ? (scope.conversationId ?? null)
                : undefined
            }
            activeWorkerId={selectedWorkerId}
            onSelectWorker={(id) => {
              setGeoOpen(false)
              setSelectedWorkerId((prev) => (prev === id ? null : id))
            }}
          />
        )}

        {geoOpen && (
          <div className="relative hidden shrink-0 px-3 pt-2.5 lg:block">
            <ActiveProcessesCard />
          </div>
        )}

        {singraShell && inlineVoiceActive && voiceConfig ? (
          <div className="relative min-h-0 flex-1 overflow-hidden animate-fade-in">
            <SprachAnsicht
              konfiguration={voiceConfig}
              aufChat={() => setInlineVoiceActive(false)}
              providerId={providerId}
            />
          </div>
        ) : (
          <>
            <AiChatVerlaufListe
              entries={entries}
              empty={empty}
              singraShell={singraShell}
              userName={currentUser?.username}
              activeProjectName={activeProjectName}
              beispielSchluessel={beispielSchluessel}
              onSelectEmptyPrompt={(promptText) => {
                setInput(promptText)
                requestAnimationFrame(() => inputRef.current?.focus())
              }}
              auswahlModus={auswahlModus}
              gewaehlteNachrichten={gewaehlteNachrichten}
              selectedIds={wahl.auswahl}
              onBulkForward={handleBulkForward}
              onBulkCopy={handleBulkCopy}
              onBulkStar={handleBulkStar}
              onClearSelection={wahl.leeren}
              verlaufRef={verlaufRef}
              messagesContainerRef={messagesContainerRef}
              bottomMarkerRef={bottomMarkerRef}
              onScroll={handleVerlaufScroll}
              starredIds={starredIds}
              editingMessageId={editingMessage?.id}
              busy={busy}
              laufendeWerkzeuge={laufendeWerkzeuge}
              anhaengeJeNachricht={anhaengeJeNachricht}
              onProposalChange={(updated) => {
                merkeVorschlag(updated)
                const lauf = updated.run_id ?? runId
                if (lauf && updated.status !== 'proposed') {
                  void haengeAn(lauf)
                }
              }}
              onAnswer={sendContent}
              onOpenMessageMenu={handleOpenMessageMenu}
              onToggleSelectMessage={handleToggleSelectMessage}
            />

            <form
              className={`relative shrink-0 px-2.5 py-2 pb-[max(0.5rem,var(--msm-unten-sicher))] sm:px-4 sm:py-3 transition-colors ${
                singraShell
                  ? 'border-t-0 bg-transparent'
                  : 'border-t border-outline-variant/40 bg-surface/85 backdrop-blur-md'
              }`}
              onSubmit={send}
            >
              <div ref={eingabeRef} className="mx-auto w-full max-w-3xl xl:max-w-4xl">
                <AiChatComposerHinweise
                  memoryNoticeDue={memoryNoticeDue}
                  onMemoryNoticeAnswered={() => setMemoryNoticeDue(false)}
                  scopeKind={scope.kind}
                  anhaenge={offeneAnhaenge}
                  vorschauen={vorschauen}
                  onRemoveAttachment={(anhang) => void removeAttachment(anhang)}
                  busy={busy}
                  editingMessage={editingMessage}
                  onCancelEdit={() => setEditingMessage(null)}
                  onEditInputClear={() => setInput('')}
                  replyingTo={replyingTo}
                  onCancelReply={() => setReplyingTo(null)}
                  queuedMessages={queuedMessages}
                  setQueuedMessages={setQueuedMessages}
                  zeigeSlashMenu={zeigeSlashMenu}
                  gefilterteSlashBefehle={gefilterteSlashBefehle}
                  slashIndex={slashIndex}
                  setSlashIndex={setSlashIndex}
                />

                <div
                  className={
                    dictating
                      ? 'w-full rounded-2xl border border-outline-variant/50 bg-surface-container-low/50 p-2'
                      : singraShell
                        ? 'flex flex-col rounded-3xl border border-white/15 bg-black/55 backdrop-blur-xl p-2.5 sm:p-3 shadow-[0_14px_40px_rgba(0,0,0,0.45)] focus-within:border-primary/55 transition-colors'
                        : 'flex flex-col rounded-2xl border border-outline-variant/50 bg-surface-container-low/50 p-2 sm:p-2.5 focus-within:border-primary/50'
                  }
                >
                  {dictating ? (
                    <VoiceRecordingBar
                      durationSeconds={dictationElapsed}
                      statusLabel="Jetzt sprechen …"
                      variant="danger"
                      kompakt={eingabeKompakt}
                      className="w-full border-0 bg-transparent"
                      extraInfo={
                        <Kurzinfo
                          text={
                            dictationQuota?.monthly_limit_minutes != null
                              ? t('ai.chat.dictationMonthlyLimit', { min: dictationQuota.monthly_limit_minutes })
                              : t('ai.chat.dictationUnlimitedHint')
                          }
                          lage="oben"
                          aussen={eingabeKompakt ? 'inline-flex shrink-0' : 'hidden sm:inline-flex shrink-0'}
                        >
                          <div className="flex items-center gap-1 rounded-lg border border-outline-variant/40 bg-surface-container-low/60 px-2 py-0.5 text-xs text-on-surface-variant">
                            <span className="tabular-nums font-medium text-on-surface">
                              {dictationQuota?.monthly_limit_minutes != null
                                ? t('ai.chat.dictationRemaining', {
                                    min: Math.max(
                                      0,
                                      Math.ceil(
                                        ((dictationQuota.remaining_seconds ?? 0) - dictationElapsed) / 60,
                                      ),
                                    ),
                                  })
                                : t('ai.chat.dictationUnlimited')}
                            </span>
                          </div>
                        </Kurzinfo>
                      }
                      onCancel={diktatAbbrechen}
                      onConfirm={() => void diktatUmschalten()}
                      audioLevel={dictationAudioLevel}
                      cancelLabel={t(
                        eingabeKompakt ? 'ai.chat.dictationCancelShort' : 'ai.chat.dictationCancel',
                      )}
                      confirmLabel={t(
                        eingabeKompakt ? 'ai.chat.dictationStopShort' : 'ai.chat.dictationStop',
                      )}
                      cancelIcon={<X className="h-4 w-4" aria-hidden="true" />}
                      confirmIcon={<Check className="h-3.5 w-3.5" aria-hidden="true" />}
                    />
                  ) : (
                    <>
                      <textarea
                        ref={inputRef}
                        className={`max-h-40 min-h-9 w-full resize-none border-0 bg-transparent px-1 py-1 text-sm leading-6 focus:outline-none ${
                          singraShell
                            ? 'text-white placeholder:text-white/55'
                            : 'text-on-surface placeholder:text-on-surface-variant'
                        }`}
                        rows={1}
                        maxLength={16000}
                        value={input}
                        onChange={(event) => {
                          const val = event.target.value
                          setInput(val)
                          if (!val.startsWith('/')) {
                            setSlashMenuAbgewiesen(false)
                          }
                          if (val.trim()) tippSignal()
                          event.target.style.height = 'auto'
                          event.target.style.height = `${Math.min(event.target.scrollHeight, 160)}px`
                        }}
                        onKeyDown={(event) => {
                          if (zeigeSlashMenu && gefilterteSlashBefehle.length > 0) {
                            if (event.key === 'ArrowDown') {
                              event.preventDefault()
                              setSlashIndex((i) => (i + 1) % gefilterteSlashBefehle.length)
                              return
                            }
                            if (event.key === 'ArrowUp') {
                              event.preventDefault()
                              setSlashIndex(
                                (i) => (i - 1 + gefilterteSlashBefehle.length) % gefilterteSlashBefehle.length,
                              )
                              return
                            }
                            if (event.key === 'Enter' || event.key === 'Tab') {
                              event.preventDefault()
                              const befehl = gefilterteSlashBefehle[slashIndex]
                              if (befehl) befehl.ausfuehren()
                              return
                            }
                            if (event.key === 'Escape') {
                              event.preventDefault()
                              setSlashMenuAbgewiesen(true)
                              return
                            }
                          }

                          if (event.key === 'Escape' && (editingMessage || replyingTo)) {
                            event.preventDefault()
                            if (editingMessage) {
                              setEditingMessage(null)
                              setInput('')
                            } else {
                              setReplyingTo(null)
                            }
                            return
                          }

                          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                            event.preventDefault()
                            if (event.altKey && streaming) {
                              void sendImmediatelyAndInterrupt(input)
                            } else {
                              void send(event as unknown as React.FormEvent)
                            }
                          }
                        }}
                        placeholder={
                          streaming
                            ? 'Nachricht in Warteschlange einreihen oder mit Alt+Enter sofort senden…'
                            : singraShell
                              ? 'Schreib eine Nachricht …'
                              : t('ai.chat.placeholder')
                        }
                        disabled={uploading || availableProviders.length === 0}
                        aria-label={editingMessage ? t('ai.chat.edit', 'Nachricht bearbeiten') : t('ai.chat.message')}
                      />

                      <div className="flex items-center justify-between gap-1.5 pt-1.5 min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <AiChatPlusMenue
                            singraShell={singraShell}
                            canAttach={canAttach}
                            busy={busy}
                            uploading={uploading}
                            fileInputRef={fileInputRef}
                            uploadFiles={uploadFiles}
                            onKamera={() => setKameraOffen(true)}
                            onSpeicher={() => setSpeicherOffen(true)}
                            onTools={() => navigate('/ai?bereich=tools')}
                          />
                          {canAttach && !singraShell && (
                            <Kurzinfo text={t('ai.attachments.storageTitle')} lage="oben" seite="anfang" aussen="shrink-0">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 rounded-full text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                                aria-label={t('ai.attachments.storageTitle')}
                                onClick={() => setSpeicherOffen(true)}
                              >
                                <HardDrive className="h-3.5 w-3.5" aria-hidden="true" />
                              </Button>
                            </Kurzinfo>
                          )}

                          <AiChatModellPille
                            provider={aktiverProvider}
                            providerMitModell={aktiverProviderMitModell}
                            selectedModel={selectedModel}
                            denken={denken}
                            busy={busy}
                            singraShell={singraShell}
                            onOpen={() => setModelModalOpen(true)}
                          />
                        </div>

                        <AiChatSendeleiste
                          hasVoiceTarget={hasVoice && Boolean(onSwitchMode || voiceConfig)}
                          inlineVoiceActive={inlineVoiceActive}
                          onToggleVoice={() => {
                            if (singraShell && voiceConfig) {
                              setInlineVoiceActive((v) => !v)
                            } else if (onSwitchMode) {
                              onSwitchMode('sprache')
                            }
                          }}
                          singraShell={singraShell}
                          dictationAvailable={dictationAvailable}
                          transcribing={transcribing}
                          uploading={uploading}
                          hasProvider={Boolean(providerId)}
                          onToggleDictation={() => void diktatUmschalten()}
                          contextStatus={contextStatus}
                          streaming={streaming}
                          input={input}
                          hasAttachments={offeneAnhaenge.length > 0}
                          editingMessage={Boolean(editingMessage)}
                          onStop={() => void stoppeLauf()}
                          onEnqueue={(text) => enqueueMessage(text)}
                          onSendNowInterrupt={(text) => void sendImmediatelyAndInterrupt(text)}
                        />
                      </div>
                    </>
                  )}
                </div>

                {availableProviders.length === 0 && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-status-warning">
                    <Zap className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {t('ai.chat.noProvider')}
                  </p>
                )}
                <p className={`mt-2 text-center text-xs hidden sm:block ${singraShell && empty ? 'text-white/55' : 'text-on-surface-variant'}`}>
                  {t('ai.chat.privacyHint')}
                </p>
              </div>
            </form>
          </>
        )}
        {dragging && <Ablageflaeche icon={<Paperclip className="h-4 w-4" />} text={t('ai.attachments.drop')} />}
      </section>
      </WorkerSplitLayout>

      <AiSkillModal open={skillsModalOpen} onClose={() => setSkillsModalOpen(false)} />
      <ChatHintergrundDialog
        bereich="ki"
        offen={hintergrundOffen}
        onOffenChange={setzeHintergrundOffen}
      />
      <AiModellBlatt
        offen={modelModalOpen}
        onSchliessen={() => setModelModalOpen(false)}
        anbieter={availableProviders}
        anbieterId={providerId}
        waehleAnbieter={waehleProvider}
        modelle={providerModelle}
        gefilterteModelle={gefilterteModelle}
        suchbegriff={modelSearchQuery}
        onSuchbegriff={setModelSearchQuery}
        gewaehltesModell={selectedModel}
        aktiverAnbieter={aktiverProvider}
        waehleModell={waehleModell}
        aktiverMitModell={aktiverProviderMitModell}
        denken={denken}
        waehleDenken={waehleDenken}
      />
      <AiSpeicherDrawer
        offen={speicherOffen}
        onSchliessen={() => setSpeicherOffen(false)}
        anhaenge={attachments}
        onLoeschen={handleStorageDelete}
        onInPromptEinfuegen={handleInsertIntoPrompt}
        tresorSpiegelungAktiv={Boolean(localStorage.getItem('msm_vault_mirror_chat_attachments') === 'true')}
      />
      <CameraSnapshotModal
        open={kameraOffen}
        onOpenChange={setKameraOffen}
        onCapture={handleCameraCapture}
        titel="Foto für Singra aufnehmen"
        bestaetigen="Foto anfügen"
        nurKamera
      />
      <AiNachrichtenMenue
        message={actionMenuMessage}
        isStarred={Boolean(actionMenuMessage && starredIds.has(actionMenuMessage.id))}
        canEdit={Boolean(actionMenuMessage?.role === 'user' && !busy)}
        onClose={() => setActionMenuMessage(null)}
        onReply={handleReplyToMessage}
        onForward={(m) => setForwardMessages([m])}
        onCopy={handleCopyMessage}
        onToggleStar={handleToggleStar}
        onStartMultiSelect={(m) => wahl.umschalten(m.id)}
        onEdit={handleEditMessage}
      />
      <AiWeiterleitenDialog
        open={Boolean(forwardMessages && forwardMessages.length > 0)}
        messages={forwardMessages ?? []}
        onClose={() => setForwardMessages(null)}
        onNewChat={onNewChat}
      />
    </RegionalAnalysisLayout>
  )
}
