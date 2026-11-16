import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Database, Network, Search, Server as ServerIcon } from 'lucide-react'
import { Ankerfenster, Button, Input, Kurzinfo } from '@maunting/ui'
import { sortNodesByPriority, useNodePreferencesStore } from '@/stores/nodePreferencesStore'
import { useServerPreferencesStore } from '@/stores/serverPreferencesStore'
import type { Server } from '@/types'

export type StatusTone = 'running' | 'transient' | 'failed' | 'stopped'
export type StatusEntityKind = 'application' | 'database' | 'node'

const TRANSIENT_SERVER_STATUSES = new Set([
  'starting',
  'restarting',
  'stopping',
  'installing',
  'updating',
  'queued',
  'awaiting_files',
])

export function getStatusBlockTone(
  status: string,
  kind: StatusEntityKind = 'application',
): StatusTone {
  if (status === 'running' || status === 'online') return 'running'
  if (TRANSIENT_SERVER_STATUSES.has(status)) return 'transient'
  if (status === 'failed' || status === 'error') return 'failed'
  if (status === 'stopped' || status === 'offline') return 'stopped'
  return kind === 'node' ? 'transient' : 'stopped'
}

const ICON_TONE_CLASSES: Record<
  StatusTone,
  { fill: string; hoverFill: string; border: string; hoverBorder: string }
> = {
  running: {
    fill: 'bg-status-success/15 text-status-success',
    hoverFill: 'hover:bg-status-success/25 group-hover/sblock:bg-status-success/25',
    border: 'border-status-success/55 ring-1 ring-status-success/25 shadow-sm',
    hoverBorder: 'hover:border-status-success group-hover/sblock:border-status-success',
  },
  transient: {
    fill: 'bg-status-warning/15 text-status-warning animate-pulse',
    hoverFill: 'hover:bg-status-warning/25 group-hover/sblock:bg-status-warning/25',
    border: 'border-status-warning/55 ring-1 ring-status-warning/20',
    hoverBorder: 'hover:border-status-warning group-hover/sblock:border-status-warning',
  },
  failed: {
    fill: 'bg-status-destructive/15 text-status-destructive',
    hoverFill: 'hover:bg-status-destructive/25 group-hover/sblock:bg-status-destructive/25',
    border: 'border-status-destructive/55 ring-1 ring-status-destructive/20',
    hoverBorder: 'hover:border-status-destructive group-hover/sblock:border-status-destructive',
  },
  stopped: {
    fill: 'bg-surface-container-highest/65 text-on-surface-variant/70',
    hoverFill:
      'hover:bg-surface-container-high hover:text-on-surface group-hover/sblock:bg-surface-container-high group-hover/sblock:text-on-surface',
    border: 'border-outline/60',
    hoverBorder: 'hover:border-outline-variant group-hover/sblock:border-outline-variant',
  },
}

const FAVORITE_ICON_BORDER =
  'border-status-warning/90 ring-2 ring-status-warning/45 shadow-[0_0_12px_-3px_hsl(var(--mui-warning)/0.45)]'
const FAVORITE_ICON_HOVER_BORDER =
  'hover:border-status-warning group-hover/sblock:border-status-warning'

export interface ServerStatusIconProps {
  status: string
  kind?: StatusEntityKind
  size?: 'xs' | 'sm' | 'md'
  interactive?: boolean
  favorite?: boolean
  className?: string
  'data-testid'?: string
}

/**
 * Einheitliches Status-Icon im Block-Rahmen (Grün = läuft, Gelb = arbeitet,
 * Rot = Fehler, Grau = aus; goldene Umrandung bei Favoriten), wiederverwendet
 * in ServerStatusBlocks, NodeStatusBlocks, ServerCard und Node-Karten.
 */
