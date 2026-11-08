import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
  Terminal,
  XCircle,
} from 'lucide-react'
import { Button, Spinner } from '@maunting/ui'
import { aiApi, type SingraDeploymentItem } from '@/api/ai'
import { still } from '@/lib/still'

const PHASES: Array<{ key: string; label: string; desc: string }> = [
  { key: 'snapshot', label: 'Quellcode erfassen', desc: 'Sichert aktuellen Projektstand und Prüfsummen' },
  { key: 'build_frontend', label: 'Web-Build', desc: 'Kompiliert Vite/React im isolierten Container' },
  { key: 'build_backend', label: 'Backend-Laufzeit', desc: 'Bereitet Node/Python Umgebung vor' },
  { key: 'database', label: 'Datenbank anlegen', desc: 'Erstellt PostgreSQL-Datenbank und Zugänge' },
  { key: 'migrations', label: 'Tabellen migrieren', desc: 'Führt SQL-Dateien deterministisch aus' },
  { key: 'start_backend', label: 'Backend starten', desc: 'Startet Container über start.sh' },
  { key: 'verify_backend', label: 'Backend prüfen', desc: 'Prüft TCP-Port und HTTP-Gesundheit' },
  { key: 'start_frontend', label: 'Frontend starten', desc: 'Richtet Caddy-Webserver ein' },
  { key: 'proxy', label: 'Routing schalten', desc: 'Aktiviert Reverse-Proxy über msm-caddy' },
  { key: 'verify_frontend', label: 'Web-Aufruf prüfen', desc: 'Verifiziert HTTP 200 der Einstiegsseite' },
  { key: 'verify_api', label: 'API-Aufruf prüfen', desc: 'Testet Schnittstellen-Antworten' },
  { key: 'verify_db', label: 'Datenbank prüfen', desc: 'Validiert Datenbankzugriff im Betrieb' },
  { key: 'quality', label: 'Qualitäts-Gate', desc: 'Browser-Tests und CDN/Font-Prüfung' },
  { key: 'done', label: 'Live freigegeben', desc: 'Bereitstellung erfolgreich abgeschlossen' },
]

export interface SingraDeploymentPanelProps {
  projectId: string
  activeDeploymentId?: string | null
  onRetry?: () => void
  onClose?: () => void
}

