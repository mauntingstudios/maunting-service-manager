import { useTranslation } from 'react-i18next'
import { Check, Wrench } from 'lucide-react'
import { Dropdown } from '@maunting/ui'
import { formatCpuLabel } from '../preis'
import type { Konfiguration, LaufzeitMonate, ShopSpiel } from '../typen'

interface KonfiguratorProps {
  spiel: ShopSpiel
  konfiguration: Konfiguration
  onChange: (naechste: Konfiguration) => void
}

const LAUFZEITEN: LaufzeitMonate[] = [1, 3, 12]

export function Konfigurator({ spiel, konfiguration, onChange }: KonfiguratorProps) {
  const { t, i18n } = useTranslation()
  const sprache = i18n.language.startsWith('de') ? 'de' : 'en'

  const setze = <K extends keyof Konfiguration>(feld: K, wert: Konfiguration[K]) => {
    onChange({ ...konfiguration, [feld]: wert })
  }

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
