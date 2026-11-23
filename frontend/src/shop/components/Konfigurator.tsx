import { useTranslation } from 'react-i18next'
import { Check, Wrench } from 'lucide-react'
import { Dropdown } from '@maunting/ui'
import { formatCpuLabel, formatEuro } from '../preis'
import type { AbrechnungsModus, Konfiguration, LaufzeitMonate, ShopSpiel } from '../typen'

interface KonfiguratorProps {
  spiel: ShopSpiel
  konfiguration: Konfiguration
  onChange: (naechste: Konfiguration) => void
  aboRabattProzent?: number
}

const LAUFZEITEN: LaufzeitMonate[] = [1, 3, 12]

export function Konfigurator({
  spiel,
  konfiguration,
  onChange,
  aboRabattProzent = 0,
}: KonfiguratorProps) {
  const { t, i18n } = useTranslation()
  const sprache = i18n.language.startsWith('de') ? 'de' : 'en'

  const setze = <K extends keyof Konfiguration>(feld: K, wert: Konfiguration[K]) => {
    onChange({ ...konfiguration, [feld]: wert })
  }

  const abrechnungsModus = konfiguration.abrechnungsModus ?? 'prepaid'
  const hatLifetime = (spiel.lifetimePreisCent ?? 0) > 0
  const setzeAbrechnungsModus = (modus: AbrechnungsModus) => {
    onChange({
      ...konfiguration,
      abrechnungsModus: modus,
      laufzeitMonate: modus === 'subscription' || modus === 'lifetime' ? 1 : konfiguration.laufzeitMonate,
    })
  }
  const maxSlots =
    spiel.slotStufen[spiel.slotStufen.length - 1] ??
    Math.max(spiel.standardSlots, konfiguration.slots)
  const empfehlungSpieler = Math.max(
    4,
    Math.min(maxSlots, Math.max(konfiguration.slots, Math.round(konfiguration.ramGb * 2 + konfiguration.cpu * 2))),
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
  const zeigtModInklusiv = spiel.unterstuetztMods || spiel.unterstuetztWorkshop

  return (
    <section className="msm-card space-y-6 rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 p-5">
      <h2 className="font-headline text-lg font-bold text-on-surface">
        {t('shop.spiel.konfigurator')}
      </h2>

      <div className="grid gap-5 sm:grid-cols-2">
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

        <div className="space-y-1.5 sm:col-span-2">
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
          <div className="space-y-1.5 sm:col-span-2">
            <span className="block text-xs font-medium uppercase tracking-wider text-on-surface-variant">
              {t('shop.spiel.laufzeit')}
            </span>
            <div className="flex gap-2" role="group" aria-label={t('shop.spiel.laufzeit')}>
              {LAUFZEITEN.map((monate) => {
                const aktiv = konfiguration.laufzeitMonate === monate
                const gesperrt = abrechnungsModus === 'subscription' && monate !== 1
                return (
                  <button
                    key={monate}
                    type="button"
                    disabled={gesperrt}
                    onClick={() => setze('laufzeitMonate', monate)}
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
              <p className="text-xs text-on-surface-variant">{t('shop.spiel.aboIntervallHinweis')}</p>
            )}
          </div>
        )}
      </div>

      <p className="text-xs text-on-surface-variant">
        {t('shop.spiel.ramEmpfehlung', {
          ram: konfiguration.ramGb,
          cpu: konfiguration.cpu,
          spieler: empfehlungSpieler,
        })}
      </p>

      <div className="rounded-xl border border-outline-variant/30 bg-surface-container/60 p-4 space-y-2.5">
        <p className="text-xs font-semibold uppercase tracking-wider text-status-running">
          {t('shop.spiel.inklusiveTitel')}
        </p>
        <ul className="grid gap-1.5 text-xs text-on-surface sm:grid-cols-2">
          {[
            spiel.ddosGameAware
              ? spiel.ddosProvider
                ? t('shop.spiel.inklusiveDdosMitAnbieter', { provider: spiel.ddosProvider })
                : t('shop.spiel.inklusiveDdosGameAware')
              : spiel.ddosProvider
                ? t('shop.spiel.inklusiveDdosProvider', { provider: spiel.ddosProvider })
                : t('shop.spiel.inklusiveDdos'),
            t('shop.spiel.inklusiveBackups'),
            ...(spiel.allowGameSwitch !== false ? [t('shop.spiel.inklusiveGameSwitch')] : []),
            t('shop.spiel.inklusiveSftp'),
            t('shop.spiel.inklusiveKonsole'),
          ].map((punkt) => (
            <li key={punkt} className="flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 shrink-0 text-status-running" aria-hidden="true" />
              <span>{punkt}</span>
            </li>
          ))}
        </ul>
      </div>

      {zeigtModInklusiv && (
        <div className="flex flex-wrap items-center gap-3 border-t border-outline-variant/30 pt-4">
          {spiel.unterstuetztMods && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-status-running/35 bg-status-running/10 px-3 py-1 text-xs font-semibold text-status-running">
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              {t('shop.spiel.modsInklusive')}
            </span>
          )}
          {spiel.unterstuetztWorkshop && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/35 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
              {t('shop.spiel.workshopInklusive')}
            </span>
          )}
        </div>
      )}
    </section>
  )
}
