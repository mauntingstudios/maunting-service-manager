import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Activity, Clock, Cpu, Database, HardDrive, History, Network, Star, Store } from 'lucide-react'
import { Badge, Kurzinfo } from '@maunting/ui'
import { ServerConnectChip } from '@/components/server/ServerConnectChip'
import { ServerStatusIcon } from '@/components/server/ServerStatusBlocks'
import { UptimeDisplay } from '@/components/server/UptimeDisplay'
import { formatMb, resolveServerConnect, serverStatusClasses } from '@/lib/serverConnect'
import { useServerPreferencesStore } from '@/stores/serverPreferencesStore'
import type { Server } from '@/types'

interface ServerCardProps {
  server: Server
  gameLabel: string
  variant?: 'dashboard' | 'list'
}

/**
 * Gemeinsame Serverkarte für Dashboard und Serverliste.
 * Verwendet einen semantischen Link per stretched-link (`after:inset-0`), damit die gesamte
 * Karte klickbar bleibt und interaktive Controls (`ServerConnectChip`, Favoriten) gültig auf `z-10` liegen.
 */
export function ServerCard({ server, gameLabel, variant = 'list' }: ServerCardProps) {
  const { t } = useTranslation()
  const isDashboard = variant === 'dashboard'
  const { favoriteIds, lastVisitedId, toggleFavorite, setLastVisited } = useServerPreferencesStore()
  const isFavorite = favoriteIds.includes(server.id)
  const isLastVisited = lastVisitedId === server.id
  const hasConnectEndpoint = Boolean(resolveServerConnect(server).primary)

  return (
    <article className="relative msm-card h-full flex flex-col rounded-2xl border border-outline bg-surface-container-low/80 backdrop-blur-xl px-4 py-3.5 sm:px-5 sm:py-4 hover:border-primary/40 hover:bg-surface-container-high/40 transition-all duration-200 group">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <ServerStatusIcon
            status={server.status}
            kind={server.server_kind === 'database' ? 'database' : 'application'}
            size="sm"
            data-testid={`server-card-icon-${server.id}`}
          />
          <h3 className="font-headline text-body-md font-semibold text-on-surface group-hover:text-primary transition-colors min-w-0 truncate">
            <Link
              to={`/servers/${server.id}`}
              onClick={() => setLastVisited(server.id)}
              className="focus:outline-none after:absolute after:inset-0 after:content-['']"
            >
              {server.name}
            </Link>
          </h3>
          {isLastVisited && (
            <Badge
              variant="default"
              className="relative z-10 shrink-0"
              data-testid={`server-last-visited-${server.id}`}
            >
              <History className="w-3 h-3 mr-1 inline" aria-hidden="true" />
              {t('servers.lastVisitedBadge')}
            </Badge>
          )}
          {!isDashboard && server.node_name && (
            <Kurzinfo
              text={t('servers.nodeBadgeHint', { name: server.node_name })}
              seite="mitte"
              aussen="relative z-10 shrink-0"
            >
              <Badge variant="info" aria-description={t('servers.node')}>
                <Network className="w-3 h-3 mr-1 inline" aria-hidden="true" />
                {server.node_name}
              </Badge>
            </Kurzinfo>
          )}
          {!isDashboard && server.server_kind === 'database' && (
            <Badge variant="info" className="relative z-10 shrink-0">
              <Database className="w-3 h-3 mr-1 inline" aria-hidden="true" />
              {t('servers.kind.database')}
            </Badge>
          )}
          {!isDashboard && server.is_hoster_managed && (
            <Badge variant="info" className="relative z-10 shrink-0">
              <Store className="w-3 h-3 mr-1 inline" aria-hidden="true" />
              {t('servers.customerBadge')}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <Kurzinfo
            text={isFavorite ? t('servers.unfavoriteAction') : t('servers.favoriteAction')}
            seite="ende"
            aussen="relative z-10 shrink-0"
          >
            <button
              type="button"
              onClick={() => toggleFavorite(server.id)}
              aria-pressed={isFavorite}
              aria-label={
                isFavorite
                  ? t('servers.unfavoriteServer', { name: server.name })
                  : t('servers.favoriteServer', { name: server.name })
              }
              data-testid={`server-favorite-${server.id}`}
              className={`inline-flex h-8 w-8 max-md:h-11 max-md:w-11 items-center justify-center rounded-full border transition-colors ${
                isFavorite
                  ? 'border-primary/40 bg-primary/15 text-primary'
                  : 'border-transparent text-on-surface-variant hover:bg-surface-container-highest/70 hover:text-on-surface'
              }`}
            >
              <Star className={`h-3.5 w-3.5 ${isFavorite ? 'fill-current' : ''}`} aria-hidden="true" />
            </button>
          </Kurzinfo>

          <span
            className={`font-mono-sm text-mono-sm px-2.5 py-0.5 rounded-full border shrink-0 ${serverStatusClasses(server.status)}`}
          >
            {t(`servers.status.${server.status}`, { defaultValue: server.status })}
          </span>
        </div>
      </div>

      <p className="font-body-md text-xs text-on-surface-variant/90 mt-1 mb-3.5 truncate">
        {gameLabel}
      </p>

      <div className="mt-auto border-t border-outline/40 pt-3 space-y-2.5">
        <div
          className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-xs text-on-surface-variant"
          data-testid={`server-resources-row-${server.id}`}
        >
          <span className="inline-flex items-center gap-1.5 font-body-md tabular-nums">
            <Cpu className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>
              {server.cpu_limit_percent ? `${server.cpu_limit_percent}%` : t('common.unlimited')}
            </span>
          </span>
          <span className="inline-flex items-center gap-1.5 font-body-md tabular-nums">
            <Activity className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>
              {server.ram_limit_mb ? formatMb(server.ram_limit_mb) : t('common.unlimited')}
            </span>
          </span>
          <span className="inline-flex items-center gap-1.5 font-body-md tabular-nums">
            <HardDrive className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>
              {server.disk_usage_mb && server.disk_limit_gb
                ? `${formatMb(server.disk_usage_mb)} / ${server.disk_limit_gb} GB`
                : server.disk_usage_mb
                  ? formatMb(server.disk_usage_mb)
                  : server.disk_limit_gb
                    ? `${server.disk_limit_gb} GB`
                    : t('common.unlimited')}
            </span>
          </span>
          {server.status === 'running' && (
            <span className="inline-flex items-center gap-1.5 font-body-md tabular-nums">
              <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <UptimeDisplay server={server} label="" compact />
            </span>
          )}
        </div>

        {hasConnectEndpoint && (
          <div
            className="flex items-center justify-between gap-2 pt-0.5"
            data-testid={`server-connect-row-${server.id}`}
          >
            <div className="relative z-10 min-w-0 max-w-full">
              <ServerConnectChip server={server} compact />
            </div>
          </div>
        )}
      </div>
    </article>
  )
}
