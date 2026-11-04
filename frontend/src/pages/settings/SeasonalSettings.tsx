import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Switch } from '@maunting/ui'
import { SEASON_ASSETS } from '@/season/assets'
import { istGueltigesFenster, type SeasonId, type SeasonMode } from '@/season/typen'
import { saisonStatus } from '@/season/zeitfenster'
import { useJetzt } from '@/season/useJetzt'
import type { PanelSettings } from './types'

function datumAnzeige(wert: string): string {
  const treffer = /^(\d{2})-(\d{2})T/.exec(wert)
  return treffer ? `${treffer[2]}.${treffer[1]}.` : ''
}

function zeitAnzeige(wert: string): string {
  const treffer = /T(\d{2}:\d{2})$/.exec(wert)
  return treffer ? treffer[1] : ''
}

function formatiereDatumEingabe(roh: string): string {
  const ziffern = roh.replace(/\D/g, '').slice(0, 4)
  if (ziffern.length < 3) return ziffern
  const basis = `${ziffern.slice(0, 2)}.${ziffern.slice(2)}`
  return ziffern.length === 4 ? `${basis}.` : basis
}

function wertAusAnzeige(datum: string, zeit: string): string | null {
  const treffer = /^(\d{2})\.(\d{2})\.?$/.exec(datum.trim())
  if (!treffer) return null
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(zeit)) return null
  const wert = `${treffer[2]}-${treffer[1]}T${zeit}`
  return istGueltigesFenster(wert) ? wert : null
}

function SaisonSymbol({ id }: { id: SeasonId }) {
  if (id === 'birthday') {
    return (
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8" />
        <path d="M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1" />
        <path d="M2 21h20" />
        <path d="M7 8v3M12 8v3M17 8v3" />
        <path d="M7 4h.01M12 4h.01M17 4h.01" />
      </svg>
    )
  }
  if (id === 'halloween') {
    return (
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <path d="M12 4c1 1.8 1.4 2.2 2.9 2.2 2 0 3.6 1.8 3.6 4.2 0 3.7-2.9 6.9-6.5 8.6-3.6-1.7-6.5-4.9-6.5-8.6C5.5 8 7.1 6.2 9.1 6.2 10.6 6.2 11 5.8 12 4Z" />
        <path d="M12 4c-.4 2.2-1 3.5-2.2 4.8" />
        <path d="M9.7 10.8h.01M14.3 10.8h.01M10.4 14c1 .8 2.2.8 3.2 0" />
      </svg>
    )
  }
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M12 3v18M4.5 7.5l15 9M19.5 7.5l-15 9" />
      <path d="M12 6l-2-2m2 2 2-2M12 18l-2 2m2-2 2 2M6.5 9.5l-2.5-.5m2.5.5.5-2.5M17.5 15l2.5.5m-2.5-.5-.5 2.5M6.5 15l-2.5.5m2.5-.5.5 2.5M17.5 9.5l2.5-.5m-2.5.5-.5-2.5" />
    </svg>
  )
}

function SaisonIcon({ id, titel }: { id: SeasonId; titel: string }) {
  const [bildFehler, setBildFehler] = useState(false)
  const logoSrc = SEASON_ASSETS[id]?.logoMsm

  if (logoSrc && !bildFehler) {
    return (
      <div data-season-icon="" className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full border border-primary/30 bg-surface-container shadow-sm">
        <img
          src={logoSrc}
          alt={titel}
          className="h-full w-full rounded-full object-cover"
          onError={() => setBildFehler(true)}
        />
      </div>
    )
  }

  return (
    <span data-season-icon="" className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-primary/20 bg-primary/10 text-primary">
      <span className="h-5 w-5">
        <SaisonSymbol id={id} />
      </span>
    </span>
  )
}

