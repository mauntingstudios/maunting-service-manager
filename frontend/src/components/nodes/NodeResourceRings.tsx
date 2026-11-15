import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Copy, Cpu, Database, HardDrive, Info } from 'lucide-react'
import { Ankerfenster, Button, ProgressRing, StackedProgressBar, type Segment } from '@maunting/ui'
import { formatMb } from '@/lib/serverConnect'
import { toast } from '@/stores/toastStore'

export interface NodeResourceMetrics {
  nodeId: number
  nodeName: string
  host?: string | null
  cpuPercent?: number | null
  cpuCores?: number | null
  cpuModel?: string | null
  ramTotalMb?: number | null
  ramUsedMb?: number | null
  ramAllocatedMb?: number | null
  ramAllocatableMb?: number | null
  diskTotalMb?: number | null
  diskUsedMb?: number | null
  diskPanelUsedMb?: number | null
  diskAllocatedGb?: number | null
  diskAllocatableGb?: number | null
}

interface NodeResourceRingsProps {
  metrics: NodeResourceMetrics
  testIdPrefix?: string
}

/** Berechnet verbleibenden zuweisbaren RAM in MB (mit Fallback Total minus gebucht). */
export function resolveAllocatableRamMb(m: NodeResourceMetrics): number | null {
  if (m.ramAllocatableMb != null) return Math.max(0, m.ramAllocatableMb)
  if (m.ramTotalMb == null) return null
  return Math.max(0, Math.round(m.ramTotalMb - (m.ramAllocatedMb ?? 0)))
}

/** Berechnet verbleibenden zuweisbaren Disk-Platz in GB (mit Fallback Total minus gebucht). */
export function resolveAllocatableDiskGb(m: NodeResourceMetrics): number | null {
  if (m.diskAllocatableGb != null) return Math.max(0, m.diskAllocatableGb)
  if (m.diskTotalMb == null) return null
  const totalGb = Math.floor(m.diskTotalMb / 1024)
  return Math.max(0, totalGb - (m.diskAllocatedGb ?? 0))
}

/**
 * Einheitliches 3-Ring-Ressourcenband (CPU, RAM, Disk) für Nodes.
 * Zeigt aktuelle Auslastung und verbleibende Kapazität direkt auf einen Blick.
 */
