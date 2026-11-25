import { useTranslation } from 'react-i18next'
import { Activity, Check, Cpu, Server, ShieldCheck } from 'lucide-react'
import { Button, Dropdown } from '@maunting/ui'
import type {
  ShopNodeAvailabilityItem,
  ShopPublicNodeStatusDto,
  ShopShortDurationTierDto,
} from '@/api/shop'
import { formatCpuLabel, formatEuro, kurzzeitPreisCent } from '../preis'
import { standortAnzeigeName } from '../standortName'
import type { ShopPingMessung } from '../shopStandortStore'
import type { AbrechnungsModus, Konfiguration, LaufzeitMonate, LaufzeitTage, ShopSpiel } from '../typen'

interface KonfiguratorProps {
  spiel: ShopSpiel
  konfiguration: Konfiguration
  onChange: (naechste: Konfiguration) => void
  ddosLabel?: string | null
  aboRabattProzent?: number
  shortDurationTiers?: ShopShortDurationTierDto[]
  nodeStatuses?: ShopPublicNodeStatusDto[]
  nodeAvailabilityById?: Record<number, ShopNodeAvailabilityItem>
  pingMsByNodeId?: Record<number, ShopPingMessung>
  onSelectStandort?: (nodeId: number | null) => void
  pingBusy?: boolean
  onRunPingTest?: () => void
}

const LAUFZEITEN: LaufzeitMonate[] = [1, 3, 12]

function auswahlKarteKlassen(aktiv: boolean, gesperrt = false): string {
  if (gesperrt) {
    return 'cursor-not-allowed border-outline-variant/25 bg-surface-container/40 text-on-surface-variant/60'
  }
  if (aktiv) {
    return 'border-primary/60 bg-primary/15 text-on-surface'
  }
  return 'border-outline-variant/40 bg-surface-container text-on-surface-variant hover:text-on-surface'
}

function SchrittKopf({ nummer, titel }: { nummer: number; titel: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-primary/40 bg-primary/15 text-xs font-bold tabular-nums text-primary">
        {nummer}
      </span>
      <h3 className="font-headline text-sm font-bold text-on-surface">{titel}</h3>
    </div>
  )
}

