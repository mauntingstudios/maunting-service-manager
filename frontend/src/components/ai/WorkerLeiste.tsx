import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bot } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { aiApi, type AiWorkerInfo } from '@/api/ai'
import { getRateLimitRemainingMs } from '@/api/client'
import { AI_ZUSTELLUNG_EVENT } from '@/lib/aiZustellung'
import { Kurzinfo } from '@maunting/ui'

/**
 * Dynamischer Takt: Schnell (5s), solange Aufträge aktiv sind; gemächlich (30s) in Ruhe.
 * Das Zustell-Ereignis weckt die Leiste bei Änderungen sofort in Millisekunden.
 */
const AKTIV_TAKT_MS = 5_000
const RUHE_TAKT_MS = 30_000

const STATUS_TEXT: Record<string, string> = {
  running: 'ai.worker.running',
  waiting_confirmation: 'ai.worker.waitingApproval',
  waiting_user: 'ai.worker.waitingUser',
  waiting_wake: 'ai.worker.waitingWake',
}

export interface WorkerLeisteProps {
  /** Im Projekt-Chat: zeigt ausschließlich Worker dieses Projekts. */
  projectId?: string | null
  /** Im normalen Chat: zeigt ausschließlich Worker aus genau diesem Chat. */
  conversationId?: string | null
  /** Aktuell im Split-View geöffneter Worker. */
  activeWorkerId?: string | null
  /** Öffnet/schließt den Split-View statt Seitennavigation. */
  onSelectWorker?: (workerId: string) => void
  /** Aktiviert das Glas-/Overlay-Styling der Singra-Oberfläche. */
  singraShell?: boolean
  /** Kompakte Inline-Darstellung direkt oben links im Chat-Header (ohne Balken). */
  inline?: boolean
}

/**
 * Die Worker-Leiste des Chats: je lebendem Hintergrund-Auftrag eine Pille.
 *
 * Einsehbar, nicht beschreibbar, räumt sich auf (docs/agentic-framework.md,
 * Frontend-Zeile): Die Liste zeigt nur, was das Backend als lebend meldet —
 * Endzustände fallen beim nächsten Blick von selbst heraus, gelöscht wird
 * nichts. Ohne `onSelectWorker` führt ein Klick in die lesende Worker-Ansicht
 * (`?ansicht=worker&id=<uuid>`), mit `onSelectWorker` öffnet sich der Split-View.
 */
