import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { Bot, SlidersHorizontal, type LucideIcon } from 'lucide-react'
import { ActionMenu, Button, Kurzinfo, TabBar, type ActionMenuItem, type TabDef } from '@maunting/ui'
import { useHasPermission, useIsOwner } from '@/hooks/useHasPermission'
import { usePanelNavigation } from './usePanelNavigation'
import {
  DASHBOARD_SEITEN,
  DEFAULT_DASHBOARD_TABS,
  MAX_DASHBOARD_TABS,
  SETTINGS_SEKTIONEN,
  matchDashboardTab,
} from '@/desktop/dashboard/dashboardWege'
import { useDashboardPreferencesStore } from '@/stores/dashboardPreferencesStore'
import { toast } from '@/stores/toastStore'
import { DashboardReiterAnpassenDialog } from './DashboardReiterAnpassenDialog'

export interface DashboardOption {
  to: string
  label: string
  icon?: LucideIcon
  kind: 'panel' | 'settings'
  groupLabel?: string
}

/**
 * Die Reiterzeile der Server-Verwaltung im Web und in der MSS-App:
 * Dashboard als fester erster Reiter, dahinter frei zusammenstellbare
 * Schnellzugriffe (Standard: Server, Nodes, KI-Provider) sowie „Mehr“.
 *
 * Werden Panel-Bereiche ausgepinnt, wandern sie automatisch ins „Mehr“-Menü,
 * damit keine Seite unerreichbar wird.
 */
export function DashboardReiter({ dashboardPath = '/' }: { dashboardPath?: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { items } = usePanelNavigation(dashboardPath)
  const isOwner = useIsOwner()
  const canReadHoster = useHasPermission('panel.hoster.read') || isOwner
  const [dialogOpen, setDialogOpen] = useState(false)

  const pinnedTabs = useDashboardPreferencesStore((s) => s.pinnedTabs)
  const togglePinnedTab = useDashboardPreferencesStore((s) => s.togglePinnedTab)
  const movePinnedTab = useDashboardPreferencesStore((s) => s.movePinnedTab)
  const resetToDefaults = useDashboardPreferencesStore((s) => s.resetToDefaults)

  const erlaubt = useMemo(() => {
    const allowedSet = new Set(items.map((eintrag) => eintrag.to))
    if (allowedSet.has('/settings')) {
      allowedSet.add('/admin/ai-providers')
    }
    return allowedSet
  }, [items])

  const dashboardHome = useMemo(() => {
    const eintrag = items.find((item) => item.to === dashboardPath)
    return {
      id: dashboardPath,
      label: t(DASHBOARD_SEITEN[0].labelKey),
      icon: eintrag?.icon,
    }
  }, [items, dashboardPath, t])

  const optionen = useMemo<DashboardOption[]>(() => {
    const list: DashboardOption[] = []

    for (const seite of DASHBOARD_SEITEN) {
      if (seite.to === '/' || !erlaubt.has(seite.to)) continue
      list.push({
        to: seite.to,
        label: t(seite.labelKey),
        icon:
          items.find((eintrag) => eintrag.to === seite.to)?.icon ??
          (seite.to === '/admin/ai-providers' ? Bot : undefined),
        kind: 'panel',
      })
    }

    if (erlaubt.has('/settings')) {
      for (const sektion of SETTINGS_SEKTIONEN) {
        list.push({
          to: sektion.to,
          label: sektion.altLabelKey && canReadHoster ? t(sektion.altLabelKey) : t(sektion.labelKey),
          icon: sektion.icon,
          kind: 'settings',
          groupLabel: t(sektion.groupKey),
        })
      }
    }

    return list
  }, [erlaubt, items, canReadHoster, t])

  const activePinnedIds = pinnedTabs ?? DEFAULT_DASHBOARD_TABS
  const pinnedSet = useMemo(() => new Set(activePinnedIds), [activePinnedIds])

  const pinnedOptions = useMemo(() => {
    const byRoute = new Map(optionen.map((opt) => [opt.to, opt]))
    return activePinnedIds
      .map((to) => byRoute.get(to))
      .filter((opt): opt is DashboardOption => Boolean(opt))
  }, [activePinnedIds, optionen])

  const mehrOptions = useMemo(
    () => optionen.filter((opt) => opt.kind === 'panel' && !pinnedSet.has(opt.to)),
    [optionen, pinnedSet],
  )

  const tabs: TabDef<string>[] = [
    dashboardHome,
    ...pinnedOptions.map((opt) => ({
      id: opt.to,
      label: opt.label,
      icon: opt.icon,
    })),
  ]

  const aktiv = matchDashboardTab(
    location.pathname,
    location.search,
    tabs.map((tab) => tab.id),
  )

  const mehrItems: ActionMenuItem[] = mehrOptions.map((opt) => {
    const Icon = opt.icon
    return {
      key: opt.to,
      label: opt.label,
      icon: Icon ? <Icon className="h-4 w-4" aria-hidden="true" /> : undefined,
      onSelect: () => navigate(opt.to),
    }
  })

  const handleTogglePin = useCallback(
    (to: string) => {
      const result = togglePinnedTab(to)
      if (result === 'limit') {
        toast.info(t('dashboard.customize.limitReached', { max: MAX_DASHBOARD_TABS }))
      }
    },
    [togglePinnedTab, t],
  )

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
        {optionen.length >= 2 && (
          <Kurzinfo text={t('mss.dashboard.anpassen')}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              fingerziel
              onClick={() => setDialogOpen(true)}
              aria-label={t('mss.dashboard.anpassen')}
              className="shrink-0 rounded-full border border-outline-variant/35 bg-surface-container-low/75 text-on-surface-variant backdrop-blur-md transition-[background-color,color,transform] hover:bg-surface-container-high/80 hover:text-on-surface active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 disabled:pointer-events-none disabled:opacity-50"
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            </Button>
          </Kurzinfo>
        )}
      </div>

      {dialogOpen && (
        <DashboardReiterAnpassenDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          options={optionen}
          pinnedOptions={pinnedOptions}
          pinnedSet={pinnedSet}
          isCustom={pinnedTabs !== null}
          onTogglePin={handleTogglePin}
          onMovePin={movePinnedTab}
          onReset={resetToDefaults}
        />
      )}
    </div>
  )
}