export function NodeResourceRings({ metrics, testIdPrefix = 'node' }: NodeResourceRingsProps) {
  const { t } = useTranslation()
  const {
    nodeId,
    cpuPercent,
    cpuCores,
    cpuModel,
    ramTotalMb,
    ramUsedMb,
    diskTotalMb,
    diskUsedMb,
  } = metrics

  const cleanModel = cpuModel?.trim() || null
  const cpuVal = cpuPercent != null && Number.isFinite(cpuPercent)
    ? Math.max(0, Math.min(100, cpuPercent))
    : null
  const cpuDisplay = cpuVal != null
    ? `${cpuVal.toFixed(0)}%`
    : cpuCores != null
      ? t('nodes.cpuCores', { count: cpuCores })
      : '—'
  const cpuHintParts = [
    cpuVal != null && cpuCores != null ? t('nodes.cpuCores', { count: cpuCores }) : null,
    cleanModel || (cpuCores == null ? t('nodes.cpuModelUnknown') : null),
  ].filter(Boolean)
  const cpuHint = cpuHintParts.length > 0 ? cpuHintParts.join(' · ') : t('nodes.cpuModelUnknown')

  const ramPercent =
    ramTotalMb != null && ramTotalMb > 0 && ramUsedMb != null
      ? Math.max(0, Math.min(100, (ramUsedMb / ramTotalMb) * 100))
      : null
  const ramDisplay =
    ramTotalMb != null && ramUsedMb != null
      ? `${formatMb(ramUsedMb)} / ${formatMb(ramTotalMb)}`
      : ramTotalMb != null
        ? formatMb(ramTotalMb)
        : '—'
  const allocRam = resolveAllocatableRamMb(metrics)
  const freeRam =
    ramTotalMb != null && ramUsedMb != null ? Math.max(0, ramTotalMb - ramUsedMb) : null
  const ramHintParts = [
    allocRam != null ? t('nodes.ramAllocatableShort', { value: formatMb(allocRam) }) : null,
    freeRam != null ? t('nodes.freeRam', { value: formatMb(freeRam) }) : null,
  ].filter(Boolean)
  const ramHint = ramHintParts.length > 0 ? ramHintParts.join(' · ') : undefined

  const diskPercent =
    diskTotalMb != null && diskTotalMb > 0 && diskUsedMb != null
      ? Math.max(0, Math.min(100, (diskUsedMb / diskTotalMb) * 100))
      : null
  const diskDisplay =
    diskTotalMb != null && diskUsedMb != null
      ? `${formatMb(diskUsedMb)} / ${formatMb(diskTotalMb)}`
      : diskTotalMb != null
        ? formatMb(diskTotalMb)
        : '—'
  const allocDiskGb = resolveAllocatableDiskGb(metrics)
  const freeDiskMb =
    diskTotalMb != null && diskUsedMb != null ? Math.max(0, diskTotalMb - diskUsedMb) : null
  const diskHintParts = [
    allocDiskGb != null ? t('nodes.diskAllocatable', { value: `${allocDiskGb} GB` }) : null,
    freeDiskMb != null ? t('nodes.diskFree', { value: formatMb(freeDiskMb) }) : null,
  ].filter(Boolean)
  const diskHint = diskHintParts.length > 0 ? diskHintParts.join(' · ') : undefined

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-5">
      <ProgressRing
        value={cpuVal}
        label="CPU"
        displayValue={cpuDisplay}
        hint={cpuHint}
        icon={<Cpu className="h-4 w-4" />}
        heat
        data-testid={`${testIdPrefix}-cpu-${nodeId}`}
      />
      <ProgressRing
        value={ramPercent}
        label="RAM"
        displayValue={ramDisplay}
        hint={ramHint}
        icon={<Database className="h-4 w-4" />}
        heat
        data-testid={`${testIdPrefix}-ram-${nodeId}`}
      />
      <ProgressRing
        value={diskPercent}
        label="Disk"
        displayValue={diskDisplay}
        hint={diskHint}
        icon={<HardDrive className="h-4 w-4" />}
        heat
        data-testid={`${testIdPrefix}-disk-${nodeId}`}
      />
    </div>
  )
}

interface NodeCapacityDetailsButtonProps {
  metrics: NodeResourceMetrics
  testIdPrefix?: string
}

/**
 * Hält sekundäre Infrastrukturdetails (Host-URL, gebuchte Limits vs. Reserve,
 * 3-teilige Disk-Aufteilung) sauber auf 1 Klick im Ankerfenster bereit.
 */