function FensterFelder({
  label,
  wert,
  aendern,
  disabled,
}: {
  label: string
  wert: string
  aendern: (wert: string) => void
  disabled: boolean
}) {
  const { t } = useTranslation()
  const id = useId()
  const [datum, setDatum] = useState(() => datumAnzeige(wert))
  const [zeit, setZeit] = useState(() => zeitAnzeige(wert))
  const [fehler, setFehler] = useState(false)

  useEffect(() => {
    setDatum(datumAnzeige(wert))
    setZeit(zeitAnzeige(wert))
    setFehler(false)
  }, [wert])

  const uebernehmenOhneFehler = (neuesDatum: string, neueZeit: string) => {
    const neu = wertAusAnzeige(neuesDatum, neueZeit)
    if (!neu || neu === wert) return
    aendern(neu)
  }

  const uebernehmen = () => {
    const neu = wertAusAnzeige(datum, zeit)
    if (!neu) {
      setFehler(true)
      return
    }
    setFehler(false)
    if (neu !== wert) aendern(neu)
  }

  return (
    <div className="min-w-0">
      <span id={`${id}-label`} className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
        {label}
      </span>
      <div role="group" aria-labelledby={`${id}-label`} className="flex min-w-0 flex-wrap items-center gap-2">
        <input
          id={`${id}-datum`}
          aria-label={`${label} ${t('settings.seasonal.dateLabel')}`}
          aria-invalid={fehler || undefined}
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          value={datum}
          disabled={disabled}
          placeholder={t('settings.seasonal.datePlaceholder')}
          aria-describedby={fehler ? `${id}-fehler` : undefined}
          onChange={(ereignis) => {
            const neu = formatiereDatumEingabe(ereignis.target.value)
            setDatum(neu)
            if (fehler) setFehler(false)
            uebernehmenOhneFehler(neu, zeit)
          }}
          onBlur={uebernehmen}
          className="msm-input w-24 text-center font-mono-sm"
        />
        <input
          id={`${id}-zeit`}
          aria-label={`${label} ${t('settings.seasonal.timeLabel')}`}
          aria-invalid={fehler || undefined}
          aria-describedby={fehler ? `${id}-fehler` : undefined}
          type="time"
          step={60}
          value={zeit}
          disabled={disabled}
          onChange={(ereignis) => {
            const neu = ereignis.target.value
            setZeit(neu)
            if (fehler) setFehler(false)
            uebernehmenOhneFehler(datum, neu)
          }}
          onBlur={uebernehmen}
          className="msm-input w-28 font-mono-sm"
        />
      </div>
      {fehler && <p id={`${id}-fehler`} role="alert" className="msm-field-error">{t('settings.seasonal.invalidDate')}</p>}
    </div>
  )
}

function SaisonZeile({
  id,
  titel,
  mode,
  start,
  end,
  enabled,
  jetzt,
  onMode,
  onStart,
  onEnd,
}: {
  id: SeasonId
  titel: string
  mode: SeasonMode
  start: string
  end: string
  enabled: boolean
  jetzt: Date
  onMode: (mode: SeasonMode) => void
  onStart: (start: string) => void
  onEnd: (end: string) => void
}) {
  const { t } = useTranslation()
  const status = saisonStatus(enabled, { mode, start, end }, jetzt)
  const statusKlasse = status === 'aktiv'
    ? 'msm-badge-success'
    : status === 'immer'
      ? 'msm-badge-info'
      : 'msm-badge-neutral'
  const statusText = {
    aus: t('settings.seasonal.statusOff'),
    immer: t('settings.seasonal.statusAlways'),
    aktiv: t('settings.seasonal.statusActive'),
    inaktiv: t('settings.seasonal.statusInactive'),
  }[status]
  const sofortAktiv = mode === 'on'
  const zeitplanAktiv = mode === 'auto'

  return (
    <div className="rounded-xl border border-outline-variant/50 bg-surface-container-low/40 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <SaisonIcon id={id} titel={titel} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-headline text-body-md font-semibold text-on-surface">{titel}</h3>
            <span className={statusKlasse}>{statusText}</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-on-surface-variant">
            {t('settings.seasonal.scheduleHint')}
          </p>
        </div>
        <div className="flex w-full shrink-0 flex-col gap-2 sm:w-56">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-on-surface-variant">{t('settings.seasonal.modeOn')}</span>
            <Switch
              checked={sofortAktiv}
              onCheckedChange={(an) => onMode(an ? 'on' : 'off')}
              aria-label={`${titel} ${t('settings.seasonal.modeOn')}`}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-on-surface-variant">{t('settings.seasonal.modeAuto')}</span>
            <Switch
              checked={zeitplanAktiv}
              onCheckedChange={(an) => onMode(an ? 'auto' : 'off')}
              aria-label={`${titel} ${t('settings.seasonal.modeAuto')}`}
            />
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <FensterFelder
          label={t('settings.seasonal.from')}
          wert={start}
          aendern={onStart}
          disabled={!zeitplanAktiv}
        />
        <FensterFelder
          label={t('settings.seasonal.to')}
          wert={end}
          aendern={onEnd}
          disabled={!zeitplanAktiv}
        />
      </div>
    </div>
  )
}

