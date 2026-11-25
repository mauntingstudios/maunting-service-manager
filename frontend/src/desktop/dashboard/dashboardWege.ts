import type { LucideIcon } from 'lucide-react'
import {
  Bot,
  FileText,
  Gamepad2,
  Globe,
  HardDrive,
  KeyRound,
  Mail,
  Megaphone,
  ShieldAlert,
  ShoppingBag,
} from 'lucide-react'
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
  // Nicht „Einstellungen“ wie in der Web-Kopfleiste: in der App heißen so
  // schon die Geräteeinstellungen im Profilmenü. Die Seite bleibt dieselbe.
  { to: '/settings', labelKey: 'mss.dashboard.panelEinstellungen', gruppe: 'Panel' },
  { to: '/blueprints', labelKey: 'nav.blueprints', gruppe: 'Panel' },
  { to: '/panel-backups', labelKey: 'nav.panelBackups', gruppe: 'Panel' },
  { to: '/panel-database', labelKey: 'nav.panelDatabase', gruppe: 'Panel' },
]

export const DEFAULT_DASHBOARD_TABS: readonly string[] = [
  '/servers',
  '/admin/nodes',
  '/admin/ai-providers',
]

export const MAX_DASHBOARD_TABS = 5

export type SettingsSectionId =
  | 'general'
  | 'imprint'
  | 'announcements'
  | 'security'
  | 'oauth'
  | 'gameIntegrations'
  | 'shop'
  | 'communication'
  | 'ai'
  | 'storage'

export type SecuritySubTab = 'security' | 'captcha' | 'cloudflare'
export type GameIntegrationSubTab = 'steam' | 'curseforge'
export type CommunicationSubTab = 'email' | 'messenger' | 'supportWidget'
export type AnnouncementsSubTab = 'popup' | 'news'
export type StorageSubTab = 'vaultStorage' | 'backup'
export type ShopSettingsSubTab = 'overview' | 'catalog' | 'orders' | 'accounting' | 'setup' | 'hoster'
export type AiSettingsSubTab = 'providers' | 'features' | 'limits' | 'usage' | 'searchEngine'

export interface SettingsBereichDef {
  id: SettingsSectionId
  to: `/settings?tab=${SettingsSectionId}`
  labelKey: string
  altLabelKey?: string
  icon: LucideIcon
  groupKey: string
}

/**
 * Einheitliche Liste aller gebündelten Panel-Einstellungsbereiche.
 * Wird sowohl von `Settings.tsx` (Seitenleiste) als auch von `DashboardReiter`
 * (Schnellzugriff-Favoriten) genutzt.
 */
export const SETTINGS_SEKTIONEN: readonly SettingsBereichDef[] = [
  { id: 'general', to: '/settings?tab=general', labelKey: 'settings.tabs.general', icon: Globe, groupKey: 'settings.groups.basis' },
  { id: 'imprint', to: '/settings?tab=imprint', labelKey: 'settings.tabs.imprint', icon: FileText, groupKey: 'settings.groups.basis' },
  { id: 'announcements', to: '/settings?tab=announcements', labelKey: 'settings.tabs.announcements', icon: Megaphone, groupKey: 'settings.groups.basis' },
  { id: 'security', to: '/settings?tab=security', labelKey: 'settings.tabs.security', icon: ShieldAlert, groupKey: 'settings.groups.sicherheit' },
  { id: 'oauth', to: '/settings?tab=oauth', labelKey: 'settings.tabs.oauth', icon: KeyRound, groupKey: 'settings.groups.sicherheit' },
  { id: 'gameIntegrations', to: '/settings?tab=gameIntegrations', labelKey: 'settings.tabs.gameIntegrations', icon: Gamepad2, groupKey: 'settings.groups.verbindungen' },
  {
    id: 'shop',
    to: '/settings?tab=shop',
    labelKey: 'settings.tabs.shop',
    altLabelKey: 'settings.tabs.shopAndHoster',
    icon: ShoppingBag,
    groupKey: 'settings.groups.verbindungen',
  },
  { id: 'communication', to: '/settings?tab=communication', labelKey: 'settings.tabs.communication', icon: Mail, groupKey: 'settings.groups.verbindungen' },
  { id: 'ai', to: '/settings?tab=ai', labelKey: 'settings.tabs.aiAndSearch', icon: Bot, groupKey: 'settings.groups.verbindungen' },
  { id: 'storage', to: '/settings?tab=storage', labelKey: 'settings.tabs.storage', icon: HardDrive, groupKey: 'settings.groups.daten' },
]

