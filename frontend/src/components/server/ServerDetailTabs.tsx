import type { LucideIcon } from 'lucide-react'
import { Dropdown, type DropdownOption } from '@maunting/ui'

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
 * Responsives Verhalten:
 * - Auf schmalen Bildschirmen / Handys (`md:hidden`): Barrierefreier Design-DNA Dropdown
 *   für die direkte Wahl jedes Tabs mit vollem Namen und Icon ohne horizontales Wischen
 *   oder Zusammenschrumpfen.
 * - Ab `md` (Desktop & Tablets): Vollwertige horizontale Reiterleiste mit Symbol und
 *   vollem Namen, aktiver Hervorhebung und Tastaturnavigation.
 */
export function ServerDetailTabs<TKey extends string>({
  tabs,
  activeTab,
  onSelect,
  ariaLabel,
}: ServerDetailTabsProps<TKey>) {
  const dropdownOptions: DropdownOption[] = tabs.map((tab) => {
    const Icon = tab.icon
    return {
      value: tab.key,
      label: tab.label,
      icon: <Icon className="h-4 w-4 text-on-surface-variant" aria-hidden="true" />,
    }
  })

  return (
    <div className="z-20 -mb-px">
      {/* Mobile-Ansicht (md:hidden): Schnelle Direktwahl per Design-DNA Dropdown */}
      <div className="md:hidden py-1.5" data-testid="mobile-tab-dropdown">
        <Dropdown
          value={activeTab}
          onChange={(val) => onSelect(val as TKey)}
          options={dropdownOptions}
          aria-label={ariaLabel ? `${ariaLabel} Navigation` : 'Server Navigation'}
        />
      </div>

      {/* Desktop-Ansicht (hidden md:block): Horizontale semantische Tabliste */}
      <div
        role="tablist"
        aria-label={ariaLabel}
        className="hidden md:block border-b border-outline bg-transparent overflow-x-auto msm-ohne-rollbalken"
      >
        <div className="flex gap-1 min-w-max">
          {tabs.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.key
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onSelect(tab.key)}
                className={`inline-flex items-center gap-2 border-b-2 px-4 py-2.5 font-body-md text-sm transition-colors ${
                  isActive
                    ? 'border-secondary text-primary font-medium'
                    : 'border-transparent text-on-surface-variant hover:text-on-surface'
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
