import type { LucideIcon } from 'lucide-react'

import { Kurzinfo } from '@maunting/ui'

/**
 * Ein Reiter der Serverdetail-Seite: Schlüssel, fertiger Name und Symbol.
 */
export interface ServerDetailTab<TKey extends string = string> {
  key: TKey
  label: string
  icon: LucideIcon
}

interface ServerDetailTabsProps<TKey extends string> {
  tabs: ServerDetailTab<TKey>[]
  activeTab: TKey
  onSelect: (key: TKey) => void
  /** Optionaler a11y-Name für die Tab-Liste (etwa der Servername). */
  ariaLabel?: string
}

/**
 * Reiterleiste der Serverdetail-Seite (Dateien, Konsole, Mods, ...).
 *
 * Am Handy kompakt nach dem Muster des TabBar-Kompaktmodus: nur Symbole, der
 * gewählte Reiter behält seinen Namen, die übrigen nennen ihn per Kurzinfo.
 * Die Leiste bricht um statt zu wischen — erst ab `md` stehen volle Namen in
 * der Wischleiste wie bisher.
 *
 * Sie klebt direkt unter der mobilen Topbar: `top-12` zu deren `h-12`
 * (Muster: Sprungleiste). Ab `md` steht sie statisch wie bisher.
 */
export function ServerDetailTabs<TKey extends string>({ tabs, activeTab, onSelect, ariaLabel }: ServerDetailTabsProps<TKey>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="sticky top-12 z-20 -mb-px border-b border-outline bg-background/95 backdrop-blur-xl msm-ohne-rollbalken md:static md:overflow-x-auto md:bg-transparent md:backdrop-blur-none"
    >
      <div className="flex flex-wrap gap-1 md:flex-nowrap md:min-w-max">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.key
          const nurSymbol = !isActive
          const knopf = (
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onSelect(tab.key)}
              className={`inline-flex items-center gap-2 border-b-2 px-4 py-2.5 font-body-md text-sm transition-colors [@media(pointer:coarse)]:min-h-11 ${nurSymbol ? 'max-md:gap-0 max-md:px-2' : ''} ${
                isActive
                  ? 'border-secondary text-primary'
                  : 'border-transparent text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {nurSymbol ? <span className="max-md:sr-only">{tab.label}</span> : tab.label}
            </button>
          )
          // Die Hülle bleibt beim Wechsel des Reiters dieselbe, sonst verlöre der Knopf den Fokus.
          return (
            <Kurzinfo key={tab.key} text={tab.label} className={nurSymbol ? 'md:!hidden' : '!hidden'}>
              {knopf}
            </Kurzinfo>
          )
        })}
      </div>
    </div>
  )
}
