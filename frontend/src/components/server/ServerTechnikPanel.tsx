import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock, Copy, Cpu, Network } from 'lucide-react'
import { Button, Kurzinfo, ProgressBar } from '@maunting/ui'
import { ServerCredentialsPanel } from '@/components/server/ServerCredentialsPanel'
import { UptimeDisplay } from '@/components/server/UptimeDisplay'
import { formatMb, formatPortRoleLabel } from '@/lib/serverConnect'
import { toast } from '@/stores/toastStore'
import type { Server } from '@/types'

export interface ServerRuntimeMetrics {
  cpu_percent?: number | null
  ram_mb?: number | null
  disk_used_mb?: number | null
  uptime_seconds?: number | null
}

interface ServerTechnikPanelProps {
  server: Server
  gameLabel: string
  status: ServerRuntimeMetrics | null
  effectiveStatus: string
  configuredCpuLimit: number | null
  configuredRamLimit: number | null
  configuredDiskLimit: number | null
  cpuUsageOfLimit: number | undefined
  ramUsageOfLimit: number | undefined
  diskUsageOfLimit: number | undefined
  showResourceEdit: boolean
  isLifecycleBusy: boolean
  actionLoading: string | null
  canManageCredentials: boolean
  networkEditButton: ReactNode
  onOpenResourceEditor: () => void
}

/**
 * Ruhiges Telemetrie-, Node- und Netzwerk-Band direkt im unteren Bereich des Server-Decks.
 * Zeigt Auslastungsbalken (CPU, RAM, Disk), Node, Uptime, Ports und Container-ID
 * ohne seitlichen Platz für Mods, Dateien oder Konsole wegzunehmen.
 */