/**
 * Der Saison-Bereich unter Allgemein. Die Karten sind bewusst keine
 * Tabelle: pro Saison gibt es genau einen Modus und ein Fenster, und beides
 * soll man in einem Blick sehen.
 */
export function SeasonalSettings({
  settings,
  onChange,
}: {
  settings: PanelSettings
  onChange: (patch: Partial<PanelSettings>) => void
}) {
  const { t } = useTranslation()
  const jetzt = useJetzt()

  return (
    <section className="msm-card p-6" aria-labelledby="seasonal-settings-title">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-outline-variant/30 pb-4">
        <div className="min-w-0">
          <h2 id="seasonal-settings-title" data-season-heading="" className="font-headline text-headline-sm text-primary">
            {t('settings.seasonal.title')}
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-on-surface-variant">
            {t('settings.seasonal.hint')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p data-season-heading="" className="font-headline text-body-md font-semibold text-primary">
              {t('settings.seasonal.enabled')}
            </p>
            <p className="text-xs text-on-surface-variant">{t('settings.seasonal.enabledHint')}</p>
          </div>
          <Switch
            checked={settings.seasonal_enabled}
            onCheckedChange={(an) => onChange({ seasonal_enabled: an })}
            aria-label={t('settings.seasonal.enabled')}
          />
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <SaisonZeile
          id="birthday"
          titel={t('settings.seasonal.birthday')}
          mode={settings.season_birthday_mode}
          start={settings.season_birthday_start}
          end={settings.season_birthday_end}
          enabled={settings.seasonal_enabled}
          jetzt={jetzt}
          onMode={(mode) => onChange({ season_birthday_mode: mode })}
          onStart={(start) => onChange({ season_birthday_start: start })}
          onEnd={(end) => onChange({ season_birthday_end: end })}
        />
        <SaisonZeile
          id="halloween"
          titel={t('settings.seasonal.halloween')}
          mode={settings.season_halloween_mode}
          start={settings.season_halloween_start}
          end={settings.season_halloween_end}
          enabled={settings.seasonal_enabled}
          jetzt={jetzt}
          onMode={(mode) => onChange({ season_halloween_mode: mode })}
          onStart={(start) => onChange({ season_halloween_start: start })}
          onEnd={(end) => onChange({ season_halloween_end: end })}
        />
        <SaisonZeile
          id="christmas"
          titel={t('settings.seasonal.christmas')}
          mode={settings.season_christmas_mode}
          start={settings.season_christmas_start}
          end={settings.season_christmas_end}
          enabled={settings.seasonal_enabled}
          jetzt={jetzt}
          onMode={(mode) => onChange({ season_christmas_mode: mode })}
          onStart={(start) => onChange({ season_christmas_start: start })}
          onEnd={(end) => onChange({ season_christmas_end: end })}
        />
      </div>
    </section>
  )
}
