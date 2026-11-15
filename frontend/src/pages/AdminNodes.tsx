/**
 * AdminNodes — Node-Verwaltung im einheitlichen Server-Deck-Stil.
 * Zeigt Auslastung und verbleibende Kapazität (CPU, RAM, Disk) sofort über ProgressRings
 * und bündelt Host-URL sowie Buchungsaufschlüsselung sauber auf einen Klick im Ankerfenster.
 */
import { useEffect, useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  MoreHorizontal,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react'
import { useNodeStore } from '@/stores/nodeStore'
import { sortNodesByPriority, useNodePreferencesStore } from '@/stores/nodePreferencesStore'
import { toast } from '@/stores/toastStore'
import { confirm } from '@/stores/confirmStore'
import {
  ActionMenu,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Kurzinfo,
  PasswordInput,
  Spinner,
  type ActionMenuItem,
} from '@maunting/ui'
import { FavoriteButton, FAVORITE_CARD_HIGHLIGHT_CLASS } from '@/components/FavoriteButton'
import { NodeEnrollmentDialog } from '@/components/nodes/NodeEnrollmentDialog'
import { NodeStatusBlocks, ServerStatusIcon } from '@/components/server/ServerStatusBlocks'
import {
  NodeCapacityDetailsButton,
  NodeResourceRings,
  type NodeResourceMetrics,
} from '@/components/nodes/NodeResourceRings'
import { TageszeitHintergrund } from '@/components/layout/TageszeitHintergrund'
import { useTageszeitMotiv } from '@/lib/tageszeit'
import type { Node } from '@/types'
import { api } from '@/api/client'
import { useHasPermission } from '@/hooks/useHasPermission'

function statusVariant(status: string): 'success' | 'destructive' | 'default' | 'warning' {
  switch (status) {
    case 'online':
      return 'success'
    case 'offline':
      return 'destructive'
    case 'unknown':
      return 'default'
    default:
      return 'warning'
  }
}

function toNodeMetrics(node: Node): NodeResourceMetrics {
  const m = node.metrics
  const ramTotalMb =
    node.ram_total ??
    (m?.ram_total_bytes != null ? Math.round(m.ram_total_bytes / (1024 * 1024)) : null)

  let ramUsedMb: number | null = null
  if (m?.ram_used_bytes != null) {
    ramUsedMb = Math.round(m.ram_used_bytes / (1024 * 1024))
  } else if (m?.ram_percent != null && ramTotalMb != null) {
    ramUsedMb = Math.round((m.ram_percent / 100) * ramTotalMb)
  }

  const diskTotalMb =
    node.disk_total ??
    (m?.disk_total_bytes != null ? Math.round(m.disk_total_bytes / (1024 * 1024)) : null)
  const diskUsedMb =
    m?.disk_used_bytes != null
      ? Math.round(m.disk_used_bytes / (1024 * 1024))
      : node.disk_used ?? null

  return {
    nodeId: node.id,
    nodeName: node.name,
    host: node.host,
    cpuPercent: m?.cpu_percent ?? null,
    cpuCores: node.cpu_total ?? m?.cpu_count ?? null,
    cpuModel: node.cpu_model || m?.cpu_model || null,
    ramTotalMb,
    ramUsedMb,
    ramAllocatedMb: node.ram_allocated_mb ?? null,
    ramAllocatableMb: node.ram_allocatable_mb ?? null,
    diskTotalMb,
    diskUsedMb,
    diskPanelUsedMb: node.disk_panel_used_mb ?? null,
    diskAllocatedGb: node.disk_allocated_gb ?? null,
    diskAllocatableGb: node.disk_allocatable_gb ?? null,
  }
}

export function AdminNodes({ ohneHintergrund = false }: { ohneHintergrund?: boolean } = {}) {
  const { t } = useTranslation()
  const { nodes, total, loading, fetchNodes, createNode, updateNode, deleteNode, healthCheck } =
    useNodeStore()
  const { favoriteIds, toggleFavorite } = useNodePreferencesStore()
  const canManageNodes = useHasPermission('nodes.manage')
  const headerMotiv = useTageszeitMotiv('dashboard')
  const [showForm, setShowForm] = useState(false)
  const [showEnrollment, setShowEnrollment] = useState(false)
  const [editing, setEditing] = useState<Node | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [updatingNodes, setUpdatingNodes] = useState(false)
  const [form, setForm] = useState({
    name: '',
    host: '',
    auth_token: '',
    tls_fingerprint: '',
  })

  const [searchVal, setSearchVal] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize] = useState(25)

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchVal)
      setCurrentPage(1)
    }, 400)
    return () => clearTimeout(timer)
  }, [searchVal])

  const load = useCallback(() => {
    void fetchNodes(currentPage, pageSize, debouncedSearch).catch((err: unknown) => {
      toast.error(err instanceof Error ? err.message : t('nodes.loadFailed'))
    })
  }, [fetchNodes, currentPage, pageSize, debouncedSearch, t])

  useEffect(() => {
    api<{ update_available: boolean }>('/system/update/status')
      .then((data) => {
        setUpdateAvailable(data.update_available)
      })
      .catch(() => {})
  }, [])

  const handleUpdateNodes = async () => {
    const approved = await confirm({
      title: t('nodes.updateConfirmTitle'),
      message: t('nodes.updateConfirmBody'),
      confirmText: t('nodes.updateAll'),
    })
    if (!approved) return
    setUpdatingNodes(true)
    try {
      const res = await api<{ message: string }>('/system/update/nodes', { method: 'POST' })
      toast.success(res.message || t('nodes.updateStarted'))
      await fetchNodes(currentPage, pageSize, debouncedSearch)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('nodes.updateFailed'))
    } finally {
      setUpdatingNodes(false)
    }
  }

  useEffect(() => {
    load()
    const id = window.setInterval(() => {
      // Im Hintergrundtab schaut niemand hin: kein Takt, keine Anfragen.
      if (document.visibilityState !== 'visible') return
      void load()
    }, 20_000)
    return () => window.clearInterval(id)
  }, [load])

  const openEnrollment = () => {
    setShowForm(false)
    setEditing(null)
    setShowEnrollment(true)
  }

  const openManualCreate = () => {
    setEditing(null)
    setForm({ name: '', host: 'https://', auth_token: '', tls_fingerprint: '' })
    setShowEnrollment(false)
    setShowForm(true)
  }

  const openEdit = (node: Node) => {
    setEditing(node)
    setForm({
      name: node.name,
      host: node.host,
      auth_token: '',
      tls_fingerprint: node.tls_fingerprint || '',
    })
    setShowForm(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      if (editing) {
        const payload: {
          name?: string
          host?: string
          auth_token?: string
          tls_fingerprint?: string
        } = {
          name: form.name.trim(),
          host: form.host.trim(),
        }
        if (form.auth_token.trim()) {
          payload.auth_token = form.auth_token.trim()
        }
        if (form.tls_fingerprint.trim()) {
          payload.tls_fingerprint = form.tls_fingerprint.trim()
        }
        await updateNode(editing.id, payload)
        toast.success(t('nodes.updated'))
      } else {
        if (form.auth_token.trim().length < 16) {
          toast.error(t('nodes.tokenTooShort'))
          return
        }
        if (!form.tls_fingerprint.trim()) {
          toast.error(t('nodes.fingerprintRequired'))
          return
        }
        await createNode({
          name: form.name.trim(),
          host: form.host.trim(),
          auth_token: form.auth_token.trim(),
          tls_fingerprint: form.tls_fingerprint.trim(),
        })
        toast.success(t('nodes.created'))
      }
      setShowForm(false)
      setForm({ name: '', host: '', auth_token: '', tls_fingerprint: '' })
      setEditing(null)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (node: Node) => {
    if (node.is_local) {
      toast.error(t('nodes.cannotDeleteLocal'))
      return
    }
    if (node.server_count > 0) {
      toast.error(t('nodes.cannotDeleteWithServers', { count: node.server_count }))
      return
    }
    if (
      !(await confirm({
        message: t('nodes.confirmDelete', { name: node.name }),
        danger: true,
        confirmText: t('common.delete'),
      }))
    ) {
      return
    }
    try {
      await deleteNode(node.id)
      toast.success(t('nodes.deleted'))
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('common.error'))
    }
  }

  const handleHealth = async (node: Node) => {
    setBusyId(node.id)
    try {
      const fresh = await healthCheck(node.id)
      toast.success(
        fresh.status === 'online' ? t('nodes.healthOnline') : t('nodes.healthOffline'),
      )
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('nodes.healthFailed'))
    } finally {
      setBusyId(null)
    }
  }

  const sortedNodes = useMemo(
    () => sortNodesByPriority(nodes, favoriteIds),
    [nodes, favoriteIds],
  )

  const stats = useMemo(() => {
    const online = nodes.filter((n) => n.status === 'online').length
    const servers = nodes.reduce((sum, n) => sum + (n.server_count || 0), 0)
    return { online, servers }
  }, [nodes])

  if (loading && nodes.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="md" className="text-secondary" />
      </div>
    )
  }

  return (
    <div className="relative isolate flex flex-col h-full w-full min-h-0 overflow-y-auto text-on-surface scrollbar-thin">
      {!ohneHintergrund && (
        <TageszeitHintergrund
          motiv={headerMotiv}
          hoehe="h-[520px] sm:h-[580px] lg:h-[640px]"
          deckkraft="opacity-55"
          ebene="-z-10"
        />
      )}

      <main
        className={`relative z-10 mx-auto w-full max-w-7xl 2xl:max-w-[1600px] px-3.5 ${
          ohneHintergrund ? 'pt-2 sm:pt-3' : 'pt-4 sm:pt-6'
        } pb-12 sm:px-6 lg:px-8 space-y-6`}
      >
        {/* Freischwebender Infrastruktur-Header im einheitlichen Stil */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
              <Network className="h-4 w-4" aria-hidden="true" />
              <span>{t('pageContext.infrastructure')}</span>
            </div>
            {!ohneHintergrund && (
              <h1 className="mt-1 font-headline text-2xl sm:text-3xl font-extrabold tracking-tight text-on-surface">
                {t('nav.nodes')}
              </h1>
            )}
            <p className="mt-1 text-xs sm:text-sm text-on-surface-variant max-w-xl leading-relaxed">
              {t('nodes.subtitle')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border backdrop-blur-md shadow-sm ${
                stats.online > 0
                  ? 'bg-status-success/15 border-status-success/30 text-status-success'
                  : 'bg-surface-container-high/80 border-outline-variant/30 text-on-surface-variant'
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  stats.online > 0 ? 'bg-status-success animate-pulse' : 'bg-on-surface-variant/50'
                }`}
              />
              {t('nodes.capacitySubtitle', { online: stats.online, total })}
            </span>

            {canManageNodes && updateAvailable && (
              <Button
                variant="secondary"
                type="button"
                fingerziel
                disabled={updatingNodes}
                onClick={handleUpdateNodes}
                className="inline-flex items-center gap-2 rounded-xl disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${updatingNodes ? 'animate-spin' : ''}`} />
                {updatingNodes ? t('nodes.updating') : t('nodes.updateAll')}
              </Button>
            )}

            {canManageNodes && (
              <Button
                type="button"
                fingerziel
                onClick={openEnrollment}
                className="inline-flex items-center gap-2 rounded-xl shadow-sm"
              >
                <Plus className="h-4 w-4" />
                {t('nodes.add')}
              </Button>
            )}
          </div>
        </div>

        {/* Kompakte Filterleiste */}
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-outline bg-surface-container-low/80 backdrop-blur-xl px-3.5 py-2.5 sm:px-4 sm:py-3"
          role="search"
        >
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-on-surface-variant"
              aria-hidden="true"
            />
            <Input
              type="search"
              aria-label={t('nodes.searchPlaceholder')}
              value={searchVal}
              onChange={(e) => setSearchVal(e.target.value)}
              placeholder={t('nodes.searchPlaceholder')}
              className="min-h-11 pl-9 sm:min-h-10"
            />
          </div>
          {sortedNodes.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-on-surface-variant">
              <NodeStatusBlocks nodes={sortedNodes} testIdPrefix="admin-node-block" />
              <span className="rounded-full border border-outline-variant/40 bg-surface-container-high/55 px-2.5 py-1 font-medium tabular-nums">
                {t('nodes.serverCount', { count: stats.servers })}
              </span>
            </div>
          )}
        </div>

        {showEnrollment && (
          <NodeEnrollmentDialog
            onClose={() => setShowEnrollment(false)}
            onManualSetup={openManualCreate}
            onApproved={() => fetchNodes(currentPage, pageSize, debouncedSearch)}
          />
        )}

        <Dialog
          open={showForm}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              setShowForm(false)
              setEditing(null)
            }
          }}
        >
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editing ? t('nodes.edit') : t('nodes.add')}</DialogTitle>
              <DialogDescription>{t('nodes.subtitle')}</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  label={t('common.name')}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  maxLength={100}
                  autoComplete="off"
                />
                <Input
                  label={t('nodes.host')}
                  value={form.host}
                  onChange={(e) => setForm({ ...form, host: e.target.value })}
                  required
                  placeholder="https://10.0.0.5:9000"
                  maxLength={255}
                  autoComplete="off"
                />
              </div>
              <div>
                <Input
                  label={t('nodes.tlsFingerprint')}
                  className="font-mono text-sm"
                  value={form.tls_fingerprint}
                  onChange={(e) => setForm({ ...form, tls_fingerprint: e.target.value })}
                  required={!editing}
                  placeholder={t('nodes.fingerprintPlaceholder')}
                  maxLength={128}
                  autoComplete="off"
                  spellCheck={false}
                />
                <p className="mt-1 text-xs text-on-surface-variant">{t('nodes.fingerprintHint')}</p>
              </div>
              <div>
                <PasswordInput
                  label={t('nodes.agentToken')}
                  value={form.auth_token}
                  onChange={(e) => setForm({ ...form, auth_token: e.target.value })}
                  required={!editing}
                  minLength={editing ? undefined : 16}
                  placeholder={editing ? t('nodes.tokenLeaveBlank') : undefined}
                  autoComplete="new-password"
                />
                <p className="mt-1 font-body-md text-xs text-on-surface-variant">
                  {t('nodes.tokenHint')}
                </p>
              </div>
              <DialogFooter>
                <Button
                  variant="secondary"
                  type="button"
                  fingerziel
                  onClick={() => {
                    setShowForm(false)
                    setEditing(null)
                  }}
                >
                  {t('common.cancel')}
                </Button>
                <Button type="submit" fingerziel disabled={saving}>
                  {saving ? t('common.loading') : t('common.save')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {nodes.length === 0 ? (
          <div className="msm-card rounded-2xl border-2 border-dashed border-outline-variant bg-surface-container-low/80 backdrop-blur-xl p-12 text-center">
            <Network className="mx-auto mb-4 h-10 w-10 text-on-surface-variant" aria-hidden="true" />
            <h3 className="mb-1 font-headline text-body-lg text-on-surface">{t('nodes.empty')}</h3>
            <p className="font-body-md text-sm text-on-surface-variant">{t('nodes.emptyHint')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {sortedNodes.map((node) => {
              const metrics = toNodeMetrics(node)
              const isFavorite = favoriteIds.includes(node.id)

              return (
                <article
                  key={node.id}
                  data-testid={`node-card-${node.id}`}
                  data-favorite={isFavorite ? 'true' : 'false'}
                  className={`msm-card rounded-2xl border bg-surface-container-low/80 backdrop-blur-xl px-4 py-3.5 sm:px-5 sm:py-4 space-y-3 transition-all duration-200 ${
                    isFavorite
                      ? FAVORITE_CARD_HIGHLIGHT_CLASS
                      : 'border-outline hover:border-primary/40'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 min-w-0">
                        <ServerStatusIcon
                          status={node.status}
                          kind="node"
                          size="sm"
                          favorite={isFavorite}
                          data-testid={`node-card-icon-${node.id}`}
                        />
                        <h3 className="font-headline text-body-lg font-semibold text-on-surface truncate">
                          {node.name}
                        </h3>
                        <Badge variant={statusVariant(node.status)}>
                          {t(`nodes.status.${node.status}`, { defaultValue: node.status })}
                        </Badge>
                        {node.is_local && <Badge variant="info">{t('nodes.local')}</Badge>}
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-on-surface-variant">
                        <span>{t('nodes.serverCount', { count: node.server_count })}</span>
                        {metrics.cpuCores != null && (
                          <>
                            <span aria-hidden="true" className="text-outline">·</span>
                            <span>{t('nodes.cpuCores', { count: metrics.cpuCores })}</span>
                          </>
                        )}
                        {node.last_heartbeat && (
                          <>
                            <span aria-hidden="true" className="text-outline">·</span>
                            <span className="tabular-nums">
                              {new Date(node.last_heartbeat).toLocaleTimeString()}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <FavoriteButton
                        isFavorite={isFavorite}
                        onToggle={() => toggleFavorite(node.id)}
                        tooltipText={
                          isFavorite ? t('nodes.unfavoriteAction') : t('nodes.favoriteAction')
                        }
                        ariaLabel={
                          isFavorite
                            ? t('nodes.unfavoriteNode', { name: node.name })
                            : t('nodes.favoriteNode', { name: node.name })
                        }
                        tooltipSide="mitte"
                        testId={`node-favorite-${node.id}`}
                      />

                      <NodeCapacityDetailsButton metrics={metrics} testIdPrefix="node" />

                      <Kurzinfo text={t('nodes.healthCheck')} seite={canManageNodes ? 'mitte' : 'ende'}>
                        <Button
                          variant="ghost"
                          size="icon"
                          fingerziel
                          type="button"
                          aria-label={t('nodes.healthCheckLabel', { name: node.name })}
                          onClick={() => void handleHealth(node)}
                          disabled={busyId === node.id}
                          className="text-on-surface-variant hover:text-primary"
                        >
                          <RefreshCw
                            className={`h-4 w-4 ${busyId === node.id ? 'animate-spin' : ''}`}
                          />
                        </Button>
                      </Kurzinfo>

                      {canManageNodes && (() => {
                        const nodeMenuItems: ActionMenuItem[] = [
                          {
                            key: 'edit',
                            label: t('nodes.edit'),
                            icon: <Pencil className="h-4 w-4" aria-hidden="true" />,
                            onSelect: () => openEdit(node),
                          },
                          {
                            key: 'delete',
                            label: t('common.delete'),
                            icon: <Trash2 className="h-4 w-4" aria-hidden="true" />,
                            destructive: true,
                            separatorBefore: true,
                            disabled: node.is_local || node.server_count > 0,
                            onSelect: () => void handleDelete(node),
                          },
                        ]
                        return (
                          <ActionMenu
                            label={t('nodes.actionsMenu', { name: node.name })}
                            ariaLabel={t('nodes.actionsMenu', { name: node.name })}
                            items={nodeMenuItems}
                            icon={<MoreHorizontal className="h-4 w-4" aria-hidden="true" />}
                            variant="ghost"
                            surface="dna"
                            align="end"
                            iconOnly
                          />
                        )
                      })()}
                    </div>
                  </div>

                  <div className="border-t border-outline/40 pt-3">
                    <NodeResourceRings metrics={metrics} testIdPrefix="node" />
                  </div>
                </article>
              )
            })}
          </div>
        )}

        {Math.ceil(total / pageSize) > 1 && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-outline/40 pt-4 text-sm text-on-surface-variant">
            <div>
              {t('nodes.pagination.range', {
                from: (currentPage - 1) * pageSize + 1,
                to: Math.min(currentPage * pageSize, total),
                total,
              })}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                fingerziel
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => p - 1)}
                className="disabled:opacity-50"
              >
                {t('common.back')}
              </Button>
              <span className="font-medium px-2 tabular-nums">
                {t('nodes.pagination.page', {
                  current: currentPage,
                  total: Math.ceil(total / pageSize),
                })}
              </span>
              <Button
                variant="secondary"
                size="sm"
                fingerziel
                disabled={currentPage >= Math.ceil(total / pageSize)}
                onClick={() => setCurrentPage((p) => p + 1)}
                className="disabled:opacity-50"
              >
                {t('common.next')}
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
