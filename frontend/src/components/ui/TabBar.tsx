import { Fragment, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { LucideIcon } from 'lucide-react'

import { Kurzinfo } from '@/Singra/UI/Kurzinfo'

/**
 * Definiert einen einzelnen Tab fuer den gemeinsamen {@link TabBar}.
 *
 * Das ist absichtlich ein generisches Modul, damit sowohl die Panel-Einstellungen
 * (`/settings`) als auch die Profil-Seite (`/profile`) die identische Tab-Logik
 * verwenden. Aenderungen am Verhalten wirken damit automatisch auf beide Seiten.
 */
export interface TabDef<TId extends string> {
  id: TId
  /** i18n-Schlüssel des Namens. Entfällt, wenn `label` den Text fertig mitbringt. */
  labelKey?: string
  /** Fertiger Name, etwa aus der gemeinsamen Panel-Navigation. */
  label?: string
  /** Ohne Symbol bleibt nur der Name (dichte Leisten wie in den Entwicklerwerkzeugen). */
  icon?: LucideIcon
  /** Wird in der Tabs-Reihenfolge zuerst versteckt (z.B. fuer Danger-Zone). */
  variant?: 'default' | 'danger'
  /** Optionale Zahl hinter dem Namen, etwa die Mitglieder eines Teams. */
  badge?: number
  /**
   * Optionale Gruppen-ID. Zwischen zwei aufeinanderfolgenden Reitern mit
   * verschiedener Gruppe zeigt die Leiste einen schmalen Trenner — ohne
   * Text, damit lange Reiterlisten lesbar bleiben, ohne länger zu werden.
   */
  group?: string
}

interface TabBarProps<TId extends string> {
  tabs: TabDef<TId>[]
  active: TId
  onChange: (id: TId) => void
  /** Optionaler a11y-Label fuer die umschliessende Tab-Liste. */
  ariaLabel?: string
  /**
   * Innerhalb einer Karte ohne eigene Karte darum — sonst stünde eine Karte in
   * der Karte.
   */
  embedded?: boolean
  /**
   * Am Handy eine Zeile, die sich seitlich wischen lässt, statt umzubrechen.
   * Ab md wie gewohnt.
   */
  einzeilig?: boolean
  /**
   * Kleiner und enger, für Werkzeugleisten in schmalen Panels. Unter md zeigen
   * Reiter mit Symbol nur das Symbol, der gewählte behält seinen Namen; den
   * Namen der übrigen nennt eine Kurzinfo.
   */
  kompakt?: boolean
}

/**
 * Gemeinsame Tab-Leiste. Wird in `Settings.tsx` und `Profile.tsx` eingesetzt,
 * damit beide Seiten dasselbe Verhalten, dieselben i18n-Keys und dasselbe Design
 * teilen. Die Auswahl der Tabs liegt weiterhin in der jeweiligen Orchestrator-Komponente.
 */
export function TabBar<TId extends string>({ tabs, active, onChange, ariaLabel, embedded = false, einzeilig = false, kompakt = false }: TabBarProps<TId>) {
  const { t } = useTranslation()
  const aktiverReiter = useRef<HTMLButtonElement | null>(null)

  // Beim Öffnen einer Seite kann der aktive Reiter außerhalb der sichtbaren
  // Leiste liegen; dann sieht man nicht, wo man ist. Nur die wischbare
  // Handy-Leiste scrollt, die feste Seitenleiste bleibt stehen.
  useEffect(() => {
    if (einzeilig) aktiverReiter.current?.scrollIntoView?.({ block: 'nearest', inline: 'center' })
  }, [active, einzeilig])

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      data-msm-tabbar=""
      className={`${embedded ? `rounded-lg bg-surface-container-low/50 ${kompakt ? 'p-0.5' : 'p-1'}` : 'msm-card p-2'} inline-flex flex-wrap ${kompakt ? 'gap-0.5' : 'gap-1'} ${
        einzeilig ? 'max-md:flex max-md:w-full max-md:flex-nowrap max-md:overflow-x-auto msm-ohne-rollbalken' : ''
      }`}
    >
      {tabs.map((tab, index) => {
        const Icon = tab.icon
        const isActive = active === tab.id
        const isDanger = tab.variant === 'danger'
        const name = tab.label ?? t(tab.labelKey ?? '')
        // Trenner nur zwischen zwei gesetzten, verschiedenen Gruppen: Reiter
        // ohne Gruppe verhalten sich wie bisher.
        const gruppeDavor = index > 0 ? tabs[index - 1].group : undefined
        const trennt = index > 0 && tab.group !== undefined && gruppeDavor !== undefined && tab.group !== gruppeDavor
        const nurSymbol = kompakt && !!Icon && !isActive
        const knopf = (
          <button
            type="button"
            role="tab"
            aria-selected={isActive}
            data-tab-variant={tab.variant ?? 'default'}
            ref={isActive ? aktiverReiter : undefined}
            onClick={(e) => {
              onChange(tab.id)
              if (einzeilig) e.currentTarget.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
            }}
            className={`${kompakt ? `gap-1.5 px-2.5 py-1 text-xs [@media(pointer:coarse)]:min-h-11 ${nurSymbol ? 'max-md:px-1.5' : ''}` : 'gap-2 px-4 py-2 text-sm'} rounded-md font-medium inline-flex shrink-0 items-center transition-colors ${
              einzeilig ? 'max-md:min-h-11' : ''
            } ${
              isActive
                ? isDanger
                  ? 'bg-status-destructive/15 text-status-destructive'
                  : 'bg-secondary-container text-on-secondary-container'
                : isDanger
                  ? 'text-status-destructive/80 hover:bg-status-destructive/10'
                  : 'text-on-surface-variant hover:bg-surface-container-high'
            }`}
          >
            {Icon && <Icon className={kompakt ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden="true" />}
            {nurSymbol ? <span className="max-md:sr-only">{name}</span> : name}
            {tab.badge !== undefined && (
              <>
                {/* Ohne Trenner liest ein Screenreader „Papierkorb1“. */}
                <span className="sr-only">, </span>
                <span className="min-w-[1.25rem] rounded-full bg-surface-container-high px-1.5 text-center text-xs tabular-nums">
                  {tab.badge}
                </span>
              </>
            )}
          </button>
        )
        // Die Hülle bleibt beim Wechsel des Reiters dieselbe, sonst verlöre der Knopf den Fokus.
        const hülle = kompakt ? (
          <Kurzinfo text={name} className={nurSymbol ? 'md:!hidden' : '!hidden'}>
            {knopf}
          </Kurzinfo>
        ) : (
          knopf
        )
        return (
          <Fragment key={tab.id}>
            {trennt && <span aria-hidden="true" data-tab-gruppe="" className="mx-1 w-px self-stretch bg-outline-variant/50" />}
            {hülle}
          </Fragment>
        )
      })}
    </div>
  )
}
