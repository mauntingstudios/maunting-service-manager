import { useTranslation } from 'react-i18next'
import { Dropdown, Switch } from '@maunting/ui'
import type { Konfiguration, LaufzeitMonate, ShopSpiel } from '../typen'

interface KonfiguratorProps {
  spiel: ShopSpiel
  konfiguration: Konfiguration
  onChange: (naechste: Konfiguration) => void
}

const LAUFZEITEN: LaufzeitMonate[] = [1, 3, 12]

export function Konfigurator({ spiel, konfiguration, onChange }: KonfiguratorProps) {
  const { t } = useTranslation()

  const setze = <K extends keyof Konfiguration>(feld: K, wert: Konfiguration[K]) => {
    onChange({ ...konfiguration, [feld]: wert })
  }

  const ramOptionen = spiel.ramStufenGb.map((gb) => ({ value: String(gb), label: `${gb} GB` }))
  const cpuOptionen = spiel.cpuStufen.map((kerne) => ({
    value: String(kerne),
    label: `${kerne} ${kerne === 1 ? t('shop.spiel.kern') : t('shop.spiel.kerne')}`,
  }))
  const slotOptionen = spiel.slotStufen.map((slots) => ({
    value: String(slots),
    label: `${slots} ${t('shop.spiel.spieler')}`,
  }))

  return (
    <section className="msm-card space-y-6 rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 p-5">
      <h2 className="font-headline text-lg font-bold text-on-surface">
        {t('shop.spiel.konfigurator')}
      </h2>

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="block text-xs font-medium uppercase tracking-wider text-on-surface-variant">
            {t('shop.spiel.ram')}
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

        <div className="space-y-1.5">
          <span className="block text-xs font-medium uppercase tracking-wider text-on-surface-variant">
            {t('shop.spiel.laufzeit')}
          </span>
          <div className="flex gap-2" role="group" aria-label={t('shop.spiel.laufzeit')}>
            {LAUFZEITEN.map((monate) => {
              const aktiv = konfiguration.laufzeitMonate === monate
              return (
                <button
                  key={monate}
                  type="button"
                  onClick={() => setze('laufzeitMonate', monate)}
                  aria-pressed={aktiv}
                  className={`min-h-11 flex-1 rounded-lg border px-2 text-sm font-semibold transition-colors ${
                    aktiv
                      ? 'border-primary/50 bg-primary/15 text-primary'
                      : 'border-outline-variant/40 bg-surface-container text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {t('shop.spiel.monate', { count: monate })}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="space-y-3 border-t border-outline-variant/30 pt-4">
        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="block text-sm font-semibold text-on-surface">
              {t('shop.spiel.mods')}
            </span>
            <span className="block text-xs text-on-surface-variant">
              {spiel.unterstuetztMods
                ? t('shop.spiel.modsHinweis')
                : t('shop.spiel.modsNichtVerfuegbar')}
            </span>
          </span>
          <Switch
            checked={konfiguration.mods}
            onCheckedChange={(wert) => setze('mods', wert)}
            disabled={!spiel.unterstuetztMods}
            aria-label={t('shop.spiel.mods')}
          />
        </label>

        {spiel.kiZugangCent > 0 && (
          <label className="flex items-center justify-between gap-4">
            <span>
              <span className="block text-sm font-semibold text-on-surface">
                {t('shop.spiel.ki')}
              </span>
              <span className="block text-xs text-on-surface-variant">
                {t('shop.spiel.kiHinweis')}
              </span>
            </span>
            <Switch
              checked={konfiguration.kiZugang}
              onCheckedChange={(wert) => setze('kiZugang', wert)}
              aria-label={t('shop.spiel.ki')}
            />
          </label>
        )}
      </div>
    </section>
  )
}
