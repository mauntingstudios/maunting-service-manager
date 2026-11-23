import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useOutletContext } from 'react-router-dom'
import type { ShellOutletKontext } from '@/components/layout/Shell'
import { api } from '@/api/client'
import { toast } from '@/stores/toastStore'
import { confirm } from '@/stores/confirmStore'
import { useHostInterfaces } from '@/hooks/useHostInterfaces'
import { useHasPermission, useIsOwner } from '@/hooks/useHasPermission'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'
import { sortServersByPriority, useServerPreferencesStore } from '@/stores/serverPreferencesStore'
import { filterVisibleServersInPreview, useRolePreviewStore } from '@/stores/rolePreviewStore'
import type { Server, GameInfo, PostgresCredential, ServerCreateResult, Node } from '@/types'
import { labelRole, mapBlueprintPorts } from '@/utils/portRoles'
import { groupByGame, resolveBlueprintEditionLabel } from '@/utils/blueprintGroups'
import { Server as ServerIcon, Plus, AlertTriangle, Database, Store } from 'lucide-react'
import { PostgresCredentialsDialog } from '@/components/server/PostgresCredentialsDialog'
import { ServerCard } from '@/components/server/ServerCard'
import { ServerStatusBlocks, useLazySlice } from '@/components/server/ServerStatusBlocks'
import {
  Button,
  buttonClasses,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Dropdown,
  Input,
  PasswordInput,
  Spinner,
  TabBar,
  Switch,
} from '@maunting/ui'
import { TageszeitHintergrund } from '@/components/layout/TageszeitHintergrund'
import { useTageszeitMotiv } from '@/lib/tageszeit'
type ServerKind = 'application' | 'database'

const POSTGRES_BLUEPRINT = 'postgres'

const DB_DEFAULTS = {
  db_name: 'app',
  db_user: 'app_owner',
  db_password: '',
  db_external: false,
  db_cidrs: '',
  db_ssl: true,
}

function splitCidrs(text: string): string[] {
  return text.split(/[\s,;]+/).map((part) => part.trim()).filter(Boolean)
}

