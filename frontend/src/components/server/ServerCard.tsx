import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Activity, Clock, Cpu, Database, HardDrive, Network, Server as ServerIcon, Store } from 'lucide-react'
import { Badge, Kurzinfo } from '@maunting/ui'
import { ServerConnectChip } from '@/components/server/ServerConnectChip'
import { UptimeDisplay } from '@/components/server/UptimeDisplay'
import { serverStatusClasses } from '@/lib/serverConnect'
import type { Server } from '@/types'

interface ServerCardProps {
  server: Server
  gameLabel: string
  variant?: 'dashboard' | 'list'
}

/**
 * Gemeinsame Serverkarte für Dashboard und Serverliste.
 * Verwendet einen semantischen Link per stretched-link (`after:inset-0`), damit die gesamte
 * Karte klickbar bleibt und interaktive Controls (`ServerConnectChip`) gültig auf `z-10` liegen.
 */
export function ServerCard({ server, gameLabel, variant = 'list' }: ServerCardProps) {
  const { t } = useTranslation()
  const isDashboard = variant === 'dashboard'

  return (
    <article className="relative msm-card p-5 hover:border-primary/40 hover:bg-surface-container-high/40 transition-all duration-200 group">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <ServerIcon
            className="w-4 h-4 text-on-surface-variant group-hover:text-primary transition-colors shrink-0"
            aria-hidden="true"
          />
          <h3 className="font-headline text-body-md text-on-surface group-hover:text-primary transition-colors min-w-0 truncate">
            <Link
              to={`/servers/${server.id}`}
              className="focus:outline-none after:absolute after:inset-0 after:content-['']"
            >
              {server.name}
            </Link>
          </h3>
          {!isDashboard && server.node_name && (
            <div className="relative z-10">
              <Kurzinfo text={t('servers.node')} aussen="shrink-0">
                <Badge variant="info" aria-description={t('servers.node')}>
                  <Network className="w-3 h-3 mr-1 inline" aria-hidden="true" />
                  {server.node_name}
                </Badge>
              </Kurzinfo>
            </div>
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
        <span
          className={`font-mono-sm text-mono-sm px-2.5 py-0.5 rounded-full border shrink-0 ${serverStatusClasses(server.status)}`}
        >
          {t(`servers.status.${server.status}`, { defaultValue: server.status })}
        </span>
      </div>

      <p className="font-body-md text-sm text-on-surface-variant mb-4 truncate">
        {gameLabel}
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-on-surface-variant">
          <span className="inline-flex items-center gap-1.5 font-body-md">
            <Cpu className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>
              {isDashboard ? 'CPU: ' : ''}
              {server.cpu_limit_percent ? `${server.cpu_limit_percent}%` : t('common.unlimited')}
            </span>
          </span>
          <span className="inline-flex items-center gap-1.5 font-body-md">
            <Activity className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>
              {isDashboard ? 'RAM: ' : ''}
              {server.ram_limit_mb ? `${server.ram_limit_mb} MB` : t('common.unlimited')}
            </span>
          </span>
          {!isDashboard && (
            <span className="inline-flex items-center gap-1.5 font-body-md">
              <HardDrive className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>{server.disk_limit_gb ? `${server.disk_limit_gb} GB` : t('common.unlimited')}</span>
            </span>
          )}
          {server.status === 'running' && (
            <span className="inline-flex items-center gap-1.5 font-body-md">
              <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <UptimeDisplay server={server} label={t('serverDetail.uptime', { defaultValue: 'Uptime' })} compact />
            </span>
          )}
        </div>

        <div className="relative z-10">
          <ServerConnectChip server={server} compact />
        </div>
      </div>
    </article>
  )
}
