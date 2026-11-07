import { useCallback, useEffect, useState } from 'react'
import {
  Activity,
  Bot,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Cpu,
  LayoutGrid,
  Monitor,
  Plug,
  Plus,
  Server,
  ShieldAlert,
  Trash2,
} from 'lucide-react'
import {
  aiApi,
  type AiMcpServer,
  type AiMcpServerWrite,
  type AiWorkerInfo,
} from '@/api/ai'
import { api, SanitizedApiError } from '@/api/client'
import { teamsApi, type Team } from '@/api/teams'
import { AiAutonomyButton } from '@/components/ai/AiAutonomyButton'
import { AufgabenAnsicht } from '@/components/ai/AufgabenAnsicht'
import { GuardianAnsicht } from '@/components/ai/GuardianAnsicht'
import { WorkerAnsicht } from '@/components/ai/WorkerAnsicht'
import { useHasPermission } from '@/hooks/useHasPermission'
import {
  SINGRA_MCP_PRESETS,
  type SingraMcpPreset,
} from './singraTemplates'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Dropdown,
  Input,
  Spinner,
  Switch,
} from '@maunting/ui'
import { confirm } from '@/stores/confirmStore'
import { toast } from '@/stores/toastStore'

type ToolSubTab = 'mcp' | 'tasks' | 'workers' | 'guardian'

interface ServerOption {
  id: number
  name: string
}

interface SingraToolsViewProps {
  initialSubTab?: ToolSubTab
  initialWorkerId?: string | null
  appFaehigkeiten?: {
    computer_use?: boolean | null
    artifact_install?: boolean | null
  }
}

const TRANSPORT_OPTIONS = [
  { value: 'http', label: 'Web-Verbindung (HTTP)' },
  { value: 'sse', label: 'Live-Stream (SSE)' },
  { value: 'stdio', label: 'Lokales Programm (Kommandozeile)' },
]

