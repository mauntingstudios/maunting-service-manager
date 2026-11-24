import { useTranslation } from 'react-i18next'
import { ArrowRight, Cpu, Server, ShieldCheck } from 'lucide-react'
import { Badge, Button } from '@maunting/ui'
import type { ShopPublicNodeStatusDto } from '@/api/shop'
import { formatEuro } from '../preis'
import { standortAnzeigeName, standortUntertitel } from '../standortName'
import type { ShopPingMessung } from '../shopStandortStore'

interface StandortPingDeckProps {
  nodeStatuses: ShopPublicNodeStatusDto[]
  ausgewaehlteNodeId: number | null
  onSelectNode: (nodeId: number | null) => void
  pingWerte: Record<number, ShopPingMessung>
  besterPingNodeId: number | null
  pingBusy: boolean
  onRunPingTest: () => void
}

function latenzBalken(ms: number): { prozent: number; farbe: string } {
  const prozent = Math.max(12, Math.min(100, Math.round((ms / 150) * 100)))
  if (ms <= 35) return { prozent, farbe: 'bg-status-running' }
  if (ms <= 85) return { prozent, farbe: 'bg-status-warning' }
  return { prozent, farbe: 'bg-status-destructive' }
}

function auslastungFarbe(belegtProzent: number): string {
  if (belegtProzent < 65) return 'bg-status-running'
  if (belegtProzent < 88) return 'bg-status-warning'
  return 'bg-status-destructive'
}

