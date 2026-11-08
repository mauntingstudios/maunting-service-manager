import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, FolderOpen, Monitor, Server, Wrench, XCircle } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button, Dropdown } from '@maunting/ui'

import type { AiConversationSummary } from '@/api/ai'

/**
 * Fehlerseite der Live-Vorschau im Stil einer Statuskette: was geklappt hat,
 * wo es hängt, und ein Knopf, der Singra den Fehler samt Kontext zum Beheben
 * schickt.
 */
export interface PreviewDiagnosticsProps {
  kind: 'error' | 'unconfigured'
  error?: { message: string; detail?: string } | null
  fileCount: number
  entryFile?: string | null
  chats: AiConversationSummary[]
  chatChoice: string
  onChatChoiceChange: (value: string) => void
  onFix: () => void
  onDismiss?: () => void
}

type StepState = 'ok' | 'error' | 'warning'

function Step({
  icon,
  label,
  subtitle,
  state,
}: {
  icon: ReactNode
  label: string
  subtitle: string
  state: StepState
}) {
  const color =
    state === 'ok' ? 'text-status-success' : state === 'error' ? 'text-status-destructive' : 'text-status-warning'
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center">
      <div className="relative grid h-12 w-12 place-items-center rounded-full border border-outline-variant/30 bg-surface-container-high/80 text-on-surface">
        {icon}
        <span className={`absolute -bottom-1 -right-1 rounded-full bg-surface ${color}`}>
          {state === 'ok' ? (
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          ) : state === 'error' ? (
            <XCircle className="h-4 w-4" aria-hidden="true" />
          ) : (
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          )}
        </span>
      </div>
      <div className="text-xs font-semibold text-on-surface">{label}</div>
      <div className={`text-label-sm ${color}`}>{subtitle}</div>
    </div>
  )
}

export function PreviewDiagnostics({
  kind,
  error,
  fileCount,
  entryFile,
  chats,
  chatChoice,
  onChatChoiceChange,
  onFix,
  onDismiss,
}: PreviewDiagnosticsProps) {
  const [showDetail, setShowDetail] = useState(false)
  const isError = kind === 'error'
  const value = chatChoice === '__latest__' ? chats[0]?.id ?? '__new__' : chatChoice

  return (
    <div className="flex flex-1 flex-col items-center justify-center overflow-auto bg-surface p-5 sm:p-8">
      <div className="w-full max-w-xl space-y-5">
        <div className="space-y-1 text-center">
          <h3 className="text-base font-semibold text-on-surface">
            {isError ? 'Die Vorschau konnte nicht geladen werden' : 'Die Vorschau ist noch nicht eingerichtet'}
          </h3>
          <p className="text-xs text-on-surface-variant">
            {isError
              ? 'Projektdateien und Sandbox sind in Ordnung. Beim Darstellen im Browser ist ein Fehler aufgetreten.'
              : 'Im Projekt gibt es keine Browser-Einstiegsdatei (z. B. index.html oder src/main.tsx).'}
          </p>
        </div>

        <div className="flex items-start gap-2 rounded-2xl border border-outline-variant/25 bg-surface-container-low/50 px-3 py-4">
          <Step
            icon={<FolderOpen className="h-5 w-5" aria-hidden="true" />}
            label="Projektdateien"
            subtitle={`${fileCount} Datei${fileCount === 1 ? '' : 'en'}`}
            state="ok"
          />
          <div className="mt-6 h-px w-6 shrink-0 bg-outline-variant/40 sm:w-10" />
          <Step icon={<Server className="h-5 w-5" aria-hidden="true" />} label="Dev-Sandbox" subtitle="Bereit" state="ok" />
          <div className="mt-6 h-px w-6 shrink-0 bg-outline-variant/40 sm:w-10" />
          <Step
            icon={<Monitor className="h-5 w-5" aria-hidden="true" />}
            label="Vorschau"
            subtitle={isError ? 'Fehler' : 'Nicht eingerichtet'}
            state={isError ? 'error' : 'warning'}
          />
        </div>

        {isError && error && (
          <div className="rounded-xl border border-status-destructive/30 bg-status-destructive/10 p-3 text-xs">
            <div className="font-medium text-on-surface break-words">{error.message}</div>
            {entryFile && <div className="mt-1 text-on-surface-variant">Einstieg: <span className="font-mono">{entryFile}</span></div>}
            {error.detail && (
              <>
                <button
                  type="button"
                  onClick={() => setShowDetail((v) => !v)}
                  className="mt-2 inline-flex items-center gap-1 text-on-surface-variant hover:text-on-surface"
                >
                  {showDetail ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  Technische Details
                </button>
                {showDetail && (
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/50 p-2.5 font-mono text-label-sm text-on-surface-variant">
                    {error.detail}
                  </pre>
                )}
              </>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="w-full sm:w-56">
            <Dropdown
              value={value}
              onChange={onChatChoiceChange}
              options={[
                ...chats.map((c, idx) => ({
                  value: c.id,
                  label: idx === 0 ? `${c.title} (zuletzt aktiv)` : c.title,
                })),
                { value: '__new__', label: '+ Neuer Projekt-Chat' },
              ]}
              aria-label="Chat für die Fehlerbehebung"
            />
          </div>
          <Button type="button" className="flex-1 gap-1.5" onClick={onFix}>
            <Wrench className="h-4 w-4" aria-hidden="true" />
            {isError ? 'Fehler mit Singra beheben' : 'Vorschau von Singra einrichten lassen'}
          </Button>
        </div>
        {onDismiss && (
          <div className="text-center">
            <button
              type="button"
              onClick={onDismiss}
              className="text-xs text-on-surface-variant underline-offset-2 hover:text-on-surface hover:underline"
            >
              Vorschau trotzdem anzeigen
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
