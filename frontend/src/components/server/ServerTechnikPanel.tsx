import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Check,
  ChevronDown,
  Clock,
  Copy,
  Cpu,
  Database,
  HardDrive,
  Network,
  SlidersHorizontal,
} from 'lucide-react'
import { Ankerfenster, Button, Kurzinfo, ProgressRing } from '@maunting/ui'
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
  node_cpu_steal_percent?: number | null
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
  showNetworkEdit?: boolean
  isLifecycleBusy: boolean
  actionLoading: string | null
  canManageCredentials: boolean
  onOpenResourceEditor: () => void
  onOpenNetworkEditor: () => void
}

/**
 * Kompakter Status- und Ressourcenstreifen im Server-Deck.
 * Zeigt Auslastungsringe (CPU, RAM, Disk), Spiel, Node und Uptime auf einen Blick
 * und hält Netzwerk, Ports sowie den Container-Namen sauber hinter einem Klick bereit.
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
  showNetworkEdit = false,
  isLifecycleBusy,
  actionLoading,
  canManageCredentials,
  onOpenResourceEditor,
  onOpenNetworkEditor,
}: ServerTechnikPanelProps) {
  const { t } = useTranslation()
  const [networkOpen, setNetworkOpen] = useState(false)
  const [containerCopied, setContainerCopied] = useState(false)
  const [ramPeakMb, setRamPeakMb] = useState<number | null>(null)
  const networkTriggerRef = useRef<HTMLButtonElement>(null)
  const networkPanelId = useId()

  useEffect(() => {
    setRamPeakMb(null)
  }, [server.id])

  useEffect(() => {
    if (status?.ram_mb == null) return
    setRamPeakMb((prev) => (prev == null || status.ram_mb! > prev ? status.ram_mb! : prev))
  }, [status?.ram_mb])

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
  const cpuDisplay =
    status?.cpu_percent != null ? `${status.cpu_percent.toFixed(1)}%` : '—'
  const cpuHint =
    configuredCpuLimit != null
      ? t('serverDetail.ofLimit', { limit: `${configuredCpuLimit}%` })
      : t('common.unlimited')

  const ramDisplay = status?.ram_mb != null ? formatMb(status.ram_mb) : '—'
  const ramHint =
    configuredRamLimit != null
      ? t('serverDetail.ofLimit', { limit: formatMb(configuredRamLimit) })
      : t('common.unlimited')

  const diskDisplay =
    status?.disk_used_mb != null ? formatMb(status.disk_used_mb) : '—'
  const diskHint =
    configuredDiskLimit != null
      ? t('serverDetail.ofLimit', { limit: `${configuredDiskLimit} GB` })
      : t('common.unlimited')

  const networkEditDisabled = effectiveStatus === 'running' || !!actionLoading
  const limitsDisabled = isLifecycleBusy || !!actionLoading

  const handleOpenNetworkEdit = () => {
    setNetworkOpen(false)
    onOpenNetworkEditor()
  }

  const handleCopyContainer = () => {
    void navigator.clipboard.writeText(`msm-srv-${server.id}`)
    setContainerCopied(true)
    toast.success(t('servers.dockerContainerNameCopied'))
    window.setTimeout(() => setContainerCopied(false), 1800)
  }

  const limitsButton = (
    <Button
      variant="ghost"
      size="sm"
      fingerziel
      onClick={onOpenResourceEditor}
      disabled={limitsDisabled}
      aria-description={isLifecycleBusy ? t('serverDetail.resourceEditor.lifecycleBusy') : undefined}
      className="h-7 px-2.5 text-xs text-on-surface-variant hover:text-primary disabled:opacity-50"
      data-testid="resource-edit-btn"
    >
      <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{t('serverDetail.limitsAction')}</span>
    </Button>
  )

  const networkEditButton = (
    <Button
      variant="ghost"
      size="sm"
      fingerziel
      onClick={handleOpenNetworkEdit}
      disabled={networkEditDisabled}
      aria-description={effectiveStatus === 'running' ? t('servers.networkEditRequiresStopped') : undefined}
      className={`h-7 px-2.5 text-xs text-on-surface-variant hover:text-primary ${
        networkEditDisabled ? 'opacity-50 cursor-not-allowed' : ''
      }`}
      data-testid="network-edit-btn"
    >
      {t('common.edit')}
    </Button>
  )

  return (
    <div
      className="border-t border-outline/40 pt-2.5 space-y-2.5"
      aria-label={t('serverDetail.technikPanel')}
    >
      <section aria-label={t('serverDetail.resources')} className="space-y-2.5">
        {/* Ruhige Kontextzeile links, schneller 1-Klick-Zugriff für Limits & Netzwerk rechts */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0 text-xs text-on-surface-variant">
            <span className="font-medium text-on-surface">{t('serverDetail.resources')}</span>
            <span aria-hidden="true" className="text-outline">·</span>
            <span className="truncate max-w-[14rem]">{gameLabel}</span>
            {server.node_name ? (
              <>
                <span aria-hidden="true" className="text-outline">·</span>
                <span className="truncate max-w-[11rem]">{server.node_name}</span>
              </>
            ) : null}
            {effectiveStatus === 'running' ? (
              <>
                <span aria-hidden="true" className="text-outline">·</span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <UptimeDisplay server={server} label="" compact />
                </span>
              </>
            ) : null}
            {status?.node_cpu_steal_percent != null ? (
              <>
                <span aria-hidden="true" className="text-outline">·</span>
                <span data-testid="server-cpu-steal">
                  {t('servers.cpuStealLabel')}: {status.node_cpu_steal_percent.toFixed(1)}%
                </span>
              </>
            ) : null}
            {ramPeakMb != null ? (
              <>
                <span aria-hidden="true" className="text-outline">·</span>
                <span data-testid="server-ram-peak">
                  {t('servers.ramPeakLabel')}: {formatMb(ramPeakMb)}
                </span>
              </>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-1 shrink-0">
            {showResourceEdit && (
              isLifecycleBusy ? (
                <Kurzinfo text={t('serverDetail.resourceEditor.lifecycleBusy')} seite="ende">
                  {limitsButton}
                </Kurzinfo>
              ) : (
                limitsButton
              )
            )}

            <Button
              ref={networkTriggerRef}
              type="button"
              variant="ghost"
              size="sm"
              fingerziel
              onClick={() => setNetworkOpen((current) => !current)}
              aria-expanded={networkOpen}
              aria-controls={networkPanelId}
              data-testid="network-details-trigger"
              className={`h-7 px-2.5 text-xs ${
                networkOpen
                  ? 'bg-surface-container-high text-primary'
                  : 'text-on-surface-variant hover:text-primary'
              }`}
            >
              <Network className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{t('servers.network')}</span>
              {!server.public_bind_ip ? (
                <span
                  className="h-1.5 w-1.5 rounded-full bg-status-warning shrink-0"
                  aria-hidden="true"
                />
              ) : null}
              <ChevronDown
                className={`h-3.5 w-3.5 shrink-0 transition-transform ${networkOpen ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </Button>
          </div>
        </div>

        {/* Moderne Auslastungsringe statt alter flacher Balken */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-5">
          <ProgressRing
            value={cpuValue}
            label="CPU"
            displayValue={cpuDisplay}
            hint={cpuHint}
            icon={<Cpu className="h-4 w-4" />}
            heat
          />
          <ProgressRing
            value={configuredRamLimit != null ? ramUsageOfLimit : null}
            label="RAM"
            displayValue={ramDisplay}
            hint={ramHint}
            icon={<Database className="h-4 w-4" />}
            heat
          />
          <ProgressRing
            value={configuredDiskLimit != null ? diskUsageOfLimit : null}
            label="Disk"
            displayValue={diskDisplay}
            hint={diskHint}
            icon={<HardDrive className="h-4 w-4" />}
            heat
          />
        </div>
      </section>

      {/* Netzwerk, Ports & Container sauber im Ankerfenster auf Abruf */}
      <Ankerfenster
        offen={networkOpen}
        onSchliessen={() => setNetworkOpen(false)}
        anker={networkTriggerRef}
        label={t('serverDetail.networkSummary')}
        ausrichtung="ende"
        maxHoehe="75dvh"
        durchsichtig
        className="w-[min(24rem,calc(100vw-2rem))] rounded-2xl border-outline-variant/40 overscroll-contain space-y-3.5"
      >
        <section id={networkPanelId} aria-label={t('servers.network')} className="space-y-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-on-surface">
                {t('serverDetail.networkSummary')}
              </h3>
              <p className="text-xs text-on-surface-variant truncate">{gameLabel}</p>
            </div>
            {showNetworkEdit && (
              <div className="shrink-0">
                {effectiveStatus === 'running' ? (
                  <Kurzinfo text={t('servers.networkEditRequiresStopped')} seite="ende">
                    {networkEditButton}
                  </Kurzinfo>
                ) : (
                  networkEditButton
                )}
              </div>
            )}
          </div>

          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div className="min-w-0">
              <dt className="text-xs text-on-surface-variant">{t('servers.node')}</dt>
              <dd className="mt-0.5 text-body-md font-medium text-on-surface truncate">
                {server.node_name || t('servers.nodeUnknown', { defaultValue: '—' })}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-on-surface-variant">{t('serverDetail.hostIpLabel')}</dt>
              <dd className="mt-0.5 font-headline text-body-md text-primary break-all">
                {server.public_hostname || server.public_bind_ip || (
                  <span className="text-xs font-body-md text-status-warning">
                    {t('servers.bindIp.unset')}
                  </span>
                )}
              </dd>
              {server.public_hostname && server.public_bind_ip && (
                <p className="mt-0.5 text-xs text-on-surface-variant break-all">
                  {server.public_bind_ip}
                </p>
              )}
            </div>
          </dl>

          {displayPorts.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-on-surface-variant">{t('serverDetail.exposedPorts')}</p>
              <ul className="divide-y divide-outline-variant/25 rounded-xl border border-outline-variant/35 bg-surface-container/45">
                {displayPorts.map((p) => (
                  <li
                    key={`${p.role}-${p.protocol}`}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                  >
                    <span className="text-on-surface-variant truncate">
                      {formatPortRoleLabel(p.role, t)}
                    </span>
                    <span className="inline-flex items-baseline gap-2 shrink-0 tabular-nums">
                      <span className="font-headline text-body-md text-on-surface">
                        {p.port ?? '-'}
                      </span>
                      <span className="text-xs text-on-surface-variant">
                        {p.protocol.toUpperCase()}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="border-t border-outline-variant/25 pt-2.5 flex items-center justify-between gap-2">
            <span className="text-xs text-on-surface-variant">
              {t('servers.dockerContainerLabel')}
            </span>
            <Kurzinfo text={t('servers.dockerContainerInstallDirHint')} seite="ende">
              <button
                type="button"
                className="inline-flex min-h-[44px] md:min-h-[30px] items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-on-surface hover:bg-surface-container-highest/70 transition-colors"
                aria-label={t('servers.copyDockerContainerName')}
                aria-description={t('servers.dockerContainerInstallDirHint')}
                onClick={handleCopyContainer}
              >
                <span className="sr-only">{t('servers.dockerContainerLabel')}: </span>
                <span className="font-mono text-xs text-on-surface">msm-srv-{server.id}</span>
                {containerCopied ? (
                  <Check className="h-3.5 w-3.5 shrink-0 text-secondary" aria-hidden="true" />
                ) : (
                  <Copy className="h-3.5 w-3.5 shrink-0 text-on-surface-variant" aria-hidden="true" />
                )}
              </button>
            </Kurzinfo>
          </div>
        </section>
      </Ankerfenster>

      {/* Zugangsdaten (rendert automatisch null, sofern der Blueprint keine benötigt) */}
      <ServerCredentialsPanel serverId={server.id} canManage={canManageCredentials} />
    </div>
  )
}
