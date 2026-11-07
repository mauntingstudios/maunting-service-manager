import { useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Monitor,
  RefreshCw,
  Smartphone,
  Sparkles,
  Wrench,
  XCircle,
} from 'lucide-react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Kurzinfo,
  Spinner,
} from '@maunting/ui'

import type { AiPreviewInspectionResult } from '@/api/ai'

export interface SingraVisualInspectionModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  projectName: string
  inspectionResult: AiPreviewInspectionResult | null
  loading: boolean
  onReinspect: () => void
  onFixWithSingra: (issues: string[]) => void
}

export function SingraVisualInspectionModal({
  open,
  onOpenChange,
  projectName,
  inspectionResult,
  loading,
  onReinspect,
  onFixWithSingra,
}: SingraVisualInspectionModalProps) {
  const [activeTab, setActiveTab] = useState<'mobile' | 'desktop'>('mobile')
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null)

  const mobileVp = inspectionResult?.viewports?.mobile
  const desktopVp = inspectionResult?.viewports?.desktop
  const currentVp = activeTab === 'mobile' ? mobileVp : desktopVp

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
              <span>Visuelle KI-Sichtprüfung — „{projectName}“</span>
            </DialogTitle>
            <DialogDescription>
              Singra rendert die App im Headless-Browser auf echten Displaygrößen, fängt Konsolenfehler ab und
              erkennt seitlichen Überlauf auf Mobilgeräten.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 px-6 pb-6 pt-3">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
                <Spinner size="lg" className="text-primary" />
                <div className="text-sm font-medium text-on-surface">
                  Vorschau wird im Headless-Browser gerendert…
                </div>
                <p className="text-xs text-on-surface-variant max-w-sm">
                  Erzeuge Screenshots für Smartphone (375 px) und Desktop (1280 px), messe Layoutbreiten und prüfe
                  auf JavaScript-Fehler.
                </p>
              </div>
            ) : !inspectionResult ? (
              <div className="py-12 text-center text-xs text-on-surface-variant">
                Noch keine Prüfergebnisse vorhanden.
              </div>
            ) : (
              <>
                {/* Status-Banner */}
                <div
                  className={[
                    'flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4',
                    inspectionResult.ok
                      ? 'border-status-success/35 bg-status-success/10 text-on-surface'
                      : 'border-status-destructive/35 bg-status-destructive/10 text-on-surface',
                  ].join(' ')}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {inspectionResult.ok ? (
                      <CheckCircle2 className="h-6 w-6 text-status-success shrink-0" aria-hidden="true" />
                    ) : (
                      <AlertTriangle className="h-6 w-6 text-status-destructive shrink-0" aria-hidden="true" />
                    )}
                    <div>
                      <div className="text-sm font-semibold">
                        {inspectionResult.ok
                          ? 'Alle visuellen Tests bestanden'
                          : `${inspectionResult.issues.length} Layout- oder Render-Problem${inspectionResult.issues.length === 1 ? '' : 'e'} erkannt`}
                      </div>
                      <div className="text-xs text-on-surface-variant mt-0.5">
                        {inspectionResult.summary}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={onReinspect}
                      className="gap-1.5 text-xs"
                    >
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                      Erneut prüfen
                    </Button>
                    {!inspectionResult.ok && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          onOpenChange(false)
                          onFixWithSingra(inspectionResult.issues)
                        }}
                        className="gap-1.5 text-xs"
                      >
                        <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
                        Mit Singra beheben
                      </Button>
                    )}
                  </div>
                </div>

                {/* Wenn Probleme vorhanden sind: Konkrete Liste */}
                {inspectionResult.issues.length > 0 && (
                  <div className="rounded-xl border border-status-destructive/25 bg-status-destructive/5 p-3.5 space-y-2">
                    <div className="text-xs font-semibold text-status-destructive flex items-center gap-1.5">
                      <XCircle className="h-4 w-4" aria-hidden="true" />
                      <span>Erkannte Auffälligkeiten:</span>
                    </div>
                    <ul className="space-y-1 text-xs text-on-surface list-disc pl-5">
                      {inspectionResult.issues.map((iss, i) => (
                        <li key={i}>{iss}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Viewport-Auswahl (Smartphone vs. Desktop) */}
                <div className="flex items-center justify-between border-b border-outline-variant/20 pb-2 pt-1">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveTab('mobile')}
                      className={[
                        'flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-medium transition-all',
                        activeTab === 'mobile'
                          ? 'bg-primary/15 text-primary border border-primary/30'
                          : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high',
                      ].join(' ')}
                    >
                      <Smartphone className="h-4 w-4" aria-hidden="true" />
                      <span>Smartphone (375 × 667)</span>
                      {mobileVp?.overflow ? (
                        <span className="rounded bg-status-destructive/20 px-1.5 py-0.2 text-label-sm text-status-destructive">
                          Überlauf
                        </span>
                      ) : (
                        <span className="rounded bg-status-success/20 px-1.5 py-0.2 text-label-sm text-status-success">
                          OK
                        </span>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveTab('desktop')}
                      className={[
                        'flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-medium transition-all',
                        activeTab === 'desktop'
                          ? 'bg-primary/15 text-primary border border-primary/30'
                          : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high',
                      ].join(' ')}
                    >
                      <Monitor className="h-4 w-4" aria-hidden="true" />
                      <span>Desktop (1280 × 800)</span>
                      {desktopVp?.overflow ? (
                        <span className="rounded bg-status-destructive/20 px-1.5 py-0.2 text-label-sm text-status-destructive">
                          Überlauf
                        </span>
                      ) : (
                        <span className="rounded bg-status-success/20 px-1.5 py-0.2 text-label-sm text-status-success">
                          OK
                        </span>
                      )}
                    </button>
                  </div>

                  {inspectionResult.browser_name && (
                    <span className="font-mono text-label-sm text-on-surface-variant hidden sm:inline">
                      Engine: {inspectionResult.browser_name} (Headless)
                    </span>
                  )}
                </div>

                {/* Screenshot & Metriken des gewählten Viewports */}
                {currentVp && (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
                    {/* Linke Seite: Screenshot */}
                    <div className="lg:col-span-2 flex flex-col items-center justify-center rounded-2xl border border-outline-variant/30 bg-black/40 p-4 min-h-[360px]">
                      {currentVp.screenshot_base64 ? (
                        <div className="relative group max-h-[500px] overflow-auto rounded-xl border border-white/10 shadow-2xl bg-white">
                          <img
                            src={currentVp.screenshot_base64}
                            alt={`Headless-Screenshot ${currentVp.label}`}
                            className="max-h-[480px] w-auto object-contain cursor-zoom-in"
                            onClick={() => setFullscreenImage(currentVp.screenshot_base64)}
                          />
                          <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Kurzinfo text="In Originalgröße ansehen">
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                onClick={() => setFullscreenImage(currentVp.screenshot_base64)}
                                className="h-7 w-7 p-0 rounded-full"
                              >
                                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                              </Button>
                            </Kurzinfo>
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs text-on-surface-variant">
                          Kein Screenshot für diesen Viewport erzeugt.
                        </div>
                      )}
                    </div>

                    {/* Rechte Seite: Messwerte */}
                    <div className="space-y-3 rounded-2xl border border-outline-variant/25 bg-surface-container-low/40 p-4 text-xs">
                      <div className="font-semibold text-on-surface pb-1 border-b border-outline-variant/15">
                        Layout-Messungen ({currentVp.label})
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-on-surface-variant">Displaybreite</span>
                          <span className="font-mono font-medium text-on-surface">{currentVp.width} px</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-on-surface-variant">Inhaltsbreite (scrollWidth)</span>
                          <span
                            className={[
                              'font-mono font-medium',
                              currentVp.overflow ? 'text-status-destructive' : 'text-status-success',
                            ].join(' ')}
                          >
                            {currentVp.scroll_width} px
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-on-surface-variant">Seitlicher Überlauf</span>
                          <span
                            className={[
                              'font-semibold',
                              currentVp.overflow ? 'text-status-destructive' : 'text-status-success',
                            ].join(' ')}
                          >
                            {currentVp.overflow ? 'Ja (Aktion nötig)' : 'Keiner (Mobilfreundlich)'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-on-surface-variant">Render-Status</span>
                          <span
                            className={[
                              'font-medium',
                              currentVp.root_empty ? 'text-status-destructive' : 'text-status-success',
                            ].join(' ')}
                          >
                            {currentVp.root_empty ? 'Leeres Element' : 'Sichtbare Inhalte gerendert'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-on-surface-variant">Konsole</span>
                          <span
                            className={[
                              'font-medium',
                              currentVp.errors.length > 0 ? 'text-status-destructive' : 'text-status-success',
                            ].join(' ')}
                          >
                            {currentVp.errors.length === 0
                              ? '0 Fehler'
                              : `${currentVp.errors.length} Fehler`}
                          </span>
                        </div>
                      </div>

                      {currentVp.errors.length > 0 && (
                        <div className="mt-2 rounded-xl bg-status-destructive/10 border border-status-destructive/25 p-2.5 space-y-1">
                          <div className="font-medium text-status-destructive">Konsolenausgaben:</div>
                          <pre className="max-h-28 overflow-auto font-mono text-label-sm whitespace-pre-wrap break-words text-on-surface-variant">
                            {currentVp.errors.join('\n')}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="flex justify-end pt-3 border-t border-outline-variant/20">
              <Button type="button" onClick={() => onOpenChange(false)}>
                Schließen
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Vollbild-Zoom des Screenshots */}
      <Dialog open={Boolean(fullscreenImage)} onOpenChange={() => setFullscreenImage(null)}>
        <DialogContent className="max-w-6xl max-h-[96vh] p-2 flex flex-col items-center justify-center bg-black/95">
          <img
            src={fullscreenImage ?? ''}
            alt="Vergrößerte Vorschau"
            className="max-h-[90vh] max-w-full object-contain rounded-lg"
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
