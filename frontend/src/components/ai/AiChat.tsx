import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AudioLines, CalendarClock, Camera, Check, Globe2, HardDrive, Image as ImageIcon, ListPlus, Loader2, Menu, MessageSquarePlus, Mic, Paperclip, Pencil, Plus, RotateCw, Search, Send, ShieldAlert, Sparkles, Square, Trash2, Upload, X, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  aiApi,
  type AiActionProposal,
  type AiAttachment,
  type AiContextStatus,
  type AiConversationDetail,
  type AiGeoCameraCommand,
  type AiProviderAvailable,
  type AiRegionalAnalysis,
  type AiRunInfo,
  type AiSkillSummary,
  type AiVoiceConfig,
} from '@/api/ai'
import { api, SanitizedApiError } from '@/api/client'
import { Ablageflaeche, Button, Dropdown, Blatteintrag, Blattknopf, Kurzinfo, VoiceRecordingBar } from '@maunting/ui'
import { Avatar } from '@/components/app/Avatar'
import {
  aiChatPreferenceKeys,
  readAiProviderChoice,
  readAiReasoningChoice,
  writeAiProviderChoice,
  writeAiReasoningChoice,
} from '@/lib/aiChatPreferences'
import { browserWahlInsKontoUebernehmen } from '@/lib/aiProviderKonto'
import { ChatHintergrund, ChatHintergrundDialog } from '@/features/chatHintergrund'
import { useAuthStore } from '@/stores/authStore'
import { confirm } from '@/stores/confirmStore'
import { toast } from '@/stores/toastStore'
import { AiActionProposalCard } from './AiActionProposalCard'
import { AiAnhangLeiste } from './anhaenge/AiAnhangLeiste'
import { AiAnhangListe } from './anhaenge/AiAnhangListe'
import { AiSpeicherDrawer } from './anhaenge/AiSpeicherDrawer'
import { useAnhangUpload } from './anhaenge/useAnhangUpload'
import { AiAutonomyButton } from './AiAutonomyButton'
import { AiContextMeter } from './AiContextMeter'
import { AiMemoryNotice } from './AiMemoryNotice'
import { AiSkillModal } from './AiSkillModal'
import { denkwahlFuer, ReasoningPicker } from './ReasoningPicker'
// Die Blase und ihre Bestandteile standen hier, solange es genau ein Fenster
// gab. Sie liegen jetzt in `AiVerlauf`, weil das Guardian-Fenster denselben
// Verlauf zeichnet — zwei Zeichner wären zwei Wahrheiten darüber, wie ein Zug
// der KI aussieht. Die Schleife hier bleibt: an ihr hängen Bearbeiten und
import { AiAntwortblase, formatMessageTime, KEINE_AUFRUFE, mergeEntries } from './AiVerlauf'
import { WorkerLeiste } from './WorkerLeiste'
import { useAiLauf, type Entry } from './useAiLauf'
import { ActiveProcessesCard } from './geo/ActiveProcessesCard'
import { RegionalAnalysisLayout } from './geo/RegionalAnalysisLayout'
import type { NewsItem } from './geo/RegionalInfoPanel'
import { applyGeoCameraCommand, normalizeGeoCameraCommand, normalizeRegionalAnalysis } from './geo/regionalAnalysis'
import { AI_ZUSTELLUNG_EVENT } from '@/lib/aiZustellung'
import { AI_ENTWURF_EVENT, entwurfNehmen } from '@/lib/aiEntwurf'
import { useHasPermission } from '@/hooks/useHasPermission'
import { starteAufnahme, type Aufnahme } from './voice/audioAufnahme'
import { SprachAnsicht } from './voice/SprachAnsicht'
import { SingraEmptyState, SingraScenicBackground } from './singra/SingraEmptyState'
import { CameraSnapshotModal } from '@/components/social/CameraSnapshotModal'
import { AI_IS_BETA } from './AiBetaBanner'
import { chatScopeApi, PRIMARY_CHAT_SCOPE, type AiChatScope } from './chatScope'

import { Spinner } from '@maunting/ui'
import { still } from '@/lib/still'
interface ServerOption {
  id: number
  name: string
}

/**
 * Der Dateidialog zeigt alles. Ob eine Datei lesbar ist, entscheidet der
 * Server an Inhalt und Endung — nicht der Browser anhand einer kurzen Liste,
 * die genau die Formate vergisst, die jemand gerade braucht.
 */
const ATTACHMENT_ACCEPT = '*/*'

/**
 * Wie oft das Tipp-Signal höchstens gesendet wird.
 *
 * Die Ruhe-Karenz der Meldestelle liegt bei 10–20 Sekunden
 * (docs/agentic-framework.md, §4) — ein Signal je zehn Sekunden hält sie
 * zuverlässig offen, ohne je Tastendruck einen Request zu erzeugen.
 * Übertragen wird nur der Zeitpunkt, nie der Text.
 */
const TIPP_TAKT_MS = 10_000

/**
 * Wie oft der offene Chat nach Fremdem sieht — Nachrichten aus einem zweiten
 * Tab, der Desktop-App oder einer Meldestellen-Lieferung. Derselbe Abstand
 * wie im Guardian-Fenster, aus demselben Grund: nachsehen, nicht streamen.
 */
const NACHSEHEN_MS = 20_000

/**
 * Die Denkwahl — dieselben zwei Felder, die auch auf der Leitung stehen und in
 * `ai_runs` landen: **ob** nachgedacht wird und **wie tief**.
 *
 * Zwei Felder statt eines, weil die Anbieter selbst zwei Dinge kennen: 145 der
 * 272 denkenden Modelle nennen ueberhaupt keine Stufen. `{an: true, stufe:
 * null}` heisst dort „denk nach, so wie du es fuer richtig haeltst" — mit einem
 * einzelnen Stufenfeld muesste man dafuer einen Wert erfinden.
 */
interface Denkwahl {
  an: boolean
  stufe: string | null
}



/**
 * Mit welchem Modell der Chat aufgeht: dem zuletzt gewaehlten, sonst dem
 * ersten benutzbaren.
 *
 * Die gemerkte Kennung wird nicht geglaubt, sondern gegen die Liste geprueft.
 * Zwischen zwei Besuchen kann der Provider geloescht, sein Schluessel entfernt
 * oder dem Benutzer die Rolle entzogen worden sein — dann steht er nicht mehr
 * als `available` in der Liste, und ein Verweis darauf ergaebe eine
 * Auswahlliste, deren angezeigter Wert in keiner ihrer Optionen vorkommt.
 *
 * Eine reine Funktion, damit sie sich ohne gerendertes Bauteil pruefen laesst.
 */
function providerBeimOeffnen(
  providers: AiProviderAvailable[],
  gemerkt: number | null,
): number | null {
  const benutzbar = providers.filter((item) => item.available)
  if (gemerkt !== null && benutzbar.some((item) => item.id === gemerkt)) return gemerkt
  return benutzbar[0]?.id ?? null
}

/**
 * Der KI-Assistent: **eine** Unterhaltung, die die Seite ausfuellt.
 *
 * Bewusst wie ein Messenger und nicht wie ein Verwaltungsformular. Es gibt
 * keinen Weg, einen zweiten Chat anzulegen — der Assistent ist ein
 * Gespraechspartner, keine Ablage. Alles Weitere (Provider, Denkschritte,
 * autonomer Modus, Skills) haengt als Schalter am Chat statt in eigenen
 * Kaesten daneben.
 */
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