export function StandortPingDeck({
  nodeStatuses,
  ausgewaehlteNodeId,
  onSelectNode,
  pingWerte,
  besterPingNodeId,
  pingBusy,
  onRunPingTest,
}: StandortPingDeckProps) {
  const { t } = useTranslation()
  if (nodeStatuses.length === 0) return null

  const onlineNodes = nodeStatuses.filter((n) => n.status === 'online')
  const gemessene = onlineNodes.filter((n) => pingWerte[n.id]?.ms != null).length

  return (
    <section
      id="shop-standorte"
      aria-label={t('shop.nodeStatus.titel')}
      data-shop-reveal
      className="msm-shop-reveal msm-shop-reveal-fallback mx-auto max-w-7xl px-4 pb-12 pt-2 sm:px-6 lg:px-8"
    >
      <div className="msm-card rounded-2xl border border-outline-variant/30 bg-surface-container-low/85 p-5 shadow-xl sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-label-sm font-semibold uppercase tracking-[0.18em] text-primary">
              {t('shop.nodeStatus.eyebrow')}
            </p>
            <h2 className="mt-1 font-headline text-2xl font-bold text-on-surface">
              {t('shop.nodeStatus.titel')}
            </h2>
            <p className="mt-1 text-xs text-on-surface-variant sm:text-sm">
              {t('shop.nodeStatus.untertitel')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {gemessene > 0 && (
              <span className="text-xs font-medium tabular-nums text-on-surface-variant">
                {t('shop.nodeStatus.pingFortschritt', {
                  done: gemessene,
                  total: onlineNodes.length,
                })}
              </span>
            )}
            {ausgewaehlteNodeId != null && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onSelectNode(null)}
              >
                {t('shop.nodeStatus.standortAutomatischZuruecksetzen')}
              </Button>
            )}
            {onlineNodes.length > 0 && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={pingBusy}
                onClick={onRunPingTest}
              >
                {pingBusy ? t('shop.nodeStatus.pingLaeuft') : t('shop.nodeStatus.pingTesten')}
              </Button>
            )}
          </div>
        </div>

        <div
          className={`mt-5 grid gap-4 ${
            nodeStatuses.length === 1
              ? 'max-w-2xl grid-cols-1'
              : nodeStatuses.length === 2
                ? 'grid-cols-1 md:grid-cols-2'
                : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
          }`}
        >
          {nodeStatuses.map((node) => {
            const anzeigeName = standortAnzeigeName(node, t('shop.nodeStatus.standardStandort'))
            const untertitel = standortUntertitel(node)
            const isOffline = node.load_level === 'offline' || node.status !== 'online'
            const isFull =
              !isOffline &&
              (node.load_level === 'full' ||
                node.load_level === 'high' ||
                !node.accepting_orders)
            const badgeVariant = isOffline ? 'destructive' : isFull ? 'warning' : 'success'
            const badgeLabel = isOffline
              ? t('shop.nodeStatus.offline')
              : isFull
                ? t('shop.nodeStatus.belegt')
                : t('shop.nodeStatus.frei')
            const statusDotClass = isOffline
              ? 'bg-status-destructive'
              : isFull
                ? 'bg-status-warning'
                : 'bg-status-running'
            const pingInfo = pingWerte[node.id]
            const istBesterPing = besterPingNodeId === node.id
            const istAusgewaehlt = ausgewaehlteNodeId === node.id
            const aufpreis = Math.max(0, node.shop_surcharge_cents ?? 0)
            const kannWaehlen = !isOffline && !isFull
            const balken = pingInfo?.ms != null ? latenzBalken(pingInfo.ms) : null
            const ramFreePercent =
              node.ram_free_percent != null
                ? Math.max(0, Math.min(100, Math.round(node.ram_free_percent)))
                : null
            const ramUsedPercent = ramFreePercent != null ? 100 - ramFreePercent : null

            return (
              <article
                key={node.id}
                className={`msm-shop-card-lift flex flex-col justify-between gap-3.5 rounded-2xl border bg-surface-container/95 p-4 transition-colors ${
                  istAusgewaehlt
                    ? 'border-primary bg-primary/5 ring-1 ring-primary/40'
                    : istBesterPing
                      ? 'border-primary/60'
                      : 'border-outline-variant/30'
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-2.5">
                      <span
                        className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${statusDotClass}`}
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <h3 className="truncate font-headline text-base font-bold text-on-surface">
                          {anzeigeName}
                        </h3>
                        {untertitel && (
                          <p className="truncate text-xs text-on-surface-variant">{untertitel}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                      {pingInfo?.ms != null && (
                        <Badge
                          variant={istBesterPing ? 'success' : 'info'}
                          className="tabular-nums"
                        >
                          {istBesterPing
                            ? `${pingInfo.ms} ms · ${t('shop.nodeStatus.besterPing')}`
                            : `${pingInfo.ms} ms`}
                        </Badge>
                      )}
                      <Badge variant={badgeVariant}>{badgeLabel}</Badge>
                    </div>
                  </div>

                  {ramFreePercent != null && ramUsedPercent != null && (
                    <div className="space-y-1.5 rounded-xl border border-white/10 bg-background/50 p-3">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-on-surface-variant">
                          {t('shop.nodeStatus.kapazitaetAuslastung')}
                        </span>
                        <span className="font-semibold tabular-nums text-on-surface">
                          {t('shop.nodeStatus.ramFreiProzent', { percent: ramFreePercent })}
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-container-highest">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${auslastungFarbe(
                            ramUsedPercent,
                          )}`}
                          style={{ width: `${Math.max(6, ramUsedPercent)}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {balken && (
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container-highest">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${balken.farbe}`}
                        style={{ width: `${balken.prozent}%` }}
                      />
                    </div>
                  )}

                  {(node.ddos_game_aware || node.ddos_provider) && (
                    <div>
                      <span className="msm-shop-ddos-pill inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold text-status-running">
                        <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span>
                          {node.ddos_game_aware
                            ? node.ddos_provider
                              ? `${t('shop.nodeStatus.ddosGameAware')} (${node.ddos_provider})`
                              : t('shop.nodeStatus.ddosGameAware')
                            : node.ddos_provider}
                        </span>
                      </span>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-1.5">
                    {node.hardware_tier_label && (
                      <Badge variant="default">{node.hardware_tier_label}</Badge>
                    )}
                    <Badge variant="default" className="tabular-nums">
                      {aufpreis > 0
                        ? t('shop.nodeStatus.aufpreisMonat', { preis: formatEuro(aufpreis) })
                        : t('shop.nodeStatus.inklusive')}
                    </Badge>
                  </div>

                  {(node.cpu_model || node.ram_type || node.storage_type) && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-on-surface-variant">
                      {node.cpu_model && (
                        <span className="inline-flex items-center gap-1">
                          <Cpu className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span>{node.cpu_model}</span>
                        </span>
                      )}
                      {node.ram_type && <span>{node.ram_type}</span>}
                      {node.storage_type && <span>{node.storage_type}</span>}
                    </div>
                  )}
                </div>

                <div className="space-y-2 border-t border-white/10 pt-3">
                  <Button
                    type="button"
                    size="sm"
                    variant={istAusgewaehlt ? 'primary' : 'secondary'}
                    disabled={!kannWaehlen && !istAusgewaehlt}
                    aria-pressed={istAusgewaehlt}
                    onClick={() => onSelectNode(istAusgewaehlt ? null : node.id)}
                    className="w-full"
                  >
                    {istAusgewaehlt
                      ? t('shop.nodeStatus.standortAusgewaehlt')
                      : kannWaehlen
                        ? t('shop.nodeStatus.standortWaehlen')
                        : badgeLabel}
                  </Button>
                  {istAusgewaehlt && (
                    <a
                      href="#shop-spiele"
                      className="inline-flex w-full items-center justify-center gap-1.5 text-xs font-semibold text-primary hover:underline"
                    >
                      <Server className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{t('shop.nodeStatus.zumKatalog')}</span>
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </a>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      </div>
    </section>
  )
}
