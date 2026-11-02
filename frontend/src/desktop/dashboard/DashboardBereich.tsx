/**
 * Die Server-Verwaltung in der App.
 *
 * Gerendert werden **dieselben** Seitenkomponenten wie im Panel
 * (`pages/Settings.tsx` ist dort eine andere Datei als die Geräteeinstellungen
 * der App). Ein Wechsel im Web wirkt damit sofort hier; es gibt keine Kopie.
 * Welche Seite sichtbar ist, entscheidet `usePanelNavigation` — dieselbe Quelle
 * wie die Seitenleiste im Web.
 */
import { lazy, Suspense, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'

import { ErrorBoundary } from '@/components/ErrorBoundary'
import { RequirePermission } from '@/components/RequirePermission'
import { usePanelNavigation } from '@/components/layout/usePanelNavigation'
import { Loader } from '@/components/ui/Loader'
import { TabBar, type TabDef } from '@/components/ui/TabBar'
import { ActionMenu, useZurueckSchliesst, type ActionMenuItem } from '@/Singra/UI'
import { DASHBOARD_SEITEN, dashboardElternroute } from './dashboardWege'

const Dashboard = lazy(() => import('@/pages/Dashboard').then((modul) => ({ default: modul.Dashboard })))
const Servers = lazy(() => import('@/pages/Servers').then((modul) => ({ default: modul.Servers })))
const ServerDetail = lazy(() => import('@/pages/ServerDetail').then((modul) => ({ default: modul.ServerDetail })))
const Users = lazy(() => import('@/pages/Users').then((modul) => ({ default: modul.Users })))
const Roles = lazy(() => import('@/pages/Roles').then((modul) => ({ default: modul.Roles })))
const Blueprints = lazy(() => import('@/pages/Blueprints').then((modul) => ({ default: modul.Blueprints })))
const AdminNodes = lazy(() => import('@/pages/AdminNodes').then((modul) => ({ default: modul.AdminNodes })))
const AdminAudit = lazy(() => import('@/pages/AdminAudit').then((modul) => ({ default: modul.AdminAudit })))
const Settings = lazy(() => import('@/pages/Settings').then((modul) => ({ default: modul.Settings })))
const PanelBackups = lazy(() => import('@/pages/PanelBackups').then((modul) => ({ default: modul.PanelBackups })))
const PanelDatabase = lazy(() => import('@/pages/PanelDatabase').then((modul) => ({ default: modul.PanelDatabase })))

export function DashboardBereich() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { items } = usePanelNavigation()
  const inhaltRef = useRef<HTMLDivElement>(null)

  const eltern = dashboardElternroute(location.pathname)
  // Unter Android beendet Zurück sonst die App: eine Unterseite bekommt einen
  // eigenen Verlaufseintrag und führt zurück in ihre Liste.
  useZurueckSchliesst(Boolean(eltern), () => navigate(eltern ?? '/'))

  // Jede Seite beginnt oben; sonst erbt die nächste den Rollstand der vorigen.
  useEffect(() => {
    // `scrollTo` fehlt in jsdom; ohne den Test dort darf die Seite nicht brechen.
    inhaltRef.current?.scrollTo?.({ top: 0 })
  }, [location.pathname])

  const seiten = useMemo(() => {
    const erlaubt = new Set(items.map((eintrag) => eintrag.to))
    return DASHBOARD_SEITEN.filter((seite) => erlaubt.has(seite.to)).map((seite) => ({
      ...seite,
      label: t(seite.labelKey),
      icon: items.find((eintrag) => eintrag.to === seite.to)?.icon,
    }))
  }, [items, t])

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
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="mb-4 flex shrink-0 flex-wrap items-center gap-2">
        <TabBar
          tabs={tabs}
          active={aktiv}
          onChange={(ziel) => navigate(ziel)}
          ariaLabel={t('mss.dashboard.bereiche')}
          einzeilig
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

      <div ref={inhaltRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-6">
        <ErrorBoundary key={location.pathname} compact>
          <Suspense
            fallback={
              <div className="flex min-h-64 items-center justify-center">
                <Loader label="Maunting Service Manager" />
              </div>
            }
          >
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/servers" element={<Servers />} />
              <Route path="/servers/:id" element={<ServerDetail />} />
              <Route
                path="/users"
                element={
                  <RequirePermission routeKey="users">
                    <Users />
                  </RequirePermission>
                }
              />
              <Route
                path="/roles"
                element={
                  <RequirePermission routeKey="roles">
                    <Roles />
                  </RequirePermission>
                }
              />
              <Route
                path="/admin/nodes"
                element={
                  <RequirePermission routeKey="nodes">
                    <AdminNodes />
                  </RequirePermission>
                }
              />
              <Route
                path="/admin/audit"
                element={
                  <RequirePermission routeKey="audit">
                    <AdminAudit />
                  </RequirePermission>
                }
              />
              <Route
                path="/blueprints"
                element={
                  <RequirePermission routeKey="blueprints">
                    <Blueprints />
                  </RequirePermission>
                }
              />
              <Route
                path="/panel-backups"
                element={
                  <RequirePermission routeKey="panelBackups">
                    <PanelBackups />
                  </RequirePermission>
                }
              />
              <Route
                path="/panel-database"
                element={
                  <RequirePermission routeKey="panelDatabase">
                    <PanelDatabase />
                  </RequirePermission>
                }
              />
              <Route
                path="/settings"
                element={
                  <RequirePermission routeKey="settings">
                    <Settings />
                  </RequirePermission>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  )
}