export function NodeCapacityDetailsButton({
  metrics,
  testIdPrefix = 'node',
}: NodeCapacityDetailsButtonProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [hostCopied, setHostCopied] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  const {
    nodeId,
    nodeName,
    host,
    cpuModel,
    ramTotalMb,
    ramAllocatedMb,
    diskTotalMb,
    diskUsedMb,
    diskPanelUsedMb,
    diskAllocatedGb,
  } = metrics

  const hasContent = Boolean(host || cpuModel?.trim() || ramTotalMb != null || diskTotalMb != null)
  if (!hasContent) return null

  const allocRam = resolveAllocatableRamMb(metrics)
  const allocDiskGb = resolveAllocatableDiskGb(metrics)
  const panelUsedMb = diskPanelUsedMb ?? 0
  const totalDiskMb = diskTotalMb ?? 0
  const hostUsedMb = diskUsedMb ?? 0
  const systemUsedMb = Math.max(0, hostUsedMb - panelUsedMb)
  const freeDiskMb = totalDiskMb > 0 ? Math.max(0, totalDiskMb - hostUsedMb) : 0

  const segments: Segment[] = [
    {
      value: panelUsedMb,
      colorClass: 'bg-primary',
      label: t('nodes.diskPanelUsed', { value: formatMb(panelUsedMb) }),
    },
    {
      value: systemUsedMb,
      colorClass: 'bg-outline',
      label: t('nodes.diskSystemUsed', { value: formatMb(systemUsedMb) }),
    },
    {
      value: freeDiskMb,
      colorClass: 'bg-status-success',
      label: t('nodes.diskFree', { value: formatMb(freeDiskMb) }),
    },
  ]

  const handleCopyHost = () => {
    if (!host) return
    void navigator.clipboard.writeText(host)
    setHostCopied(true)
    toast.success(t('nodes.hostCopied'))
    window.setTimeout(() => setHostCopied(false), 1800)
  }

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="sm"
        fingerziel
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={panelId}
        data-testid={`${testIdPrefix}-details-trigger-${nodeId}`}
        className={`h-8 px-2.5 text-xs ${
          open
            ? 'bg-surface-container-high text-primary'
            : 'text-on-surface-variant hover:text-primary'
        }`}
      >
        <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{t('nodes.detailsLabel')}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </Button>

      <Ankerfenster
        offen={open}
        onSchliessen={() => setOpen(false)}
        anker={triggerRef}
        label={`${nodeName} ${t('nodes.capacityDetails')}`}
        ausrichtung="ende"
        maxHoehe="75dvh"
        durchsichtig
        className="w-[min(24rem,calc(100vw-2rem))] rounded-2xl border-outline-variant/40 overscroll-contain space-y-3.5"
      >
        <section
          id={panelId}
          aria-label={t('nodes.capacityDetails')}
          className="space-y-3.5 text-xs"
        >
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-on-surface">{nodeName}</h3>
            {cpuModel?.trim() ? (
              <p className="text-xs text-on-surface-variant break-words mt-0.5">{cpuModel.trim()}</p>
            ) : null}
          </div>

          {host ? (
            <div className="space-y-1">
              <p className="text-on-surface-variant">{t('nodes.host')}</p>
              <div className="flex items-center justify-between gap-2 rounded-xl border border-outline-variant/35 bg-surface-container/50 px-2.5 py-1.5">
                <span className="font-mono text-xs text-on-surface break-all">{host}</span>
                <button
                  type="button"
                  onClick={handleCopyHost}
                  aria-label={t('nodes.copyHost')}
                  className="inline-flex min-h-[36px] min-w-[36px] shrink-0 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-highest/70 hover:text-primary transition-colors"
                >
                  {hostCopied ? (
                    <Check className="h-3.5 w-3.5 text-secondary" aria-hidden="true" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>
          ) : null}

          {ramTotalMb != null ? (
            <div
              className="rounded-xl border border-outline-variant/35 bg-surface-container/45 p-3 space-y-1"
              data-testid={`${testIdPrefix}-ram-booked-${nodeId}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-on-surface">RAM</span>
                <span className="tabular-nums text-on-surface-variant">
                  {t('nodes.ramAllocatable', { value: formatMb(allocRam) })}
                </span>
              </div>
              <p className="text-on-surface-variant tabular-nums">
                {t('nodes.ramBooked', {
                  used: formatMb(ramAllocatedMb ?? 0),
                  total: formatMb(ramTotalMb),
                })}
              </p>
            </div>
          ) : null}

          {diskTotalMb != null ? (
            <div
              className="rounded-xl border border-outline-variant/35 bg-surface-container/45 p-3 space-y-2"
              data-testid={`${testIdPrefix}-disk-breakdown-${nodeId}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-on-surface">Disk</span>
                <span className="tabular-nums text-on-surface-variant">
                  {t('nodes.diskAllocatable', { value: `${allocDiskGb ?? 0} GB` })}
                </span>
              </div>
              <StackedProgressBar
                segments={segments}
                hint={`${t('nodes.diskBooked', {
                  used: `${diskAllocatedGb ?? 0} GB`,
                  total: `${Math.floor(totalDiskMb / 1024)} GB`,
                })}`}
              />
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-label-sm">
                <span className="text-primary">
                  ■ {t('nodes.diskPanelUsed', { value: formatMb(panelUsedMb) })}
                </span>
                <span className="text-on-surface-variant">
                  ■ {t('nodes.diskSystemUsed', { value: formatMb(systemUsedMb) })}
                </span>
                <span className="text-status-success">
                  ■ {t('nodes.diskFree', { value: formatMb(freeDiskMb) })}
                </span>
              </div>
            </div>
          ) : null}
        </section>
      </Ankerfenster>
    </>
  )
}