export function ServerStatusIcon({
  status,
  kind = 'application',
  size = 'sm',
  interactive = false,
  favorite = false,
  className = '',
  'data-testid': dataTestId,
}: ServerStatusIconProps) {
  const tone = getStatusBlockTone(status, kind)
  const palette = ICON_TONE_CLASSES[tone]
  const boxSize = size === 'md' ? 'h-8 w-8 rounded-lg' : size === 'xs' ? 'h-5 w-5 rounded-md' : 'h-7 w-7 rounded-lg'
  const iconSize = size === 'md' ? 'h-4 w-4' : size === 'xs' ? 'h-3 w-3' : 'h-3.5 w-3.5'
  const borderClass = favorite ? FAVORITE_ICON_BORDER : palette.border
  const hoverBorderClass = favorite ? FAVORITE_ICON_HOVER_BORDER : palette.hoverBorder

  return (
    <span
      data-testid={dataTestId}
      data-status={status}
      data-status-tone={tone}
      data-favorite={favorite ? 'true' : 'false'}
      className={`inline-flex ${boxSize} items-center justify-center border transition-all duration-150 shrink-0 ${palette.fill} ${borderClass} ${
        interactive ? `${palette.hoverFill} ${hoverBorderClass}` : ''
      } ${className}`}
    >
      {kind === 'database' ? (
        <Database className={iconSize} aria-hidden="true" />
      ) : kind === 'node' ? (
        <Network className={iconSize} aria-hidden="true" />
      ) : (
        <ServerIcon className={iconSize} aria-hidden="true" />
      )}
    </span>
  )
}

/**
 * Inkrementelles Lazy-Loading für große Serverlisten (100+ Einträge) per
 * IntersectionObserver plus explizitem Lade-Trigger als Fallback.
 */
export function useLazySlice<T>(items: readonly T[], batchSize = 24) {
  const [visibleCount, setVisibleCount] = useState(batchSize)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setVisibleCount(batchSize)
  }, [batchSize, items.length])

  const hasMore = visibleCount < items.length
  const remaining = Math.max(0, items.length - visibleCount)

  const loadMore = useCallback(() => {
    setVisibleCount((prev) => Math.min(items.length, prev + batchSize))
  }, [items.length, batchSize])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasMore || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (observed) => {
        if (observed.some((entry) => entry.isIntersecting)) {
          loadMore()
        }
      },
      { rootMargin: '160px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, loadMore])

  const visibleItems = useMemo(
    () => items.slice(0, visibleCount),
    [items, visibleCount],
  )

  return { visibleItems, hasMore, remaining, loadMore, sentinelRef }
}

interface StatusBlockEntry {
  id: number
  label: string
  status: string
  statusLabel: string
  tone: StatusTone
  kind: StatusEntityKind
  favorite: boolean
  to?: string
}