let cachedProviders: AiProviderAvailable[] | null = null

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
  const canAttach = useHasPermission('ai.attachments.use')
  const canUseAutonomy = useHasPermission('ai.autonomous.use')
  const canUseMemory = useHasPermission('ai.memory.use')
  const canUseSkills = useHasPermission('ai.skills.use')
  const canUseVoice = useHasPermission('ai.voice.use')
  // Modell und Denkstufe merkt sich der Browser — je Benutzer, begruendet in
  // `aiChatPreferences`. Die Kennung kommt aus dem Auth-Store statt aus einer
  const currentUser = useAuthStore((state) => state.user)
  const userId = currentUser?.id ?? 'anonym'
  const merkSchluessel = useMemo(() => aiChatPreferenceKeys(userId), [userId])
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const scopeIdentityKey =
    scope.kind === 'docs'
      ? `docs:${scope.documentUid}`
      : `primary:${scope.conversationId ?? ''}:${scope.projectId ?? ''}`
  const chatApi = useMemo(
    () => chatScopeApi(scopeRef.current, () => scopeRef.current.kind === 'docs' ? scopeRef.current.selection : undefined),
    [scopeIdentityKey],
  )
  const [skillsModalOpen, setSkillsModalOpen] = useState(false)
  const [hintergrundOffen, setzeHintergrundOffen] = useState(false)
  const [providers, setProviders] = useState<AiProviderAvailable[]>(() => cachedProviders ?? [])
  const [providerId, setProviderId] = useState<number | null>(() => {
    const kontoWahl = useAuthStore.getState().user?.ai_provider_id ?? null
    return providerBeimOeffnen(
      cachedProviders ?? [],
      kontoWahl ?? (currentUser?.id ? readAiProviderChoice(merkSchluessel.provider) : null),
    )
  })
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [inlineVoiceActive, setInlineVoiceActive] = useState(false)
  useEffect(() => {
    onProviderChange?.(providerId)
  }, [onProviderChange, providerId])

  const [attachments, setAttachments] = useState<AiAttachment[]>([])
  const [servers, setServers] = useState<ServerOption[]>([])
  // Zwei Felder, genau wie auf der Leitung und in `ai_runs`: **ob** nachgedacht
  // wird und **wie tief**. Das ist keine Doppelung — 145 der 272 denkenden
  // Modelle kennen ueberhaupt keine Stufen, dort ist `stufe` zwangslaeufig
  // `null`, und ein einzelnes Feld muesste fuer sie einen Wert erfinden.
  // Welche Stufen es gibt, sagt der Provider aus dem Katalog; sie sind je
  // Modell verschieden und bereits auf die Rolle dieses Benutzers geklemmt.
  // Die Wahl ueberlebt das Neuladen: sie steht im localStorage unter der
  // Benutzerkennung. Der Anfangswert kommt deshalb aus einer Funktion — sonst
  // stuende beim ersten Bild „kein Nachdenken", und der Effekt darunter setzte
  // die gemerkte Stufe erst nach dem Laden der Provider nach.
  const [denken, setDenken] = useState<Denkwahl>(
    () => readAiReasoningChoice(merkSchluessel.reasoning) ?? { an: false, stufe: null },
  )
  // Ob der Einwilligungshinweis faellig ist. Die 24-Stunden-Regel entscheidet
  // das Backend — hier steht nur das Ergebnis.
  const [memoryNoticeDue, setMemoryNoticeDue] = useState(false)
  const [input, setInput] = useState('')
  const [dictationAvailable, setDictationAvailable] = useState(false)
  const [dictating, setDictating] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [dictationQuota, setDictationQuota] = useState<{
    monthly_limit_minutes: number | null
    used_seconds: number
    remaining_seconds: number | null
  } | null>(null)
  const [dictationElapsed, setDictationElapsed] = useState(0)
  const [dictationAudioLevel, setDictationAudioLevel] = useState(0)
  // Welche eigene Nachricht gerade umformuliert wird, und womit.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [dragging, setDragging] = useState(false)
  // Was beim Oeffnen schon lief. Wird in einem eigenen Effekt angehaengt, weil
  // das Anhaengen erst gehen kann, wenn die Verarbeitung steht.
  const [laufBeimOeffnen, setLaufBeimOeffnen] = useState<AiRunInfo | null>(null)
  // Wie voll der Kontext ist. `null` heisst „noch nicht geladen oder nicht
  // abrufbar“ — der Ring bleibt dann schlicht weg.
  const [contextStatus, setContextStatus] = useState<AiContextStatus | null>(null)
  // Steht der Verlauf unten? Nur dann wird nachgeschoben. Anfangs ja — ein
  // frisch geöffneter Chat zeigt die letzte Nachricht.
  const [amEnde, setAmEnde] = useState(true)
  // Warteschlange fuer Nachrichten, die waehrend des Streams eingegeben werden.
  const [queuedMessages, setQueuedMessages] = useState<string[]>([])
  // Regionale Analyse & Globus-Zustand
  const [geoData, setGeoData] = useState<AiRegionalAnalysis | null>(null)
  const [geoOpen, setGeoOpen] = useState(false)

  const verlaufRef = useRef<HTMLDivElement | null>(null)
  const mountedRef = useRef(true)
  const dragDepthRef = useRef(0)
  // Wann zuletzt „der Mensch tippt" gemeldet wurde — die Drossel des
  // Tipp-Signals. Ein Ref und kein State: der Wert soll nichts neu zeichnen.
  const letztesTippSignalRef = useRef(0)
  // Die tatsächliche Breite der Eingabezeile, nicht der Viewport: Ein 380px-
  // Dokumentpanel auf einem 1920px-Bildschirm erfüllt `sm:` trotzdem.
  const eingabeRef = useRef<HTMLDivElement | null>(null)
  const [eingabeSchmal, setEingabeSchmal] = useState(false)
  // Eingebettet ist immer schmal: Das Dokument-Panel ist hoechstens 720px
  // breit, auch wenn der Browser breit ist. Viewport-Breakpoints greifen dort
  // deshalb nicht.
  const eingabeKompakt = eingebettet || eingabeSchmal
  // Welches Modell **jetzt** gewählt ist. `ladeKontext` braucht das, um eine
  // Antwort zu erkennen, die zu einer älteren Wahl gehört. Zuweisung beim
  // Render, dasselbe Muster wie `autoscrollRef` in ServerConsolePanel.
  const providerRef = useRef<number | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const dictationRef = useRef<Aufnahme | null>(null)
  const dictationChunksRef = useRef<ArrayBuffer[]>([])
  const dictationSelectionRef = useRef<{ start: number; end: number } | null>(null)
  providerRef.current = providerId

  useEffect(() => {
    let active = true
    if (!providerId || !canUseVoice) {
      setDictationAvailable(false)
      setDictationQuota(null)
      return
    }
    aiApi.getVoiceConfig(providerId)
      .then((config) => {
        if (active) {
          setDictationAvailable(Boolean(config.dictation_available))
          setDictationQuota({
            monthly_limit_minutes: config.dictation_monthly_limit_minutes ?? null,
            used_seconds: config.dictation_used_seconds ?? 0,
            remaining_seconds: config.dictation_remaining_seconds ?? null,
          })
        }
      })
      .catch(() => {
        if (active) {
          setDictationAvailable(false)
          setDictationQuota(null)
        }
      })
    return () => { active = false }
  }, [providerId, canUseVoice])

  const diktatAbbrechen = useCallback(() => {
    if (dictationRef.current) {
      dictationRef.current.beenden()
      dictationRef.current = null
    }
    dictationChunksRef.current = []
    setDictating(false)
    setDictationElapsed(0)
  }, [])

  const diktatUmschalten = useCallback(async () => {
    if (!providerId || transcribing) return
    if (!dictationRef.current) {
      if (
        dictationQuota?.remaining_seconds !== null &&
        dictationQuota?.remaining_seconds !== undefined &&
        dictationQuota.remaining_seconds <= 0
      ) {
        toast.error(t('ai.chat.dictationQuotaExceeded'))
        return
      }
      const feld = inputRef.current
      const start = feld?.selectionStart ?? input.length
      const end = feld?.selectionEnd ?? start
      dictationSelectionRef.current = { start, end }
      dictationChunksRef.current = []
      try {
        dictationRef.current = await starteAufnahme((chunk) => dictationChunksRef.current.push(chunk))
        setDictating(true)
        setDictationElapsed(0)
      } catch {
        toast.error(t('ai.chat.dictationError'))
      }
      return
    }
    dictationRef.current.beenden()
    dictationRef.current = null
    setDictating(false)
    setDictationElapsed(0)
    const chunks = dictationChunksRef.current
    dictationChunksRef.current = []
    const bytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
    if (!bytes) return
    const pcm = new Uint8Array(bytes)
    let offset = 0
    for (const chunk of chunks) {
      pcm.set(new Uint8Array(chunk), offset)
      offset += chunk.byteLength
    }
    setTranscribing(true)
    try {
      const { text } = await aiApi.transcribeVoice(providerId, pcm.buffer)
      const sel = dictationSelectionRef.current
      dictationSelectionRef.current = null
      setInput((aktuelleEingabe) => {
        const start = sel?.start ?? (inputRef.current?.selectionStart ?? aktuelleEingabe.length)
        const end = sel?.end ?? (inputRef.current?.selectionEnd ?? start)
        const neu = `${aktuelleEingabe.slice(0, start)}${text}${aktuelleEingabe.slice(end)}`.slice(0, 16_000)
        requestAnimationFrame(() => {
          const cursor = Math.min(neu.length, start + text.length)
          inputRef.current?.setSelectionRange(cursor, cursor)
          inputRef.current?.focus()
        })
        return neu
      })
      // Restkontingent aktualisieren
      aiApi.getVoiceConfig(providerId).then((config) => {
        setDictationQuota({
          monthly_limit_minutes: config.dictation_monthly_limit_minutes ?? null,
          used_seconds: config.dictation_used_seconds ?? 0,
          remaining_seconds: config.dictation_remaining_seconds ?? null,
        })
      }).catch(() => {})
    } catch {
      toast.error(t('ai.chat.dictationError'))
    } finally {
      setTranscribing(false)
    }
  }, [dictationQuota, input, providerId, t, transcribing])

  useEffect(() => {
    if (!dictating) {
      setDictationElapsed(0)
      setDictationAudioLevel(0)
      return
    }
    const timer = setInterval(() => {
      setDictationElapsed((prev) => {
        const next = prev + 1
        if (
          dictationQuota?.remaining_seconds !== null &&
          dictationQuota?.remaining_seconds !== undefined &&
          next >= dictationQuota.remaining_seconds
        ) {
          void diktatUmschalten()
        }
        return next
      })
    }, 1000)

    let animId = 0
    let running = true
    const pollLevel = () => {
      if (!running) return
      if (dictationRef.current) {
        setDictationAudioLevel(dictationRef.current.pegel())
      }
      animId = requestAnimationFrame(pollLevel)
    }
    animId = requestAnimationFrame(pollLevel)

    return () => {
      clearInterval(timer)
      running = false
      cancelAnimationFrame(animId)
    }
  }, [dictating, dictationQuota, diktatUmschalten])

  useEffect(() => () => dictationRef.current?.beenden(), [])

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
    const handlePrefChange = () => {
      const savedProvider = readAiProviderChoice(merkSchluessel.provider)
      if (savedProvider !== null && savedProvider !== providerId) {
        setProviderId(savedProvider)
      }
      const savedReasoning = readAiReasoningChoice(merkSchluessel.reasoning)
      if (savedReasoning !== null) {
        setDenken(savedReasoning)
      }
    }
    const handleCleared = () => {
      setEntries([])
      setContextStatus(null)
      setAttachments([])
    }
    window.addEventListener('msm:ai-preference-changed', handlePrefChange)
    window.addEventListener('msm:ai-chat-cleared', handleCleared)
    return () => {
      window.removeEventListener('msm:ai-preference-changed', handlePrefChange)
      window.removeEventListener('msm:ai-chat-cleared', handleCleared)
    }
  }, [merkSchluessel, providerId])

  // Ein übergebener Entwurf (`lib/aiEntwurf.ts`) kommt ins Eingabefeld, nie direkt in den Chat.
  useEffect(() => {
    const nehmen = () => {
      const text = entwurfNehmen()
      if (!text) return
      setInput((bisher) => (bisher.trim() ? `${bisher}\n\n${text}` : text).slice(0, 16_000))
      requestAnimationFrame(() => inputRef.current?.focus())
    }
    nehmen()
    window.addEventListener(AI_ENTWURF_EVENT, nehmen)
    return () => window.removeEventListener(AI_ENTWURF_EVENT, nehmen)
  }, [])

  useEffect(() => {
    // StrictMode fuehrt Setup/Cleanup in Entwicklung absichtlich doppelt aus.
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    let active = true
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
      // Nur für den Autonomie-Knopf, und nur dort wird die Liste gebraucht.
      // Ohne das Recht holte jedes Öffnen der Seite alle sichtbaren Server
      // samt Bind-IP, Spiel-, Query- und RCON-Port in den Browser — für eine
      // Auswahlliste, die gar nicht gezeichnet wird.
      canUseAutonomy
        ? api<ServerOption[]>('/servers').catch(() => [] as ServerOption[])
        : Promise.resolve([] as ServerOption[]),
      // Scheitert der Abruf, wird der Hinweis nicht gezeigt statt den ganzen
      // Chat scheitern zu lassen — er ist wichtig, aber nicht so wichtig.
      canUseMemory
        ? aiApi.getMemoryPreference().catch(() => null)
        : Promise.resolve(null),
      // Laeuft da noch etwas von vorhin? Scheitert die Frage, wird eben nicht
      // angehaengt — der Verlauf steht ohnehin.
      chatApi.getActiveRun().catch(() => null),
    ])
      .then(([providerRows, conversation, actions, attachmentRows, serverRows, memoryPreference, aktiverLauf]) => {
        if (!active) return
        setLaufBeimOeffnen(aktiverLauf)
        setMemoryNoticeDue(Boolean(memoryPreference?.notice_due))
        if (providerRows && providerRows.length > 0) {
          cachedProviders = providerRows
          setProviders(providerRows)
          // Die Wahl am Konto schlägt die im Browser: sie ist die eine Quelle,
          // die auch Overlay und Desktop-App sehen. Der localStorage bleibt als
          // Rückfall für Konten, die noch nie hier gewählt haben. Bewusst
          // `getState()` statt Abo — die gespeicherte Wahl ändert sich beim
          // Wechseln unten, und ein Abo lüde dann den ganzen Chat neu.
          const kontoWahl = useAuthStore.getState().user?.ai_provider_id ?? null
          setProviderId(providerBeimOeffnen(
            providerRows,
            kontoWahl ?? readAiProviderChoice(merkSchluessel.provider),
          ))
          // Einmalige Übernahme: eine Browser-Wahl aus der Zeit vor dem
          // Konto-Feld wandert beim ersten Öffnen ans Konto. Ohne das spräche
          // das Overlay bis zum nächsten manuellen Modellwechsel weiter mit dem
          // erstbesten Zugang — und der kann beliebig langsam sein.
          void browserWahlInsKontoUebernehmen()
        }
        if (scope.kind === 'primary' && !scope.conversationId && conversation?.id) {
          onResolveConversationId?.(conversation.id)
        }
        // Vorschlaege werden chronologisch zwischen die Nachrichten einsortiert,
        // damit man sieht, auf welche Antwort sie sich beziehen. Vorher standen
        // sie gesammelt am Ende und wirkten losgeloest.
        const geladen = mergeEntries(conversation?.messages ?? [], actions ?? [])
        verlaufEintraegeRef.current = geladen
        setEntries(geladen)
        setAttachments(attachmentRows ?? [])
        setServers((serverRows ?? []).map((row: ServerOption) => ({ id: row.id, name: row.name })))
        if (scope.kind === 'docs' && conversation?.id) {
          // Beim Primaerchat steht der Lauf schon im Promise.all; im
          // Dokumentfenster braucht die Frage die Kennung dieses Fensters.
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
  }, [canAttach, canUseAutonomy, canUseMemory, merkSchluessel.provider, t, chatApi, scope.kind])



  /**
   * Die Zahlen hinter dem Ring — abhaengig vom **Modell**, nicht nur vom Chat.
   *
   * Deshalb neu geholt, sobald der Provider wechselt: dasselbe Gespraech fuellt
   * ein 128k-Fenster fast und ein 1M-Fenster kaum. Ohne das zeigte der Ring nach
   * einem Modellwechsel weiter den Fuellstand des alten.
   */
  const ladeKontext = useCallback(async () => {
    if (!providerId) {
      setContextStatus(null)
      return
    }
    try {
      const status = selectedModel
        ? await chatApi.getContextStatus(providerId, selectedModel)
        : await chatApi.getContextStatus(providerId)
      // Nur übernehmen, wenn die Wahl seither dieselbe geblieben ist. Zwei
      // Modellwechsel kurz hintereinander können sich überholen — die Auskunft
      // ist bei kaltem Modellkatalog ein externer Abruf. Der Ring zeigte dann
      // das Fenster des ersten Modells für das zweite an, und genau daran
      // liest der Benutzer ab, wann gefaltet wird.
      if (mountedRef.current && providerRef.current === providerId) setContextStatus(status)
    } catch {
      // Der Ring ist eine Zusatzauskunft. Faellt sie aus, verschwindet er —
      // ein Fehlertoast fuer eine Anzeige waere laestiger als die fehlende Zahl.
      if (mountedRef.current) setContextStatus(null)
    }
  }, [chatApi, providerId, selectedModel])

  useEffect(() => { void ladeKontext() }, [ladeKontext])

  /**
   * Der Lauf und sein Ereignisstrom — der Verlauf entsteht dort, nicht hier.
   *
   * Diese Komponente bleibt für das zuständig, was man sieht und bedient:
   * Modellwahl, Denktiefe, Anhänge, Bearbeiten, Zeichnen. Wie aus dreizehn
   * Ereignisarten ein Verlauf wird, steht in `useAiLauf` und lässt sich dort
   * ohne gerendertes Bauteil prüfen.
   */
  const {
    entries, setEntries, streaming, laufendeWerkzeuge, runId, setRunId,
    merkeVorschlag, sendContent, haengeAn, stoppeLauf,
  } = useAiLauf({
    conversationId: scope.kind === 'primary' ? (scope.conversationId ?? null) : null,
    providerId,
    selectedModel,
    canAttach,
    denken,
    ladeKontext,
    setAttachments,
    appFaehigkeiten,
    api: chatApi,
  })

  const meldeAnhangFehler = useCallback((text: string) => {
    toast.error(text)
  }, [])
  // Dateiauswahl, Drag-and-drop, Zwischenablage und Vorschau liegen in einem
  // eigenen Modul. Der Chat kennt nur noch `uploadFiles(files)`.
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

  const [speicherOffen, setSpeicherOffen] = useState(false)
  const [kameraOffen, setKameraOffen] = useState(false)
  const [plusMenuOffen, setPlusMenuOffen] = useState(false)
  const [slashMenuAbgewiesen, setSlashMenuAbgewiesen] = useState(false)
  const [slashIndex, setSlashIndex] = useState(0)
  const [skills, setSkills] = useState<AiSkillSummary[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

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
      } catch {
        // Vault-Löschung optional falls nicht initialisiert
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
  }, [setInput])

  const wasAnalyzingRegionRef = useRef(false)
  // Welcher Verlauf zuletzt **geladen** wurde (nicht: aus dem Strom kam). Ein
  // geladener Stand oeffnet die Karte nie — sonst stuende man beim Betreten
  // des Chats wieder im Globus, nur weil die letzte Sitzung dort endete.
  const verlaufEintraegeRef = useRef<Entry[] | null>(null)
  const letzteGeoKennungRef = useRef<string | null>(null)

  // Automatische Aktivierung des 3D-Globus, sobald in diesem Fenster eine
  // regionale Analyse laeuft. Der Verlauf allein oeffnet sie nicht: wer den
  // Chat betritt, soll den Chat sehen, auch wenn die letzte Sitzung eine
  // Kartenanalyse enthielt. Wer sie sehen will, oeffnet sie ueber das Menue.
  useEffect(() => {
    const isAnalyzing = laufendeWerkzeuge.some(
      (w) => w.tool_name === 'analyze_region' || w.tool_name === 'control_region_camera',
    )
    if (isAnalyzing && !wasAnalyzingRegionRef.current) {
      setGeoOpen(true)
    }
    wasAnalyzingRegionRef.current = isAnalyzing
  }, [laufendeWerkzeuge])

  // Haelt die Daten der Kartenansicht aktuell: die juengste Analyse und alle
  // nachfolgenden Kamerabefehle im Verlauf.
  //
  // Geoeffnet wird sie nur fuer etwas, das **waehrend eines Laufs in diesem
  // Fenster** dazukommt. Ein geladener Verlauf (Betreten des Chats, Nachladen
  // im Takt, Aktualisieren) wird still uebernommen. Der Mensch oeffnet eine
  // alte Analyse ueber das Menue.
  useEffect(() => {
    const ausVerlauf = verlaufEintraegeRef.current === entries
    let latestAnalysis: AiRegionalAnalysis | null = null
    let analyseKennung = ''
    let analysisMsgIdx = -1
    let analysisSecIdx = -1

    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i]
      if (entry.kind === 'message' && entry.message.sections) {
        for (let j = entry.message.sections.length - 1; j >= 0; j--) {
          const section = entry.message.sections[j]
          if (
            section.art === 'tool' &&
            section.werkzeug?.tool_name === 'analyze_region' &&
            section.werkzeug.geo_analysis
          ) {
            const geo = normalizeRegionalAnalysis(section.werkzeug.geo_analysis)
            if (geo) {
              latestAnalysis = geo
              analyseKennung = geo.camera?.command_id || `${entry.message.id}:${j}`
              analysisMsgIdx = i
              analysisSecIdx = j
              break
            }
          }
        }
        if (latestAnalysis) break
      }
    }

    if (!latestAnalysis) {
      // Ohne Analyse gibt es keine Karte — auch keine alte im Menue.
      letzteGeoKennungRef.current = null
      setGeoData(null)
      return
    }

    let combinedGeo = latestAnalysis
    let letzterKamerabefehl: AiGeoCameraCommand | null = null

    for (let i = Math.max(0, analysisMsgIdx); i < entries.length; i++) {
      const entry = entries[i]
      if (entry.kind === 'message' && entry.message.sections) {
        const startJ = i === analysisMsgIdx ? analysisSecIdx + 1 : 0
        for (let j = startJ; j < entry.message.sections.length; j++) {
          const section = entry.message.sections[j]
          if (
            section.art === 'tool' &&
            section.werkzeug?.tool_name === 'control_region_camera' &&
            section.werkzeug.geo_camera
          ) {
            const command = normalizeGeoCameraCommand(section.werkzeug.geo_camera)
            if (command) {
              combinedGeo = applyGeoCameraCommand(combinedGeo, command) ?? combinedGeo
              letzterKamerabefehl = command
            }
          }
        }
      }
    }

    const kennung = letzterKamerabefehl?.command_id || analyseKennung
    if (letzteGeoKennungRef.current !== kennung) {
      if (!ausVerlauf && streaming) {
        setGeoOpen(true)
      }
      letzteGeoKennungRef.current = kennung
    }
    setGeoData(combinedGeo)
  }, [entries, streaming])

  const newsFromSearch = useMemo<NewsItem[]>(() => {
    if (!geoData?.location) return []
    const curLoc = geoData.location.toLowerCase().split(',')[0].trim()

    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i]
      if (entry.kind === 'message' && entry.message.sections) {
        const hasMatchingAnalysis = entry.message.sections.some(
          (s) =>
            s.art === 'tool' &&
            s.werkzeug?.tool_name === 'analyze_region' &&
            s.werkzeug.geo_analysis?.location?.toLowerCase().includes(curLoc),
        )

        for (let j = entry.message.sections.length - 1; j >= 0; j--) {
          const section = entry.message.sections[j]
          if (
            section.art === 'tool' &&
            section.werkzeug?.tool_name === 'web_search' &&
            (section.werkzeug.web_results || section.werkzeug.ergebnis)
          ) {
            const rawResults =
              section.werkzeug.web_results ||
              (
                section.werkzeug.ergebnis as {
                  results?: Array<{
                    title?: string
                    url?: string
                    description?: string
                    snippet?: string
                  }>
                }
              )?.results

            if (Array.isArray(rawResults) && rawResults.length > 0) {
              const matchingResults = rawResults.filter((r) => {
                if (hasMatchingAnalysis) return true
                const text = `${r.title || ''} ${r.description || ''} ${r.snippet || ''}`.toLowerCase()
                return text.includes(curLoc)
              })

              if (matchingResults.length > 0) {
                return matchingResults.map((r, idx) => {
                  let domain = 'Websuche'
                  try {
                    if (r.url) domain = new URL(r.url).hostname.replace(/^www\./, '')
                  } catch {}
                  return {
                    id: `search-news-${idx}`,
                    title: r.title || 'Nachrichtenbericht',
                    source: domain,
                    timeAgo: 'Aktuell',
                    category: 'Websuche',
                    url: r.url,
                    snippet: r.description || r.snippet,
                  }
                })
              }
            }
          }
        }
      }
    }
    return []
  }, [entries, geoData?.location])

  const userScrolledUpRef = useRef(false)
  const bottomMarkerRef = useRef<HTMLDivElement | null>(null)
  const messagesContainerRef = useRef<HTMLDivElement | null>(null)

  const scrolleNachUnten = useCallback((force = false) => {
    if (!force && userScrolledUpRef.current) return
    const kasten = verlaufRef.current
    if (kasten) {
      kasten.scrollTop = kasten.scrollHeight
    }
    bottomMarkerRef.current?.scrollIntoView({ block: 'end' })
  }, [])

  const prevGeoOpenRef = useRef(geoOpen)
  useEffect(() => {
    if (prevGeoOpenRef.current !== geoOpen) {
      userScrolledUpRef.current = false
      setAmEnde(true)
      scrolleNachUnten(true)
      const t1 = setTimeout(() => scrolleNachUnten(true), 50)
      const t2 = setTimeout(() => scrolleNachUnten(true), 150)
      const t3 = setTimeout(() => scrolleNachUnten(true), 350)
      const t4 = setTimeout(() => scrolleNachUnten(true), 600)
      return () => {
        clearTimeout(t1)
        clearTimeout(t2)
        clearTimeout(t3)
        clearTimeout(t4)
      }
    }
    prevGeoOpenRef.current = geoOpen
  }, [geoOpen, scrolleNachUnten])

  // ResizeObserver: Sobald Markdown, Syntax-Highlighting, Tabellen oder Karten
  // im Nachrichten-Container gerendert werden und die Höhe wächst, bleiben wir unten.
  useEffect(() => {
    const el = messagesContainerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (!userScrolledUpRef.current) {
        scrolleNachUnten(false)
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [scrolleNachUnten])

  const initialScrollDoneRef = useRef(false)

  useLayoutEffect(() => {
    if (!loading && entries.length > 0 && !initialScrollDoneRef.current) {
      scrolleNachUnten(true)
    }
  }, [loading, entries.length, scrolleNachUnten])

  useEffect(() => {
    if (!loading && entries.length > 0 && !initialScrollDoneRef.current) {
      initialScrollDoneRef.current = true
      userScrolledUpRef.current = false
      setAmEnde(true)
      scrolleNachUnten(true)
      const timers = [
        setTimeout(() => scrolleNachUnten(true), 30),
        setTimeout(() => scrolleNachUnten(true), 100),
        setTimeout(() => scrolleNachUnten(true), 250),
        setTimeout(() => scrolleNachUnten(true), 500),
        setTimeout(() => scrolleNachUnten(true), 1000),
      ]
      return () => {
        timers.forEach(clearTimeout)
      }
    }
  }, [loading, entries.length, scrolleNachUnten])

  useEffect(() => {
    if (amEnde && !userScrolledUpRef.current) {
      scrolleNachUnten(false)
    }
  }, [amEnde, entries, scrolleNachUnten])

  const availableProviders = useMemo(
    () => providers.filter((provider) => provider.available),
    [providers],
  )

  const aktiverProvider = useMemo(
    () => availableProviders.find((provider) => provider.id === providerId) ?? null,
    [availableProviders, providerId],
  )

  useEffect(() => {
    if (!aktiverProvider) {
      setSelectedModel(null)
      return
    }
    setSelectedModel((prev) => {
      if (prev && aktiverProvider.models?.some((m) => m.model_id === prev)) return prev
      return aktiverProvider.default_model
    })
  }, [aktiverProvider])

  const aktiverProviderMitModell = useMemo(() => {
    if (!aktiverProvider) return null
    const modelEntry = aktiverProvider.models?.find((m) => m.model_id === (selectedModel || aktiverProvider.default_model))
    if (!modelEntry) return aktiverProvider
    return {
      ...aktiverProvider,
      default_model: modelEntry.model_id,
      reasoning: modelEntry.reasoning,
      efforts: modelEntry.efforts,
      can_disable: modelEntry.can_disable,
      default_effort: modelEntry.default_effort,
    }
  }, [aktiverProvider, selectedModel])

  // Beim Providerwechsel die Wahl auf etwas Gueltiges bringen. Warum das noetig
  // ist, steht bei `denkwahlFuer`.
  useEffect(() => {
    if (!aktiverProviderMitModell) return
    setDenken((jetzt) => denkwahlFuer(jetzt, aktiverProviderMitModell))
  }, [aktiverProviderMitModell])

  /**
   * Die Wahl merken — aber nur die **gewaehlte**, nicht die zurechtgebogene.
   *
   * Deshalb hier und nicht in einem Effekt auf `denken`: der Effekt darueber
   * senkt die Stufe beim Wechsel auf ein Modell, das sie nicht kennt. Schriebe
   * man auch das mit, waere „xhigh" nach einem kurzen Abstecher zu einem
   * kleineren Modell dauerhaft verloren, ohne dass jemand es angefasst hat.
   */
  const waehleDenken = useCallback((wahl: Denkwahl) => {
    setDenken(wahl)
    writeAiReasoningChoice(merkSchluessel.reasoning, wahl)
  }, [merkSchluessel.reasoning])

  /**
   * Das Modell merken. Auch hier nur die gewaehlte Kennung — was beim naechsten
   * Oeffnen daraus wird, entscheidet `providerBeimOeffnen` gegen die dann
   * gueltige Liste.
   *
   * Gemerkt wird am **Konto** (PATCH), nicht nur im Browser: Overlay und
   * Desktop-App kennen den localStorage dieses Fensters nicht und liefen sonst
   * stillschweigend auf einem anderen Modell als das Panel. Der localStorage
   * bleibt als Rueckfall, falls der Server die Wahl gerade nicht annimmt —
   * dann gilt sie wenigstens in diesem Fenster weiter.
   */
  const waehleProvider = useCallback((wert: string) => {
    const id = Number(wert)
    setProviderId(id)
    writeAiProviderChoice(merkSchluessel.provider, id)
    void api<{ ai_provider_id: number | null }>('/auth/me/ai-provider', {
      method: 'PATCH',
      body: JSON.stringify({ provider_id: id }),
    })
      .then((antwort) => useAuthStore.getState().updateUser({ ai_provider_id: antwort.ai_provider_id }))
      .catch(() => undefined)
  }, [merkSchluessel.provider])

  /** Hochgeladen, aber noch nicht abgeschickt — die Chips über dem Eingabefeld. */
  const offeneAnhaenge = useMemo(
    () => attachments.filter((item) => item.message_id === null),
    [attachments],
  )

  /** Anhänge nach der Nachricht, mit der sie gesendet wurden. */
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

  const clearHistory = async () => {
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
      initialScrollDoneRef.current = false
      userScrolledUpRef.current = false
      setEntries([])
      setAttachments([])
      clearPreviews()
      setContextStatus(null)
      window.dispatchEvent(new Event('msm:ai-chat-cleared'))
    } catch (error: unknown) {
      toast.error(error instanceof SanitizedApiError ? error.message : t('ai.chat.errors.delete'))
    }
  }

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
          if (onNewChat) {
            onNewChat()
          } else {
            void clearHistory()
          }
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
  }, [skills, onNewChat, clearHistory])

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

  // Abarbeiten der Warteschlange, sobald der vorherige Lauf beendet ist
  useEffect(() => {
    if (!streaming && queuedMessages.length > 0 && providerId) {
      const nextContent = queuedMessages[0]
      setQueuedMessages((q) => q.slice(1))
      void sendContent(nextContent)
    }
  }, [providerId, queuedMessages, sendContent, streaming])

  const enqueueMessage = useCallback((content: string) => {
    const text = content.trim()
    if (!text) return
    setQueuedMessages((q) => [...q, text])
    setInput('')
  }, [])

  const sendImmediatelyAndInterrupt = useCallback(async (content: string) => {
    const text = content.trim()
    const mitAnhaengen = offeneAnhaenge.length > 0
    if ((!text && !mitAnhaengen) || !providerId) return
    window.dispatchEvent(new CustomEvent('msm:ai-message-sent'))
    setInput('')
    userScrolledUpRef.current = false
    setAmEnde(true)
    scrolleNachUnten(true)
    if (streaming) {
      await stoppeLauf()
    }
    await sendContent(text, mitAnhaengen)
  }, [offeneAnhaenge.length, providerId, scrolleNachUnten, sendContent, stoppeLauf, streaming])

  const send = async (event: React.FormEvent) => {
    event.preventDefault()
    if (uploading || !providerId) return
    const content = input.trim()
    const mitAnhaengen = offeneAnhaenge.length > 0
    // Ein Bild ohne Begleittext ist eine vollstaendige Frage. Die bisherige
    // Sperre `!content` verhinderte genau das, was der Dateianhang anbietet.
    if (!content && !mitAnhaengen) return
    window.dispatchEvent(new CustomEvent('msm:ai-message-sent'))
    if (streaming) {
      if (content) enqueueMessage(content)
      return
    }
    setInput('')
    userScrolledUpRef.current = false
    setAmEnde(true)
    scrolleNachUnten(true)
    await sendContent(content, mitAnhaengen)
  }

  /**
   * Nimmt eine bereits gesendete eigene Nachricht zurück und stellt sie neu.
   *
   * Zwei Schritte, weil sie zwei verschiedene Dinge sind: der Schnitt räumt
   * den Verlauf ab dieser Nachricht auf — sie selbst eingeschlossen —, und
   * erst danach geht der neue Text den gewohnten Weg. Die KI sieht von der
   * alten Fassung nichts mehr; sie steht weder im Verlauf noch im Kontext.
   */
  const submitEdit = async (messageId: string) => {
    const content = editDraft.trim()
    if (!content || !providerId || streaming) return
    try {
      await chatApi.editMessage(messageId, content)
    } catch (error: unknown) {
      toast.error(error instanceof SanitizedApiError ? error.message : t('ai.chat.errors.edit'))
      return
    }
    // Erst wenn der Schnitt durch ist: sonst stünde die alte Fassung noch da,
    // während der Server sie schon nicht mehr kennt.
    setEntries((current) => {
      const index = current.findIndex((item) => item.kind === 'message' && item.id === messageId)
      return index === -1 ? current : current.slice(0, index)
    })
    // Der Server hat die Anhaenge der bearbeiteten Nachricht entbunden, nicht
    // geloescht. Einmal nachladen, damit sie als Chips wieder ueber dem
    // Eingabefeld stehen; `sendContent` bindet sie gleich an die neue Fassung.
    if (canAttach) {
      void aiApi.listAttachments()
        .then((rows) => { if (mountedRef.current) setAttachments(rows) })
        .catch(() => undefined)
    }
    setEditingId(null)
    setEditDraft('')
    userScrolledUpRef.current = false
    setAmEnde(true)
    scrolleNachUnten(true)
    await sendContent(content)
  }

  /**
   * Beim Oeffnen an einen laufenden Lauf anhaengen.
   *
   * Das ist die andere Haelfte von "der Lauf haengt an nichts": er arbeitet
   * weiter, waehrend man woanders ist — und wenn man zurueckkommt, sieht man
   * ihn wieder. Ohne das stuende hier eine abgebrochene Antwort.
   */
  useEffect(() => {
    if (!laufBeimOeffnen) return
    setLaufBeimOeffnen(null)
    if (!laufBeimOeffnen.live) return
    setRunId(laufBeimOeffnen.id)
    void haengeAn(laufBeimOeffnen.id)
  }, [haengeAn, laufBeimOeffnen, setRunId])

  /**
   * Fremdes nachladen — auf Zuruf **und** im Takt.
   *
   * Zuruf ist das Zustell-Ereignis der Glocke (Meldestellen-Lieferungen,
   * beobachtete Laufwechsel). Er allein hat nicht gereicht: die Glocke sieht
   * einen Lauf nur, wenn ihr Takt ihn trifft — wer im Chat stand, pollte dort
   * nur alle 60 Sekunden, und ein Lauf aus einem zweiten Tab oder der
   * Desktop-App begann und endete komplett zwischen zwei Blicken. Die
   * Nachricht stand dann in der Datenbank und nirgendwo auf dem Schirm, bis
   * jemand hart neu lud.
   *
   * Deshalb zusätzlich derselbe 20-Sekunden-Takt, den das Guardian-Fenster
   * seit jeher hat (`GuardianAnsicht.NACHSEHEN_MS`): nachsehen, nicht
   * streamen. Er ruht, solange das Fenster verdeckt ist — eine App im Tray
   * soll nicht alle 20 Sekunden das Panel wecken; beim Sichtbarwerden wird
   * einmal sofort nachgeladen.
   *
   * Nicht während eines Stroms: dann ist SSE die Wahrheit, und ein Nachladen
   * mittendrin ersetzte den halb gezeichneten Zug durch seinen alten Stand.
   * Das gilt auch für eine Antwort, die **unterwegs** ist, wenn der Strom
   * beginnt: `veraltet` entwertet sie beim Effekt-Wechsel, sonst überschriebe
   * sie die optimistischen Blasen, und die folgenden Deltas liefen ins Leere
   * (`useAiLauf.aendere` findet die ID dann nicht mehr und schweigt).
   */
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
      if (document.visibilityState === 'visible') nachladen()
    }
    window.addEventListener(AI_ZUSTELLUNG_EVENT, nachladen)
    document.addEventListener('visibilitychange', sichtbar)
    return () => {
      veraltet = true
      window.clearInterval(takt)
      window.removeEventListener(AI_ZUSTELLUNG_EVENT, nachladen)
      document.removeEventListener('visibilitychange', sichtbar)
    }
  }, [chatApi, setEntries, streaming])

  const [reloading, setReloading] = useState(false)
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
    } catch {
      // Fehler still abfangen
    } finally {
      if (mountedRef.current) {
        setReloading(false)
      }
    }
  }, [chatApi, streaming, reloading, ladeKontext, setEntries])

  /**
   * Das Tipp-Signal: gedrosselt, ohne Inhalt, ohne Fehlerbehandlung nach aussen.
   *
   * Die Meldestelle hält Worker-Meldungen zurück, solange der Mensch schreibt
   * (Ruhe-Regel). Was sie dafür braucht, ist genau ein Zeitstempel — der Text
   * verlässt den Browser nicht, nicht einmal seine Länge.
   */
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
        userScrolledUpRef.current = false
        setAmEnde(true)
        setGeoOpen(false)
        scrolleNachUnten(true)
        setTimeout(() => scrolleNachUnten(true), 50)
        setTimeout(() => scrolleNachUnten(true), 150)
        setTimeout(() => scrolleNachUnten(true), 350)
      }}
    >
      <section
        // `relative` trägt die Hintergrundschicht weiter unten; ohne das
        // spannte sie sich über den nächsten positionierten Vorfahren auf.
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
        // Zaehler statt Boolean: das Verlassen eines Kindelements feuert
        // ebenfalls `dragleave` und wuerde die Flaeche sonst flackern lassen.
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
        // Strg+V mit einem Bild oder einer Datei in der Zwischenablage.
        // Text bleibt Text: ohne Dateien wird nichts abgefangen. Nicht jeder
        // Browser fuellt `files`; die `items`-Liste ist der zweite Weg.
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
      {/* ── Der Hintergrund: atmosphärisches Landschaftsbild oder Chat-Hintergrund ── */}
      <ChatHintergrund bereich="ki" />
      {singraShell && empty && !inlineVoiceActive && (
        <SingraScenicBackground visible />
      )}

      {/* ── Kopfzeile: Provider, Denkschritte, Autonomie, Skills ─────────
          `sticky` ist eine Position und liegt damit von selbst über der
          Schicht; ihr undurchsichtiger Grund deckt sie dort ab. */}
      <header
        className={`flex items-center justify-between border-b px-2 py-1.5 sm:px-4 sm:py-2.5 shrink-0 sticky top-0 z-20 gap-1 min-w-0 transition-colors ${
          singraShell
            ? 'pt-[calc(var(--msm-oben-sicher,0px)+0.375rem)] sm:pt-2.5 border-white/10 bg-surface-container-lowest/75 backdrop-blur-xl'
            : 'border-outline-variant/30 bg-surface-container-low'
        } ${
          eingebettet ? 'flex-wrap gap-y-1' : ''
        }`}
      >
        <div
          className={`flex min-w-0 flex-1 items-center gap-1 sm:gap-1.5 py-0.5 ${
            eingebettet ? 'flex-wrap' : 'overflow-x-auto msm-ohne-rollbalken'
          }`}
        >
          {singraShell && onOpenMobileMenu && (
            <button
              type="button"
              onClick={onOpenMobileMenu}
              className="lg:hidden flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-colors"
              aria-label="Singra Navigation öffnen"
            >
              <Menu className="h-5 w-5" />
            </button>
          )}

          {/* Schrumpft im schmalen Browser-Panel, damit die Knöpfe daneben Platz haben. */}
          <div className="min-w-24 flex-1 max-w-52 sm:w-52 sm:flex-none shrink-0">
            <Dropdown
              value={providerId ? String(providerId) : null}
              onChange={waehleProvider}
              options={availableProviders.map((provider) => ({
                value: String(provider.id),
                label: provider.name,
                hint: provider.default_model,
              }))}
              placeholder={t('ai.chat.selectProvider')}
              disabled={busy}
              aria-label={t('ai.chat.selectProvider')}
            />
          </div>

          {aktiverProvider?.models && aktiverProvider.models.length > 1 && (
            <div className="min-w-28 max-w-48 sm:w-44 shrink-0">
              <Dropdown
                value={selectedModel ?? aktiverProvider.default_model}
                onChange={(val) => setSelectedModel(val)}
                options={aktiverProvider.models.map((m) => ({
                  value: m.model_id,
                  label: m.name || m.model_id,
                }))}
                placeholder="Modell"
                disabled={busy}
                aria-label="Modell auswählen"
              />
            </div>
          )}

          <div className="shrink-0">
            <ReasoningPicker
              provider={aktiverProviderMitModell}
              wahl={denken}
              onChange={waehleDenken}
              disabled={busy}
            />
          </div>

          {activeProjectName && (
            <span className="hidden md:inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary shrink-0">
              Projekt: {activeProjectName}
            </span>
          )}

          {!singraShell && canUseAutonomy && (
            <div className="shrink-0">
              <AiAutonomyButton
                servers={servers}
                disabled={busy}
                bereich={scope.kind === 'docs' ? 'docs' : 'panel'}
              />
            </div>
          )}

          {!singraShell && canUseSkills && (
            <Kurzinfo text={t('ai.skills.directoryTitle')} className="xl:!hidden" aussen="shrink-0">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSkillsModalOpen(true)}
                className="h-8 px-2 text-xs flex items-center gap-1.5 border border-outline-variant/30 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/60 rounded-lg transition-colors"
                aria-label={t('ai.skills.directoryTitle')}
              >
                <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden="true" />
                <span className="hidden xl:inline">{t('ai.skills.directoryTitle')}</span>
              </Button>
            </Kurzinfo>
          )}

          {!singraShell && ((showTasks && canTasks) || (showGuardian && onSwitchMode)) && (
            <div className="flex items-center rounded-lg border border-outline-variant/30 bg-surface-container/50 p-0.5 shrink-0">
              {showTasks && canTasks && onSwitchMode && (
                <Kurzinfo text={t('ai.tasks.toTasks')} className="xl:!hidden">
                  <button
                    type="button"
                    onClick={() => onSwitchMode('aufgaben')}
                    className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/60 transition-colors"
                    aria-label={t('ai.tasks.toTasks')}
                  >
                    <CalendarClock className="h-3.5 w-3.5 shrink-0 text-on-surface-variant" aria-hidden="true" />
                    <span className="hidden xl:inline">Aufgaben</span>
                  </button>
                </Kurzinfo>
              )}

              {showGuardian && onSwitchMode && (
                <Kurzinfo text={t('ai.guardian.toGuardianMode')} className="xl:!hidden">
                  <button
                    type="button"
                    onClick={() => onSwitchMode('guardian')}
                    className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/60 transition-colors"
                    aria-label={t('ai.guardian.toGuardianMode')}
                  >
                    <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-on-surface-variant" aria-hidden="true" />
                    <span className="hidden xl:inline">Guardian</span>
                  </button>
                </Kurzinfo>
              )}
            </div>
          )}

          {hasVoice && (onSwitchMode || voiceConfig) && (
            <Kurzinfo
              text={t('ai.voice.toVoiceMode')}
              className={eingebettet ? undefined : 'sm:!hidden'}
              aussen="shrink-0"
            >
              <button
                type="button"
                onClick={() => {
                  if (singraShell && voiceConfig) {
                    setInlineVoiceActive((v) => !v)
                  } else if (onSwitchMode) {
                    onSwitchMode('sprache')
                  }
                }}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  inlineVoiceActive
                    ? 'border-primary bg-primary text-on-primary shadow-sm'
                    : 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/20'
                }`}
                aria-label={t('ai.voice.toVoiceMode')}
              >
                <AudioLines className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="hidden sm:inline">{inlineVoiceActive ? 'Zum Text-Chat' : 'Realtime'}</span>
              </button>
            </Kurzinfo>
          )}
        </div>

        {/* Feststehende Aktionen rechts: Suche, Neuladen und Blattmenü bleiben immer sichtbar */}
        <div className="flex items-center gap-1 shrink-0 ml-1">
          {singraShell && onOpenHistorySearch && (
            <Kurzinfo text="Unterhaltungen durchsuchen">
              <button
                type="button"
                onClick={onOpenHistorySearch}
                className="flex h-8 w-8 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10 shrink-0 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-colors"
                aria-label="Unterhaltungen durchsuchen"
              >
                <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
              </button>
            </Kurzinfo>
          )}

          <Kurzinfo text={t('common.refresh', 'Aktualisieren')}>
            <button
              type="button"
              onClick={() => void manuellNachladen()}
              disabled={busy || streaming}
              className="flex h-8 w-8 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 shrink-0 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface disabled:opacity-40 transition-colors"
              aria-label={t('common.refresh', 'Aktualisieren')}
            >
              <RotateCw className={`h-4 w-4 shrink-0 ${reloading ? 'animate-spin' : ''}`} aria-hidden="true" />
            </button>
          </Kurzinfo>

          <Blattknopf label={t('ai.chat.moreSettings')} titel={t('ai.chat.title')}>
            {(schliessen) => (
              <>
                <Blatteintrag
                  icon={<RotateCw className="h-4 w-4" aria-hidden="true" />}
                  label={t('common.refresh', 'Aktualisieren')}
                  disabled={busy || streaming}
                  onClick={() => {
                    schliessen()
                    void manuellNachladen()
                  }}
                />
                {geoData && !geoOpen && (
                  <Blatteintrag
                    icon={<Globe2 className="h-4 w-4" aria-hidden="true" />}
                    label={t('ai.geo.open')}
                    onClick={() => {
                      schliessen()
                      setGeoOpen(true)
                    }}
                  />
                )}
                <Blatteintrag
                  icon={<ImageIcon className="h-4 w-4" aria-hidden="true" />}
                  label={t('social.wallpaper.title')}
                  onClick={() => {
                    schliessen()
                    setzeHintergrundOffen(true)
                  }}
                />
                <Blatteintrag
                  icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                  label={t('ai.chat.clear')}
                  gefahr
                  disabled={busy || empty}
                  onClick={() => {
                    schliessen()
                    void clearHistory()
                  }}
                />
              </>
            )}
          </Blattknopf>
        </div>
      </header>

      {/* ── Die Worker-Leiste: lebende Hintergrund-Aufträge, einsehbar ── */}
      {showWorkers && !singraShell && <WorkerLeiste />}

      {/* ── Aktive Prozesse im 3-Spalten-Kommandozentrum ── */}
      {geoOpen && (
        <div className="relative hidden shrink-0 px-3 pt-2.5 lg:block">
          <ActiveProcessesCard />
        </div>
      )}

      {/* ── Singra Inline-Sprachmodus: nahtloser Übergang in derselben Bühne ── */}
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
          {/* ── Verlauf ───────────────────────────────────────────────────── */}
          <div
            ref={verlaufRef}
            // Ohne eigenen Grund: hier scheint der Chat-Hintergrund durch.
            className="relative min-h-0 flex-1 overflow-y-auto"
            aria-live="polite"
            onScroll={(event) => {
              const { scrollTop, scrollHeight, clientHeight } = event.currentTarget
              const isAtBottom = scrollHeight - scrollTop - clientHeight < 60
              setAmEnde(isAtBottom)
              if (isAtBottom) {
                userScrolledUpRef.current = false
              } else if (scrollHeight - scrollTop - clientHeight > 120) {
                userScrolledUpRef.current = true
              }
            }}
          >

            <div
              ref={messagesContainerRef}
              className="mx-auto w-full max-w-4xl xl:max-w-5xl 2xl:max-w-6xl px-3 py-6 sm:px-6"
            >
              {empty && (
                singraShell ? (
                  <SingraEmptyState
                    userName={currentUser?.username}
                    activeProjectName={activeProjectName}
                    onSelectPrompt={(promptText) => {
                      setInput(promptText)
                      requestAnimationFrame(() => inputRef.current?.focus())
                    }}
                  />
                ) : (
                  <div className="py-16 text-center">
                    <Sparkles className="mx-auto h-10 w-10 text-primary/70" aria-hidden="true" />
                    <div className="mt-4 flex items-center justify-center gap-2">
                      <h2 className="font-headline text-xl font-semibold text-on-surface">
                        {t('ai.chat.emptyTitle')}
                      </h2>
                      {AI_IS_BETA && (
                        <span className="px-1.5 py-0.5 rounded bg-status-warning/15 text-status-warning border border-status-warning/30 text-label-sm font-bold uppercase tracking-wider">
                          {t('ai.betaBadge', 'Beta')}
                        </span>
                      )}
                    </div>
                    <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-on-surface-variant">
                      {t('ai.chat.emptyDescription')}
                    </p>
                    <ul className="mx-auto mt-6 grid max-w-lg gap-2 text-left">
                      {beispielSchluessel.map((key) => (
                        <li key={key}>
                          <button
                            type="button"
                            className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low/40 px-4 py-3 text-sm text-on-surface-variant transition-colors hover:border-primary/40 hover:text-on-surface"
                            onClick={() => setInput(t(`ai.chat.examples.${key}`))}
                          >
                            {t(`ai.chat.examples.${key}`)}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              )}

              <div className="space-y-4">
                {entries.map((entry, index) => {
                  if (entry.kind === 'compacted') {
                    return (
                      <div key={entry.id} className="flex items-center gap-3 py-2">
                        <span className="h-px flex-1 bg-outline-variant/40" />
                        <span className="text-xs text-on-surface-variant">{t('ai.chat.compacted')}</span>
                        <span className="h-px flex-1 bg-outline-variant/40" />
                      </div>
                    )
                  }
                  if (entry.kind === 'proposal') {
                    return (
                      <AiActionProposalCard
                        key={entry.id}
                        proposal={entry.proposal}
                        onChange={(updated) => {
                          merkeVorschlag(updated)
                          // **Hier ging es frueher nicht weiter.** Die Aktion lief,
                          // und der Chat blieb stumm — man musste eine neue
                          // Nachricht schreiben, damit die KI ueberhaupt erfuhr,
                          // wie ihr eigener Vorschlag ausgegangen ist.
                          const lauf = updated.run_id ?? runId
                          if (lauf && updated.status !== 'proposed') {
                            void haengeAn(lauf)
                          }
                        }}
                      />
                    )
                  }

                  const { message } = entry
                  if (message.role === 'user') {
                    const isEditing = editingId === message.id
                    return (
                      <article key={entry.id} className="group flex justify-end gap-3">
                        {isEditing ? (
                          <div className="w-full max-w-[85%] space-y-2">
                            <textarea
                              className="msm-input min-h-[4.5rem] w-full text-sm"
                              value={editDraft}
                              maxLength={16_000}
                              autoFocus
                              disabled={busy}
                              onChange={(event) => setEditDraft(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Escape') { setEditingId(null); setEditDraft('') }
                                if (event.key === 'Enter' && !event.shiftKey) {
                                  event.preventDefault()
                                  void submitEdit(message.id)
                                }
                              }}
                              aria-label={t('ai.chat.edit')}
                            />
                            {/* Der Hinweis gehoert hierher, nicht in eine Rueckfrage
                                danach: wer bearbeitet, soll vorher wissen, dass der
                                Verlauf ab hier verschwindet. */}
                            <p className="text-xs text-on-surface-variant">{t('ai.chat.editHint')}</p>
                            <div className="flex justify-end gap-2">
                              <Button
                                type="button" size="sm" variant="secondary" disabled={busy}
                                onClick={() => { setEditingId(null); setEditDraft('') }}
                              >
                                <X className="h-4 w-4" aria-hidden="true" />
                                {t('common.cancel')}
                              </Button>
                              <Button
                                type="button" size="sm"
                                disabled={busy || !editDraft.trim()}
                                onClick={() => void submitEdit(message.id)}
                              >
                                <Check className="h-4 w-4" aria-hidden="true" />
                                {t('ai.chat.editSend')}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => { setEditingId(message.id); setEditDraft(message.content) }}
                              className="mt-1 self-start rounded-lg p-1.5 text-on-surface-variant opacity-0 transition-opacity hover:text-on-surface focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-0"
                              aria-label={t('ai.chat.edit')}
                            >
                              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                            <div className="flex max-w-[85%] flex-col items-end rounded-2xl rounded-tr-sm border border-primary/35 bg-surface-container-high/95 text-on-surface px-4 py-3 shadow-md backdrop-blur-xl">
                              {message.content && (
                                <p className="w-full whitespace-pre-wrap break-words text-base sm:text-sm leading-relaxed sm:leading-6 text-on-surface">
                                  {message.content}
                                </p>
                              )}
                              {/* Die Anhaenge stehen **in** der Nachricht, mit der
                                  sie gesendet wurden. Vorher hingen sie nur an der
                                  Unterhaltung: nach einem Neuladen war nicht mehr
                                  erkennbar, zu welcher Frage sie gehoerten. */}
                              <AiAnhangListe
                                anhaenge={anhaengeJeNachricht.get(message.id) ?? []}
                              />
                              {message.created_at && (
                                <span className="mt-1 text-label-sm text-on-surface-variant/70">
                                  {formatMessageTime(message.created_at)}
                                </span>
                              )}
                            </div>
                          </>
                        )}
                        <Avatar
                          src={currentUser?.avatar_url}
                          name={currentUser?.username}
                          size="xs"
                          className="mt-1 shrink-0"
                        />
                      </article>
                    )
                  }

                  return (
                    <AiAntwortblase
                      key={entry.id}
                      message={message}
                      // Beantwortet ist eine Rückfrage, sobald irgendein späterer
                      // Eintrag existiert: dann hat der Benutzer geschrieben, ob
                      // per Knopf oder frei getippt. Damit überlebt der Zustand
                      // auch ein Neuladen der Seite, ohne dass er irgendwo
                      // gespeichert werden müsste.
                      beantwortet={index < entries.length - 1}
                      busy={busy}
                      // Nur die noch schreibende Blase bekommt den Plan. Alle
                      // anderen bekommen immer dieselbe leere Liste — sonst
                      // entwertete eine je Runde neue Eigenschaft den `memo`
                      // Vergleich für den ganzen Verlauf.
                      laufendeWerkzeuge={
                        message.status === 'streaming' ? laufendeWerkzeuge : KEINE_AUFRUFE
                      }
                      onAnswer={sendContent}
                    />
                  )
                })}
              </div>
              <div ref={bottomMarkerRef} className="h-0 w-0 pointer-events-none" aria-hidden="true" />
            </div>
          </div>

          {/* ── Eingabe ───────────────────────────────────────────────────── */}
          <form
            className={`relative shrink-0 px-2.5 py-2 sm:px-4 sm:py-3 transition-colors ${
              singraShell
                ? empty
                  ? 'bg-gradient-to-t from-black/80 via-black/45 to-transparent border-t-0'
                  : 'border-t border-white/10 bg-black/45 backdrop-blur-xl'
                : 'border-t border-outline-variant/40 bg-surface/85 backdrop-blur-md'
            }`}
            onSubmit={send}
          >
            {/* Der Hinweis steht ueber dem Eingabefeld, nicht in einer
                Einstellungsseite: er soll dort auftauchen, wo die Entscheidung
                Folgen hat — bevor jemand etwas Persoenliches tippt. */}
            {memoryNoticeDue && scope.kind !== 'docs' && (
              <AiMemoryNotice onAnswered={() => setMemoryNoticeDue(false)} />
            )}
            <div ref={eingabeRef} className="mx-auto w-full max-w-3xl xl:max-w-4xl">
              {/* Nur Ungesendetes: alles Uebrige steht in seiner Nachricht. Vorher
                  blieb jeder Anhang hier stehen und ging bei jeder Folgefrage
                  erneut an den Anbieter. */}
              <AiAnhangLeiste
                anhaenge={offeneAnhaenge}
                vorschauen={vorschauen}
                onRemove={(anhang) => void removeAttachment(anhang)}
                disabled={busy}
              />

              {queuedMessages.length > 0 && (
                <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-outline-variant/30 bg-surface-container-high/60 px-2.5 py-1.5 text-xs text-on-surface-variant">
                  <span className="flex items-center gap-1 font-medium text-on-surface">
                    <ListPlus className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                    Warteschlange ({queuedMessages.length}):
                  </span>
                  {queuedMessages.map((msg, idx) => (
                    <Kurzinfo key={idx} text={msg} aussen="max-w-[220px]">
                      <span className="inline-flex max-w-[220px] items-center gap-1 rounded bg-surface-container-highest px-2 py-0.5 text-on-surface border border-outline-variant/40">
                        <span className="truncate">{msg}</span>
                        <button
                          type="button"
                          className="text-on-surface-variant hover:text-status-destructive transition-colors"
                          onClick={() => setQueuedMessages((q) => q.filter((_, i) => i !== idx))}
                          aria-label="Aus Warteschlange entfernen"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    </Kurzinfo>
                  ))}
                  {queuedMessages.length > 1 && (
                    <button
                      type="button"
                      className="ml-auto text-label-sm text-on-surface-variant hover:text-status-destructive underline transition-colors"
                      onClick={() => setQueuedMessages([])}
                    >
                      Alle leeren
                    </button>
                  )}
                </div>
              )}

              {/* Autovervollständigung für Slash-Befehle und Skills */}
              {zeigeSlashMenu && gefilterteSlashBefehle.length > 0 && (
                <div
                  role="listbox"
                  aria-label="Verfügbare Befehle und Skills"
                  className="mb-2 max-h-64 overflow-y-auto rounded-2xl border border-outline-variant/40 bg-surface-container-high/95 p-2 shadow-2xl backdrop-blur-xl animate-fade-in"
                >
                  <div className="px-2.5 py-1 text-label-sm font-semibold uppercase tracking-wider text-white/50">
                    Befehle & Skills ({gefilterteSlashBefehle.length})
                  </div>
                  <div className="space-y-1 mt-1">
                    {gefilterteSlashBefehle.map((befehl, idx) => {
                      const aktiv = idx === slashIndex
                      const Icon = befehl.icon
                      return (
                        <button
                          key={befehl.id}
                          type="button"
                          role="option"
                          aria-selected={aktiv}
                          className={[
                            'flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-xs transition-colors',
                            aktiv
                              ? 'bg-primary/25 border border-primary/45 text-white'
                              : 'text-white/85 hover:bg-white/10 hover:text-white border border-transparent',
                          ].join(' ')}
                          onMouseEnter={() => setSlashIndex(idx)}
                          onClick={() => befehl.ausfuehren()}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div
                              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                                aktiv ? 'bg-primary/30 text-primary' : 'bg-white/10 text-white/70'
                              }`}
                            >
                              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                            </div>
                            <div className="min-w-0">
                              <span className="font-semibold text-white">{befehl.label}</span>
                              <span className="ml-2 truncate text-white/60">{befehl.beschreibung}</span>
                            </div>
                          </div>
                          <span className="text-label-sm text-white/40 shrink-0 font-mono">
                            {befehl.art === 'skill' ? 'Skill' : 'Aktion'}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              <div
                className={
                  dictating
                    ? 'w-full rounded-2xl border border-outline-variant/50 bg-surface-container-low/50 p-2'
                    : singraShell
                      ? 'flex items-end gap-2 rounded-3xl border border-white/15 bg-black/55 backdrop-blur-xl px-2.5 py-2 shadow-[0_14px_40px_rgba(0,0,0,0.45)] focus-within:border-primary/55 transition-colors'
                      : 'flex items-end gap-2 rounded-2xl border border-outline-variant/50 bg-surface-container-low/50 p-2 focus-within:border-primary/50'
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
                    {canAttach && (
                      singraShell ? (
                        <div className="relative shrink-0">
                          <Kurzinfo text="Aktionen & Anhänge" lage="oben" seite="anfang">
                            <button
                              type="button"
                              onClick={() => setPlusMenuOffen((v) => !v)}
                              className={`grid h-9 w-9 place-items-center rounded-full transition-colors border border-white/15 bg-white/5 text-white/80 hover:bg-white/15 hover:text-white ${
                                busy ? 'pointer-events-none opacity-50' : 'cursor-pointer'
                              }`}
                              aria-label="Aktionen und Anhänge"
                              aria-expanded={plusMenuOffen}
                            >
                              {uploading ? (
                                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                              ) : (
                                <Plus
                                  className={`h-4 w-4 transition-transform duration-200 ${
                                    plusMenuOffen ? 'rotate-45' : ''
                                  }`}
                                  aria-hidden="true"
                                />
                              )}
                            </button>
                          </Kurzinfo>

                          {plusMenuOffen && (
                            <>
                              <div
                                className="fixed inset-0 z-40"
                                onClick={() => setPlusMenuOffen(false)}
                                aria-hidden="true"
                              />
                              <div
                                role="menu"
                                className="absolute bottom-12 left-0 z-50 w-56 rounded-2xl border border-outline-variant/40 bg-surface-container-high/95 p-1.5 shadow-2xl backdrop-blur-xl animate-fade-in text-on-surface text-xs"
                              >
                                <button
                                  type="button"
                                  role="menuitem"
                                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-white/90 hover:bg-white/10 hover:text-white transition-colors"
                                  onClick={() => {
                                    setPlusMenuOffen(false)
                                    fileInputRef.current?.click()
                                  }}
                                >
                                  <Upload className="h-4 w-4 text-primary" aria-hidden="true" />
                                  <span className="font-medium">Datei hochladen</span>
                                </button>

                                <button
                                  type="button"
                                  role="menuitem"
                                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-white/90 hover:bg-white/10 hover:text-white transition-colors"
                                  onClick={() => {
                                    setPlusMenuOffen(false)
                                    setKameraOffen(true)
                                  }}
                                >
                                  <Camera className="h-4 w-4 text-primary" aria-hidden="true" />
                                  <span className="font-medium">Foto aufnehmen</span>
                                </button>

                                <button
                                  type="button"
                                  role="menuitem"
                                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-white/90 hover:bg-white/10 hover:text-white transition-colors"
                                  onClick={() => {
                                    setPlusMenuOffen(false)
                                    setSpeicherOffen(true)
                                  }}
                                >
                                  <HardDrive className="h-4 w-4 text-primary" aria-hidden="true" />
                                  <span className="font-medium">Aus KI-Speicher wählen</span>
                                </button>
                              </div>
                            </>
                          )}

                          <input
                            ref={fileInputRef}
                            type="file"
                            className="sr-only"
                            disabled={busy}
                            accept={ATTACHMENT_ACCEPT}
                            multiple
                            aria-label={t('ai.attachments.add')}
                            onChange={(event) => {
                              void uploadFiles(event.target.files)
                              event.target.value = ''
                            }}
                          />
                        </div>
                      ) : (
                        <Kurzinfo text={t('ai.attachments.add')} lage="oben" seite="anfang" aussen="shrink-0">
                          <label
                            className={`grid h-9 w-9 place-items-center rounded-full transition-colors text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface ${
                              busy ? 'pointer-events-none opacity-50' : 'cursor-pointer'
                            }`}
                          >
                            {uploading ? (
                              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            ) : (
                              <Paperclip className="h-4 w-4" aria-hidden="true" />
                            )}
                            <input
                              type="file"
                              className="sr-only"
                              disabled={busy}
                              accept={ATTACHMENT_ACCEPT}
                              multiple
                              aria-label={t('ai.attachments.add')}
                              onChange={(event) => {
                                void uploadFiles(event.target.files)
                                event.target.value = ''
                              }}
                            />
                          </label>
                        </Kurzinfo>
                      )
                    )}
                    {canAttach && !singraShell && (
                      <Kurzinfo text={t('ai.attachments.storageTitle')} lage="oben" seite="anfang" aussen="shrink-0">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 rounded-full text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                          aria-label={t('ai.attachments.storageTitle')}
                          onClick={() => setSpeicherOffen(true)}
                        >
                          <HardDrive className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </Kurzinfo>
                    )}
                    <textarea
                      ref={inputRef}
                      className={`max-h-40 min-h-9 flex-1 resize-none border-0 bg-transparent py-1.5 text-sm leading-6 focus:outline-none ${
                        singraShell
                          ? 'text-white placeholder:text-white/55 px-1'
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
                            if (befehl) {
                              befehl.ausfuehren()
                            }
                            return
                          }
                          if (event.key === 'Escape') {
                            event.preventDefault()
                            setSlashMenuAbgewiesen(true)
                            return
                          }
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
                      aria-label={t('ai.chat.message')}
                    />
                    {dictationAvailable && (
                      <Kurzinfo text={t('ai.chat.dictationStart')} lage="oben" aussen="shrink-0">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className={`h-9 w-9 rounded-full p-0 ${
                            singraShell ? 'text-white/75 hover:bg-white/10 hover:text-white' : ''
                          }`}
                          disabled={transcribing || uploading || !providerId}
                          onClick={() => void diktatUmschalten()}
                          aria-label={t('ai.chat.dictationStart')}
                        >
                          {transcribing
                            ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            : <Mic className="h-4 w-4" aria-hidden="true" />}
                        </Button>
                      </Kurzinfo>
                    )}
                  </>
                )}
                {!dictating && (
                  <>
                    {/* Direkt neben dem Absenden, weil dort die Entscheidung faellt:
                        wer sieht, dass der Kontext gleich zusammengefasst wird, formuliert
                        die naechste Frage anders. In einer Einstellungsseite haette
                        dieselbe Zahl niemanden erreicht. */}
                    <AiContextMeter status={contextStatus} />
                    {streaming ? (
                  !input.trim() ? (
                    <Kurzinfo text={t('ai.chat.stopRun')} lage="oben" seite="ende" aussen="shrink-0">
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        className="h-9 w-9 rounded-full p-0 flex items-center justify-center bg-status-destructive/15 text-status-destructive hover:bg-status-destructive/25 border border-status-destructive/30 transition-colors"
                        onClick={() => void stoppeLauf()}
                        aria-label={t('ai.chat.stopRun')}
                      >
                        <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                      </Button>
                    </Kurzinfo>
                  ) : (
                    <div className="flex items-center gap-1 shrink-0">
                      <Kurzinfo text={`${t('ai.chat.enqueue')} (Enter)`} lage="oben" aussen="shrink-0">
                        <Button
                          type="button"
                          size="sm"
                          className="h-9 rounded-full px-2.5 text-xs flex items-center gap-1"
                          onClick={() => enqueueMessage(input)}
                          aria-label={t('ai.chat.enqueue')}
                          aria-keyshortcuts="Enter"
                        >
                          <ListPlus className="h-3.5 w-3.5" aria-hidden="true" />
                          <span className="hidden sm:inline">Einreihen</span>
                        </Button>
                      </Kurzinfo>
                      <Kurzinfo text={`${t('ai.chat.sendNowInterrupt')} (Alt+Enter)`} lage="oben" seite="ende" aussen="shrink-0">
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          className="h-9 w-9 rounded-full p-0 flex items-center justify-center bg-status-destructive/15 text-status-destructive hover:bg-status-destructive/25 border border-status-destructive/30"
                          onClick={() => void sendImmediatelyAndInterrupt(input)}
                          aria-label={t('ai.chat.sendNowInterrupt')}
                          aria-keyshortcuts="Alt+Enter"
                        >
                          <Zap className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </Kurzinfo>
                    </div>
                  )
                ) : (
                  <Button
                    type="submit"
                    size="sm"
                    className={`h-9 w-9 shrink-0 rounded-full p-0 ${
                      singraShell ? 'bg-primary text-on-primary shadow-md hover:brightness-110' : ''
                    }`}
                    disabled={
                      uploading
                      || (!input.trim() && offeneAnhaenge.length === 0)
                      || !providerId
                    }
                    aria-label={t('ai.chat.send')}
                  >
                    <Send className="h-4 w-4" aria-hidden="true" />
                  </Button>
                )}
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
      {/* Über der ganzen Fläche statt im Verlauf: dort rollte sie mit und sprach über `aria-live` mit. */}
      {dragging && <Ablageflaeche icon={<Paperclip className="h-4 w-4" />} text={t('ai.attachments.drop')} />}
    </section>
    <AiSkillModal open={skillsModalOpen} onClose={() => setSkillsModalOpen(false)} />
    {/* Ausserhalb des Blattmenüs: das schliesst sich beim Klick auf die Zeile
        und nähme sein Fenster mit, stünde es darin. */}
    <ChatHintergrundDialog
      bereich="ki"
      offen={hintergrundOffen}
      onOffenChange={setzeHintergrundOffen}
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
    </RegionalAnalysisLayout>
  )
}
