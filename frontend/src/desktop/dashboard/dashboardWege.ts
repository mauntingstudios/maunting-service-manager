import type { NavGroupName } from '@/components/layout/navigation'

export interface DashboardSeite {
  /** Derselbe Pfad wie im Panel — die Seiten navigieren absolut. */
  to: string
  /** Name in Reiter, Menü und Kopfzeile. */
  labelKey: string
  /** Die Gruppe der Panel-Navigation entscheidet Reiter oder „Mehr“. */
  gruppe: NavGroupName
}

/**
 * Die Panel-Seiten, die das Dashboard in der App zeigt.
 *
 * Die Seiten selbst sind dieselben Komponenten wie im Web; hier steht nur,
 * unter welchem Pfad sie im Speicherrouter liegen. Sichtbarkeit und Rechte
 * kommen aus `usePanelNavigation`, damit die App keine eigenen Regeln führt.
 */
export const DASHBOARD_SEITEN: DashboardSeite[] = [
  { to: '/', labelKey: 'nav.dashboard', gruppe: 'Overview' },
  { to: '/servers', labelKey: 'nav.servers', gruppe: 'Infrastructure' },
  { to: '/admin/nodes', labelKey: 'nav.nodes', gruppe: 'Infrastructure' },
  { to: '/admin/ai-providers', labelKey: 'nav.aiProviders', gruppe: 'Infrastructure' },
  { to: '/users', labelKey: 'nav.users', gruppe: 'Administration' },
  { to: '/roles', labelKey: 'nav.roles', gruppe: 'Administration' },
  { to: '/admin/audit', labelKey: 'nav.audit', gruppe: 'Administration' },
  // Nicht „Einstellungen“ wie in der Web-Seitenleiste: in der App heißen so
  // schon die Geräteeinstellungen im Profilmenü. Die Seite bleibt dieselbe.
  { to: '/settings', labelKey: 'mss.dashboard.panelEinstellungen', gruppe: 'Panel' },
  { to: '/blueprints', labelKey: 'nav.blueprints', gruppe: 'Panel' },
  { to: '/panel-backups', labelKey: 'nav.panelBackups', gruppe: 'Panel' },
  { to: '/panel-database', labelKey: 'nav.panelDatabase', gruppe: 'Panel' },
]

const SEITEN_PFADE = DASHBOARD_SEITEN.map((seite) => seite.to).filter((pfad) => pfad !== '/')

/** Gehört der Pfad zur Server-Verwaltung? */
export function istDashboardRoute(pathname: string): boolean {
  return pathname === '/' || SEITEN_PFADE.some((pfad) => pathname === pfad || pathname.startsWith(`${pfad}/`))
}

/** Die Liste, zu der eine Unterseite gehört — das Ziel des Zurück-Pfeils. */
export function dashboardElternroute(pathname: string): string | null {
  return SEITEN_PFADE.find((pfad) => pathname.startsWith(`${pfad}/`)) ?? null
}

export function dashboardTitelKey(pathname: string): string {
  const route = dashboardElternroute(pathname) ?? pathname
  return DASHBOARD_SEITEN.find((seite) => seite.to === route)?.labelKey ?? 'nav.dashboard'
}
