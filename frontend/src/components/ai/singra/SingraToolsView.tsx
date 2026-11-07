import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity,
  Bot,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Cpu,
  ExternalLink,
  LayoutGrid,
  Mail,
  Monitor,
  Plug,
  Plus,
  Search,
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
  MCP_CATEGORIES,
  SINGRA_MCP_PRESETS,
  type McpCategory,
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
  const [selectedCategory, setSelectedCategory] = useState<'all' | McpCategory>('all')
  const [presetSearch, setPresetSearch] = useState('')

  // Create MCP Integration Modal
  const [mcpModalOpen, setMcpModalOpen] = useState(false)
  const [selectedPreset, setSelectedPreset] = useState<SingraMcpPreset | null>(null)
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
    setSelectedPreset(preset)
    setMcpDraft({
      name: preset.name,
      description: preset.description,
      transport: preset.transport,
      endpoint_url: preset.endpoint_url || '',
      command: preset.command || '',
      args: preset.args || [],
      auth_header:
        preset.authType === 'none' || preset.authType === 'connection_string'
          ? ''
          : (preset.auth_header || ''),
      enabled: true,
      scopeChoice: 'personal',
    })
    setArgsInput((preset.args || []).join(' '))
    setIsPresetModal(true)
    setShowTechnicalMcp(false)
    setMcpModalOpen(true)
  }

  const handleOpenCustomModal = () => {
    setSelectedPreset(null)
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
        auth_header:
          selectedPreset?.authType === 'none' || selectedPreset?.authType === 'connection_string'
            ? null
            : mcpDraft.auth_header?.trim() || null,
        team_id: teamId,
        is_global: isGlobal,
        enabled: true,
      })
      setMcpServers((prev) => [created, ...prev])
      setMcpModalOpen(false)
      setSelectedPreset(null)
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

  const filteredPresets = useMemo(() => {
    const q = presetSearch.trim().toLowerCase()
    return SINGRA_MCP_PRESETS.filter((p) => {
      const matchCategory = selectedCategory === 'all' || p.category === selectedCategory
      if (!matchCategory) return false
      if (!q) return true
      return (
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.badge.toLowerCase().includes(q)
      )
    })
  }, [selectedCategory, presetSearch])

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

        {/* Sub-Navigation: Mobile Grid (kein horizontales Swipen), Desktop Pills */}
        <div className="grid grid-cols-2 gap-2 sm:hidden">
          <button
            type="button"
            onClick={() => setSubTab('mcp')}
            className={[
              'flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition-colors border',
              subTab === 'mcp'
                ? 'bg-primary/15 text-primary border-primary/30'
                : 'bg-surface-container-low/60 text-on-surface-variant border-outline-variant/25 hover:text-on-surface',
            ].join(' ')}
          >
            <Plug className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">Integrationen ({mcpServers.length})</span>
          </button>

          {canManageTasks && (
            <button
              type="button"
              onClick={() => setSubTab('tasks')}
              className={[
                'flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition-colors border',
                subTab === 'tasks'
                  ? 'bg-primary/15 text-primary border-primary/30'
                  : 'bg-surface-container-low/60 text-on-surface-variant border-outline-variant/25 hover:text-on-surface',
              ].join(' ')}
            >
              <CalendarClock className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">Aufgaben</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setSubTab('workers')}
            className={[
              'flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition-colors border',
              subTab === 'workers'
                ? 'bg-primary/15 text-primary border-primary/30'
                : 'bg-surface-container-low/60 text-on-surface-variant border-outline-variant/25 hover:text-on-surface',
            ].join(' ')}
          >
            <Cpu className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">Aufträge ({workers.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('guardian')}
            className={[
              'flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition-colors border',
              subTab === 'guardian'
                ? 'bg-primary/15 text-primary border-primary/30'
                : 'bg-surface-container-low/60 text-on-surface-variant border-outline-variant/25 hover:text-on-surface',
            ].join(' ')}
          >
            <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">Selbstheilung</span>
          </button>
        </div>

        <div className="hidden sm:flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
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

            {/* Hinweis auf native E-Mail- & Kalender-Integration */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-primary/8 p-4">
              <div className="flex items-start sm:items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  <Mail className="h-4 w-4" aria-hidden="true" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-on-surface">
                    E-Mail & Kalender sind bereits nativ integriert
                  </div>
                  <p className="text-xs text-on-surface-variant">
                    Postfächer (IMAP/SMTP) und Kalender (CalDAV) bindest du direkt unter Einstellungen → Verbindungen an – ganz ohne externen MCP-Server.
                  </p>
                </div>
              </div>
              <Link
                to="/settings"
                className="shrink-0 text-xs font-semibold text-primary hover:underline self-end sm:self-center"
              >
                Zu den Verbindungen →
              </Link>
            </div>

            {/* 1-Click Integration Cards */}
            <div className="rounded-2xl border border-outline-variant/25 bg-surface-container-low/25 p-4 sm:p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-on-surface">
                    Vorkonfigurierte MCP-Erweiterungen ({filteredPresets.length})
                  </h4>
                  <p className="text-xs text-on-surface-variant">
                    Wähle aus fertigen Vorlagen für Cloud, Design, Office, E-Commerce und Medien.
                  </p>
                </div>

                {/* Preset Search */}
                <div className="relative w-full sm:w-64">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-on-surface-variant" />
                  <input
                    type="search"
                    value={presetSearch}
                    onChange={(e) => setPresetSearch(e.target.value)}
                    placeholder="Erweiterung suchen…"
                    aria-label="MCP-Erweiterung suchen"
                    className="h-8 w-full rounded-xl border border-outline-variant/30 bg-surface-container/60 pl-8 pr-3 text-xs text-on-surface placeholder:text-on-surface-variant/70 focus:border-primary/50 focus:outline-none"
                  />
                </div>
              </div>

              {/* Category Filter: Mobile Dropdown (kein Swipen), Desktop Wrapping Pills */}
              <div className="sm:hidden">
                <Dropdown
                  value={selectedCategory}
                  onChange={(val) => setSelectedCategory(val as McpCategory)}
                  options={MCP_CATEGORIES.map((cat) => ({
                    value: cat.id,
                    label: cat.label,
                  }))}
                  aria-label="MCP-Kategorie auswählen"
                />
              </div>

              <div className="hidden sm:flex flex-wrap items-center gap-1.5 pb-1">
                {MCP_CATEGORIES.map((cat) => {
                  const active = selectedCategory === cat.id
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setSelectedCategory(cat.id)}
                      className={[
                        'inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors shrink-0 border',
                        active
                          ? 'border-primary/40 bg-primary/15 text-primary'
                          : 'border-outline-variant/25 bg-surface-container-low text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high',
                      ].join(' ')}
                    >
                      <span>{cat.label}</span>
                    </button>
                  )
                })}
              </div>

              {filteredPresets.length === 0 ? (
                <div className="py-8 text-center text-xs text-on-surface-variant">
                  Keine Erweiterung für diese Suche gefunden.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {filteredPresets.map((preset) => (
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
              )}
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
      <Dialog
        open={mcpModalOpen}
        onOpenChange={(open) => {
          setMcpModalOpen(open)
          if (!open) setSelectedPreset(null)
        }}
      >
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
          <form onSubmit={handleCreateMcp} className="space-y-4 px-6 pb-6 pt-5">
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
                <p className="mt-1 text-xs text-on-surface-variant/80">
                  {mcpDraft.scopeChoice === 'personal'
                    ? 'Nur für dein eigenes Benutzerkonto aktiv.'
                    : mcpDraft.scopeChoice === 'global'
                    ? 'Global für alle Benutzer aktiv.'
                    : 'Alle Mitglieder dieses Teams teilen sich diese Zugangsdaten.'}
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-on-surface-variant mb-1">
                  {selectedPreset?.authLabel || 'Zugangsschlüssel / Token (optional)'}
                </label>
                {selectedPreset?.authType === 'none' ? (
                  <div className="flex h-10 items-center rounded-xl border border-outline-variant/30 bg-surface-container-high/40 px-3 text-xs text-on-surface-variant">
                    Kein Zugangsschlüssel nötig (Lokales Werkzeug)
                  </div>
                ) : (
                  <Input
                    type={selectedPreset?.authType === 'connection_string' ? 'text' : 'password'}
                    value={mcpDraft.auth_header ?? ''}
                    onChange={(e) => {
                      const val = e.target.value
                      setMcpDraft((d) => ({ ...d, auth_header: val }))
                      if (selectedPreset?.id === 'postgres' && val.trim()) {
                        setArgsInput(`-y @modelcontextprotocol/server-postgres ${val.trim()}`)
                      }
                    }}
                    placeholder={selectedPreset?.authPlaceholder || 'Bearer …'}
                    aria-label={selectedPreset?.authLabel || 'Authorization Header'}
                  />
                )}
              </div>
            </div>

            {selectedPreset && (selectedPreset.authHelp || selectedPreset.docUrl) && (
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-3.5 text-xs text-on-surface-variant">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2.5">
                  <div className="space-y-1">
                    <p className="font-semibold text-primary">
                      {selectedPreset.authType === 'none'
                        ? 'Lokale Ausführung'
                        : selectedPreset.authType === 'oauth_or_token'
                        ? 'Anmeldung & Token'
                        : selectedPreset.authType === 'connection_string'
                        ? 'Verbindungsanleitung'
                        : 'Zugangsdaten & Einrichtung'}
                    </p>
                    {selectedPreset.authHelp && (
                      <p className="leading-relaxed text-on-surface-variant/90">
                        {selectedPreset.authHelp}
                      </p>
                    )}
                  </div>
                  {selectedPreset.docUrl && (
                    <a
                      href={selectedPreset.docUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/20 transition-colors self-start"
                    >
                      <span>Dashboard / Token ↗</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
            )}

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