export function ServerTechnikPanel({
  server,
  gameLabel,
  status,
  effectiveStatus,
  configuredCpuLimit,
  configuredRamLimit,
  configuredDiskLimit,
  cpuUsageOfLimit,
  ramUsageOfLimit,
  diskUsageOfLimit,
  showResourceEdit,
  isLifecycleBusy,
  actionLoading,
  canManageCredentials,
  networkEditButton,
  onOpenResourceEditor,
}: ServerTechnikPanelProps) {
  const { t } = useTranslation()

  const fallbackPorts = [
    { role: 'game', port: server.game_port, protocol: 'udp' },
    { role: 'query', port: server.query_port, protocol: 'udp' },
    { role: 'rcon', port: server.rcon_port, protocol: 'tcp' },
  ]
  const displayPorts =
    server.ports && server.ports.length > 0 ? server.ports : fallbackPorts

  const cpuValue =
    configuredCpuLimit != null
      ? cpuUsageOfLimit
      : status?.cpu_percent != null
        ? Math.min(100, status.cpu_percent)
        : null
  const cpuHint =
    status?.cpu_percent != null
      ? `${status.cpu_percent.toFixed(1)}% / ${configuredCpuLimit != null ? `${configuredCpuLimit}%` : '∞'}`
      : configuredCpuLimit != null
        ? `— / ${configuredCpuLimit}%`
        : t('common.unlimited')

  const ramHint =
    status?.ram_mb != null
      ? `${formatMb(status.ram_mb)} / ${configuredRamLimit != null ? formatMb(configuredRamLimit) : '∞'}`
      : configuredRamLimit != null
        ? `— / ${formatMb(configuredRamLimit)}`
        : t('common.unlimited')

  const diskHint =
    status?.disk_used_mb != null
      ? `${formatMb(status.disk_used_mb)} / ${configuredDiskLimit != null ? `${configuredDiskLimit} GB` : '∞'}`
      : configuredDiskLimit != null
        ? `— / ${configuredDiskLimit} GB`
        : t('common.unlimited')

  return (
    <div
      className="border-t border-outline/45 pt-3 space-y-2.5"
      aria-label={t('serverDetail.technikPanel')}
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-stretch">
        {/* Ressourcen-Balken & Uptime */}
        <section
          aria-label={t('serverDetail.resources')}
          className="lg:col-span-7 min-w-0 rounded-xl border border-outline-variant/40 bg-surface-container/35 px-3 py-2.5 flex flex-col justify-between gap-2"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="font-label-md text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant flex items-center gap-1.5">
                <Cpu className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{t('serverDetail.resources')}</span>
              </h2>
              {effectiveStatus === 'running' ? (
                <span className="inline-flex items-center gap-1 text-xs text-on-surface-variant">
                  <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <UptimeDisplay server={server} label="" compact />
                </span>
              ) : null}
            </div>
            {showResourceEdit && (
              <Button
                variant="ghost"
                size="sm"
                fingerziel
                onClick={onOpenResourceEditor}
                disabled={isLifecycleBusy || !!actionLoading}
                className="h-7 px-2 text-xs text-on-surface-variant hover:text-primary disabled:opacity-50"
                data-testid="resource-edit-btn"
              >
                {t('common.edit')}
              </Button>
            )}
          </div>

          {showResourceEdit && isLifecycleBusy && (
            <p className="font-body-md text-xs text-on-surface-variant">
              {t('serverDetail.resourceEditor.lifecycleBusy')}
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3">
            <ProgressBar
              value={cpuValue}
              label="CPU"
              hint={cpuHint}
              heat
            />
            <ProgressBar
              value={configuredRamLimit != null ? ramUsageOfLimit : null}
              label="RAM"
              hint={ramHint}
              heat
            />
            <ProgressBar
              value={configuredDiskLimit != null ? diskUsageOfLimit : null}
              label="Disk"
              hint={diskHint}
              heat
            />
          </div>
        </section>

        {/* Node, Netzwerk, Ports & Container-ID */}
        <section
          aria-label={t('servers.network')}
          className="lg:col-span-5 min-w-0 rounded-xl border border-outline-variant/40 bg-surface-container/35 px-3 py-2.5 flex flex-col justify-between gap-2"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 min-w-0">
              <h2 className="font-label-md text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant flex items-center gap-1.5 shrink-0">
                <Network className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{t('servers.network')}</span>
              </h2>
              <span className="truncate text-xs text-on-surface-variant">{gameLabel}</span>
            </div>
            <div className="shrink-0">
              {effectiveStatus === 'running' ? (
                <Kurzinfo text={t('servers.networkEditRequiresStopped')} seite="ende">
                  {networkEditButton}
                </Kurzinfo>
              ) : (
                networkEditButton
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5 min-w-0">
            <div className="inline-flex items-baseline gap-1.5 min-w-0">
              <span className="text-label-sm font-medium uppercase tracking-wider text-on-surface-variant">
                {t('servers.node')}
              </span>
              <span className="text-xs font-medium text-on-surface truncate max-w-[11rem]">
                {server.node_name || t('servers.nodeUnknown', { defaultValue: '—' })}
              </span>
            </div>
            <div className="inline-flex items-baseline gap-1.5 min-w-0">
              <span className="text-label-sm font-medium uppercase tracking-wider text-on-surface-variant">
                IP
              </span>
              <span className="font-headline text-body-md text-primary break-all">
                {server.public_bind_ip || (
                  <span className="text-xs font-body-md text-status-warning">
                    {t('servers.bindIp.unset')}
                  </span>
                )}
              </span>
            </div>
            {displayPorts.map((p) => (
              <div key={`${p.role}-${p.protocol}`} className="inline-flex items-baseline gap-1">
                <span className="text-label-sm uppercase tracking-wider text-on-surface-variant">
                  {formatPortRoleLabel(p.role, t)}
                </span>
                <span className="font-headline text-body-md text-primary">
                  {p.port ?? '-'}
                </span>
                <span className="font-mono text-label-sm text-on-surface-variant">
                  {p.protocol.toUpperCase()}
                </span>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-outline-variant/25 pt-1.5">
            <Kurzinfo text={t('servers.dockerContainerInstallDirHint')} seite="ende">
              <button
                type="button"
                className="inline-flex min-h-[44px] md:min-h-[26px] items-center gap-2 rounded-md px-1.5 -mx-1.5 text-left text-on-surface-variant hover:bg-surface-container-high/70 hover:text-on-surface transition-colors"
                aria-label={t('servers.copyDockerContainerName')}
                aria-description={t('servers.dockerContainerInstallDirHint')}
                onClick={() => {
                  void navigator.clipboard.writeText(`msm-srv-${server.id}`)
                  toast.success(t('servers.dockerContainerNameCopied'))
                }}
              >
                <span className="font-label-md text-label-sm font-semibold uppercase tracking-wider">
                  {t('servers.dockerContainerLabel')}
                </span>
                <span className="font-mono text-xs text-on-surface">msm-srv-{server.id}</span>
                <Copy className="h-3 w-3 shrink-0 opacity-70" aria-hidden="true" />
              </button>
            </Kurzinfo>
          </div>
        </section>
      </div>

      {/* Zugangsdaten (rendert automatisch null, sofern der Blueprint keine benötigt) */}
      <ServerCredentialsPanel serverId={server.id} canManage={canManageCredentials} />
    </div>
  )
}
