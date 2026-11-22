import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FolderGit2,
  Globe,
  Rocket,
  Server as ServerIcon,
  ShoppingBag,
} from 'lucide-react'
import {
  aiApi,
  type AiProject,
  type AiProjectEnvironmentState,
  type AiProjectPublishOptions,
} from '@/api/ai'
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Dropdown,
  Input,
} from '@maunting/ui'
import { toast } from '@/stores/toastStore'

export interface SingraPublishModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedProject: AiProject | null
  envState: AiProjectEnvironmentState | null
  publishMode: 'fullstack_split' | 'frontend' | 'backend'
  setPublishMode: (mode: 'fullstack_split' | 'frontend' | 'backend') => void
  publishEnableDb: boolean
  setPublishEnableDb: (enable: boolean) => void
  publishApiPath: string
  setPublishApiPath: (path: string) => void
  publishBackendProxyUrl: string
  setPublishBackendProxyUrl: (url: string) => void
  selectedNodeId: string
  setSelectedNodeId: (id: string) => void
  availableNodes: Array<{ id: string; name: string; status?: string }>
  selectedTargetServerId?: string
  setSelectedTargetServerId?: (id: string) => void
  publishBindIp: string
  setPublishBindIp: (ip: string) => void
  publishOptions: AiProjectPublishOptions | null
  releaseNotes: string
  setReleaseNotes: (notes: string) => void
  publishDomainMode: 'ip' | 'cloudflare' | 'external'
  setPublishDomainMode: (mode: 'ip' | 'cloudflare' | 'external') => void
  publishCfZoneId: string
  setPublishCfZoneId: (id: string) => void
  publishCfSubdomain: string
  setPublishCfSubdomain: (sub: string) => void
  publishDomain: string
  setPublishDomain: (domain: string) => void
  publishMergeToMain: boolean
  setPublishMergeToMain: (merge: boolean) => void
  latestTestPassed: boolean | null
  setLatestTestPassed: (passed: boolean | null) => void
  publishing: boolean
  onSubmitDirect: (e: FormEvent) => void
  onGuidedPublish: () => void
}

