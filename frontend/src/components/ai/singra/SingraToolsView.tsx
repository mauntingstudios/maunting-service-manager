import { useCallback, useEffect, useState } from 'react'
import {
  Activity,
  Bot,
  CalendarClock,
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
  { value: 'http', label: 'Remote HTTP (Streamable HTTP)' },
  { value: 'sse', label: 'Remote SSE (Server-Sent Events)' },
  { value: 'stdio', label: 'Lokaler Prozess (Stdio / Kommandozeile)' },
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

  // Create MCP Server Modal
  const [mcpModalOpen, setMcpModalOpen] = useState(false)
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
      toast.success('MCP-Server hinzugefügt.')
    } catch (err: unknown) {
      toast.error(
        err instanceof SanitizedApiError
          ? err.message
          : 'MCP-Server konnte nicht gespeichert werden.',
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
      title: 'MCP-Server entfernen',
      message: `Soll der MCP-Server „${srv.name}“ wirklich gelöscht werden?`,
      confirmText: 'Löschen',
      danger: true,
    })
    if (!ok) return
    try {
      await aiApi.deleteMcpServer(srv.id)
      setMcpServers((prev) => prev.filter((s) => s.id !== srv.id))
      toast.success('MCP-Server gelöscht.')
    } catch (err: unknown) {
      toast.error(
        err instanceof SanitizedApiError
          ? err.message
          : 'MCP-Server konnte nicht gelöscht werden.',
      )
    }
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-surface px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <LayoutGrid className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="font-headline text-lg font-semibold text-on-surface">
              Singra Werkzeuge, Automatisierung & MCP
            </h2>
            <p className="text-xs text-on-surface-variant">
              Steuere autonome Berechtigungen, Computer-Use, geplante Aufgaben, Hintergrund-Worker, Guardian-Heilungen und externe MCP-Server.
            </p>
          </div>
        </div>

        {/* Top Quick-Toggles: Autonomer Modus & Computer-Use */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex items-center justify-between gap-4 rounded-2xl border border-outline-variant/30 bg-surface-container-low/45 p-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <Bot className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-on-surface">
                  Autonomer Modus
                </div>
                <p className="text-xs text-on-surface-variant mt-0.5">
                  Erlaubt Singra, genehmigte Aktionen bis zum Stundenlimit direkt ohne einzelne Rückfrage auszuführen.
                </p>
              </div>
            </div>
            {canUseAutonomy ? (
              <div className="shrink-0">
                <AiAutonomyButton servers={servers} />
              </div>
            ) : (
              <span className="text-xs text-on-surface-variant">Keine Berechtigung</span>
            )}
          </div>

          <div className="flex items-center justify-between gap-4 rounded-2xl border border-outline-variant/30 bg-surface-container-low/45 p-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <Monitor className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-on-surface">
                  Computer-Use & Desktop-Werkzeuge
                </div>
                <p className="text-xs text-on-surface-variant mt-0.5">
                  {appFaehigkeiten?.computer_use === true
                    ? 'Aktiv in deiner Smart-System Desktop-App. Singra darf lokale Werkzeuge nutzen.'
                    : appFaehigkeiten?.computer_use === false
                      ? 'In den Desktop-Einstellungen derzeit deaktiviert.'
                      : 'Verfügbar in der Maunting Smart-System Desktop-App sowie über die Projekt-Sandbox.'}
                </p>
              </div>
            </div>
            <span
              className={[
                'shrink-0 rounded-full px-2.5 py-1 text-xs font-medium border',
                appFaehigkeiten?.computer_use
                  ? 'border-status-success/30 bg-status-success/15 text-status-success'
                  : 'border-outline-variant/40 bg-surface-container text-on-surface-variant',
              ].join(' ')}
            >
              {appFaehigkeiten?.computer_use ? 'Aktiv' : 'Sandbox / App'}
            </span>
          </div>
        </div>

        {/* Sub-Navigation Tabs */}
        <div className="flex items-center gap-1.5 border-b border-outline-variant/25 pb-2 overflow-x-auto">
          <button
            type="button"
            onClick={() => setSubTab('mcp')}
            className={[
              'inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-medium transition-colors shrink-0',
              subTab === 'mcp'
                ? 'bg-primary/15 text-primary border border-primary/30'
                : 'text-on-surface-variant hover:bg-surface-container-high/50 hover:text-on-surface border border-transparent',
            ].join(' ')}
          >
            <Plug className="h-3.5 w-3.5" aria-hidden="true" />
            <span>MCP-Server ({mcpServers.length})</span>
          </button>

          {canManageTasks && (
            <button
              type="button"
              onClick={() => setSubTab('tasks')}
              className={[
                'inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-medium transition-colors shrink-0',
                subTab === 'tasks'
                  ? 'bg-primary/15 text-primary border border-primary/30'
                  : 'text-on-surface-variant hover:bg-surface-container-high/50 hover:text-on-surface border border-transparent',
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
              'inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-medium transition-colors shrink-0',
              subTab === 'workers'
                ? 'bg-primary/15 text-primary border border-primary/30'
                : 'text-on-surface-variant hover:bg-surface-container-high/50 hover:text-on-surface border border-transparent',
            ].join(' ')}
          >
            <Cpu className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Hintergrund-Worker ({workers.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('guardian')}
            className={[
              'inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-medium transition-colors shrink-0',
              subTab === 'guardian'
                ? 'bg-primary/15 text-primary border border-primary/30'
                : 'text-on-surface-variant hover:bg-surface-container-high/50 hover:text-on-surface border border-transparent',
            ].join(' ')}
          >
            <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Guardian-Heilungen</span>
          </button>
        </div>

        {/* Sub-Tab Content */}
        {subTab === 'mcp' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-on-surface">
                  Model Context Protocol (MCP) Server
                </h3>
                <p className="text-xs text-on-surface-variant">
                  Binde zusätzliche Werkzeug-Server über Remote HTTP/SSE oder lokale Prozesse an Singra an.
                </p>
              </div>
              <Button type="button" size="sm" onClick={() => setMcpModalOpen(true)}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                MCP-Server verbinden
              </Button>
            </div>

            {/* 1-Klick MCP Vorlagen */}
            <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-low/30 p-4">
              <div className="mb-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-primary">
                  1-Klick Vorlagen
                </h4>
                <p className="text-xs text-on-surface-variant">
                  Wähle einen beliebten Konnektor aus, um ihn direkt mit deinen Zugangsdaten zu verbinden.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {SINGRA_MCP_PRESETS.map((preset) => (
                  <div
                    key={preset.id}
                    className="flex flex-col justify-between rounded-xl border border-outline-variant/20 bg-surface-container-low/60 p-3 hover:border-primary/40 transition-colors"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-1.5 mb-1">
                        <span className="text-xs font-semibold text-on-surface truncate">
                          {preset.name}
                        </span>
                        <span className="rounded bg-surface-container-high px-1.5 py-0.5 text-label-sm font-medium text-primary shrink-0">
                          {preset.badge}
                        </span>
                      </div>
                      <p className="text-xs text-on-surface-variant line-clamp-2">
                        {preset.description}
                      </p>
                    </div>
                    <div className="mt-3 flex items-center justify-between pt-2 border-t border-outline-variant/15">
                      <span className="text-label-sm font-mono text-on-surface-variant">
                        {preset.transport}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => handleApplyPreset(preset)}
                      >
                        Hinzufügen
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {loadingMcp ? (
              <div className="flex h-32 items-center justify-center">
                <Spinner size="md" className="text-primary" />
              </div>
            ) : mcpServers.length === 0 ? (
              <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-low/30 p-8 text-center">
                <Server className="mx-auto h-8 w-8 text-on-surface-variant/60 mb-2" />
                <p className="text-sm font-medium text-on-surface">
                  Noch keine externen MCP-Server eingerichtet
                </p>
                <p className="mt-1 text-xs text-on-surface-variant max-w-md mx-auto">
                  Die integrierten Singra-Werkzeuge (Server-Management, Maunting Docs, Projekt-Sandbox, Git, Web-Suche und Geo-Analyse) sind bereits fest eingebaut. Über MCP kannst du eigene Dienste ergänzen.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {mcpServers.map((srv) => (
                  <div
                    key={srv.id}
                    className="flex flex-col justify-between rounded-xl border border-outline-variant/30 bg-surface-container-low/40 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-on-surface truncate">
                            {srv.name}
                          </span>
                          <span className="rounded bg-surface-container-high px-1.5 py-0.5 text-label-sm font-mono uppercase text-on-surface-variant">
                            {srv.transport}
                          </span>
                          <span className="rounded bg-primary/12 px-1.5 py-0.5 text-label-sm font-medium text-primary">
                            {srv.is_global
                              ? 'Global'
                              : srv.team_id
                                ? 'Team'
                                : 'Persönlich'}
                          </span>
                        </div>
                        {srv.description && (
                          <p className="mt-1 text-xs text-on-surface-variant">
                            {srv.description}
                          </p>
                        )}
                        <p className="mt-1.5 font-mono text-label-sm text-on-surface-variant/80 truncate">
                          {srv.transport === 'stdio' ? srv.command : srv.endpoint_url}
                        </p>
                      </div>
                      <Switch
                        checked={srv.enabled}
                        onCheckedChange={(val) => void handleToggleMcp(srv, val)}
                        aria-label={`MCP-Server ${srv.name} aktivieren`}
                      />
                    </div>
                    <div className="mt-3 flex justify-end border-t border-outline-variant/20 pt-2">
                      <button
                        type="button"
                        onClick={() => void handleDeleteMcp(srv)}
                        className="inline-flex items-center gap-1 text-xs text-on-surface-variant hover:text-status-destructive transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Entfernen
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {subTab === 'tasks' && canManageTasks && (
          <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-low/20 overflow-hidden">
            <AufgabenAnsicht />
          </div>
        )}

        {subTab === 'workers' && (
          <div className="space-y-4">
            {selectedWorkerId ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-on-surface">
                    Hintergrund-Auftrag Verlauf
                  </h3>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setSelectedWorkerId(null)}
                  >
                    Zurück zur Übersicht
                  </Button>
                </div>
                <div className="rounded-2xl border border-outline-variant/30 overflow-hidden min-h-[460px]">
                  <WorkerAnsicht
                    key={selectedWorkerId}
                    conversationId={selectedWorkerId}
                  />
                </div>
              </div>
            ) : workers.length === 0 ? (
              <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-low/30 p-8 text-center">
                <Activity className="mx-auto h-8 w-8 text-on-surface-variant/60 mb-2" />
                <p className="text-sm font-medium text-on-surface">
                  Aktuell laufen keine Hintergrund-Worker
                </p>
                <p className="mt-1 text-xs text-on-surface-variant">
                  Wenn Singra längere Recherchen oder parallele Teilaufgaben im Hintergrund ausführt, erscheinen sie hier live.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {workers.map((w) => (
                  <div
                    key={w.conversation_id}
                    className="flex items-center justify-between rounded-xl border border-outline-variant/30 bg-surface-container-low/40 px-4 py-3"
                  >
                    <div>
                      <div className="text-sm font-medium text-on-surface">
                        {w.title}
                      </div>
                      <div className="text-xs text-on-surface-variant">
                        Status: {w.status} • Gestartet:{' '}
                        {new Date(w.created_at).toLocaleTimeString()}
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => setSelectedWorkerId(w.conversation_id)}
                    >
                      Einsehen
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {subTab === 'guardian' && (
          <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-low/20 overflow-hidden min-h-[480px]">
            <GuardianAnsicht />
          </div>
        )}
      </div>

      {/* Add MCP Server Modal */}
      <Dialog open={mcpModalOpen} onOpenChange={setMcpModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>MCP-Server hinzufügen</DialogTitle>
            <DialogDescription>
              Verbinde einen externen Model Context Protocol Server für dich persönlich, für ein Team oder global.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateMcp} className="space-y-3.5 mt-2">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-1">
                Name
              </label>
              <Input
                value={mcpDraft.name}
                onChange={(e) => setMcpDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="z. B. GitLab MCP oder Dokumentations-Index"
                required
                aria-label="MCP-Server Name"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-1">
                  Transport-Protokoll
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

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-1">
                  Sichtbarkeit / Bereich
                </label>
                <Dropdown
                  value={mcpDraft.scopeChoice}
                  onChange={(val) =>
                    setMcpDraft((d) => ({ ...d, scopeChoice: val }))
                  }
                  options={[
                    { value: 'personal', label: 'Persönlich' },
                    ...teams.map((t) => ({
                      value: String(t.id),
                      label: `Team: ${t.name}`,
                    })),
                    ...(canManageGlobalSettings
                      ? [{ value: 'global', label: 'Global (Betreiber)' }]
                      : []),
                  ]}
                  aria-label="Sichtbarkeit"
                />
              </div>
            </div>

            {mcpDraft.transport === 'stdio' ? (
              <>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-1">
                    Befehl (Executable)
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
                  <label className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-1">
                    Argumente (durch Leerzeichen getrennt)
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
                <label className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-1">
                  Endpunkt-URL (HTTPS)
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

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-1">
                Authorization Header / Bearer Token (optional, DIS-verschlüsselt)
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

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-1">
                Kurzbeschreibung
              </label>
              <Input
                value={mcpDraft.description ?? ''}
                onChange={(e) =>
                  setMcpDraft((d) => ({ ...d, description: e.target.value }))
                }
                placeholder="Welche Werkzeuge stellt dieser Server bereit?"
                aria-label="Kurzbeschreibung"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setMcpModalOpen(false)}
              >
                Abbrechen
              </Button>
              <Button type="submit" disabled={savingMcp || !mcpDraft.name.trim()}>
                {savingMcp ? 'Speichert…' : 'Verbinden'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