export function SingraDeploymentPanel({
  projectId,
  activeDeploymentId,
  onRetry,
  onClose,
}: SingraDeploymentPanelProps) {
  const [deployment, setDeployment] = useState<SingraDeploymentItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [showLogs, setShowLogs] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchDeployment = async () => {
    try {
      if (activeDeploymentId) {
        const d = await aiApi.getProjectDeployment(projectId, activeDeploymentId)
        setDeployment(d)
      } else {
        const list = await aiApi.listProjectDeployments(projectId, 1)
        if (list.length > 0) {
          setDeployment(list[0])
        } else {
          setDeployment(null)
        }
      }
    } catch (err) {
      still(err, 'SingraDeploymentPanel.fetchDeployment')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchDeployment()

    // Poll status while deployment is pending or running
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      fetchDeployment()
    }, 2000)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [projectId, activeDeploymentId])

  // Stop polling if deployment reached terminal state
  useEffect(() => {
    if (deployment && (deployment.status === 'succeeded' || deployment.status === 'failed')) {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [deployment?.status])

  if (loading && !deployment) {
    return (
      <div className="flex items-center justify-center p-8 bg-surface-container-high/60 backdrop-blur-md rounded-2xl border border-outline-variant/30 text-on-surface">
        <Spinner className="h-6 w-6 text-primary mr-3" />
        <span className="text-sm">Deployment-Status wird geladen …</span>
      </div>
    )
  }

  if (!deployment) {
    return (
      <div className="p-6 bg-surface-container-high/60 backdrop-blur-md rounded-2xl border border-outline-variant/30 text-on-surface text-center">
        <p className="text-sm text-on-surface-variant">Bislang wurde für dieses Projekt noch kein Deployment gestartet.</p>
      </div>
    )
  }

  const currentPhaseIndex = PHASES.findIndex((p) => p.key === deployment.phase)
  const isSucceeded = deployment.status === 'succeeded'
  const isFailed = deployment.status === 'failed'
  const isRunning = deployment.status === 'running' || deployment.status === 'pending'

  // Calculate percentage
  let completedCount = 0
  if (isSucceeded) {
    completedCount = PHASES.length
  } else if (currentPhaseIndex >= 0) {
    completedCount = isFailed ? currentPhaseIndex : currentPhaseIndex
  }
  const progressPercent = Math.round((completedCount / PHASES.length) * 100)

  // Parse diagnostics entries
  const diagEntries = Array.isArray(deployment.diagnostics)
    ? deployment.diagnostics
    : typeof deployment.diagnostics === 'object' && deployment.diagnostics !== null
      ? Object.entries(deployment.diagnostics).map(([k, v]) => ({ step: k, message: String(v) }))
      : []

  return (
    <div className="space-y-4 rounded-2xl border border-outline-variant/30 bg-surface-container-high/80 p-5 backdrop-blur-xl shadow-lg text-on-surface">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 border border-primary/20 text-primary">
            {isRunning ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : isSucceeded ? (
              <CheckCircle2 className="h-5 w-5 text-status-success" />
            ) : (
              <XCircle className="h-5 w-5 text-status-destructive" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-base">
                {isSucceeded
                  ? 'Bereitstellung erfolgreich'
                  : isFailed
                    ? 'Bereitstellung unterbrochen'
                    : 'Bereitstellung wird ausgeführt'}
              </h3>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-surface-container-highest text-on-surface-variant border border-outline-variant/30">
                v{deployment.version} ({deployment.environment.toUpperCase()})
              </span>
            </div>
            <p className="text-xs text-on-surface-variant mt-0.5">
              {isRunning
                ? `Aktuelle Phase: ${PHASES[currentPhaseIndex]?.label || deployment.phase}`
                : isSucceeded
                  ? 'Alle 14 Sicherheits- und Bereitstellungsphasen erfolgreich durchlaufen.'
                  : `Fehlgeschlagen in Phase: ${PHASES[currentPhaseIndex]?.label || deployment.phase}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isFailed && onRetry && (
            <Button size="sm" variant="secondary" onClick={onRetry} className="gap-1.5 text-xs">
              <RefreshCw className="h-3.5 w-3.5" />
              Erneut versuchen
            </Button>
          )}
          {onClose && (
            <Button size="sm" variant="ghost" onClick={onClose} className="text-xs">
              Schließen
            </Button>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="space-y-1.5">
        <div className="flex justify-between items-center text-xs text-on-surface-variant font-medium">
          <span>Fortschritt ({completedCount} von {PHASES.length} Phasen)</span>
          <span>{progressPercent}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-surface-container-highest overflow-hidden">
          <div
            className={`h-full transition-all duration-500 rounded-full ${
              isFailed ? 'bg-status-destructive' : isSucceeded ? 'bg-status-success' : 'bg-primary'
            }`}
            style={{ width: `${Math.max(5, progressPercent)}%` }}
          />
        </div>
      </div>

      {/* 14 Phasen Stepper Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-7 gap-2 pt-2">
        {PHASES.map((p, idx) => {
          let stepStatus: 'done' | 'active' | 'failed' | 'pending' = 'pending'
          if (isSucceeded) {
            stepStatus = 'done'
          } else if (idx < currentPhaseIndex) {
            stepStatus = 'done'
          } else if (idx === currentPhaseIndex) {
            stepStatus = isFailed ? 'failed' : 'active'
          } else {
            stepStatus = 'pending'
          }

          return (
            <div
              key={p.key}
              aria-label={`${p.label}: ${p.desc}`}
              className={`flex flex-col p-2.5 rounded-xl border text-xs transition-all ${
                stepStatus === 'done'
                  ? 'bg-status-success/10 border-status-success/30 text-status-success'
                  : stepStatus === 'active'
                    ? 'bg-primary/15 border-primary text-primary shadow-sm ring-1 ring-primary/40'
                    : stepStatus === 'failed'
                      ? 'bg-status-destructive/10 border-status-destructive/30 text-status-destructive'
                      : 'bg-surface-container-highest/40 border-outline-variant/20 text-on-surface-variant/70'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-label-sm opacity-70">#{idx + 1}</span>
                {stepStatus === 'done' && <CheckCircle2 className="h-3.5 w-3.5 text-status-success" />}
                {stepStatus === 'active' && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
                {stepStatus === 'failed' && <XCircle className="h-3.5 w-3.5 text-status-destructive" />}
              </div>
              <span className="font-medium truncate text-label-sm">{p.label}</span>
            </div>
          )
        })}
      </div>

      {/* Error Details if Failed */}
      {isFailed && deployment.error_detail && (
        <div className="rounded-xl border border-status-destructive/30 bg-status-destructive/10 p-3.5 text-xs text-status-destructive space-y-1">
          <div className="flex items-center gap-2 font-semibold text-status-destructive">
            <AlertCircle className="h-4 w-4" />
            <span>Fehlercode: {deployment.error_code || 'UNBEKANNTER_FEHLER'}</span>
          </div>
          <p className="font-mono whitespace-pre-wrap text-label-sm opacity-90 pl-6">
            {deployment.error_detail}
          </p>
        </div>
      )}

      {/* Diagnostics Logs Collapsible */}
      {diagEntries.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <button
            type="button"
            onClick={() => setShowLogs((prev) => !prev)}
            className="flex items-center gap-1.5 text-xs text-on-surface-variant hover:text-on-surface font-medium transition-colors"
          >
            {showLogs ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            <Terminal className="h-3.5 w-3.5" />
            <span>Diagnose-Protokoll ({diagEntries.length} Schritte)</span>
          </button>

          {showLogs && (
            <div className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest/80 p-3 font-mono text-label-sm text-on-surface-variant space-y-1 max-h-48 overflow-y-auto">
              {diagEntries.map((entry: any, i: number) => (
                <div key={i} className="flex gap-2">
                  <span className="text-on-surface-variant/60 shrink-0 select-none">[{i + 1}]</span>
                  {entry.phase && <span className="text-primary shrink-0">{entry.phase}:</span>}
                  <span className="text-on-surface">{entry.message || entry.step}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
