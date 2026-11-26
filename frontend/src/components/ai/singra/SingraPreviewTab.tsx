import type { Dispatch, RefObject, SetStateAction } from 'react'
import {
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Globe,
  Laptop,
  MousePointer,
  Pause,
  Play,
  Rocket,
  Settings2,
  Smartphone,
  Sparkles,
  Tablet,
  Terminal,
  X,
} from 'lucide-react'
import type {
  AiConversationSummary,
  AiProject,
  AiProjectDevStatus,
  AiProjectEnvironmentState,
  AiProjectFile,
} from '@/api/ai'
import { Badge, Button, Dropdown, Kurzinfo, Spinner } from '@maunting/ui'
import { still } from '@/lib/still'
import { toast } from '@/stores/toastStore'
import { PreviewDiagnostics } from './PreviewDiagnostics'

export interface ConsoleLogEntry {
  level: 'log' | 'info' | 'warn' | 'error'
  message: string
  time: string
}

export interface SingraPreviewTabProps {
  selectedProject: AiProject
  files: AiProjectFile[]
  productionFiles: Array<{ path: string; content: string; size_bytes: number }>
  projectChats: AiConversationSummary[]
  envState: AiProjectEnvironmentState | null
  devStatus: AiProjectDevStatus | null
  devStatusLoading: boolean
  resolvedDevWebUrl: string | null
  previewEnv: 'dev' | 'production'
  setPreviewEnv: (env: 'dev' | 'production') => void
  devPreviewMode: 'bundle' | 'live'
  setDevPreviewMode: (mode: 'bundle' | 'live') => void
  previewDevice: 'desktop' | 'tablet' | 'mobile'
  setPreviewDevice: (device: 'desktop' | 'tablet' | 'mobile') => void
  inspectMode: boolean
  setInspectMode: (active: boolean) => void
  inspectElement: string | null
  setInspectElement: (el: string | null) => void
  inspectTargetChatId: string
  setInspectTargetChatId: (id: string) => void
  fixTargetChatId: string
  setFixTargetChatId: (id: string) => void
  previewIframeRef: RefObject<HTMLIFrameElement>
  previewSrcDoc: string | null
  previewError: { message: string; detail?: string } | null
  previewErrorDismissed: boolean
  setPreviewErrorDismissed: (dismissed: boolean) => void
  visualLoading: boolean
  devConsoleOpen: boolean
  setDevConsoleOpen: Dispatch<SetStateAction<boolean>>
  consoleLogs: ConsoleLogEntry[]
  setConsoleLogs: Dispatch<SetStateAction<ConsoleLogEntry[]>>
  consoleFilter: 'all' | 'log' | 'warn' | 'error'
  setConsoleFilter: (filter: 'all' | 'log' | 'warn' | 'error') => void
  onOpenPublishModal: () => void
  onRunVisualInspection: () => void
  onApplyElementWithSingra: (selector: string) => void
  onFixPreviewWithSingra: () => void
  onStartDevSandbox: () => void
  onStopDevSandbox: () => void
  canStartDevPreview?: boolean
  onOpenProjectChat: (projectId: string, conversationId?: string) => void
}