export function SingraToolsView({
  initialSubTab = 'mcp',
  initialWorkerId = null,
  appFaehigkeiten,
}: SingraToolsViewProps) {
  const canUseAutonomy = useHasPermission('ai.autonomous.use')
  const canManageTasks = useHasPermission('ai.tasks.manage')
  const canManageGlobalSettings = useHasPermission('ai.settings.manage')

  const [subTab, setSubTab] = useState<ToolSubTab>(initialSubTab)
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(initialWorkerId)
  const [servers, setServers] = useState<ServerOption[]>([])
  const [workers, setWorkers] = useState<AiWorkerInfo[]>([])
  const [mcpServers, setMcpServers] = useState<AiMcpServer[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [loadingMcp, setLoadingMcp] = useState(true)
  const [showAllPresets, setShowAllPresets] = useState(false)

  // Create MCP Integration Modal
  const [mcpModalOpen, setMcpModalOpen] = useState(false)
  const [isPresetModal, setIsPresetModal] = useState(false)
  const [showTechnicalMcp, setShowTechnicalMcp] = useState(false)
  const [savingMcp, setSavingMcp] = useState(false)
  const [mcpDraft, setMcpDraft] = useState<
    AiMcpServerWrite & { name: string; scopeChoice: string }
  >({
    name: '',
    description: '',
    transport: 'http',
    endpoint_url: '',
    command: '',
    args: [],
    auth_header: '',
    enabled: true,
    scopeChoice: 'personal',
  })
  const [argsInput, setArgsInput] = useState('')

  useEffect(() => {
    if (initialSubTab) setSubTab(initialSubTab)
  }, [initialSubTab])

  useEffect(() => {
    if (initialWorkerId) {
      setSelectedWorkerId(initialWorkerId)
      setSubTab('workers')
    }
  }, [initialWorkerId])

  useEffect(() => {
    let active = true
    if (canUseAutonomy) {
      api<ServerOption[]>('/servers')
        .then((rows) => {
          if (active) setServers(rows)
        })
        .catch(() => undefined)
    }
    return () => {
      active = false
    }
  }, [canUseAutonomy])

  const loadToolsData = useCallback(async () => {
    setLoadingMcp(true)
    try {
      const [mcpRows, workerRows, teamRows] = await Promise.all([
        aiApi.listMcpServers().catch(() => [] as AiMcpServer[]),
        aiApi.listWorkers().catch(() => [] as AiWorkerInfo[]),
        teamsApi.list().catch(() => [] as Team[]),
      ])
      setMcpServers(mcpRows)
      setWorkers(workerRows)
      setTeams(teamRows.filter((t) => !t.is_personal))
    } finally {
      setLoadingMcp(false)
    }
  }, [])

  useEffect(() => {
    void loadToolsData()
  }, [loadToolsData])

  const handleApplyPreset = (preset: SingraMcpPreset) => {
    setMcpDraft({
      name: preset.name,
      description: preset.description,
      transport: preset.transport,
      endpoint_url: preset.endpoint_url || '',
      command: preset.command || '',
      args: preset.args || [],
      auth_header: preset.auth_header || '',
      enabled: true,
      scopeChoice: 'personal',
    })
    setArgsInput((preset.args || []).join(' '))
    setIsPresetModal(true)
    setShowTechnicalMcp(false)
    setMcpModalOpen(true)
  }

  const handleOpenCustomModal = () => {
    setMcpDraft({
      name: '',
      description: '',
      transport: 'http',
      endpoint_url: '',
      command: '',
      args: [],
      auth_header: '',
      enabled: true,
      scopeChoice: 'personal',
    })
    setArgsInput('')
    setIsPresetModal(false)
    setShowTechnicalMcp(true)
    setMcpModalOpen(true)
  }

  const handleCreateMcp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!mcpDraft.name.trim() || savingMcp) return
    setSavingMcp(true)
    try {
      const isGlobal = mcpDraft.scopeChoice === 'global'
      const teamId =
        mcpDraft.scopeChoice !== 'personal' && mcpDraft.scopeChoice !== 'global'
          ? Number(mcpDraft.scopeChoice)
          : null
      const parsedArgs = argsInput
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean)

      const created = await aiApi.createMcpServer({
        name: mcpDraft.name.trim(),
        description: mcpDraft.description?.trim() || null,
        transport: mcpDraft.transport ?? 'http',
        endpoint_url:
          mcpDraft.transport === 'stdio'
            ? null
            : mcpDraft.endpoint_url?.trim() || null,
        command:
          mcpDraft.transport === 'stdio' ? mcpDraft.command?.trim() || null : null,
        args: mcpDraft.transport === 'stdio' ? parsedArgs : [],
        auth_header: mcpDraft.auth_header?.trim() || null,
        team_id: teamId,
        is_global: isGlobal,
        enabled: true,
      })
      setMcpServers((prev) => [created, ...prev])
      setMcpModalOpen(false)
      toast.success('Integration verbunden.')
    } catch (err: unknown) {
      toast.error(
        err instanceof SanitizedApiError
          ? err.message
          : 'Integration konnte nicht gespeichert werden.',
      )
    } finally {
      setSavingMcp(false)
    }
  }

  const handleToggleMcp = async (srv: AiMcpServer, enabled: boolean) => {
    try {
      const updated = await aiApi.updateMcpServer(srv.id, { enabled })
      setMcpServers((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
    } catch (err: unknown) {
      toast.error(
        err instanceof SanitizedApiError
          ? err.message
          : 'Status konnte nicht geändert werden.',
      )
    }
  }

  const handleDeleteMcp = async (srv: AiMcpServer) => {
    const ok = await confirm({
      title: 'Integration entfernen',
      message: `Soll die Integration „${srv.name}“ wirklich getrennt werden?`,
      confirmText: 'Entfernen',
      danger: true,
    })
    if (!ok) return
    try {
      await aiApi.deleteMcpServer(srv.id)
      setMcpServers((prev) => prev.filter((s) => s.id !== srv.id))
      toast.success('Integration entfernt.')
    } catch (err: unknown) {
      toast.error(
        err instanceof SanitizedApiError
          ? err.message
          : 'Integration konnte nicht entfernt werden.',
      )
    }
  }

  const visiblePresets = showAllPresets
    ? SINGRA_MCP_PRESETS
    : SINGRA_MCP_PRESETS.slice(0, 6)

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-surface px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-5">
        {/* Calm Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-outline-variant/25 bg-surface-container-low/40 p-5">
          <div className="flex items-start gap-3 max-w-xl">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <LayoutGrid className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="font-headline text-lg font-semibold text-on-surface">
                Werkzeuge & Integrationen
              </h2>
              <p className="text-xs text-on-surface-variant mt-0.5 leading-relaxed">
                Verbinde externe Dienste, verwalte geplante Aufgaben und lege fest, was Singra selbstständig ausführen darf.
              </p>
            </div>
          </div>

          {subTab === 'mcp' && (
            <Button
              type="button"
              size="sm"
              className="rounded-full px-4"
              onClick={handleOpenCustomModal}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Eigene Integration
            </Button>
          )}
        </div>

        {/* Compact Capability Cards: Selbstständiger Modus & Gerät */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-outline-variant/25 bg-surface-container-low/35 p-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
                <Bot className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-on-surface">
                  Selbstständiges Handeln
                </div>
                <p className="text-xs text-on-surface-variant mt-0.5">
                  Freigegebene Schritte ohne einzelne Rückfrage erledigen.
                </p>
              </div>
            </div>
            {canUseAutonomy ? (
              <div className="shrink-0">
                <AiAutonomyButton servers={servers} />
              </div>
            ) : (
              <span className="text-xs text-on-surface-variant">Gesperrt</span>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 rounded-2xl border border-outline-variant/25 bg-surface-container-low/35 p-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
                <Monitor className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-on-surface">
                  Lokale App-Werkzeuge
                </div>
                <p className="text-xs text-on-surface-variant mt-0.5">
                  {appFaehigkeiten?.computer_use === true
                    ? 'In deiner Desktop-App aktiv.'
                    : 'Über Projekt-Arbeitsbereich verfügbar.'}
                </p>
              </div>
            </div>
            <span
              className={[
                'shrink-0 rounded-full px-2.5 py-1 text-xs font-medium border',
                appFaehigkeiten?.computer_use
                  ? 'border-status-success/30 bg-status-success/15 text-status-success'
                  : 'border-outline-variant/35 bg-surface-container text-on-surface-variant',
              ].join(' ')}
            >
              {appFaehigkeiten?.computer_use ? 'Aktiv' : 'Bereit'}
            </span>
          </div>
        </div>

        {/* Sub-Navigation Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
          <button
            type="button"
            onClick={() => setSubTab('mcp')}
            className={[
              'inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors shrink-0 border',
              subTab === 'mcp'
                ? 'bg-primary/15 text-primary border-primary/30'
                : 'text-on-surface-variant hover:bg-surface-container-high/50 hover:text-on-surface border-transparent',
            ].join(' ')}
          >
            <Plug className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Integrationen ({mcpServers.length})</span>
          </button>

          {canManageTasks && (
            <button
              type="button"
              onClick={() => setSubTab('tasks')}
              className={[
                'inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors shrink-0 border',
                subTab === 'tasks'
                  ? 'bg-primary/15 text-primary border-primary/30'
                  : 'text-on-surface-variant hover:bg-surface-container-high/50 hover:text-on-surface border-transparent',
              ].join(' ')}
            >
              <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Geplante Aufgaben</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setSubTab('workers')}
            className={[
              'inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors shrink-0 border',
              subTab === 'workers'
                ? 'bg-primary/15 text-primary border-primary/30'
                : 'text-on-surface-variant hover:bg-surface-container-high/50 hover:text-on-surface border-transparent',
            ].join(' ')}
          >
            <Cpu className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Laufende Aufträge ({workers.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('guardian')}
            className={[
              'inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors shrink-0 border',
              subTab === 'guardian'
                ? 'bg-primary/15 text-primary border-primary/30'
                : 'text-on-surface-variant hover:bg-surface-container-high/50 hover:text-on-surface border-transparent',
            ].join(' ')}
          >
            <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Selbstheilung</span>
          </button>
        </div>

        {/* Sub-Tab Content */}
        {subTab === 'mcp' && (
          <div className="space-y-5">
            {/* Connected Integrations First */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-on-surface">
                Verbundene Dienste
              </h3>
              {loadingMcp ? (
                <div className="flex h-28 items-center justify-center">
                  <Spinner size="md" className="text-primary" />
                </div>
              ) : mcpServers.length === 0 ? (
                <div className="rounded-2xl border border-outline-variant/25 bg-surface-container-low/30 p-6 text-center">
                  <Server className="mx-auto h-7 w-7 text-primary/50 mb-2" />
                  <p className="text-sm font-medium text-on-surface">
                    Alle Grundwerkzeuge sind bereits aktiv
                  </p>
                  <p className="mt-1 text-xs text-on-surface-variant max-w-md mx-auto leading-relaxed">
                    Server-Steuerung, Dokumente, Projekte, Git und Web-Suche stehen ohne Einrichtung bereit. Unten kannst du bei Bedarf weitere Dienste verbinden.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {mcpServers.map((srv) => (
                    <div
                      key={srv.id}
                      className="flex flex-col justify-between rounded-2xl border border-outline-variant/25 bg-surface-container-low/40 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm text-on-surface truncate">
                              {srv.name}
                            </span>
                            <span className="rounded-full bg-primary/12 px-2 py-0.5 text-label-sm font-medium text-primary">
                              {srv.is_global
                                ? 'Global'
                                : srv.team_id
                                  ? 'Team'
                                  : 'Persönlich'}
                            </span>
                          </div>
                          {srv.description && (
                            <p className="mt-1 text-xs text-on-surface-variant leading-relaxed">
                              {srv.description}
                            </p>
                          )}
                        </div>
                        <Switch
                          checked={srv.enabled}
                          onCheckedChange={(val) => void handleToggleMcp(srv, val)}
                          aria-label={`${srv.name} aktivieren`}
                        />
                      </div>
                      <div className="mt-3 flex justify-end border-t border-outline-variant/15 pt-2">
                        <button
                          type="button"
                          onClick={() => void handleDeleteMcp(srv)}
                          className="inline-flex items-center gap-1 text-xs text-on-surface-variant hover:text-status-destructive transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Trennen
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 1-Click Integration Cards */}
            <div className="rounded-2xl border border-outline-variant/25 bg-surface-container-low/25 p-4 sm:p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-semibold text-on-surface">
                    Beliebte Erweiterungen
                  </h4>
                  <p className="text-xs text-on-surface-variant">
                    Mit einem Klick vorbereiten und verbinden.
                  </p>
                </div>
                {SINGRA_MCP_PRESETS.length > 6 && (
                  <button
                    type="button"
                    onClick={() => setShowAllPresets((v) => !v)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    <span>{showAllPresets ? 'Weniger anzeigen' : 'Alle anzeigen'}</span>
                    {showAllPresets ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {visiblePresets.map((preset) => (
                  <div
                    key={preset.id}
                    className="flex flex-col justify-between rounded-xl border border-outline-variant/20 bg-surface-container-low/60 p-3.5 hover:border-primary/35 transition-colors"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-1.5 mb-1">
                        <span className="text-xs font-semibold text-on-surface truncate">
                          {preset.name}
                        </span>
                        <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-label-sm font-medium text-primary shrink-0">
                          {preset.badge}
                        </span>
                      </div>
                      <p className="text-xs text-on-surface-variant line-clamp-2 leading-relaxed">
                        {preset.description}
                      </p>
                    </div>
                    <div className="mt-3 flex justify-end pt-2 border-t border-outline-variant/15">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-7 px-3 text-xs rounded-full"
                        onClick={() => handleApplyPreset(preset)}
                      >
                        Verbinden
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {subTab === 'tasks' && canManageTasks && (
          <div className="rounded-2xl border border-outline-variant/25 bg-surface-container-low/20 overflow-hidden">
            <AufgabenAnsicht />
          </div>
        )}

        {subTab === 'workers' && (
          <div className="space-y-4">
            {selectedWorkerId ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-on-surface">
                    Auftragsverlauf
                  </h3>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="rounded-full"
                    onClick={() => setSelectedWorkerId(null)}
                  >
                    Zurück zur Übersicht
                  </Button>
                </div>
                <div className="rounded-2xl border border-outline-variant/25 overflow-hidden min-h-[460px]">
                  <WorkerAnsicht
                    key={selectedWorkerId}
                    conversationId={selectedWorkerId}
                  />
                </div>
              </div>
            ) : workers.length === 0 ? (
              <div className="rounded-2xl border border-outline-variant/25 bg-surface-container-low/30 p-8 text-center">
                <Activity className="mx-auto h-8 w-8 text-on-surface-variant/60 mb-2" />
                <p className="text-sm font-medium text-on-surface">
                  Momentan laufen keine Aufträge im Hintergrund
                </p>
                <p className="mt-1 text-xs text-on-surface-variant max-w-md mx-auto">
                  Wenn Singra größere Aufgaben für dich im Hintergrund abarbeitet, kannst du den Fortschritt hier live verfolgen.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {workers.map((w) => (
                  <div
                    key={w.conversation_id}
                    className="flex items-center justify-between rounded-2xl border border-outline-variant/25 bg-surface-container-low/40 px-4 py-3"
                  >
                    <div>
                      <div className="text-sm font-medium text-on-surface">
                        {w.title}
                      </div>
                      <div className="text-xs text-on-surface-variant">
                        Gestartet um {new Date(w.created_at).toLocaleTimeString()}
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      className="rounded-full"
                      onClick={() => setSelectedWorkerId(w.conversation_id)}
                    >
                      Ansehen
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {subTab === 'guardian' && (
          <div className="rounded-2xl border border-outline-variant/25 bg-surface-container-low/20 overflow-hidden min-h-[480px]">
            <GuardianAnsicht />
          </div>
        )}
      </div>

      {/* Connect Integration Modal */}
      <Dialog open={mcpModalOpen} onOpenChange={setMcpModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {isPresetModal ? `${mcpDraft.name} verbinden` : 'Eigene Integration verbinden'}
            </DialogTitle>
            <DialogDescription>
              {isPresetModal
                ? mcpDraft.description || 'Verbinde diesen Dienst mit deinem Arbeitsbereich.'
                : 'Binde einen externen Werkzeug-Dienst für dich oder dein Team an.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateMcp} className="space-y-3.5 mt-2">
            {!isPresetModal && (
              <div>
                <label className="block text-xs font-medium text-on-surface-variant mb-1">
                  Name der Integration
                </label>
                <Input
                  value={mcpDraft.name}
                  onChange={(e) => setMcpDraft((d) => ({ ...d, name: e.target.value }))}
                  placeholder="z. B. Firmen-Wiki oder GitLab"
                  required
                  aria-label="MCP-Server Name"
                />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-on-surface-variant mb-1">
                  Wer darf die Integration nutzen?
                </label>
                <Dropdown
                  value={mcpDraft.scopeChoice}
                  onChange={(val) =>
                    setMcpDraft((d) => ({ ...d, scopeChoice: val }))
                  }
                  options={[
                    { value: 'personal', label: 'Nur ich (Persönlich)' },
                    ...teams.map((t) => ({
                      value: String(t.id),
                      label: `Team: ${t.name}`,
                    })),
                    ...(canManageGlobalSettings
                      ? [{ value: 'global', label: 'Alle Nutzer (Global)' }]
                      : []),
                  ]}
                  aria-label="Sichtbarkeit"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-on-surface-variant mb-1">
                  Zugangsschlüssel / Token (optional)
                </label>
                <Input
                  type="password"
                  value={mcpDraft.auth_header ?? ''}
                  onChange={(e) =>
                    setMcpDraft((d) => ({ ...d, auth_header: e.target.value }))
                  }
                  placeholder="Bearer …"
                  aria-label="Authorization Header"
                />
              </div>
            </div>

            {isPresetModal && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowTechnicalMcp((v) => !v)}
                  className="inline-flex items-center gap-1 text-xs text-on-surface-variant hover:text-on-surface"
                >
                  {showTechnicalMcp ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                  <span>Verbindungsdetails anpassen</span>
                </button>
              </div>
            )}

            {showTechnicalMcp && (
              <div className="space-y-3 rounded-xl border border-outline-variant/20 bg-surface-container-low/40 p-3.5">
                <div>
                  <label className="block text-xs font-medium text-on-surface-variant mb-1">
                    Verbindungsart
                  </label>
                  <Dropdown
                    value={mcpDraft.transport ?? 'http'}
                    onChange={(val) =>
                      setMcpDraft((d) => ({
                        ...d,
                        transport: val as 'http' | 'sse' | 'stdio',
                      }))
                    }
                    options={TRANSPORT_OPTIONS}
                    aria-label="Transport-Protokoll"
                  />
                </div>

                {mcpDraft.transport === 'stdio' ? (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-on-surface-variant mb-1">
                        Programm / Befehl
                      </label>
                      <Input
                        value={mcpDraft.command ?? ''}
                        onChange={(e) =>
                          setMcpDraft((d) => ({ ...d, command: e.target.value }))
                        }
                        placeholder="npx"
                        aria-label="Befehl"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-on-surface-variant mb-1">
                        Startparameter
                      </label>
                      <Input
                        value={argsInput}
                        onChange={(e) => setArgsInput(e.target.value)}
                        placeholder="-y @modelcontextprotocol/server-filesystem /pfad"
                        aria-label="Argumente"
                      />
                    </div>
                  </>
                ) : (
                  <div>
                    <label className="block text-xs font-medium text-on-surface-variant mb-1">
                      Server-Adresse (HTTPS)
                    </label>
                    <Input
                      value={mcpDraft.endpoint_url ?? ''}
                      onChange={(e) =>
                        setMcpDraft((d) => ({ ...d, endpoint_url: e.target.value }))
                      }
                      placeholder="https://mcp.example.com/mcp"
                      aria-label="Endpunkt-URL"
                    />
                  </div>
                )}

                {!isPresetModal && (
                  <div>
                    <label className="block text-xs font-medium text-on-surface-variant mb-1">
                      Kurzbeschreibung (optional)
                    </label>
                    <Input
                      value={mcpDraft.description ?? ''}
                      onChange={(e) =>
                        setMcpDraft((d) => ({ ...d, description: e.target.value }))
                      }
                      placeholder="Wofür wird dieser Dienst genutzt?"
                      aria-label="Kurzbeschreibung"
                    />
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-outline-variant/20">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setMcpModalOpen(false)}
              >
                Abbrechen
              </Button>
              <Button type="submit" disabled={savingMcp || !mcpDraft.name.trim()}>
                {savingMcp ? 'Verbindet…' : 'Verbinden'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