export function WorkerLeiste({
  projectId,
  conversationId,
  activeWorkerId,
  onSelectWorker,
  singraShell = false,
  inline = false,
}: WorkerLeisteProps = {}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [workers, setWorkers] = useState<AiWorkerInfo[]>([])
  const workersCountRef = useRef(0)
  workersCountRef.current = workers.length

  const laden = useCallback(async () => {
    if (getRateLimitRemainingMs() > 0) return
    try {
      const list = await aiApi.listWorkers()
      workersCountRef.current = list.length
      setWorkers(list)
    } catch (fehler) {
      // Die Leiste ist eine Zusatzauskunft. Scheitert der Abruf, bleibt der
      // letzte Stand stehen — ein Fehlertoast wäre lästiger als eine kurz
      // veraltete Liste. In die Konsole gehört es trotzdem: die Desktop-App
      // spricht eine frei eingetragene Backend-Adresse, und ein 404 eines
      // älteren Backends sähe sonst aus wie „es gibt keine Worker".
      console.info('Worker-Liste nicht abrufbar', fehler)
    }
  }, [])

  useEffect(() => {
    let aktiv = true
    let timer: number | undefined

    const schedule = () => {
      if (!aktiv) return
      if (timer) window.clearTimeout(timer)
      const basisMs = workersCountRef.current > 0 ? AKTIV_TAKT_MS : RUHE_TAKT_MS
      const waitMs = Math.max(basisMs, getRateLimitRemainingMs())
      timer = window.setTimeout(async () => {
        if (!aktiv) return
        if (typeof document === 'undefined' || document.visibilityState === 'visible') {
          await laden()
        }
        schedule()
      }, waitMs)
    }

    const onSyncEventOrVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      void laden().finally(() => schedule())
    }

    void laden().finally(() => schedule())
    window.addEventListener(AI_ZUSTELLUNG_EVENT, onSyncEventOrVisible)
    document.addEventListener('visibilitychange', onSyncEventOrVisible)
    return () => {
      aktiv = false
      if (timer) window.clearTimeout(timer)
      window.removeEventListener(AI_ZUSTELLUNG_EVENT, onSyncEventOrVisible)
      document.removeEventListener('visibilitychange', onSyncEventOrVisible)
    }
  }, [laden])

  const sichtbareWorker = useMemo(() => {
    if (projectId !== undefined) {
      if (!projectId) return []
      return workers.filter((w) => w.project_id === projectId)
    }
    if (conversationId !== undefined) {
      if (!conversationId) return []
      return workers.filter((w) => !w.project_id && w.parent_conversation_id === conversationId)
    }
    return workers
  }, [workers, projectId, conversationId])

  if (sichtbareWorker.length === 0) return null

  return (
    <div
      className={
        inline
          ? 'flex min-w-0 flex-wrap items-center gap-1.5'
          : [
              'relative flex shrink-0 flex-wrap items-center gap-2 px-3 sm:px-4',
              singraShell
                ? 'border-b border-white/10 bg-surface-container/55 backdrop-blur-md pt-14 pb-2.5'
                : 'border-b border-outline-variant/40 py-2',
            ].join(' ')
      }
      aria-label={t('ai.worker.listLabel')}
    >
      {!inline && (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-on-surface-variant">
          <Bot className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
          {t('ai.worker.listLabel')}
        </span>
      )}
      {sichtbareWorker.map((worker) => {
        const istAktiv = activeWorkerId === worker.conversation_id
        const istRunning = worker.status === 'running'
        const istWaitingWake = worker.status === 'waiting_wake'
        return (
          <Kurzinfo key={worker.conversation_id} text={worker.title} aussen="min-w-0 max-w-full sm:max-w-[16rem]">
            <button
              type="button"
              aria-pressed={onSelectWorker ? istAktiv : undefined}
              onClick={() => {
                if (onSelectWorker) {
                  onSelectWorker(worker.conversation_id)
                } else {
                  navigate(`/ai?ansicht=worker&id=${encodeURIComponent(worker.conversation_id)}`)
                }
              }}
              className={[
                'inline-flex items-center gap-1.5 rounded-full border text-xs font-medium',
                inline ? 'h-9 sm:h-8 max-w-[10rem] sm:max-w-[15rem] px-2.5 backdrop-blur-md shadow-sm' : 'max-w-[16rem] px-2.5 py-1',
                'transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
                istAktiv ? 'ring-2 ring-primary/55 shadow-sm' : '',
                istRunning
                  ? inline
                    ? 'border-primary/40 bg-surface-container-high/85 text-primary hover:bg-surface-container-high'
                    : 'border-primary/40 bg-primary/12 text-primary hover:bg-primary/20'
                  : istWaitingWake
                    ? 'border-outline-variant/40 bg-surface-container-high/85 text-on-surface-variant hover:text-on-surface'
                    : inline
                      ? 'border-status-warning/40 bg-surface-container-high/85 text-status-warning hover:bg-surface-container-high'
                      : 'border-status-warning/40 bg-status-warning/12 text-status-warning hover:bg-status-warning/20',
              ].join(' ')}
            >
              {inline && <Bot className="h-3.5 w-3.5 shrink-0 opacity-85" aria-hidden="true" />}
              <span
                className={[
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  istRunning
                    ? 'bg-primary animate-pulse'
                    : istWaitingWake
                      ? 'bg-on-surface-variant/60'
                      : 'bg-status-warning animate-pulse',
                ].join(' ')}
                aria-hidden="true"
              />
              <span className="truncate">{worker.title}</span>
              <span className={inline ? 'hidden sm:inline shrink-0 opacity-80' : 'shrink-0 opacity-80'}>
                · {t(STATUS_TEXT[worker.status] ?? 'ai.worker.running')}
              </span>
            </button>
          </Kurzinfo>
        )
      })}
    </div>
  )
}