export function SingraPreviewTab({
  selectedProject,
  files,
  productionFiles,
  projectChats,
  envState,
  devStatus,
  devStatusLoading,
  resolvedDevWebUrl,
  previewEnv,
  setPreviewEnv,
  devPreviewMode,
  setDevPreviewMode,
  previewDevice,
  setPreviewDevice,
  inspectMode,
  setInspectMode,
  inspectElement,
  setInspectElement,
  inspectTargetChatId,
  setInspectTargetChatId,
  fixTargetChatId,
  setFixTargetChatId,
  previewIframeRef,
  previewSrcDoc,
  previewError,
  previewErrorDismissed,
  setPreviewErrorDismissed,
  visualLoading,
  devConsoleOpen,
  setDevConsoleOpen,
  consoleLogs,
  setConsoleLogs,
  consoleFilter,
  setConsoleFilter,
  onOpenPublishModal,
  onRunVisualInspection,
  onApplyElementWithSingra,
  onFixPreviewWithSingra,
  onStartDevSandbox,
  onStopDevSandbox,
  canStartDevPreview = true,
  onOpenProjectChat,
}: SingraPreviewTabProps) {
  return (
    <div className="flex flex-1 min-h-[480px] flex-col rounded-2xl border border-outline-variant/25 bg-surface-container-low/35 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant/20 bg-surface-container-low/60 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center rounded-lg border border-outline-variant/30 bg-surface-container-high/40 p-0.5 shrink-0 text-xs">
            <button
              type="button"
              onClick={() => setPreviewEnv('dev')}
              className={[
                'px-2.5 py-1 rounded-md transition-colors font-medium',
                previewEnv === 'dev'
                  ? 'bg-primary/20 text-primary'
                  : 'text-on-surface-variant hover:text-on-surface',
              ].join(' ')}
            >
              Entwicklung (Dev)
            </button>
            <button
              type="button"
              onClick={() => setPreviewEnv('production')}
              className={[
                'px-2.5 py-1 rounded-md transition-colors font-medium',
                previewEnv === 'production'
                  ? 'bg-status-success/20 text-status-success'
                  : 'text-on-surface-variant hover:text-on-surface',
              ].join(' ')}
            >
              Produktion (Live)
            </button>
          </div>

          {previewEnv === 'production' && !envState?.production?.published && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-8 text-xs gap-1.5 border-primary/30 text-primary"
              onClick={onOpenPublishModal}
            >
              <Rocket className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Jetzt online schalten</span>
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-outline-variant/30 bg-surface-container-high/40 p-0.5">
            <Kurzinfo text="Desktop-Ansicht">
              <button
                type="button"
                onClick={() => setPreviewDevice('desktop')}
                aria-label="Desktop-Ansicht"
                className={[
                  'p-1.5 rounded-md transition-colors',
                  previewDevice === 'desktop'
                    ? 'bg-primary/20 text-primary'
                    : 'text-on-surface-variant hover:text-on-surface',
                ].join(' ')}
              >
                <Laptop className="h-3.5 w-3.5" />
              </button>
            </Kurzinfo>
            <Kurzinfo text="Tablet-Ansicht">
              <button
                type="button"
                onClick={() => setPreviewDevice('tablet')}
                aria-label="Tablet-Ansicht"
                className={[
                  'p-1.5 rounded-md transition-colors',
                  previewDevice === 'tablet'
                    ? 'bg-primary/20 text-primary'
                    : 'text-on-surface-variant hover:text-on-surface',
                ].join(' ')}
              >
                <Tablet className="h-3.5 w-3.5" />
              </button>
            </Kurzinfo>
            <Kurzinfo text="Smartphone-Ansicht">
              <button
                type="button"
                onClick={() => setPreviewDevice('mobile')}
                aria-label="Smartphone-Ansicht"
                className={[
                  'p-1.5 rounded-md transition-colors',
                  previewDevice === 'mobile'
                    ? 'bg-primary/20 text-primary'
                    : 'text-on-surface-variant hover:text-on-surface',
                ].join(' ')}
              >
                <Smartphone className="h-3.5 w-3.5" />
              </button>
            </Kurzinfo>
          </div>

          <Button
            type="button"
            size="sm"
            variant={inspectMode ? 'primary' : 'secondary'}
            className="h-8 text-xs gap-1.5"
            onClick={() => {
              const next = !inspectMode
              setInspectMode(next)
              if (next) {
                toast.info('Klicke in der Vorschau auf ein Element, um es auszuwählen.')
              } else {
                setInspectElement(null)
              }
            }}
          >
            <MousePointer className="h-3.5 w-3.5" aria-hidden="true" />
            {inspectMode ? 'Auswahl aktiv' : 'Element wählen'}
          </Button>

          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={visualLoading || files.length === 0}
            onClick={onRunVisualInspection}
            className="h-8 text-xs gap-1.5"
          >
            <Sparkles
              className={`h-3.5 w-3.5 text-primary ${visualLoading ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>{visualLoading ? 'Prüft…' : 'KI-Sichtprüfung'}</span>
          </Button>
        </div>
      </div>

      {inspectElement && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-primary/20 bg-primary/10 px-4 py-2 text-xs text-on-surface">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-semibold text-primary shrink-0">Ausgewählt:</span>
            <span className="truncate rounded bg-black/40 px-2 py-0.5 font-mono text-primary text-xs">
              {inspectElement}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-48">
              <Dropdown
                value={
                  inspectTargetChatId === '__latest__'
                    ? projectChats[0]?.id ?? '__new__'
                    : inspectTargetChatId
                }
                onChange={(val) => setInspectTargetChatId(val)}
                options={[
                  ...projectChats.map((c, idx) => ({
                    value: c.id,
                    label: idx === 0 ? `${c.title} (Zuletzt aktiv)` : c.title,
                  })),
                  { value: '__new__', label: '+ Neuer Projekt-Chat' },
                ]}
                aria-label="Ziel-Chat für Anpassung wählen"
              />
            </div>
            <Button
              type="button"
              size="sm"
              className="h-8 px-3 text-xs"
              onClick={() => onApplyElementWithSingra(inspectElement)}
            >
              Mit Singra anpassen
            </Button>
            <button
              type="button"
              onClick={() => setInspectElement(null)}
              aria-label="Elementauswahl aufheben"
              className="text-on-surface-variant hover:text-on-surface p-1"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-1 items-center justify-center bg-black/35 p-4 overflow-auto min-h-[380px]">
        <div
          className={[
            'relative h-full min-h-[420px] transition-all rounded-xl overflow-hidden border border-outline-variant/30 shadow-2xl bg-surface flex flex-col',
            previewDevice === 'desktop'
              ? 'w-full'
              : previewDevice === 'tablet'
                ? 'w-[768px] max-w-full'
                : 'w-[375px] max-w-full',
          ].join(' ')}
        >
          {!previewSrcDoc && previewEnv === 'dev' && files.length > 0 ? (
            <PreviewDiagnostics
              kind="unconfigured"
              fileCount={files.length}
              entryFile={envState?.preview?.entry_file}
              chats={projectChats}
              chatChoice={fixTargetChatId}
              onChatChoiceChange={setFixTargetChatId}
              onFix={onFixPreviewWithSingra}
            />
          ) : !previewSrcDoc ? (
            <div className="flex flex-1 flex-col items-center justify-center p-8 text-center text-on-surface-variant">
              <Globe className="h-10 w-10 text-primary/40 mb-3" />
              <p className="text-sm font-medium text-on-surface">
                {previewEnv === 'production'
                  ? 'Noch nicht auf Produktion veröffentlicht'
                  : 'Noch keine Vorschau verfügbar'}
              </p>
              <p className="text-xs text-on-surface-variant max-w-sm mt-1">
                {previewEnv === 'production'
                  ? 'Schalte deinen aktuellen Entwicklungsstand online, um ihn als Live-Server im Dashboard bereitzustellen.'
                  : 'Sobald eine Webseite oder React-Oberfläche im Projekt angelegt ist, wird sie hier direkt dargestellt.'}
              </p>
              {previewEnv === 'production' && (
                <Button
                  type="button"
                  size="sm"
                  className="mt-4 rounded-full px-4"
                  onClick={onOpenPublishModal}
                >
                  <Rocket className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Jetzt online schalten</span>
                </Button>
              )}
            </div>
          ) : (
            <>
              {previewEnv === 'dev' && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-outline-variant/20 bg-surface-container-high/60 px-4 py-2 text-xs text-on-surface shrink-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge
                      variant={devStatus?.status === 'running' ? 'success' : 'default'}
                      className="text-xs gap-1"
                    >
                      {devStatus?.status === 'running'
                        ? `✓ Dev-Sandbox aktiv (Port :${devStatus.dev_frontend_port || 27031})`
                        : devStatus?.status === 'paused_idle'
                          ? 'Pausiert (Inaktivität)'
                          : 'Dev-Sandbox gestoppt'}
                    </Badge>
                    {devStatus?.dev_web_url && devStatus?.status === 'running' && (
                      <a
                        href={resolvedDevWebUrl || devStatus.dev_web_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-primary hover:underline inline-flex items-center gap-1"
                        aria-label="Live-Server in neuem Tab öffnen"
                      >
                        <span>{resolvedDevWebUrl || devStatus.dev_web_url}</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    {devStatus?.idle_minutes && devStatus.idle_minutes > 0 ? (
                      <span className="text-label-sm text-on-surface-variant">
                        • Inaktiv seit {Math.round(devStatus.idle_minutes)} Min. (Auto-Pause nach 60 Min.)
                      </span>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-2">
                    {devStatus?.status === 'running' && (
                      <div className="flex items-center gap-1 rounded border border-outline-variant/30 p-0.5 bg-surface-container-low text-xs">
                        <button
                          type="button"
                          className={`px-2 py-0.5 rounded transition-colors ${
                            devPreviewMode === 'bundle'
                              ? 'bg-surface-container-high font-medium text-on-surface'
                              : 'text-on-surface-variant hover:text-on-surface'
                          }`}
                          onClick={() => setDevPreviewMode('bundle')}
                        >
                          Vorschau
                        </button>
                        <button
                          type="button"
                          className={`px-2 py-0.5 rounded transition-colors ${
                            devPreviewMode === 'live'
                              ? 'bg-surface-container-high font-medium text-on-surface'
                              : 'text-on-surface-variant hover:text-on-surface'
                          }`}
                          onClick={() => setDevPreviewMode('live')}
                          aria-label={resolvedDevWebUrl || devStatus?.dev_web_url || 'Live-Server'}
                        >
                          Live-Server
                        </button>
                      </div>
                    )}
                    {devStatus?.status === 'running' ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-7 text-xs px-2.5 gap-1"
                        disabled={devStatusLoading}
                        onClick={onStopDevSandbox}
                      >
                        <Pause className="h-3.5 w-3.5 shrink-0" />
                        <span>Sandbox pausieren</span>
                      </Button>
                    ) : canStartDevPreview ? (
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 text-xs px-2.5 gap-1"
                        disabled={devStatusLoading}
                        onClick={onStartDevSandbox}
                      >
                        {devStatusLoading ? <Spinner className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 shrink-0" />}
                        <span>Sandbox starten</span>
                      </Button>
                    ) : (
                      <span className="text-xs text-on-surface-variant">
                        Live-Vorschau nicht freigeschaltet
                      </span>
                    )}
                  </div>
                </div>
              )}

              {previewEnv === 'production' && envState?.production?.published && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-outline-variant/20 bg-surface-container-high/60 px-4 py-2 text-xs text-on-surface shrink-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="success" className="text-xs gap-1">
                      <Check className="h-3 w-3" aria-hidden="true" />
                      <span>Live (v{envState.production.release_count || 1})</span>
                    </Badge>
                    <span className="text-on-surface-variant">Node:</span>
                    <span className="font-medium text-on-surface">{envState.production.node_id || 'Haupt-Node'}</span>
                    <span className="text-on-surface-variant">Modus:</span>
                    <span className="font-medium text-on-surface">
                      {envState.production.mode === 'fullstack_split'
                        ? 'Fullstack getrennt'
                        : envState.production.mode === 'backend'
                          ? 'Backend'
                          : 'Frontend'}
                    </span>
                    {envState.production.web_url && (
                      <>
                        <span className="text-on-surface-variant">Adresse:</span>
                        <a
                          href={envState.production.web_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-primary hover:underline inline-flex items-center gap-1"
                        >
                          <span>{envState.production.web_url}</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </>
                    )}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-7 text-xs px-2.5 gap-1"
                    onClick={onOpenPublishModal}
                  >
                    <Settings2 className="h-3.5 w-3.5 shrink-0" />
                    <span>Bereitstellung anpassen</span>
                  </Button>
                </div>
              )}
              {previewEnv === 'production' && envState?.production?.web_url ? (
                <iframe
                  key={`preview-prod-${envState.production.web_url}`}
                  src={envState.production.web_url}
                  title="Projekt-Produktion"
                  className="w-full flex-1 border-0 min-h-[400px] bg-white"
                  sandbox="allow-scripts allow-forms allow-modals allow-same-origin"
                />
              ) : previewEnv === 'dev' && devPreviewMode === 'live' && devStatus?.status === 'running' && resolvedDevWebUrl ? (
                <iframe
                  key={`preview-dev-${resolvedDevWebUrl}`}
                  src={resolvedDevWebUrl}
                  title="Projekt-Dev-Sandbox"
                  className="w-full flex-1 border-0 min-h-[400px] bg-white"
                  sandbox="allow-scripts allow-forms allow-modals allow-same-origin"
                />
              ) : (
                <iframe
                  ref={previewIframeRef}
                  key={`preview-${previewEnv}`}
                  srcDoc={previewSrcDoc ?? undefined}
                  title="Projekt-Vorschau"
                  className="w-full flex-1 border-0 min-h-[400px] bg-white"
                  sandbox="allow-scripts allow-forms allow-modals allow-same-origin"
                  onLoad={(e) => {
                    const frame = e.currentTarget
                    if (!previewSrcDoc) return
                    try {
                      const loc = frame.contentWindow?.location
                      if (loc && loc.href && loc.href !== 'about:srcdoc' && loc.origin === window.location.origin) {
                        frame.srcdoc = previewSrcDoc
                      }
                    } catch (err) {
                      still(err, 'singra:preview:iframe:onLoad')
                    }
                  }}
                />
              )}
              {previewError && !previewErrorDismissed && (
                <div className="absolute inset-0 z-10 flex flex-col">
                  <PreviewDiagnostics
                    kind="error"
                    error={previewError}
                    fileCount={(previewEnv === 'production' ? productionFiles : files).length}
                    entryFile={envState?.preview?.entry_file}
                    chats={projectChats}
                    chatChoice={fixTargetChatId}
                    onChatChoiceChange={setFixTargetChatId}
                    onFix={onFixPreviewWithSingra}
                    onDismiss={() => setPreviewErrorDismissed(true)}
                  />
                </div>
              )}

              {/* Dev-Konsole Drawer */}
              <div className="border-t border-outline-variant/30 bg-surface-container-lowest flex flex-col shrink-0">
                <div className="flex items-center justify-between px-3 py-1.5 bg-surface-container-low text-xs border-b border-outline-variant/20 select-none">
                  <button
                    type="button"
                    onClick={() => setDevConsoleOpen((o) => !o)}
                    className="flex items-center gap-1.5 font-medium text-on-surface hover:text-primary transition-colors"
                  >
                    <Terminal className="h-3.5 w-3.5 text-primary" />
                    <span>Dev-Konsole</span>
                    <span className="text-xs text-on-surface-variant font-mono">({consoleLogs.length})</span>
                    {consoleLogs.filter((l) => l.level === 'error').length > 0 && (
                      <span className="rounded-full bg-status-destructive/20 text-status-destructive text-xs px-1.5 py-0.2 font-semibold">
                        {consoleLogs.filter((l) => l.level === 'error').length} Fehler
                      </span>
                    )}
                    {consoleLogs.filter((l) => l.level === 'warn').length > 0 && (
                      <span className="rounded-full bg-status-warning/20 text-status-warning text-xs px-1.5 py-0.2 font-semibold">
                        {consoleLogs.filter((l) => l.level === 'warn').length} Warnungen
                      </span>
                    )}
                    {devConsoleOpen ? <ChevronDown className="h-3 w-3 ml-0.5" /> : <ChevronUp className="h-3 w-3 ml-0.5" />}
                  </button>
                  {devConsoleOpen && (
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        {(['all', 'log', 'warn', 'error'] as const).map((filter) => (
                          <button
                            key={filter}
                            type="button"
                            onClick={() => setConsoleFilter(filter)}
                            className={[
                              'px-1.5 py-0.5 rounded text-xs font-medium transition-colors',
                              consoleFilter === filter
                                ? 'bg-primary/20 text-primary'
                                : 'text-on-surface-variant hover:text-on-surface',
                            ].join(' ')}
                          >
                            {filter === 'all' ? 'Alle' : filter.toUpperCase()}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => setConsoleLogs([])}
                        className="text-on-surface-variant hover:text-on-surface text-xs px-1 py-0.5"
                        aria-label="Konsole leeren"
                      >
                        Leeren
                      </button>
                    </div>
                  )}
                </div>
                {devConsoleOpen && (
                  <div className="h-36 overflow-y-auto p-2 font-mono text-xs bg-black/85 space-y-1">
                    {consoleLogs.length === 0 ? (
                      <div className="text-on-surface-variant/50 italic text-xs p-2">Keine Konsolenausgaben erfasst.</div>
                    ) : (
                      consoleLogs
                        .filter((l) => consoleFilter === 'all' || l.level === consoleFilter)
                        .map((l, idx) => (
                          <div
                            key={idx}
                            className={[
                              'flex items-start gap-2 py-0.5 px-1 rounded text-xs leading-relaxed',
                              l.level === 'error'
                                ? 'bg-status-destructive/15 text-status-destructive'
                                : l.level === 'warn'
                                  ? 'bg-status-warning/15 text-status-warning'
                                  : 'text-on-surface/90',
                            ].join(' ')}
                          >
                            <span className="text-xs text-on-surface-variant/60 shrink-0 font-sans">{l.time}</span>
                            <span className="uppercase text-xs font-bold px-1 rounded shrink-0 bg-white/10">
                              {l.level}
                            </span>
                            <span className="break-all whitespace-pre-wrap flex-1">{l.message}</span>
                            {l.level === 'error' && (
                              <button
                                type="button"
                                onClick={() => {
                                  const targetChat = projectChats[0]?.id
                                  if (targetChat) {
                                    onOpenProjectChat(selectedProject.id, targetChat)
                                    toast.info('Chat geöffnet. Bitte Singra, diesen Fehler zu beheben.')
                                  }
                                }}
                                className="shrink-0 text-xs text-primary hover:underline"
                              >
                                Mit Singra beheben
                              </button>
                            )}
                          </div>
                        ))
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
