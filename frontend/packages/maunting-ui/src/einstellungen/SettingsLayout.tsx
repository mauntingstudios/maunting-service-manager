import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

import { InhaltUebergang } from '../motion/Motion'

/**
 * Einstellungen sind Zeilen in Abschnitten, keine Kärtchen.
 *
 * Die linke Spalte führt die Abschnitte, die rechte zeigt den Inhalt. Auf
 * schmalen Flächen wird daraus eine wischbare Leiste. Die Bausteine tragen
 * keinen festen Text; Titel und Beschreibungen kommen vom Aufrufer.
 */
export interface SettingsSectionEintrag<T extends string = string> {
  id: T
  label: string
  icon?: LucideIcon
  group?: string
  tone?: 'default' | 'danger'
}

export interface SettingsLayoutProps<T extends string> {
  sections: SettingsSectionEintrag<T>[]
  active: T
  onChange: (id: T) => void
  title: string
  description?: string
  children: ReactNode
}

export function SettingsLayout<T extends string>({
  sections,
  active,
  onChange,
  title,
  description,
  children,
}: SettingsLayoutProps<T>) {
  const gruppen = [...new Set(sections.map((section) => section.group ?? ''))]

  return (
    <div className="mui-settings grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="hidden lg:block">
        <div className="sticky top-6 space-y-5">
          <div>
            <h1 className="font-headline text-headline-sm text-on-surface">{title}</h1>
            {description && <p className="mt-1 text-body-sm text-on-surface-variant">{description}</p>}
          </div>
          <nav aria-label={title} className="space-y-4">
            {gruppen.map((gruppe) => (
              <div key={gruppe || 'allgemein'}>
                {gruppe && (
                  <p className="px-3 pb-1 text-label-sm font-medium uppercase tracking-[0.14em] text-on-surface-variant/60">
                    {gruppe}
                  </p>
                )}
                <div className="space-y-0.5">
                  {sections
                    .filter((section) => (section.group ?? '') === gruppe)
                    .map((section) => {
                      const Symbol = section.icon
                      const istAktiv = section.id === active
                      return (
                        <button
                          key={section.id}
                          type="button"
                          onClick={() => onChange(section.id)}
                          aria-current={istAktiv ? 'page' : undefined}
                          className={`flex w-full items-center gap-3 rounded-control px-3 py-2 text-left text-label-md transition-colors ${
                            istAktiv
                              ? 'bg-primary/10 font-semibold text-primary'
                              : section.tone === 'danger'
                                ? 'text-status-destructive hover:bg-status-destructive/10'
                                : 'text-on-surface-variant hover:bg-surface-container-high/50 hover:text-on-surface'
                          }`}
                        >
                          {Symbol && <Symbol className="h-4 w-4 shrink-0" aria-hidden="true" />}
                          <span className="truncate">{section.label}</span>
                        </button>
                      )
                    })}
                </div>
              </div>
            ))}
          </nav>
        </div>
      </aside>

      <div className="min-w-0">
        <div className="mb-4 flex gap-1 overflow-x-auto pb-1 msm-ohne-rollbalken lg:hidden" role="tablist" aria-label={title}>
          {sections.map((section) => {
            const istAktiv = section.id === active
            return (
              <button
                key={section.id}
                type="button"
                role="tab"
                aria-selected={istAktiv}
                onClick={() => onChange(section.id)}
                className={`flex min-h-11 shrink-0 items-center gap-2 rounded-control px-3 text-label-md transition-colors ${
                  istAktiv ? 'bg-primary/10 text-primary' : 'text-on-surface-variant hover:bg-surface-container-high/50'
                }`}
              >
                {section.label}
              </button>
            )
          })}
        </div>
        <InhaltUebergang kennung={active} className="space-y-6">{children}</InhaltUebergang>
      </div>
    </div>
  )
}

export interface SettingsSectionProps {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
}

/** Ein Abschnitt: Überschrift, eine Zeile Kontext, dann die Zeilen. */
export function SettingsSection({ title, description, actions, children }: SettingsSectionProps) {
  return (
    <section className="border-t border-outline-variant/45 pt-5 first:border-0 first:pt-0">
      <header className="mb-1 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-headline text-title-lg text-on-surface">{title}</h2>
          {description && <p className="mt-0.5 text-body-sm text-on-surface-variant">{description}</p>}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </header>
      <div>{children}</div>
    </section>
  )
}

export interface SettingRowProps {
  title: string
  description?: string
  htmlFor?: string
  tone?: 'default' | 'danger'
  children: ReactNode
}

/** Eine Einstellung: Label und Erklärung links, das Steuerelement rechts. */
export function SettingRow({ title, description, htmlFor, tone = 'default', children }: SettingRowProps) {
  const inhalt = (
    <div className="min-w-0">
      <div className={`text-title-sm ${tone === 'danger' ? 'text-status-destructive' : 'text-on-surface'}`}>{title}</div>
      {description && <p className="mt-0.5 text-body-sm text-on-surface-variant">{description}</p>}
    </div>
  )
  return (
    <div className="flex flex-col gap-3 border-b border-outline-variant/35 py-3.5 last:border-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      {htmlFor ? <label htmlFor={htmlFor}>{inhalt}</label> : inhalt}
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export interface DangerZoneProps {
  title: string
  description?: string
  children: ReactNode
}

/** Destruktive Aktionen stehen unten, abgesetzt und ohne Nachbarschaft. */
export function DangerZone({ title, description, children }: DangerZoneProps) {
  return (
    <section className="mt-8 rounded-panel border border-status-destructive/30 bg-status-destructive/[0.045] p-5">
      <h2 className="font-headline text-title-lg text-status-destructive">{title}</h2>
      {description && <p className="mt-1 text-body-sm text-on-surface-variant">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}