export function SingraPublishModal({
  open,
  onOpenChange,
  selectedProject,
  envState,
  publishMode,
  setPublishMode,
  publishEnableDb,
  setPublishEnableDb,
  publishApiPath,
  setPublishApiPath,
  publishBackendProxyUrl,
  setPublishBackendProxyUrl,
  selectedNodeId,
  setSelectedNodeId,
  availableNodes,
  selectedTargetServerId = '',
  setSelectedTargetServerId,
  publishBindIp,
  setPublishBindIp,
  publishOptions,
  releaseNotes,
  setReleaseNotes,
  publishDomainMode,
  setPublishDomainMode,
  publishCfZoneId,
  setPublishCfZoneId,
  publishCfSubdomain,
  setPublishCfSubdomain,
  publishDomain,
  setPublishDomain,
  publishMergeToMain,
  setPublishMergeToMain,
  latestTestPassed,
  setLatestTestPassed,
  publishing,
  onSubmitDirect,
  onGuidedPublish,
}: SingraPublishModalProps) {
  const isRentedMode = publishOptions?.mode === 'rented_server'
  const targetServers = publishOptions?.target_servers ?? []
  const missingRentedServer = isRentedMode && (targetServers.length === 0 || !selectedTargetServerId)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="h-5 w-5 text-primary" />
            <span>
              {envState?.production?.published
                ? 'Produktions-Update veröffentlichen'
                : 'Projekt auf Produktion online schalten'}
            </span>
          </DialogTitle>
          <DialogDescription>
            {isRentedMode
              ? 'Überträgt den aktuellen Projektstand auf deinen ausgewählten gemieteten Web- oder Bot-Server und startet ihn anschließend neu.'
              : 'Übernimmt deinen aktuellen Entwicklungsstand auf eine Node, führt ausstehende PostgreSQL-Migrationen aus und stellt das Projekt im Server-Dashboard bereit.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmitDirect} className="space-y-4 p-6">
          {isRentedMode ? (
            <div className="space-y-4">
              {targetServers.length > 0 ? (
                <div>
                  <label className="block text-xs font-medium text-on-surface-variant mb-1">
                    Gemieteter Ziel-Server
                  </label>
                  <Dropdown
                    value={selectedTargetServerId}
                    onChange={(val) => setSelectedTargetServerId?.(val)}
                    options={targetServers.map((srv) => ({
                      value: String(srv.id),
                      label: `${srv.name} (${srv.game_type})`,
                    }))}
                    aria-label="Gemieteten Ziel-Server auswählen"
                  />
                  <p className="mt-1 text-xs text-on-surface-variant">
                    Unterstützt werden deine gemieteten Web- und Bot-Server mit Schreibrechten.
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-status-warning/30 bg-status-warning/10 p-4 space-y-3 text-xs">
                  <div className="flex items-start gap-2.5 text-on-surface">
                    <AlertTriangle className="h-4 w-4 text-status-warning shrink-0 mt-0.5" aria-hidden="true" />
                    <div className="space-y-1">
                      <p className="font-semibold">Kein passender Server gemietet</p>
                      <p className="text-on-surface-variant">
                        Für die Veröffentlichung eines KI-Projekts wird ein aktiver Frontend-, Backend- oder Bot-Server benötigt.
                      </p>
                    </div>
                  </div>
                  <Link
                    to="/shop"
                    onClick={() => onOpenChange(false)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 font-medium text-on-primary hover:opacity-90 transition-opacity"
                  >
                    <ShoppingBag className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Zum Shop</span>
                  </Link>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-on-surface-variant mb-1">
                  Release-Notiz (optional)
                </label>
                <Input
                  value={releaseNotes}
                  onChange={(e) => setReleaseNotes(e.target.value)}
                  placeholder="z. B. Startseite aktualisiert"
                  aria-label="Release-Notiz"
                />
              </div>

              {selectedProject?.git_repo_url && (
                <label className="flex items-center gap-2 text-xs text-on-surface cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={publishMergeToMain}
                    onChange={(e) => setPublishMergeToMain(e.target.checked)}
                    className="rounded border-outline-variant text-primary focus:ring-primary"
                  />
                  <span>Änderungen bei Veröffentlichung in den main-Branch mergen</span>
                </label>
              )}

              <div className="flex flex-wrap items-center justify-end gap-2.5 pt-4 border-t border-outline-variant/20">
                <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                  Abbrechen
                </Button>
                <Button type="submit" size="sm" disabled={publishing || missingRentedServer}>
                  <Rocket className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{publishing ? 'Veröffentlicht…' : 'Auf Server veröffentlichen'}</span>
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-outline-variant/25 bg-surface-container-low/50 p-3.5 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-on-surface-variant flex items-center gap-1.5">
                <Database className="h-3.5 w-3.5 text-primary" />
                <span>PostgreSQL Dev → Prod Branch</span>
              </span>
              <span className="font-mono text-on-surface">
                {envState?.dev_db?.branch ?? 'pg_dev'} → {envState?.prod_db?.branch ?? 'pg_prod'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-on-surface-variant flex items-center gap-1.5">
                <ServerIcon className="h-3.5 w-3.5 text-primary" />
                <span>Dashboard-Status</span>
              </span>
              <span className="font-medium text-on-surface">
                {envState?.production?.published
                  ? `Aktiv (Server #${envState.production.server_id}, Release #${envState.production.release_count})`
                  : 'Wird beim Veröffentlichen im Dashboard angelegt'}
              </span>
            </div>
            {envState?.production?.web_url && (
              <div className="flex items-center justify-between pt-1 border-t border-outline-variant/15">
                <span className="text-on-surface-variant flex items-center gap-1.5">
                  <Globe className="h-3.5 w-3.5 text-primary" />
                  <span>Öffentliche Adresse</span>
                </span>
                <a
                  href={envState.production.web_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-primary hover:underline truncate max-w-[260px]"
                >
                  {envState.production.web_url}
                </a>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-on-surface-variant mb-1">
              Architektur-Modus
            </label>
            <Dropdown
              value={publishMode}
              onChange={(val) => setPublishMode(val as 'fullstack_split' | 'frontend' | 'backend')}
              options={[
                { value: 'fullstack_split', label: 'Frontend & Backend getrennt (Fullstack)' },
                { value: 'frontend', label: 'Nur Frontend (Webseite / SPA über Caddy)' },
                { value: 'backend', label: 'Nur Backend (Docker-Container mit Port & DB)' },
              ]}
              aria-label="Architektur-Modus auswählen"
            />
          </div>

          {publishMode !== 'frontend' && (
            <label className="flex items-start gap-2.5 text-xs text-on-surface cursor-pointer rounded-xl border border-outline-variant/25 bg-surface-container-low/40 p-3 select-none">
              <input
                type="checkbox"
                checked={publishEnableDb}
                onChange={(e) => setPublishEnableDb(e.target.checked)}
                className="rounded border-outline-variant text-primary focus:ring-primary mt-0.5"
              />
              <div className="flex flex-col">
                <span className="font-medium text-on-surface">Eigene PostgreSQL-Datenbank automatisch anlegen & verbinden</span>
                <span className="text-xs text-on-surface-variant">Erstellt eine verwaltete Datenbank auf der Node und injiziert DATABASE_URL in die Umgebung des Backends.</span>
              </div>
            </label>
          )}

          {publishMode !== 'backend' && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-on-surface-variant mb-1">
                  API-Pfad für Backend-Proxy
                </label>
                <Input
                  value={publishApiPath}
                  onChange={(e) => setPublishApiPath(e.target.value)}
                  placeholder="/api/*"
                  aria-label="API-Pfad für Backend-Proxy"
                />
                <span className="text-xs text-on-surface-variant mt-0.5 block">Standard: /api/* (anpassbar für /graphql, /trpc/* etc.)</span>
              </div>
              {publishMode === 'frontend' && (
                <div>
                  <label className="block text-xs font-medium text-on-surface-variant mb-1">
                    Backend-Zieladresse (optional)
                  </label>
                  <Input
                    value={publishBackendProxyUrl}
                    onChange={(e) => setPublishBackendProxyUrl(e.target.value)}
                    placeholder="z. B. https://api.extern.de oder 127.0.0.1:5001"
                    aria-label="Backend-Zieladresse"
                  />
                  <span className="text-xs text-on-surface-variant mt-0.5 block">Wohin Caddy Anfragen an den API-Pfad weiterleiten soll.</span>
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-on-surface-variant mb-1">
              Ziel-Node auswählen
            </label>
            <Dropdown
              value={selectedNodeId}
              onChange={(val) => setSelectedNodeId(val)}
              options={[
                { value: '__auto__', label: 'Automatisch (Lokale Haupt-Node)' },
                ...availableNodes.map((n) => ({
                  value: n.id,
                  label: `${n.name} (${n.status === 'online' ? 'Online' : n.status || 'Bereit'})`,
                })),
              ]}
              aria-label="Ziel-Node auswählen"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-on-surface-variant mb-1">
              Öffentliche Node-IP (Schnittstelle)
            </label>
            <Dropdown
              value={publishBindIp || publishOptions?.default_ip || ''}
              onChange={(val) => setPublishBindIp(val)}
              options={
                (publishOptions?.public_ips || []).length > 0
                  ? (publishOptions?.public_ips || []).map((ip) => ({
                      value: ip.ip,
                      label: `${ip.ip} (${ip.interface}${!ip.is_private ? ' • Öffentlich' : ' • Privat'})`,
                    }))
                  : [{ value: '127.0.0.1', label: '127.0.0.1 (Lokal)' }]
              }
              aria-label="Öffentliche Schnittstelle auswählen"
            />
            <span className="text-xs text-on-surface-variant mt-0.5 block">
              Auf dieser IP-Adresse wird der Port für Web-Traffic nach außen freigegeben.
            </span>
          </div>

          <div>
            <label className="block text-xs font-medium text-on-surface-variant mb-1">
              Release-Notiz (optional)
            </label>
            <Input
              value={releaseNotes}
              onChange={(e) => setReleaseNotes(e.target.value)}
              placeholder="z. B. Dark Mode und Startseite veröffentlicht"
              aria-label="Release-Notiz"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-on-surface-variant mb-1">
              Erreichbar über
            </label>
            <Dropdown
              value={publishDomainMode}
              onChange={(val) => setPublishDomainMode(val as 'ip' | 'cloudflare' | 'external')}
              options={[
                { value: 'ip', label: 'IP-Adresse und Port' },
                { value: 'cloudflare', label: 'Domain über Cloudflare' },
                { value: 'external', label: 'Eigene Domain (mit Anleitung)' },
              ]}
              aria-label="Erreichbarkeit wählen"
            />
          </div>

          {publishDomainMode === 'cloudflare' && (
            <div className="rounded-xl border border-primary/25 bg-surface-container-low/50 p-3 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-on-surface flex items-center gap-1.5">
                  <Globe className="h-3.5 w-3.5 text-primary" />
                  <span>Cloudflare DNS-Automatisierung</span>
                </span>
                {publishOptions?.cloudflare_configured ? (
                  <Badge variant="success" className="text-xs">
                    ✓ Cloudflare verbunden
                  </Badge>
                ) : (
                  <Badge variant="warning" className="text-xs">
                    Kein Cloudflare-Token
                  </Badge>
                )}
              </div>
              {publishOptions?.cloudflare_configured && publishOptions.cloudflare_zones.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-xs font-medium text-on-surface-variant mb-1">
                      Domain / Zone
                    </label>
                    <Dropdown
                      value={publishCfZoneId}
                      onChange={(val) => setPublishCfZoneId(val)}
                      options={publishOptions.cloudflare_zones.map((z) => ({
                        value: z.id,
                        label: `${z.name} (${z.status})`,
                      }))}
                      aria-label="Cloudflare-Zone auswählen"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-on-surface-variant mb-1">
                      Subdomain-Präfix
                    </label>
                    <Input
                      value={publishCfSubdomain}
                      onChange={(e) => setPublishCfSubdomain(e.target.value)}
                      placeholder="z. B. app oder toast"
                      aria-label="Subdomain-Präfix"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-on-surface-variant mb-1">
                    Vollständige Domain
                  </label>
                  <Input
                    value={publishDomain}
                    onChange={(e) => setPublishDomain(e.target.value)}
                    placeholder="app.beispiel.de"
                    aria-label="Domain"
                  />
                </div>
              )}
              {publishDomain && (
                <div className="text-xs text-primary font-mono pt-1">
                  Zieladresse: https://{publishDomain}
                </div>
              )}
            </div>
          )}

          {publishDomainMode === 'external' && (
            <div>
              <label className="block text-xs font-medium text-on-surface-variant mb-1">
                Eigene Domain
              </label>
              <Input
                value={publishDomain}
                onChange={(e) => setPublishDomain(e.target.value)}
                placeholder="app.beispiel.de"
                aria-label="Domain"
              />
            </div>
          )}

          {selectedProject?.git_repo_url && (
            <div className="rounded-xl border border-outline-variant/25 bg-surface-container-low/40 p-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-on-surface-variant flex items-center gap-1.5">
                  <FolderGit2 className="h-3.5 w-3.5 text-primary" />
                  <span>Git-Repository</span>
                </span>
                {publishOptions?.github_configured ? (
                  <Badge variant="success" className="text-xs gap-1">
                    ✓ GitHub-Schlüssel im Konto hinterlegt
                  </Badge>
                ) : (
                  <span className="text-xs text-on-surface-variant font-mono truncate max-w-[200px]">
                    {selectedProject.git_repo_url}
                  </span>
                )}
              </div>
              <label className="flex items-center gap-2 text-xs text-on-surface cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={publishMergeToMain}
                  onChange={(e) => setPublishMergeToMain(e.target.checked)}
                  className="rounded border-outline-variant text-primary focus:ring-primary"
                />
                <span>Änderungen bei Veröffentlichung in den main-Branch mergen</span>
              </label>
            </div>
          )}

          <div className="rounded-xl border border-primary/25 bg-primary/8 p-3 text-xs text-on-surface-variant space-y-1">
            <div className="font-semibold text-on-surface">Wie geht es weiter?</div>
            <p>
              <span className="font-medium text-on-surface">Mit Singra:</span> Singra testet zuerst, veröffentlicht
              dann auf die Node, prüft die Erreichbarkeit und führt dich durch die Domain-Einrichtung.
            </p>
            <p>
              <span className="font-medium text-on-surface">Direkt:</span> Der aktuelle Stand wird sofort ohne
              vorherige Tests übernommen. Eine Domain musst du danach selbst verbinden.
            </p>
          </div>

          {/* Test-Gate Banner */}
          <div
            className={`p-3.5 rounded-xl border text-xs flex items-center justify-between gap-3 ${
              latestTestPassed === true
                ? 'bg-status-success/10 border-status-success/30 text-status-success'
                : latestTestPassed === false
                  ? 'bg-status-destructive/10 border-status-destructive/30 text-status-destructive'
                  : 'bg-status-warning/10 border-status-warning/30 text-status-warning'
            }`}
          >
            <div className="flex items-center gap-2.5">
              {latestTestPassed === true ? (
                <CheckCircle2 className="h-4 w-4 text-status-success shrink-0" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-status-warning shrink-0" />
              )}
              <div>
                <span className="font-semibold block">
                  {latestTestPassed === true
                    ? 'Test-Gate bestanden'
                    : latestTestPassed === false
                      ? 'Test-Gate nicht bestanden'
                      : 'Test-Gate ausstehend'}
                </span>
                <span className="text-label-sm opacity-80">
                  {latestTestPassed === true
                    ? 'Browser-, Layout- und Sicherheitsprüfungen wurden erfolgreich durchlaufen.'
                    : 'Vor der Veröffentlichung müssen automatisierte Tests für diesen Release-Stand vorliegen.'}
                </span>
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="text-xs h-7 shrink-0"
              onClick={async () => {
                if (!selectedProject) return
                toast.info('Starte System- und Browsertests …')
                try {
                  const testRes = await aiApi.runProjectTests(selectedProject.id)
                  setLatestTestPassed(testRes.passed)
                  if (testRes.passed) {
                    toast.success('Test-Gate bestanden!')
                  } else {
                    toast.warning('Test-Gate meldet Fehler.')
                  }
                } catch {
                  toast.error('Tests konnten nicht ausgeführt werden.')
                }
              }}
            >
              Tests jetzt starten
            </Button>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2.5 pt-4 border-t border-outline-variant/20">
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Abbrechen
            </Button>
            <Button type="submit" variant="secondary" size="sm" disabled={publishing}>
              <span>{publishing ? 'Veröffentlicht…' : 'Direkt veröffentlichen'}</span>
            </Button>
            <Button type="button" size="sm" disabled={publishing} onClick={onGuidedPublish}>
              <Rocket className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Mit Singra online schalten</span>
            </Button>
          </div>
          </>
          )}
        </form>
      </DialogContent>
    </Dialog>
  )
}
