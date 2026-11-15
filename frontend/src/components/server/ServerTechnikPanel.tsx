import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock, Cpu, Database, HardDrive, Network } from 'lucide-react'
import { Button, Kurzinfo, ResourceMetricCard } from '@maunting/ui'
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
 * Rechtes docked Technik-&-Limits-Panel der Serverdetail-Seite (Hybrid Variante C):
 * Hält CPU/RAM/Disk/Uptime-Metriken inkl. Limit-Editor, Netzwerk-/Port-Details,
 * den kanonischen Docker-Containernamen und Zugangsdaten übersichtlich beisammen,
 * ohne die obere Bedienleiste und Tab-Ansicht zu überladen.
 */
export function ServerTechnikPanel({
  server,
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

  return (
    <div className="space-y-4">
      {/* Ressourcen & Limits */}
      <section className="msm-card p-4 space-y-3" aria-label={t('serverDetail.resources')}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-headline text-body-md text-on-surface flex items-center gap-2">
            <Cpu className="w-4 h-4 text-on-surface-variant" aria-hidden="true" />
            {t('serverDetail.resources')}
          </h3>
          {showResourceEdit && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onOpenResourceEditor}
              disabled={isLifecycleBusy || !!actionLoading}
              className="disabled:opacity-50"
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ResourceMetricCard
            label="CPU"
            value={status?.cpu_percent != null ? `${status.cpu_percent.toFixed(1)}%` : '—'}
            hint={`${t('serverDetail.limit')}: ${configuredCpuLimit != null ? `${configuredCpuLimit}%` : t('common.unlimited')}`}
            icon={<Cpu className="h-4 w-4" />}
            percent={configuredCpuLimit != null ? cpuUsageOfLimit : undefined}
            heat
          />
          <ResourceMetricCard
            label="RAM"
            value={status?.ram_mb != null ? formatMb(status.ram_mb) : '—'}
            hint={`${t('serverDetail.limit')}: ${configuredRamLimit != null ? formatMb(configuredRamLimit) : t('common.unlimited')}`}
            icon={<Database className="h-4 w-4" />}
            percent={configuredRamLimit != null ? ramUsageOfLimit : undefined}
            heat
          />
          <ResourceMetricCard
            label="Disk"
            value={status?.disk_used_mb != null ? formatMb(status.disk_used_mb) : '—'}
            hint={
              configuredDiskLimit != null
                ? `${t('serverDetail.limit')}: ${configuredDiskLimit} GB`
                : t('common.unlimited')
            }
            icon={<HardDrive className="h-4 w-4" />}
            percent={configuredDiskLimit != null ? diskUsageOfLimit : undefined}
            heat
          />
          <ResourceMetricCard
            label={t('serverDetail.uptime', { defaultValue: 'Uptime' })}
            value={effectiveStatus === 'running' ? <UptimeDisplay server={server} label="" compact /> : '—'}
            hint={
              effectiveStatus === 'running'
                ? t('serverDetail.sinceLastStart', { defaultValue: 'Seit letztem Start' })
                : t(`servers.status.${effectiveStatus}`, { defaultValue: effectiveStatus })
            }
            icon={<Clock className="h-4 w-4" />}
          />
        </div>
      </section>

      {/* Netzwerk & Ports */}
      <section className="msm-card p-4 space-y-3" aria-label={t('servers.network')}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Network className="w-4 h-4 text-on-surface-variant" aria-hidden="true" />
            <h3 className="font-headline text-body-md text-on-surface">
              {t('servers.network')}
            </h3>
          </div>
          {effectiveStatus === 'running' ? (
            <Kurzinfo text={t('servers.networkEditRequiresStopped')} seite="ende">
              {networkEditButton}
            </Kurzinfo>
          ) : (
            networkEditButton
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <p className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-0.5">
              {t('servers.node')}
            </p>
            <p className="font-headline text-body-md text-primary break-all">
              {server.node_name || t('servers.nodeUnknown', { defaultValue: '—' })}
            </p>
          </div>
          <div>
            <p className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-0.5">
              {t('servers.publicBindIp')}
            </p>
            <p className="font-headline text-body-md text-primary break-all">
              {server.public_bind_ip || (
                <span className="text-status-warning">
                  {t('servers.bindIp.unset')}
                </span>
              )}
            </p>
          </div>
          {displayPorts.map((p) => (
            <div key={`${p.role}-${p.protocol}`}>
              <p className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-0.5">
                {formatPortRoleLabel(p.role, t)}
              </p>
              <p className="font-headline text-body-md text-primary">
                {p.port ?? '-'}{' '}
                <span className="text-sm font-body-md text-on-surface-variant">
                  {p.protocol.toUpperCase()}
                </span>
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Container-Bezeichner (kopierbar für Host-/Admin-Debugging) */}
      <div className="msm-card p-3.5">
        <Kurzinfo text={t('servers.dockerContainerInstallDirHint')} seite="ende" aussen="w-full">
          <Button
            variant="secondary"
            type="button"
            className="w-full inline-flex min-h-11 items-center justify-between gap-2 text-left"
            aria-label={t('servers.copyDockerContainerName')}
            aria-description={t('servers.dockerContainerInstallDirHint')}
            onClick={() => {
              void navigator.clipboard.writeText(`msm-srv-${server.id}`)
              toast.success(t('servers.dockerContainerNameCopied'))
            }}
          >
            <span className="font-label-md text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">
              {t('servers.dockerContainerLabel')}
            </span>
            <span className="font-mono text-xs text-on-surface">msm-srv-{server.id}</span>
          </Button>
        </Kurzinfo>
      </div>

      {/* Zugangsdaten (nur sichtbar bei Bedarf oder vorhandener Zuordnung) */}
      <ServerCredentialsPanel serverId={server.id} canManage={canManageCredentials} />
    </div>
  )
}
