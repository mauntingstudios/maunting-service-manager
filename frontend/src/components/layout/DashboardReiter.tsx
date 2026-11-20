import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { Bot } from 'lucide-react'
import { ActionMenu, TabBar, type ActionMenuItem, type TabDef } from '@maunting/ui'
import { usePanelNavigation } from './usePanelNavigation'
import { DASHBOARD_SEITEN, dashboardElternroute } from '@/desktop/dashboard/dashboardWege'

/**
 * Die Reiterzeile der Server-Verwaltung im Web: Dashboard, Server, Nodes und
 * KI-Provider als Reiter, der Rest (Benutzer, Rollen, Audit, Einstellungen,
 * Blueprints, Backups, Datenbank) hinter „Mehr“.
 *
 * Dieselbe Quelle, dieselbe Aufteilung und derselbe freischwebende Auftritt
 * wie das Dashboard in der MSS-App (`desktop/dashboard/DashboardBereich`):
 * Sichtbarkeit und Rechte kommen aus `usePanelNavigation`, die Seitenliste aus
 * `DASHBOARD_SEITEN`. Die Zeile trägt bewusst keinen eigenen Balken.
 */
export function DashboardReiter({ dashboardPath = '/' }: { dashboardPath?: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { items } = usePanelNavigation(dashboardPath)

  const eltern = dashboardElternroute(location.pathname)

  const seiten = useMemo(() => {
    const erlaubt = new Set(items.map((eintrag) => eintrag.to))
    if (erlaubt.has('/settings')) {
      erlaubt.add('/admin/ai-providers')
    }
    return DASHBOARD_SEITEN.map((seite) => ({
      ...seite,
      to: seite.to === '/' ? dashboardPath : seite.to,
    }))
      .filter((seite) => erlaubt.has(seite.to))
      .map((seite) => ({
        ...seite,
        label: t(seite.labelKey),
        icon: items.find((eintrag) => eintrag.to === seite.to)?.icon ?? (seite.to === '/admin/ai-providers' ? Bot : undefined),
      }))
  }, [items, t, dashboardPath])

  const reiter = seiten.filter((seite) => seite.gruppe === 'Overview' || seite.gruppe === 'Infrastructure')
  const weitere = seiten.filter((seite) => seite.gruppe === 'Administration' || seite.gruppe === 'Panel')

  const aktiv = eltern ?? location.pathname
  const tabs: TabDef<string>[] = reiter.map((seite) => ({
    id: seite.to,
    label: seite.label,
    icon: seite.icon,
  }))
  const mehrItems: ActionMenuItem[] = weitere.map((seite) => {
    const Icon = seite.icon
    return {
      key: seite.to,
      label: seite.label,
      icon: Icon ? <Icon className="h-4 w-4" aria-hidden="true" /> : undefined,
      onSelect: () => navigate(seite.to),
    }
  })

  return (
    <div className="relative z-20 mx-auto flex w-full max-w-7xl 2xl:max-w-[1600px] shrink-0 items-center justify-between gap-2 px-3.5 sm:px-6 lg:px-8 pt-3 sm:pt-3.5 pb-1">
      <div className="flex flex-1 items-center gap-2 min-w-0">
        <TabBar
          tabs={tabs}
          active={aktiv}
          onChange={(ziel) => navigate(ziel)}
          ariaLabel={t('mss.dashboard.bereiche')}
          einzeilig
          embedded
        />
        {mehrItems.length > 0 && (
          <ActionMenu
            label={t('mss.dashboard.mehr')}
            items={mehrItems}
            variant="ghost"
            surface="dna"
            compact
          />
        )}
      </div>
    </div>
  )
}
