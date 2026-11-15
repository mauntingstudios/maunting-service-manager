import { ChevronDown, type LucideIcon } from 'lucide-react'
import { ActionMenu, Dropdown, type ActionMenuItem, type DropdownOption } from '@maunting/ui'

/**
 * Ein Reiter der Serverdetail-Seite: Schlüssel, fertiger Name und Symbol.
 */
export interface ServerDetailTab<TKey extends string = string> {
  key: TKey
  label: string
  icon: LucideIcon
  /** Sekundäre Verwaltungsreiter werden am Desktop im „Weitere“-Menü gebündelt. */
  secondary?: boolean
}

interface ServerDetailTabsProps<TKey extends string> {
  tabs: ServerDetailTab<TKey>[]
  activeTab: TKey
  onSelect: (key: TKey) => void
  /** Optionaler a11y-Name für die Tab-Liste (etwa der Servername). */
  ariaLabel?: string
  /** Beschriftung des Überlauf-Menüs am Desktop. */
  moreLabel?: string
}

/**
 * Reiterleiste der Serverdetail-Seite (Dateien, Konsole, Mods, ...).
 *
 * Responsives Verhalten:
 * - Auf schmalen Bildschirmen / Handys (`md:hidden`): Barrierefreier Design-DNA Dropdown
 *   für die direkte Wahl jedes Tabs mit vollem Namen und Icon ohne horizontales Wischen
 *   oder Zusammenschrumpfen.
 * - Ab `md` (Desktop & Tablets): Kompakte primäre Tab-Leiste; optionale `secondary`-Reiter
 *   wandern in das `Weitere`-Menü, bleiben bei Auswahl aber sichtbar in der Leiste.
 */
export function ServerDetailTabs<TKey extends string>({
  tabs,
  activeTab,
  onSelect,
  ariaLabel,
  moreLabel = 'Weitere',
}: ServerDetailTabsProps<TKey>) {
  const primaryTabs = tabs.filter((tab) => !tab.secondary)
  const secondaryTabs = tabs.filter((tab) => Boolean(tab.secondary))
  const activeSecondaryTab = secondaryTabs.find((tab) => tab.key === activeTab)
  const visibleDesktopTabs = activeSecondaryTab
    ? [...primaryTabs, activeSecondaryTab]
    : primaryTabs

  const dropdownOptions: DropdownOption[] = tabs.map((tab) => {
    const Icon = tab.icon
    return {
      value: tab.key,
      label: tab.label,
      icon: <Icon className="h-4 w-4 text-on-surface-variant" aria-hidden="true" />,
    }
  })

  const overflowItems: ActionMenuItem[] = secondaryTabs.map((tab) => {
    const Icon = tab.icon
    return {
      key: tab.key,
      label: tab.label,
      icon: <Icon className="h-4 w-4" aria-hidden="true" />,
      onSelect: () => onSelect(tab.key),
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
          buttonClassName="min-h-[44px]"
        />
      </div>

      {/* Desktop-Ansicht: Semantische Tabliste plus optionales Überlauf-Menü für seltene Reiter */}
      <div className="hidden md:flex items-center justify-between gap-2 border-b border-outline">
        <div
          role="tablist"
          aria-label={ariaLabel}
          className="hidden md:block flex-1 min-w-0 bg-transparent overflow-x-auto msm-ohne-rollbalken"
        >
          <div className="flex gap-1 min-w-max">
            {visibleDesktopTabs.map((tab) => {
              const Icon = tab.icon
              const isActive = activeTab === tab.key
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => onSelect(tab.key)}
                  className={`inline-flex items-center gap-2 border-b-2 px-3.5 py-2.5 font-body-md text-sm transition-colors ${
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
        {overflowItems.length > 0 ? (
          <div className="shrink-0 pb-1">
            <ActionMenu
              label={moreLabel}
              icon={<ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
              items={overflowItems}
              variant="ghost"
              surface="dna"
              align="end"
              compact
              ariaLabel={moreLabel}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}