function StatusBlockStrip({
  entries,
  maxVisible,
  testIdPrefix,
  onNavigate,
}: {
  entries: readonly StatusBlockEntry[]
  maxVisible: number
  testIdPrefix: string
  onNavigate?: (id: number) => void
}) {
  const { t } = useTranslation()
  const [quickOpen, setQuickOpen] = useState(false)
  const [quickFilter, setQuickFilter] = useState('')
  const moreBtnRef = useRef<HTMLButtonElement | null>(null)

  const interactive = useMemo(() => entries.some((entry) => Boolean(entry.to)), [entries])
  const filteredQuickEntries = useMemo(() => {
    const query = quickFilter.trim().toLowerCase()
    if (!query) return entries
    return entries.filter(
      (entry) =>
        entry.label.toLowerCase().includes(query) ||
        entry.statusLabel.toLowerCase().includes(query) ||
        entry.status.toLowerCase().includes(query),
    )
  }, [entries, quickFilter])

  const {
    visibleItems: quickVisibleEntries,
    hasMore: quickHasMore,
    remaining: quickRemaining,
    loadMore: quickLoadMore,
    sentinelRef: quickSentinelRef,
  } = useLazySlice(filteredQuickEntries, 48)

  if (entries.length === 0) return null

  const visible = entries.slice(0, maxVisible)
  const overflow = entries.length - visible.length

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid={`${testIdPrefix}-strip`}>
      {visible.map((entry) => {
        const accessibleName = `${entry.label} (${entry.statusLabel})`

        return (
          <Kurzinfo
            key={entry.id}
            portal
            text={`${entry.label} · ${entry.statusLabel}`}
            seite="mitte"
            aussen="shrink-0"
          >
            {entry.to ? (
              <Link
                to={entry.to}
                onClick={() => onNavigate?.(entry.id)}
                aria-label={accessibleName}
                data-testid={`${testIdPrefix}-${entry.id}`}
                data-status={entry.status}
                data-status-tone={entry.tone}
                data-favorite={entry.favorite ? 'true' : 'false'}
                className="group/sblock inline-flex rounded-lg transition-transform duration-150 hover:-translate-y-0.5 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                <ServerStatusIcon
                  status={entry.status}
                  kind={entry.kind}
                  favorite={entry.favorite}
                  interactive
                />
              </Link>
            ) : (
              <span
                role="img"
                aria-label={accessibleName}
                data-testid={`${testIdPrefix}-${entry.id}`}
                data-status={entry.status}
                data-status-tone={entry.tone}
                data-favorite={entry.favorite ? 'true' : 'false'}
                className="inline-flex"
              >
                <ServerStatusIcon
                  status={entry.status}
                  kind={entry.kind}
                  favorite={entry.favorite}
                />
              </span>
            )}
          </Kurzinfo>
        )
      })}

      {overflow > 0 && interactive && (
        <>
          <button
            ref={moreBtnRef}
            type="button"
            onClick={() => setQuickOpen((open) => !open)}
            aria-expanded={quickOpen}
            aria-label={t('servers.quickAccessAll', { count: entries.length })}
            data-testid={`${testIdPrefix}-more`}
            className="inline-flex h-7 items-center rounded-lg border border-outline/60 bg-surface-container-high/70 hover:bg-surface-container-highest hover:border-primary/40 px-2 font-mono text-xs font-semibold text-on-surface-variant hover:text-on-surface transition-colors tabular-nums"
          >
            +{overflow}
          </button>

          <Ankerfenster
            offen={quickOpen}
            onSchliessen={() => setQuickOpen(false)}
            anker={moreBtnRef}
            label={t('servers.quickAccessTitle', { count: entries.length })}
            ausrichtung="ende"
            maxHoehe="70dvh"
            durchsichtig
            className="w-[min(22rem,calc(100vw-2rem))] rounded-2xl border-outline-variant/40 overscroll-contain space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <ServerIcon className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-on-surface truncate">
                  {t('servers.quickAccessTitle', { count: entries.length })}
                </h3>
              </div>
            </div>

            <Input
              type="search"
              value={quickFilter}
              onChange={(e) => setQuickFilter(e.target.value)}
              placeholder={t('servers.quickAccessSearch')}
              aria-label={t('servers.quickAccessSearch')}
              prefix={<Search className="h-3.5 w-3.5" aria-hidden="true" />}
              data-testid={`${testIdPrefix}-quick-search`}
            />

            {quickVisibleEntries.length === 0 ? (
              <p className="py-4 text-center text-xs text-on-surface-variant">
                {t('servers.quickAccessEmpty')}
              </p>
            ) : (
              <div className="space-y-1">
                {quickVisibleEntries.map((entry) => (
                  <Link
                    key={entry.id}
                    to={entry.to!}
                    onClick={() => {
                      onNavigate?.(entry.id)
                      setQuickOpen(false)
                    }}
                    data-testid={`${testIdPrefix}-quick-item-${entry.id}`}
                    className="group/sblock flex items-center gap-2.5 rounded-xl border border-transparent px-2 py-1.5 hover:border-outline-variant/40 hover:bg-surface-container/70 transition-colors"
                  >
                    <ServerStatusIcon
                      status={entry.status}
                      kind={entry.kind}
                      size="sm"
                      favorite={entry.favorite}
                      interactive
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-on-surface group-hover/sblock:text-primary">
                      {entry.label}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-on-surface-variant">
                      {entry.statusLabel}
                    </span>
                  </Link>
                ))}
                {quickHasMore && (
                  <div ref={quickSentinelRef} className="pt-2 flex justify-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={quickLoadMore}
                      data-testid={`${testIdPrefix}-quick-load-more`}
                    >
                      {t('servers.loadMoreServers', { remaining: quickRemaining })}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </Ankerfenster>
        </>
      )}

      {overflow > 0 && !interactive && (
        <span
          data-testid={`${testIdPrefix}-more`}
          className="inline-flex h-7 items-center rounded-lg border border-outline bg-surface-container-high/55 px-2 font-mono text-xs text-on-surface-variant tabular-nums"
        >
          +{overflow}
        </span>
      )}
    </div>
  )
}

interface ServerStatusBlocksProps {
  servers: readonly Server[]
  maxVisible?: number
  testIdPrefix?: string
}

/**
 * Kompakte Server-Symbol-Blöcke mit Statusfarbe: Grün für laufende Server,
 * Gelb für Übergangszustände, Rot für Fehler, Grau für gestoppt.
 * Tooltips laufen per Portal über den Box-Rand hinaus; ab `maxVisible`
 * öffnet `+N` einen durchsuchbaren Schnellzugriff mit Lazy-Loading.
 */
export function ServerStatusBlocks({
  servers,
  maxVisible = 18,
  testIdPrefix = 'server-block',
}: ServerStatusBlocksProps) {
  const { t } = useTranslation()
  const setLastVisited = useServerPreferencesStore((s) => s.setLastVisited)
  const favoriteIds = useServerPreferencesStore((s) => s.favoriteIds)

  const entries: StatusBlockEntry[] = useMemo(() => {
    const favoriteSet = new Set(favoriteIds)
    return servers.map((server) => {
      const kind: StatusEntityKind =
        server.server_kind === 'database' ? 'database' : 'application'
      return {
        id: server.id,
        label: server.name,
        status: server.status,
        statusLabel: t(`servers.status.${server.status}`, { defaultValue: server.status }),
        tone: getStatusBlockTone(server.status, kind),
        kind,
        favorite: favoriteSet.has(server.id),
        to: `/servers/${server.id}`,
      }
    })
  }, [servers, favoriteIds, t])

  return (
    <StatusBlockStrip
      entries={entries}
      maxVisible={maxVisible}
      testIdPrefix={testIdPrefix}
      onNavigate={setLastVisited}
    />
  )
}

interface NodeStatusBlocksProps {
  nodes: ReadonlyArray<{ id: number; name: string; status: string }>
  maxVisible?: number
  testIdPrefix?: string
}

/**
 * Einheitliches Block-Signal für Infrastruktur-Nodes passend zu `ServerStatusBlocks`.
 */
export function NodeStatusBlocks({
  nodes,
  maxVisible = 12,
  testIdPrefix = 'node-block',
}: NodeStatusBlocksProps) {
  const { t } = useTranslation()
  const favoriteIds = useNodePreferencesStore((s) => s.favoriteIds)

  const entries: StatusBlockEntry[] = useMemo(() => {
    const favoriteSet = new Set(favoriteIds)
    return sortNodesByPriority(nodes, favoriteIds).map((node) => ({
      id: node.id,
      label: node.name,
      status: node.status,
      statusLabel: t(`nodes.status.${node.status}`, { defaultValue: node.status }),
      tone: getStatusBlockTone(node.status, 'node'),
      kind: 'node' as const,
      favorite: favoriteSet.has(node.id),
    }))
  }, [nodes, favoriteIds, t])

  return (
    <StatusBlockStrip
      entries={entries}
      maxVisible={maxVisible}
      testIdPrefix={testIdPrefix}
    />
  )
}
