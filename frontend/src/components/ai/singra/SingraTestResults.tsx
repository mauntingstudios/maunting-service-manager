import { useEffect, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Layout,
  Play,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  XCircle,
} from 'lucide-react'
import { Button, Spinner } from '@maunting/ui'
import { aiApi, type SingraTestRunItem } from '@/api/ai'
import { still } from '@/lib/still'

export interface SingraTestResultsProps {
  projectId: string
  onTestCompleted?: (passed: boolean) => void
}

export function SingraTestResults({ projectId, onTestCompleted }: SingraTestResultsProps) {
  const [testRuns, setTestRuns] = useState<SingraTestRunItem[]>([])
  const [loading, setLoading] = useState(true)
  const [runningTest, setRunningTest] = useState(false)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)

  const loadTestRuns = async () => {
    try {
      const runs = await aiApi.getProjectTestRuns(projectId)
      setTestRuns(runs)
      if (runs.length > 0 && !selectedRunId) {
        setSelectedRunId(runs[0].id)
      }
    } catch (err) {
      still(err, 'SingraTestResults.loadRuns')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTestRuns()
  }, [projectId])

  const handleRunTests = async () => {
    if (runningTest) return
    setRunningTest(true)
    try {
      const res = await aiApi.runProjectTests(projectId)
      await loadTestRuns()
      if (onTestCompleted) {
        onTestCompleted(res.passed)
      }
    } catch (err) {
      still(err, 'SingraTestResults.runTests')
    } finally {
      setRunningTest(false)
    }
  }

  const latestRun = testRuns[0] || null
  const activeRun = testRuns.find((r) => r.id === selectedRunId) || latestRun

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 bg-surface-container-high/60 backdrop-blur-md rounded-2xl border border-outline-variant/30 text-on-surface">
        <Spinner className="h-6 w-6 text-primary mr-3" />
        <span className="text-sm">Test-Ergebnisse werden geladen …</span>
      </div>
    )
  }

  return (
    <div className="space-y-4 rounded-2xl border border-outline-variant/30 bg-surface-container-high/80 p-5 backdrop-blur-xl shadow-lg text-on-surface">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-base">Automatisierte Browser- & Systemtests</h3>
          </div>
          <p className="text-xs text-on-surface-variant mt-0.5">
            Verbindliches Test-Gate: Prüft Layout, Interaktion, Origin-Guard und Formular-Validierung vor jeder Freigabe.
          </p>
        </div>

        <Button
          size="sm"
          onClick={handleRunTests}
          disabled={runningTest}
          className="gap-2 text-xs"
        >
          {runningTest ? (
            <>
              <Spinner className="h-3.5 w-3.5" />
              <span>Tests laufen …</span>
            </>
          ) : (
            <>
              <Play className="h-3.5 w-3.5" />
              <span>Tests jetzt ausführen</span>
            </>
          )}
        </Button>
      </div>

      {/* No Runs Yet */}
      {!activeRun && (
        <div className="rounded-xl border border-outline-variant/20 bg-surface-container-highest/30 p-6 text-center text-xs text-on-surface-variant space-y-2">
          <p>Für dieses Projekt liegen noch keine Testergebnisse vor.</p>
          <p className="opacity-80">
            Führe die Tests aus, um das Projekt für ein Produktions-Deployment freizugeben.
          </p>
        </div>
      )}

      {/* Active Run Card */}
      {activeRun && (
        <div className="space-y-3">
          {/* Card Status Banner */}
          <div
            className={`flex items-center justify-between p-3.5 rounded-xl border text-xs ${
              activeRun.status === 'passed'
                ? 'bg-status-success/10 border-status-success/30 text-status-success'
                : 'bg-status-destructive/10 border-status-destructive/30 text-status-destructive'
            }`}
          >
            <div className="flex items-center gap-2.5">
              {activeRun.status === 'passed' ? (
                <CheckCircle2 className="h-5 w-5 text-status-success shrink-0" />
              ) : (
                <XCircle className="h-5 w-5 text-status-destructive shrink-0" />
              )}
              <div>
                <span className="font-semibold text-sm">
                  {activeRun.status === 'passed' ? 'Test-Gate bestanden' : 'Test-Gate nicht bestanden'}
                </span>
                <div className="flex items-center gap-2 text-label-sm opacity-80 mt-0.5">
                  <span>Prüfsumme: {activeRun.release_checksum ? activeRun.release_checksum.slice(0, 12) : 'unbekannt'}</span>
                  {activeRun.started_at && (
                    <span>• {new Date(activeRun.started_at).toLocaleString('de-DE')}</span>
                  )}
                </div>
              </div>
            </div>

            <span className="text-label-sm font-mono uppercase px-2.5 py-1 rounded-full border border-current font-medium">
              {activeRun.status === 'passed' ? 'Freigegeben' : 'Gesperrt'}
            </span>
          </div>

          {/* Scenarios Breakdown */}
          {activeRun.summary && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {/* Origin Guard & Network */}
              <div className="p-3 rounded-xl border border-outline-variant/25 bg-surface-container-highest/40 space-y-1.5 text-xs">
                <div className="flex items-center gap-2 font-medium">
                  <Shield className="h-4 w-4 text-primary" />
                  <span>Origin-Guard & Netzwerksicherheit</span>
                </div>
                <p className="text-label-sm text-on-surface-variant">
                  Blockiert unerlaubte externe Verbindungen zu CDNs oder Tracking-Diensten.
                </p>
                <div className="pt-1 flex items-center justify-between text-label-sm">
                  <span>Blockierte Drittanbieter-Aufrufe:</span>
                  <span className="font-mono font-medium text-status-success">
                    {activeRun.summary.third_party_requests_blocked ?? 0}
                  </span>
                </div>
              </div>

              {/* Viewports & Overflow */}
              <div className="p-3 rounded-xl border border-outline-variant/25 bg-surface-container-highest/40 space-y-1.5 text-xs">
                <div className="flex items-center gap-2 font-medium">
                  <Layout className="h-4 w-4 text-primary" />
                  <span>Layout & Mobilansicht (375x667)</span>
                </div>
                <p className="text-label-sm text-on-surface-variant">
                  Erkennt horizontale Scrollbalken und fehlerhafte Elementbreiten.
                </p>
                <div className="pt-1 flex items-center justify-between text-label-sm">
                  <span>Layout-Überlauf festgestellt:</span>
                  <span
                    className={`font-medium ${
                      activeRun.summary.viewports?.mobile?.overflow ? 'text-status-destructive' : 'text-status-success'
                    }`}
                  >
                    {activeRun.summary.viewports?.mobile?.overflow ? 'Ja (Auffällig)' : 'Nein (Sauber)'}
                  </span>
                </div>
              </div>

              {/* Negative Form Testing */}
              <div className="p-3 rounded-xl border border-outline-variant/25 bg-surface-container-highest/40 space-y-1.5 text-xs">
                <div className="flex items-center gap-2 font-medium">
                  <ShieldAlert className="h-4 w-4 text-primary" />
                  <span>Formular-Validierung (Negative Tests)</span>
                </div>
                <p className="text-label-sm text-on-surface-variant">
                  Prüft, ob Formulare leere oder ungültige Eingaben korrekt abweisen.
                </p>
                <div className="pt-1 flex items-center justify-between text-label-sm">
                  <span>Fehleingaben blockiert:</span>
                  <span className="font-medium text-status-success">
                    {activeRun.summary.negative_tests?.empty_submit_blocked !== false ? 'Korrekt validiert' : 'Nicht validiert'}
                  </span>
                </div>
              </div>

              {/* Console & Runtime Errors */}
              <div className="p-3 rounded-xl border border-outline-variant/25 bg-surface-container-highest/40 space-y-1.5 text-xs">
                <div className="flex items-center gap-2 font-medium">
                  <Terminal className="h-4 w-4 text-primary" />
                  <span>Browser-Konsole & Laufzeitfehler</span>
                </div>
                <p className="text-label-sm text-on-surface-variant">
                  Überwacht die Konsole auf ungefangene Fehler oder Script-Abbrüche.
                </p>
                <div className="pt-1 flex items-center justify-between text-label-sm">
                  <span>Konsolenfehler:</span>
                  <span
                    className={`font-mono font-medium ${
                      (activeRun.summary.console_errors?.length || 0) > 0 ? 'text-status-destructive' : 'text-status-success'
                    }`}
                  >
                    {activeRun.summary.console_errors?.length || 0}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Error List if Failed */}
          {activeRun.summary?.errors && activeRun.summary.errors.length > 0 && (
            <div className="rounded-xl border border-status-destructive/30 bg-status-destructive/10 p-3.5 text-xs text-status-destructive space-y-1.5">
              <div className="flex items-center gap-2 font-semibold text-status-destructive">
                <AlertCircle className="h-4 w-4" />
                <span>Aufgetretene Testfehler ({activeRun.summary.errors.length})</span>
              </div>
              <ul className="list-disc pl-6 space-y-1 font-mono text-label-sm opacity-90">
                {activeRun.summary.errors.map((err: string, idx: number) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* History Toggle */}
      {testRuns.length > 1 && (
        <div className="space-y-2 pt-1">
          <button
            type="button"
            onClick={() => setShowHistory((prev) => !prev)}
            className="flex items-center gap-1.5 text-xs text-on-surface-variant hover:text-on-surface font-medium transition-colors"
          >
            {showHistory ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            <Clock className="h-3.5 w-3.5" />
            <span>Vergangene Testläufe ({testRuns.length})</span>
          </button>

          {showHistory && (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {testRuns.map((r) => (
                <div
                  key={r.id}
                  onClick={() => setSelectedRunId(r.id)}
                  className={`flex items-center justify-between p-2.5 rounded-xl border text-xs cursor-pointer transition-all ${
                    r.id === activeRun?.id
                      ? 'bg-primary/10 border-primary text-primary'
                      : 'bg-surface-container-highest/30 border-outline-variant/20 text-on-surface-variant hover:bg-surface-container-highest/60'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {r.status === 'passed' ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-status-success" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-status-destructive" />
                    )}
                    <span className="font-mono text-label-sm">
                      {r.release_checksum ? r.release_checksum.slice(0, 10) : 'Testlauf'}
                    </span>
                  </div>
                  <span className="text-label-sm opacity-70">
                    {r.started_at ? new Date(r.started_at).toLocaleTimeString('de-DE') : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