export const VALID_DASHBOARD_TABS: ReadonlySet<string> = new Set([
  ...DASHBOARD_SEITEN.filter((seite) => seite.to !== '/').map((seite) => seite.to),
  ...SETTINGS_SEKTIONEN.map((sektion) => sektion.to),
])

export interface ResolvedSettingsTarget {
  section: SettingsSectionId
  announcements?: AnnouncementsSubTab
  security?: SecuritySubTab
  gameIntegrations?: GameIntegrationSubTab
  shop?: ShopSettingsSubTab
  communication?: CommunicationSubTab
  ai?: AiSettingsSubTab
  storage?: StorageSubTab
}

/**
 * Löst sowohl gebündelte Bereichs-IDs als auch historische `?tab=...`-Deep-Links
 * (z. B. `news`, `captcha`, `hoster`) auf den passenden Hauptbereich und Sub-Tab auf.
 */
export function resolveSettingsTarget(rawTab: string | null): ResolvedSettingsTarget {
  switch (rawTab) {
    case 'imprint':
      return { section: 'imprint' }
    case 'announcements':
    case 'popup':
      return { section: 'announcements', announcements: 'popup' }
    case 'news':
      return { section: 'announcements', announcements: 'news' }
    case 'security':
      return { section: 'security', security: 'security' }
    case 'captcha':
      return { section: 'security', security: 'captcha' }
    case 'cloudflare':
      return { section: 'security', security: 'cloudflare' }
    case 'oauth':
      return { section: 'oauth' }
    case 'gameIntegrations':
    case 'steam':
      return { section: 'gameIntegrations', gameIntegrations: 'steam' }
    case 'curseforge':
      return { section: 'gameIntegrations', gameIntegrations: 'curseforge' }
    case 'shop':
      return { section: 'shop', shop: 'overview' }
    case 'hoster':
      return { section: 'shop', shop: 'hoster' }
    case 'communication':
    case 'email':
      return { section: 'communication', communication: 'email' }
    case 'messenger':
      return { section: 'communication', communication: 'messenger' }
    case 'supportWidget':
      return { section: 'communication', communication: 'supportWidget' }
    case 'ai':
      return { section: 'ai', ai: 'providers' }
    case 'searchEngine':
      return { section: 'ai', ai: 'searchEngine' }
    case 'storage':
    case 'vaultStorage':
      return { section: 'storage', storage: 'vaultStorage' }
    case 'backup':
      return { section: 'storage', storage: 'backup' }
    case 'general':
    default:
      return { section: 'general' }
  }
}

const SEITEN_PFADE = DASHBOARD_SEITEN.map((seite) => seite.to).filter((pfad) => pfad !== '/')

/** Gehört der Pfad zur Server-Verwaltung? */
export function istDashboardRoute(pathname: string): boolean {
  // `/dashboard` ist die Startseite des Web-Panels; die App bleibt bei `/`.
  return pathname === '/' || pathname === '/dashboard' || SEITEN_PFADE.some((pfad) => pathname === pfad || pathname.startsWith(`${pfad}/`))
}

/** Die Liste, zu der eine Unterseite gehört — das Ziel des Zurück-Pfeils. */
export function dashboardElternroute(pathname: string): string | null {
  return SEITEN_PFADE.find((pfad) => pathname.startsWith(`${pfad}/`)) ?? null
}

export function dashboardTitelKey(pathname: string): string {
  const route = dashboardElternroute(pathname) ?? pathname
  return DASHBOARD_SEITEN.find((seite) => seite.to === route)?.labelKey ?? 'nav.dashboard'
}

/** Bestimmt den aktiven Tab in der Dashboard-Reiterleiste inkl. angepinnter Settings-Deep-Links. */
export function matchDashboardTab(
  pathname: string,
  search: string,
  visibleTabs: readonly string[],
): string {
  const eltern = dashboardElternroute(pathname)
  if (eltern) return eltern

  if (pathname === '/settings') {
    const rawTab = new URLSearchParams(search).get('tab')
    if (rawTab) {
      const target = `/settings?tab=${resolveSettingsTarget(rawTab).section}`
      if (visibleTabs.includes(target)) return target
    }
    if (visibleTabs.includes('/settings?tab=general') && !visibleTabs.includes('/settings')) {
      return '/settings?tab=general'
    }
  }

  return pathname
}