export function Servers({ ohneHintergrund = false }: { ohneHintergrund?: boolean }) {
  const huelle = useOutletContext<ShellOutletKontext | null>()
  // Die Hülle trägt das Bild auf Dashboard-Routen; die Prop bleibt für die
  // MSS-App, die dieselbe Seite einbettet.
  const ohneEigenenHintergrund = ohneHintergrund || huelle?.ohneHintergrund === true
  const { t } = useTranslation()
  const navigate = useNavigate()
  const canCreateServer = useHasPermission('servers.create')
  const canCreateDatabaseServer = useHasPermission('servers.create.database')
  const canViewHosterCustomers = useHasPermission('servers.hoster_customers.view')
  const isOwner = useIsOwner()
  const shopEnabled = usePublicSettingsStore((s) => s.shop_enabled)
  const [servers, setServers] = useState<Server[]>([])
  const [games, setGames] = useState<GameInfo[]>([])
  const [nodes, setNodes] = useState<Node[]>([])
  const [activeTab, setActiveTab] = useState<'own' | 'customers'>('own')
  const [loading, setLoading] = useState(true)
  // Der Takt ist kürzer als der Anfrage-Timeout. Ohne diesen Riegel stapelten
  // sich während eines Hängers bis zu sechs Anfragen, die alle auf dieselbe
  // überlastete Stelle zuliefen.
  const abfrageLaeuft = useRef(false)

  const headerMotiv = useTageszeitMotiv('dashboard')
  // Ohne dieses Flag wird aus einem fehlgeschlagenen Laden die Aussage
  // "Keine Server vorhanden" — der Betreiber liest, seine Server seien weg.
  const [loadError, setLoadError] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [nodesLoading, setNodesLoading] = useState(false)
  const [oneTimeCredentials, setOneTimeCredentials] = useState<PostgresCredential[]>([])
  const [form, setForm] = useState({
    name: '',
    server_kind: 'application' as ServerKind,
    game_type: 'conan_exiles_ue5',
    cpu_limit_percent: '',
    ram_limit_mb: '',
    disk_limit_gb: '',
    game_port: '',
    query_port: '',
    rcon_port: '',
    ports: {} as Record<string, string>,
    public_bind_ip: '',
    postgres_enabled: false,
    postgres_database_count: '1',
    node_id: '' as string,
    ...DB_DEFAULTS,
  })
  const isDatabaseServer = form.server_kind === 'database'
  // Der Blueprint, dessen Ports das Formular zeigt: beim Datenbankserver immer
  // PostgreSQL, egal was im Spiele-Feld stehen geblieben ist.
  const blueprintId = isDatabaseServer ? POSTGRES_BLUEPRINT : form.game_type
  const { interfaces, defaultBindIp, loading: interfacesLoading } = useHostInterfaces(form.node_id)

  useEffect(() => {
    setForm(prev => ({ ...prev, public_bind_ip: '' }))
  }, [form.node_id])

  // Default-Bind-IP setzen, sobald sie vom Backend kommt (oder sich die Node ändert).
  useEffect(() => {
    setForm((prev) => ({ ...prev, public_bind_ip: defaultBindIp || '' }))
  }, [defaultBindIp])

  const fetchServers = async () => {
    if (abfrageLaeuft.current) return
    abfrageLaeuft.current = true
    try {
      setServers(await api<Server[]>('/servers'))
      setLoadError(false)
    } catch {
      setLoadError(true)
    } finally {
      abfrageLaeuft.current = false
      setLoading(false)
    }
  }

  const loadNodes = async () => {
    if (!canCreateServer) return
    setNodesLoading(true)
    try {
      const list = await api<Node[]>('/nodes')
      const safeList = Array.isArray(list) ? list : []
      setNodes(safeList)
      const local = safeList.find((n) => n.is_local) || safeList[0]
      if (local) {
        setForm((prev) => (prev.node_id ? prev : { ...prev, node_id: String(local.id) }))
      }
    } catch {
      setNodes([])
    } finally {
      setNodesLoading(false)
    }
  }

  // Node-Liste fuer Create-Dialog: sobald ``servers.create`` (Owner-Bypass inkl.)
  useEffect(() => {
    void loadNodes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCreateServer])

  // Der Spielekatalog ist statisch — er ändert sich nur, wenn ein Blueprint
  // dazukommt. Einmal holen reicht, er gehört nicht in den 5-Sekunden-Takt.
  useEffect(() => {
    api<GameInfo[]>('/system/games').then(setGames).catch(() => {})
  }, [])

  useEffect(() => {
    fetchServers()
    const interval = setInterval(() => {
      // Im Hintergrundtab schaut niemand hin: kein Takt, keine Anfragen.
      if (document.visibilityState !== 'visible') return
      fetchServers()
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  // Node-Picker sobald mindestens ein Node geladen ist (Local + Remote).
  // Bei genau einem Eintrag ist die Wahl trivial, aber sichtbar und explizit.
  const showNodePicker = nodes.length > 1

  const formatRamMbLabel = (mb: number) =>
    mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`

  const nodeOptionLabel = (n: Node) => {
    const localTag = n.is_local ? ` · ${t('nodes.local')}` : ''
    const cores =
      n.cpu_total != null
        ? t('nodes.cpuCores', { count: n.cpu_total })
        : n.metrics?.cpu_percent != null
          ? `CPU ${Math.round(n.metrics.cpu_percent)}%`
          : 'CPU —'
    let allocLabel = '—'
    if (n.ram_allocatable_mb != null) {
      allocLabel = formatRamMbLabel(Math.max(0, n.ram_allocatable_mb))
    } else if (n.ram_total != null) {
      const booked = n.ram_allocated_mb ?? 0
      const remaining = Math.max(0, Math.round(n.ram_total - booked))
      allocLabel = formatRamMbLabel(remaining)
    } else if (n.metrics?.ram_total_bytes != null && n.metrics?.ram_used_bytes != null) {
      // Fallback: OS free when booking totals unknown (picker without full detail).
      const freeMb = Math.max(
        0,
        Math.round((n.metrics.ram_total_bytes - n.metrics.ram_used_bytes) / (1024 * 1024)),
      )
      allocLabel = formatRamMbLabel(freeMb)
    }
    return `${n.name}${localTag} (${cores}, ${t('nodes.ramAllocatableShort', { value: allocLabel })})`
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    const effectiveBindIp = form.public_bind_ip || defaultBindIp
    if (nodesLoading || interfacesLoading || interfaces.length === 0 || !effectiveBindIp) {
      toast.error(t(interfacesLoading ? 'servers.bindIp.loading' : 'servers.bindIp.noneAvailable'))
      return
    }
    if (showNodePicker && !form.node_id) {
      toast.error(t('servers.nodeRequired'))
      return
    }
    setCreating(true)
    try {
      const safeNodes = Array.isArray(nodes) ? nodes : []
      const safeGames = Array.isArray(games) ? games : []
      const targetNodeId = form.node_id ? parseInt(form.node_id, 10) : null
      const targetNode = safeNodes.find((n) => targetNodeId ? n.id === targetNodeId : n.is_local) || safeNodes[0]
      const reqRamMb = form.ram_limit_mb ? parseInt(form.ram_limit_mb, 10) : null

      if (reqRamMb && reqRamMb > 0 && targetNode) {
        let availRamMb: number | null = null
        if (targetNode.ram_allocatable_mb != null) {
          availRamMb = Math.max(0, targetNode.ram_allocatable_mb)
        } else if (targetNode.ram_total != null) {
          availRamMb = Math.max(0, targetNode.ram_total - (targetNode.ram_allocated_mb ?? 0))
        }
        if (availRamMb != null && reqRamMb > availRamMb) {
          const confirmed = await confirm({
            title: t('servers.overcommitTitle'),
            message: t('servers.overcommitWarning', {
              requested: formatRamMbLabel(reqRamMb),
              available: formatRamMbLabel(availRamMb),
              total: formatRamMbLabel(targetNode.ram_total || 0),
            }),
            confirmText: t('servers.overcommitConfirm'),
          })
          if (!confirmed) {
            setCreating(false)
            return
          }
        }
      }

      const reqDiskGb = form.disk_limit_gb ? parseInt(form.disk_limit_gb, 10) : null
      if (reqDiskGb && reqDiskGb > 0 && targetNode) {
        let availDiskGb: number | null = null
        if (targetNode.disk_allocatable_gb != null) {
          availDiskGb = Math.max(0, targetNode.disk_allocatable_gb)
        } else if (targetNode.disk_total != null) {
          const totalGb = Math.floor(targetNode.disk_total / 1024)
          availDiskGb = Math.max(0, totalGb - (targetNode.disk_allocated_gb ?? 0))
        }
        if (availDiskGb != null && reqDiskGb > availDiskGb) {
          const totalGb = Math.floor((targetNode.disk_total ?? 0) / 1024)
          const confirmed = await confirm({
            title: t('servers.overcommitTitle'),
            message: t('servers.overcommitDiskWarning', {
              requested: `${reqDiskGb} GB`,
              available: `${availDiskGb} GB`,
              total: `${totalGb} GB`,
            }),
            confirmText: t('servers.overcommitConfirm'),
          })
          if (!confirmed) {
            setCreating(false)
            return
          }
        }
      }

      const portsPayload: Record<string, number | null> = {}
      const selectedGame = safeGames.find((g) => g.id === blueprintId)
      const portDefs = selectedGame?.ports ?? [
        { name: 'game', protocol: 'udp' },
        { name: 'query', protocol: 'udp' },
        { name: 'rcon', protocol: 'tcp' },
      ]
      mapBlueprintPorts(portDefs).forEach((p) => {
        const role = p.mappedRole
        let valStr = ''
        if (role === 'game') valStr = form.game_port
        else if (role === 'query') valStr = form.query_port
        else if (role === 'rcon') valStr = form.rcon_port
        else valStr = form.ports[role] || ''
        
        portsPayload[role] = valStr ? parseInt(valStr) : null
      })

      const body: Record<string, unknown> = {
        name: form.name,
        server_kind: form.server_kind,
        game_type: isDatabaseServer ? null : form.game_type,
        cpu_limit_percent: form.cpu_limit_percent ? parseInt(form.cpu_limit_percent) : null,
        ram_limit_mb: form.ram_limit_mb ? parseInt(form.ram_limit_mb) : null,
        disk_limit_gb: form.disk_limit_gb ? parseInt(form.disk_limit_gb) : null,
        game_port: form.game_port ? parseInt(form.game_port) : null,
        query_port: form.query_port ? parseInt(form.query_port) : null,
        rcon_port: form.rcon_port ? parseInt(form.rcon_port) : null,
        ports: portsPayload,
        public_bind_ip: effectiveBindIp || null,
        postgres_enabled: !isDatabaseServer && form.postgres_enabled,
        postgres_database_count: !isDatabaseServer && form.postgres_enabled ? parseInt(form.postgres_database_count || '1') : null,
      }
      if (isDatabaseServer) {
        body.database = {
          database_name: form.db_name.trim(),
          username: form.db_user.trim(),
          // Leer: das Panel erzeugt eins, abrufbar im Verbindungs-Hub.
          password: form.db_password || null,
          allowed_cidrs: form.db_external ? splitCidrs(form.db_cidrs) : [],
          ssl_required: form.db_ssl,
        }
      }
      // Ziel-Node mitschicken (Default = Local, sobald Nodes geladen)
      if (form.node_id) {
        body.node_id = parseInt(form.node_id, 10)
      }

      const created = await api<ServerCreateResult>('/servers', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify(body),
      })
      if (created.postgres_credentials?.length) {
        setOneTimeCredentials(created.postgres_credentials)
      }
      setShowCreate(false)
      const defaultNode = safeNodes.find((n) => n.is_local) || safeNodes[0]
      setForm({
        name: '',
        server_kind: 'application',
        game_type: 'conan_exiles_ue5',
        cpu_limit_percent: '',
        ram_limit_mb: '',
        disk_limit_gb: '',
        game_port: '',
        query_port: '',
        rcon_port: '',
        ports: {},
        public_bind_ip: defaultBindIp || '',
        postgres_enabled: false,
        postgres_database_count: '1',
        node_id: defaultNode ? String(defaultNode.id) : '',
        ...DB_DEFAULTS,
      })
      fetchServers()
      if (isDatabaseServer && created.id) navigate(`/servers/${created.id}?tab=databases`)
    } catch (err: any) {
      const msg = t(err.message) || err.message || t('common.error')
      toast.error(msg)
    } finally {
      setCreating(false)
    }
  }

  // PostgreSQL entsteht über „Datenbankserver", nicht als Spiel in der Liste.
  const applicationGames = (Array.isArray(games) ? games : []).filter((g) => g.category !== 'database')
  const gameGroups = useMemo(() => groupByGame(applicationGames), [applicationGames])
  const selectedGameGroup = useMemo(
    () => gameGroups.find((grp) => grp.items.some((item) => item.id === form.game_type)) ?? null,
    [gameGroups, form.game_type],
  )
  const gameName = (id: string) => (Array.isArray(games) ? games : []).find((g) => g.id === id)?.name || id

  const preview = useRolePreviewStore((s) => s.preview)
  const visibleServers = useMemo(
    () => filterVisibleServersInPreview(servers, preview),
    [servers, preview],
  )

  // Hoster-Tabs nur für Betreiber (Owner oder `servers.hoster_customers.view`),
  // wenn tatsächlich Kundenserver vorliegen. Shop-Kunden sehen ihre Mietserver
  // direkt ohne leere "Eigene Server | Kundenserver"-Leiste.
  const ownServers = visibleServers.filter((s) => !s.is_hoster_managed)
  const customerServers = visibleServers.filter((s) => s.is_hoster_managed)
  const hasCustomerServers = customerServers.length > 0
  const showCustomerTabs = hasCustomerServers && (isOwner || canViewHosterCustomers)
  const baseShownServers = showCustomerTabs
    ? activeTab === 'customers'
      ? customerServers
      : ownServers
    : visibleServers
  const { favoriteIds, lastVisitedId } = useServerPreferencesStore()
  const shownServers = useMemo(
    () => sortServersByPriority(baseShownServers, favoriteIds, lastVisitedId),
    [baseShownServers, favoriteIds, lastVisitedId],
  )
  const shownRunningCount = shownServers.filter((s) => s.status === 'running').length
  const shownStoppedCount = Math.max(0, shownServers.length - shownRunningCount)
  const {
    visibleItems: visibleShownServers,
    hasMore: hasMoreShownServers,
    remaining: remainingShownServers,
    loadMore: loadMoreShownServers,
    sentinelRef: shownServersSentinelRef,
  } = useLazySlice(shownServers, 24)

  const tabInitialized = useRef(false)
  useEffect(() => {
    if (loading || tabInitialized.current) return
    tabInitialized.current = true
    if (showCustomerTabs && ownServers.length === 0) {
      setActiveTab('customers')
    }
  }, [loading, showCustomerTabs, ownServers.length])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="md" className="text-secondary" />
      </div>
    )
  }

  return (
    <div className="relative isolate flex flex-col h-full w-full min-h-0 overflow-y-auto text-on-surface scrollbar-thin">
      {!ohneEigenenHintergrund && (
        <TageszeitHintergrund
          motiv={headerMotiv}
          hoehe="h-[520px] sm:h-[580px] lg:h-[640px]"
          deckkraft="opacity-55"
          ebene="-z-10"
        />
      )}

      <main className={`relative z-10 mx-auto w-full max-w-7xl 2xl:max-w-[1600px] px-3.5 ${ohneEigenenHintergrund ? 'pt-2 sm:pt-3' : 'pt-4 sm:pt-6'} pb-12 sm:px-6 lg:px-8 space-y-6`}>
        {/* Freischwebender Server-Header ohne doppelten Gruß oder Banner-Kasten */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
              <ServerIcon className="h-4 w-4" aria-hidden="true" />
              <span>{t('nav.servers')}</span>
            </div>
            {!ohneEigenenHintergrund && (
              <h1 className="mt-1 font-headline text-2xl sm:text-3xl font-extrabold tracking-tight text-on-surface">
                {t('nav.servers')}
              </h1>
            )}
            <p className="mt-1 text-xs sm:text-sm text-on-surface-variant max-w-xl leading-relaxed">
              {t('servers.subtitle')}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border backdrop-blur-md shadow-sm bg-surface-container-high/80 border-outline-variant/30 text-on-surface-variant">
              <ServerIcon className="h-3.5 w-3.5 text-primary" />
              {visibleServers.length} {t('nav.servers')}
            </span>
            {canCreateServer && (
              <Button
                fingerziel
                onClick={() => {
                  setShowCreate(true)
                  void loadNodes()
                }}
                className="flex items-center gap-2 rounded-xl shadow-sm"
              >
                <Plus className="w-4 h-4" />
                {t('servers.create')}
              </Button>
            )}
          </div>
        </div>

      {loadError && (
        <div className="msm-card rounded-2xl border border-dashed border-outline bg-surface-container-low/80 backdrop-blur-xl p-12 text-center">
          <AlertTriangle className="w-10 h-10 text-status-destructive mx-auto mb-4" />
          <h3 className="font-headline text-body-lg text-on-surface mb-1">
            {t('servers.loadFailed')}
          </h3>
        </div>
      )}

      {!loadError && visibleServers.length === 0 && (
        <div className="msm-card rounded-2xl border border-dashed border-outline bg-surface-container-low/80 backdrop-blur-xl p-12 text-center">
          <ServerIcon className="w-10 h-10 text-on-surface-variant mx-auto mb-4" />
          <h3 className="font-headline text-body-lg text-on-surface mb-1">
            {t('servers.noServers')}
          </h3>
          <p className="font-body-md text-sm text-on-surface-variant">
            {!canCreateServer && shopEnabled
              ? t('dashboard.rentFirstServerHint')
              : t('servers.createHint')}
          </p>
          {!canCreateServer && shopEnabled && (
            <div className="mt-4">
              <Link to="/" className={buttonClasses('primary')}>
                {t('servers.configureInShop')}
              </Link>
            </div>
          )}
        </div>
      )}

      {showCustomerTabs && (
        <TabBar
          tabs={[
            { id: 'own' as const, labelKey: 'servers.tabs.own', icon: ServerIcon },
            { id: 'customers' as const, labelKey: 'servers.tabs.customers', icon: Store },
          ]}
          active={activeTab}
          onChange={setActiveTab}
          ariaLabel={t('nav.servers')}
          embedded
          einzeilig
          className="backdrop-blur-xl border border-outline shadow-sm bg-surface-container-low/80"
        />
      )}

      {/* Ein leergefilterter Tab braucht seinen eigenen Leerzustand — eine
          Tab-Leiste ueber leerer Flaeche liest sich als "Server weg". */}
      {!loadError && servers.length > 0 && shownServers.length === 0 && (
        <div className="msm-card rounded-2xl border border-dashed border-outline bg-surface-container-low/80 backdrop-blur-xl p-12 text-center">
          <ServerIcon className="w-10 h-10 text-on-surface-variant mx-auto mb-4" />
          <h3 className="font-headline text-body-lg text-on-surface mb-1">
            {t('servers.noServers')}
          </h3>
        </div>
      )}

      {!loadError && shownServers.length > 0 && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-outline bg-surface-container-low/80 backdrop-blur-xl px-3.5 py-2.5 sm:px-4 sm:py-3"
          data-testid="servers-status-deck"
        >
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border font-body-md ${
                shownRunningCount > 0
                  ? 'bg-status-success/10 border-status-success/30 text-status-success'
                  : 'bg-surface-container-highest border-outline text-on-surface-variant'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  shownRunningCount > 0 ? 'bg-status-success animate-pulse' : 'bg-on-surface-variant/50'
                }`}
              />
              {shownRunningCount} {t('dashboard.running')}
            </span>
            {shownStoppedCount > 0 && (
              <span className="font-body-md px-2.5 py-0.5 rounded-full border border-outline/70 bg-surface-container-highest/60 text-on-surface-variant">
                {t('dashboard.stoppedCount', { count: shownStoppedCount })}
              </span>
            )}
          </div>

          <ServerStatusBlocks
            servers={shownServers}
            maxVisible={24}
            testIdPrefix="servers-page-block"
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
        {visibleShownServers.map((server) => (
          <ServerCard
            key={server.id}
            server={server}
            gameLabel={gameName(server.game_type)}
            variant="list"
          />
        ))}
      </div>
      {hasMoreShownServers && (
        <div ref={shownServersSentinelRef} className="flex justify-center pt-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            fingerziel
            onClick={loadMoreShownServers}
            data-testid="servers-load-more"
          >
            {t('servers.loadMoreServers', { remaining: remainingShownServers })}
          </Button>
        </div>
      )}

      {/* Create Modal (Design-DNA Dialog + Input) */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('servers.create')}</DialogTitle>
            <DialogDescription>{t('servers.createDescription')}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate}>
            <div className="p-6 space-y-4">
              {canCreateDatabaseServer && (
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t('servers.kind.label')}>
                {(['application', 'database'] as const).map((kind) => (
                  <Button
                    key={kind}
                    type="button"
                    role="radio"
                    aria-checked={form.server_kind === kind}
                    variant={form.server_kind === kind ? 'primary' : 'secondary'}
                    onClick={() => setForm({ ...form, server_kind: kind, game_port: '', query_port: '', rcon_port: '', ports: {} })}
                    data-testid={`create-server-kind-${kind}`}
                  >
                    {kind === 'database' ? <Database className="w-4 h-4" /> : <ServerIcon className="w-4 h-4" />}
                    {t(`servers.kind.${kind}`)}
                  </Button>
                ))}
              </div>
              )}
              <Input
                label={t('common.name')}
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
              {!isDatabaseServer && (
              <div className="space-y-3">
                <div>
                  <label className="block font-label-md text-label-md text-on-surface-variant mb-1.5 uppercase tracking-wider">
                    {t('servers.game')}
                  </label>
                  <Dropdown
                    value={selectedGameGroup?.key ?? null}
                    onChange={(groupKey) => {
                      const group = gameGroups.find((grp) => grp.key === groupKey)
                      if (!group || group.items.length === 0) return
                      const preferred = group.items.find((item) => item.id === form.game_type) ?? group.items[0]
                      setForm({
                        ...form,
                        game_type: preferred.id,
                        game_port: '',
                        query_port: '',
                        rcon_port: '',
                        ports: {},
                      })
                    }}
                    options={gameGroups.map((grp) => ({
                      value: grp.key,
                      label: grp.name,
                      hint: grp.items.length > 1
                        ? t('servers.gameGroupHint', { count: grp.items.length })
                        : undefined,
                    }))}
                    searchable={gameGroups.length > 5}
                    placeholder={t('servers.game')}
                    aria-label={t('servers.game')}
                    data-testid="create-server-game"
                  />
                </div>
                {selectedGameGroup && selectedGameGroup.items.length > 1 && (
                  <div>
                    <label className="block font-label-md text-label-md text-on-surface-variant mb-1.5 uppercase tracking-wider">
                      {t('servers.blueprintEdition')}
                    </label>
                    <Dropdown
                      value={form.game_type || null}
                      onChange={(value) => setForm({
                        ...form,
                        game_type: value,
                        game_port: '',
                        query_port: '',
                        rcon_port: '',
                        ports: {},
                      })}
                      options={selectedGameGroup.items.map((g) => ({
                        value: g.id,
                        label: resolveBlueprintEditionLabel(g, selectedGameGroup.name),
                        hint: [
                          g.source === 'community' ? t('blueprints.originCommunity') : null,
                          g.mod_support ? 'Mods' : null,
                          g.supports_steam_workshop ? 'Workshop' : null,
                        ].filter(Boolean).join(' · ') || undefined,
                      }))}
                      searchable={selectedGameGroup.items.length > 5}
                      placeholder={t('servers.selectBlueprintEdition')}
                      aria-label={t('servers.blueprintEdition')}
                      data-testid="create-server-blueprint"
                    />
                  </div>
                )}
              </div>
              )}
              {isDatabaseServer && (
                <div className="space-y-4 rounded-lg border border-outline-variant bg-surface-container/50 p-4" data-testid="create-database-fields">
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      label={t('servers.database.name')}
                      value={form.db_name}
                      onChange={(e) => setForm({ ...form, db_name: e.target.value })}
                      required
                      data-testid="create-db-name"
                    />
                    <Input
                      label={t('servers.database.user')}
                      value={form.db_user}
                      onChange={(e) => setForm({ ...form, db_user: e.target.value })}
                      required
                      data-testid="create-db-user"
                    />
                  </div>
                  <PasswordInput
                    label={t('servers.database.password')}
                    value={form.db_password}
                    onChange={(e) => setForm({ ...form, db_password: e.target.value })}
                    minLength={12}
                    autoComplete="new-password"
                    placeholder={t('servers.database.passwordAuto')}
                  />
                  <label className="flex items-center justify-between gap-3 text-sm text-on-surface">
                    <span>
                      <span className="block font-label-md text-label-md">{t('servers.database.external')}</span>
                      <span className="mt-1 block text-xs text-on-surface-variant">{t('servers.database.externalHint')}</span>
                    </span>
                    <Switch checked={form.db_external} onCheckedChange={(v) => setForm({ ...form, db_external: v })} />
                  </label>
                  {form.db_external && (
                    <>
                      <Input
                        label={t('servers.database.cidrs')}
                        value={form.db_cidrs}
                        onChange={(e) => setForm({ ...form, db_cidrs: e.target.value })}
                        placeholder="203.0.113.0/24, 198.51.100.7/32"
                        data-testid="create-db-cidrs"
                      />
                      <label className="flex items-center justify-between gap-3 text-sm text-on-surface">
                        <span>
                          <span className="block font-label-md text-label-md">{t('servers.database.ssl')}</span>
                          <span className="mt-1 block text-xs text-on-surface-variant">{t('servers.database.sslHint')}</span>
                        </span>
                        <Switch checked={form.db_ssl} onCheckedChange={(v) => setForm({ ...form, db_ssl: v })} />
                      </label>
                    </>
                  )}
                </div>
              )}
              {/* Ziel-Node: sichtbar sobald Nodes geladen; Pflichtfeld bei Anzeige */}
              {showNodePicker && (
                <div>
                  <label className="block font-label-md text-label-md text-on-surface-variant mb-1.5 uppercase tracking-wider">
                    {t('servers.node')} *
                  </label>
                  <Dropdown
                    value={form.node_id || null}
                    onChange={(value) => setForm({ ...form, node_id: value })}
                    options={nodes.map((n) => ({
                      value: String(n.id),
                      label: nodeOptionLabel(n),
                      hint: n.host,
                    }))}
                    placeholder={t('servers.selectNode')}
                    aria-label={t('servers.node')}
                    data-testid="create-server-node"
                  />
                  <p className="font-body-md text-xs text-on-surface-variant mt-1">
                    {t('servers.nodeHint')}
                  </p>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Input
                  label={t('servers.cpuLimit')}
                  type="number"
                  min={10}
                  max={3200}
                  value={form.cpu_limit_percent}
                  onChange={(e) => setForm({ ...form, cpu_limit_percent: e.target.value })}
                  placeholder="%"
                />
                <Input
                  label={t('servers.ramLimit')}
                  type="number"
                  min={512}
                  value={form.ram_limit_mb}
                  onChange={(e) => setForm({ ...form, ram_limit_mb: e.target.value })}
                  placeholder="MB"
                />
                <Input
                  label={t('servers.diskLimit')}
                  type="number"
                  min={1}
                  value={form.disk_limit_gb}
                  onChange={(e) => setForm({ ...form, disk_limit_gb: e.target.value })}
                  placeholder="GB"
                />
              </div>

              {/* Phase 2: Bind-IP + Ports */}
              <div>
                <label className="block font-label-md text-label-md text-on-surface-variant mb-1.5 uppercase tracking-wider">
                  {t('servers.publicBindIp')}
                </label>
                <Dropdown
                  value={form.public_bind_ip || null}
                  onChange={(value) => setForm({ ...form, public_bind_ip: value })}
                  options={interfaces.map((iface) => {
                    const tag = iface.is_loopback
                      ? ` (${t('servers.bindIp.loopback')})`
                      : iface.is_private
                      ? ` (${t('servers.bindIp.private')})`
                      : ''
                    return {
                      value: iface.ip,
                      label: `${iface.ip} · ${iface.interface}${tag}`,
                      hint: iface.interface,
                    }
                  })}
                  disabled={interfacesLoading}
                  placeholder={
                    interfacesLoading
                      ? t('servers.bindIp.loading')
                      : interfaces.length === 0
                      ? t('servers.bindIp.noneAvailable')
                      : t('servers.bindIp.choose')
                  }
                  aria-label={t('servers.publicBindIp')}
                  data-testid="create-server-bind-ip"
                />
                <p className="font-body-md text-xs text-on-surface-variant mt-1">
                  {t('servers.bindIp.hint')}
                </p>
              </div>

              {(() => {
                const selectedGame = (Array.isArray(games) ? games : []).find((g) => g.id === blueprintId)
                const portDefs = selectedGame?.ports ?? [
                  { name: 'game', protocol: 'udp' },
                  { name: 'query', protocol: 'udp' },
                  { name: 'rcon', protocol: 'tcp' },
                ]
                if (portDefs.length === 0) return null
                
                const mappedPorts = mapBlueprintPorts(portDefs)

                return (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" data-testid="port-fields">
                    {mappedPorts.map((p) => {
                      const role = p.mappedRole
                      const isLegacy = role === 'game' || role === 'query' || role === 'rcon'
                      const val = isLegacy
                        ? (role === 'game' ? form.game_port : role === 'query' ? form.query_port : form.rcon_port)
                        : (form.ports[role] || '')

                      const baseRole = labelRole(role)
                      const label = baseRole === 'game'
                        ? t('servers.gamePort')
                        : baseRole === 'query'
                        ? t('servers.queryPort')
                        : baseRole === 'rcon'
                        ? t('servers.rconPort')
                        : baseRole === 'database'
                        ? t('servers.databasePort')
                        : `${role.replace('_', ' ').toUpperCase()} (${p.protocol.toUpperCase()})`

                      return (
                        <Input
                          key={role}
                          label={label}
                          type="number"
                          min={1024}
                          max={65535}
                          value={val}
                          onChange={(e) => {
                            if (isLegacy) {
                              const fieldKey = role === 'game' ? 'game_port' : role === 'query' ? 'query_port' : 'rcon_port'
                              setForm({ ...form, [fieldKey]: e.target.value })
                            } else {
                              setForm({
                                ...form,
                                ports: {
                                  ...form.ports,
                                  [role]: e.target.value,
                                },
                              })
                            }
                          }}
                          placeholder={t('servers.portAuto')}
                          data-testid={`port-input-${role}`}
                        />
                      )
                    })}
                  </div>
                )
              })()}
              {!isDatabaseServer && (
              <div className="rounded-lg border border-outline-variant bg-surface-container/50 p-4">
                <label className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <Database className="w-4 h-4 text-secondary" />
                    <span>
                      <span className="block font-label-md text-label-md text-on-surface">
                        {t('servers.postgres.enabled')}
                      </span>
                      <span className="block font-body-md text-xs text-on-surface-variant mt-1">
                        {t('servers.postgres.hint')}
                      </span>
                    </span>
                  </span>
                  <Checkbox
                    checked={form.postgres_enabled}
                    onCheckedChange={(gesetzt) =>
                      setForm({
                        ...form,
                        postgres_enabled: gesetzt,
                        postgres_database_count: gesetzt ? form.postgres_database_count || '1' : '1',
                      })
                    }
                  />
                </label>
                {form.postgres_enabled && (
                  <div className="mt-4 max-w-36">
                    <Input
                      label={t('servers.postgres.count')}
                      type="number"
                      min={1}
                      max={20}
                      value={form.postgres_database_count}
                      onChange={(e) => setForm({ ...form, postgres_database_count: e.target.value || '1' })}
                    />
                  </div>
                )}
              </div>
              )}
            </div>
            <DialogFooter>
              <Button
                variant="secondary"
                type="button"
                onClick={() => setShowCreate(false)}
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="submit"
                disabled={creating || nodesLoading || interfacesLoading || interfaces.length === 0 || !(form.public_bind_ip || defaultBindIp)}
              >
                {creating ? t('common.loading') : t('servers.create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      </main>
      <PostgresCredentialsDialog credentials={oneTimeCredentials} onClose={() => setOneTimeCredentials([])} />
    </div>
  )
}