export function Konfigurator({
  spiel,
  konfiguration,
  onChange,
  ddosLabel = null,
  aboRabattProzent = 0,
  shortDurationTiers = [],
  nodeStatuses = [],
  nodeAvailabilityById = {},
  pingMsByNodeId = {},
  onSelectStandort,
  pingBusy = false,
  onRunPingTest,
}: KonfiguratorProps) {
  const { t, i18n } = useTranslation()
  const sprache = i18n.language.startsWith('de') ? 'de' : 'en'

  const setze = <K extends keyof Konfiguration>(feld: K, wert: Konfiguration[K]) => {
    onChange({ ...konfiguration, [feld]: wert })
  }

  const abrechnungsModus = konfiguration.abrechnungsModus ?? 'prepaid'
  const hatLifetime = (spiel.lifetimePreisCent ?? 0) > 0
  const aktiveTagesStufen =
    spiel.allowShortDurations === false
      ? []
      : shortDurationTiers.filter((tier) => tier.enabled)
  const setzeAbrechnungsModus = (modus: AbrechnungsModus) => {
    onChange({
      ...konfiguration,
      abrechnungsModus: modus,
      laufzeitMonate:
        modus === 'subscription' || modus === 'lifetime' ? 1 : konfiguration.laufzeitMonate,
      laufzeitTage: modus === 'prepaid' ? (konfiguration.laufzeitTage ?? null) : null,
    })
  }
  const setzeTage = (tage: LaufzeitTage) => {
    onChange({
      ...konfiguration,
      laufzeitTage: tage,
      laufzeitMonate: 1,
    })
  }
  const setzeMonate = (monate: LaufzeitMonate) => {
    onChange({
      ...konfiguration,
      laufzeitTage: null,
      laufzeitMonate: monate,
    })
  }
  const maxSlots =
    spiel.slotStufen[spiel.slotStufen.length - 1] ??
    Math.max(spiel.standardSlots, konfiguration.slots)
  const empfehlungSpieler = Math.max(
    4,
    Math.min(
      maxSlots,
      Math.max(konfiguration.slots, Math.round(konfiguration.ramGb * 2 + konfiguration.cpu * 2)),
    ),
  )

  const ramOptionen = spiel.ramStufenGb.map((gb) => ({ value: String(gb), label: `${gb} GB` }))
  const cpuOptionen = spiel.cpuStufen.map((wert) => ({
    value: String(wert),
    label: formatCpuLabel(wert, sprache),
  }))
  const slotOptionen = spiel.slotStufen.map((slots) => ({
    value: String(slots),
    label: `${slots} ${t('shop.spiel.spieler')}`,
  }))
  const diskOptionen = (spiel.diskStufenGb ?? []).map((gb) => ({
    value: String(gb),
    label: `${gb} GB`,
  }))
  const hatStandorte = nodeStatuses.length > 0
  const leistungSchritt = hatStandorte ? 2 : 1
  const abrechnungSchritt = hatStandorte ? 3 : 2
  const hatKostenloseNode = nodeStatuses.some(
    (n) => Math.max(0, n.shop_surcharge_cents ?? 0) === 0,
  )
  const autoFrei =
    hatKostenloseNode &&
    nodeStatuses.some((n) => {
      if (Math.max(0, n.shop_surcharge_cents ?? 0) > 0) return false
      const eintrag = nodeAvailabilityById[n.id]
      if (eintrag) return eintrag.available
      return n.load_level !== 'offline' && n.status === 'online' && n.accepting_orders
    })
  const autoAktiv = konfiguration.preferredNodeId == null
  const inklusiveLeistungen = [
    ...(ddosLabel ? [ddosLabel] : []),
    t('shop.spiel.inklusiveBackups'),
    ...(spiel.allowGameSwitch !== false ? [t('shop.spiel.inklusiveGameSwitch')] : []),
    t('shop.spiel.inklusiveSftp'),
    t('shop.spiel.inklusiveKonsole'),
  ]

  return (
    <section className="msm-card space-y-6 rounded-2xl border border-white/10 bg-surface-container-low/85 p-5 shadow-xl sm:p-6">
      <h2 className="font-headline text-lg font-bold text-on-surface">
        {t('shop.spiel.konfigurator')}
      </h2>

      {hatStandorte && (
        <div className="space-y-3 border-b border-outline-variant/25 pb-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SchrittKopf nummer={1} titel={t('shop.spiel.standortHardware')} />
            {onRunPingTest && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={pingBusy}
                onClick={onRunPingTest}
                className="gap-1.5"
              >
                <Activity className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{pingBusy ? t('shop.nodeStatus.pingLaeuft') : t('shop.nodeStatus.pingTesten')}</span>
              </Button>
            )}
          </div>
          <div
            className="grid gap-2.5 sm:grid-cols-2"
            role="group"
            aria-label={t('shop.spiel.standortHardware')}
          >
            <button
              type="button"
              disabled={!hatKostenloseNode && !autoAktiv}
              onClick={() => onSelectStandort?.(null)}
              aria-pressed={autoAktiv}
              className={`rounded-xl border px-3.5 py-3 text-left transition-colors ${auswahlKarteKlassen(
                autoAktiv,
                !hatKostenloseNode && !autoAktiv,
              )}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-on-surface">
                  {t('shop.spiel.standortAutomatisch')}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-label-sm font-semibold ${
                    autoFrei
                      ? 'bg-status-running/15 text-status-running'
                      : 'bg-status-warning/15 text-status-warning'
                  }`}
                >
                  {autoFrei
                    ? t('shop.spiel.standortVerfuegbar')
                    : hatKostenloseNode
                      ? t('shop.spiel.standortAusgebuchtGroesse')
                      : t('shop.spiel.standortAuswahlPflicht')}
                </span>
              </div>
              <p className="mt-1 text-xs text-on-surface-variant">
                {t('shop.spiel.standortAutomatischHinweis')}
              </p>
            </button>

            {nodeStatuses.map((node) => {
              const eintrag = nodeAvailabilityById[node.id]
              const istOffline =
                node.load_level === 'offline' ||
                node.status !== 'online' ||
                eintrag?.reason === 'node_offline'
              const istVerfuegbar = eintrag
                ? eintrag.available
                : !istOffline && node.accepting_orders
              const aktiv = konfiguration.preferredNodeId === node.id
              const pingInfo = pingMsByNodeId[node.id]
              const aufpreis = Math.max(0, node.shop_surcharge_cents ?? 0)
              return (
                <button
                  key={node.id}
                  type="button"
                  disabled={!istVerfuegbar && !aktiv}
                  onClick={() => onSelectStandort?.(node.id)}
                  aria-pressed={aktiv}
                  className={`rounded-xl border px-3.5 py-3 text-left transition-colors ${auswahlKarteKlassen(
                    aktiv,
                    !istVerfuegbar && !aktiv,
                  )}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-on-surface">
                        {standortAnzeigeName(node, t('shop.nodeStatus.standardStandort'))}
                      </span>
                      {node.hardware_tier_label && (
                        <span className="mt-0.5 inline-block rounded-full border border-outline-variant/40 bg-surface-container-low px-2 py-0.5 text-label-sm font-medium text-on-surface-variant">
                          {node.hardware_tier_label}
                        </span>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      {pingInfo?.ms != null && (
                        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-label-sm font-semibold tabular-nums text-primary">
                          {pingInfo.ms} ms
                        </span>
                      )}
                      <span className="rounded-full border border-outline-variant/35 bg-surface-container-low px-2 py-0.5 text-label-sm font-semibold tabular-nums text-on-surface">
                        {aufpreis > 0
                          ? t('shop.nodeStatus.aufpreisMonat', { preis: formatEuro(aufpreis) })
                          : t('shop.nodeStatus.inklusive')}
                      </span>
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-on-surface-variant">
                    {node.cpu_model && (
                      <span className="inline-flex items-center gap-1">
                        <Cpu className="h-3 w-3 shrink-0" aria-hidden="true" />
                        {node.cpu_model}
                      </span>
                    )}
                    {node.ram_type && <span>{node.ram_type}</span>}
                    {node.storage_type && <span>{node.storage_type}</span>}
                    {node.ram_free_percent != null && (
                      <span>
                        {t('shop.nodeStatus.ramFreiProzent', {
                          percent: Math.round(node.ram_free_percent),
                        })}
                      </span>
                    )}
                    {(node.ddos_game_aware || node.ddos_provider) && (
                      <span className="inline-flex items-center gap-1 text-status-running">
                        <ShieldCheck className="h-3 w-3 shrink-0" aria-hidden="true" />
                        {node.ddos_game_aware
                          ? node.ddos_provider
                            ? `${t('shop.nodeStatus.ddosGameAware')} (${node.ddos_provider})`
                            : t('shop.nodeStatus.ddosGameAware')
                          : node.ddos_provider}
                      </span>
                    )}
                  </div>

                  <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                    <span
                      className={`inline-flex items-center gap-1 font-medium ${
                        istOffline
                          ? 'text-status-destructive'
                          : istVerfuegbar
                            ? 'text-status-running'
                            : 'text-status-warning'
                      }`}
                    >
                      <Server className="h-3 w-3 shrink-0" aria-hidden="true" />
                      {istOffline
                        ? t('shop.nodeStatus.offline')
                        : istVerfuegbar
                          ? t('shop.spiel.standortVerfuegbar')
                          : t('shop.spiel.standortAusgebuchtGroesse')}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="space-y-4 border-b border-outline-variant/25 pb-5">
        <SchrittKopf nummer={leistungSchritt} titel={t('shop.spiel.schrittLeistung')} />
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="space-y-1.5">
            <span className="block text-xs font-medium uppercase tracking-wider text-on-surface-variant">
              {spiel.hardwareRamType
                ? `${t('shop.spiel.ram')} · ${spiel.hardwareRamType}`
                : t('shop.spiel.ram')}
            </span>
            <Dropdown
              value={String(konfiguration.ramGb)}
              onChange={(wert) => setze('ramGb', Number(wert))}
              options={ramOptionen}
              aria-label={t('shop.spiel.ram')}
            />
          </label>

          <label className="space-y-1.5">
            <span className="block text-xs font-medium uppercase tracking-wider text-on-surface-variant">
              {t('shop.spiel.cpu')}
            </span>
            <Dropdown
              value={String(konfiguration.cpu)}
              onChange={(wert) => setze('cpu', Number(wert))}
              options={cpuOptionen}
              aria-label={t('shop.spiel.cpu')}
            />
          </label>

          <label className="space-y-1.5">
            <span className="block text-xs font-medium uppercase tracking-wider text-on-surface-variant">
              {t('shop.spiel.slots')}
            </span>
            <Dropdown
              value={String(konfiguration.slots)}
              onChange={(wert) => setze('slots', Number(wert))}
              options={slotOptionen}
              aria-label={t('shop.spiel.slots')}
            />
          </label>

          {diskOptionen.length > 0 && (
            <label className="space-y-1.5">
              <span className="block text-xs font-medium uppercase tracking-wider text-on-surface-variant">
                {spiel.hardwareStorageType
                  ? `${t('shop.spiel.disk')} · ${spiel.hardwareStorageType}`
                  : t('shop.spiel.disk')}
              </span>
              <Dropdown
                value={String(
                  konfiguration.diskGb ?? spiel.standardDiskGb ?? spiel.diskStufenGb?.[0] ?? 0,
                )}
                onChange={(wert) => setze('diskGb', Number(wert))}
                options={diskOptionen}
                aria-label={t('shop.spiel.disk')}
              />
            </label>
          )}
        </div>

        <p className="text-xs text-on-surface-variant">
          {t('shop.spiel.ramEmpfehlung', {
            ram: konfiguration.ramGb,
            cpu: konfiguration.cpu,
            spieler: empfehlungSpieler,
          })}
        </p>
      </div>

      <div className="space-y-4 border-b border-outline-variant/25 pb-5">
        <SchrittKopf nummer={abrechnungSchritt} titel={t('shop.spiel.schrittAbrechnung')} />

        <div className="space-y-1.5">
          <span className="block text-xs font-medium uppercase tracking-wider text-on-surface-variant">
            {t('shop.spiel.zahlungsart')}
          </span>
          <div
            className={`grid gap-2 ${hatLifetime ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}
            role="group"
            aria-label={t('shop.spiel.zahlungsart')}
          >
            <button
              type="button"
              onClick={() => setzeAbrechnungsModus('prepaid')}
              aria-pressed={abrechnungsModus === 'prepaid'}
              className={`rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
                abrechnungsModus === 'prepaid'
                  ? 'border-primary/60 bg-primary/15 text-on-surface'
                  : 'border-outline-variant/40 bg-surface-container text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span className="block text-sm font-semibold">{t('shop.spiel.prepaidTitel')}</span>
              <span className="mt-0.5 block text-xs text-on-surface-variant">
                {t('shop.spiel.prepaidHinweis')}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setzeAbrechnungsModus('subscription')}
              aria-pressed={abrechnungsModus === 'subscription'}
              className={`rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
                abrechnungsModus === 'subscription'
                  ? 'border-primary/60 bg-primary/15 text-on-surface'
                  : 'border-outline-variant/40 bg-surface-container text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{t('shop.spiel.aboTitel')}</span>
                {aboRabattProzent > 0 && (
                  <span className="rounded-full border border-status-running/40 bg-status-running/15 px-2 py-0.5 text-label-sm font-bold text-status-running">
                    {t('shop.spiel.aboRabattBadge', { prozent: aboRabattProzent })}
                  </span>
                )}
              </div>
              <span className="mt-0.5 block text-xs text-on-surface-variant">
                {aboRabattProzent > 0
                  ? t('shop.spiel.aboHinweisMitRabatt', { prozent: aboRabattProzent })
                  : t('shop.spiel.aboHinweis')}
              </span>
            </button>
            {hatLifetime && (
              <button
                type="button"
                onClick={() => setzeAbrechnungsModus('lifetime')}
                aria-pressed={abrechnungsModus === 'lifetime'}
                className={`rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
                  abrechnungsModus === 'lifetime'
                    ? 'border-primary/60 bg-primary/15 text-on-surface'
                    : 'border-outline-variant/40 bg-surface-container text-on-surface-variant hover:text-on-surface'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{t('shop.spiel.lifetimeTitel')}</span>
                  <span className="rounded-full border border-primary/40 bg-primary/15 px-2 py-0.5 text-label-sm font-bold text-primary">
                    {formatEuro(spiel.lifetimePreisCent ?? 0)}
                  </span>
                </div>
                <span className="mt-0.5 block text-xs text-on-surface-variant">
                  {t('shop.spiel.lifetimeHinweis')}
                </span>
              </button>
            )}
          </div>
        </div>

        {abrechnungsModus !== 'lifetime' && (
          <div className="space-y-2">
            <span className="block text-xs font-medium uppercase tracking-wider text-on-surface-variant">
              {t('shop.spiel.laufzeit')}
            </span>
            {aktiveTagesStufen.length > 0 && (
              <div
                className="flex flex-wrap gap-2"
                role="group"
                aria-label={t('shop.spiel.kurzzeitLaufzeiten')}
              >
                {aktiveTagesStufen.map((tier) => {
                  const gesperrt = abrechnungsModus === 'subscription'
                  const aktiv = !gesperrt && konfiguration.laufzeitTage === tier.days
                  const vorschauPreis = kurzzeitPreisCent(spiel.grundpreisCent, tier)
                  return (
                    <button
                      key={`tage-${tier.days}`}
                      type="button"
                      disabled={gesperrt}
                      onClick={() => setzeTage(tier.days)}
                      aria-pressed={aktiv}
                      className={`min-h-11 flex-1 rounded-lg border px-2.5 text-sm font-semibold transition-colors ${
                        gesperrt
                          ? 'cursor-not-allowed border-outline-variant/25 bg-surface-container/40 text-on-surface-variant/50'
                          : aktiv
                            ? 'border-primary/50 bg-primary/15 text-primary'
                            : 'border-outline-variant/40 bg-surface-container text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      <span className="block">{t('shop.spiel.tage', { count: tier.days })}</span>
                      <span className="block text-label-sm font-normal tabular-nums opacity-85">
                        {t('shop.karte.abWert', { preis: formatEuro(vorschauPreis) })}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
            <div className="flex gap-2" role="group" aria-label={t('shop.spiel.laufzeit')}>
              {LAUFZEITEN.map((monate) => {
                const aktiv =
                  konfiguration.laufzeitTage == null && konfiguration.laufzeitMonate === monate
                const gesperrt = abrechnungsModus === 'subscription' && monate !== 1
                return (
                  <button
                    key={monate}
                    type="button"
                    disabled={gesperrt}
                    onClick={() => setzeMonate(monate)}
                    aria-pressed={aktiv}
                    className={`min-h-11 flex-1 rounded-lg border px-2 text-sm font-semibold transition-colors ${
                      gesperrt
                        ? 'cursor-not-allowed border-outline-variant/25 bg-surface-container/40 text-on-surface-variant/50'
                        : aktiv
                          ? 'border-primary/50 bg-primary/15 text-primary'
                          : 'border-outline-variant/40 bg-surface-container text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    {t('shop.spiel.monate', { count: monate })}
                  </button>
                )
              })}
            </div>
            {abrechnungsModus === 'subscription' && (
              <p className="text-xs text-on-surface-variant">
                {aktiveTagesStufen.length > 0
                  ? t('shop.spiel.kurzzeitNurPrepaid')
                  : t('shop.spiel.aboIntervallHinweis')}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2.5 border-t border-outline-variant/25 pt-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-status-running">
          {t('shop.spiel.inklusiveTitel')}
        </p>
        <ul className="grid gap-1.5 text-xs text-on-surface sm:grid-cols-2">
          {inklusiveLeistungen.map((punkt) => (
            <li key={punkt} className="flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 shrink-0 text-status-running" aria-hidden="true" />
              <span>{punkt}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
