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
import { Loader } from '@/components/app/Loader'
import { TabBar, TabDef } from '@maunting/ui'
import { ActionMenu, useZurueckSchliesst, ActionMenuItem } from '@maunting/ui'
import { Bot } from 'lucide-react'
import { DASHBOARD_SEITEN, dashboardElternroute } from './dashboardWege'
import { TageszeitHintergrund } from '@/components/layout/TageszeitHintergrund'
import { useTageszeitMotiv } from '@/lib/tageszeit'

const Dashboard = lazy(() => import('@/pages/Dashboard').then((modul) => ({ default: modul.Dashboard })))
const Servers = lazy(() => import('@/pages/Servers').then((modul) => ({ default: modul.Servers })))
const ServerDetail = lazy(() => import('@/pages/ServerDetail').then((modul) => ({ default: modul.ServerDetail })))
const Users = lazy(() => import('@/pages/Users').then((modul) => ({ default: modul.Users })))
const Roles = lazy(() => import('@/pages/Roles').then((modul) => ({ default: modul.Roles })))
const Blueprints = lazy(() => import('@/pages/Blueprints').then((modul) => ({ default: modul.Blueprints })))
const AdminNodes = lazy(() => import('@/pages/AdminNodes').then((modul) => ({ default: modul.AdminNodes })))
const AdminAudit = lazy(() => import('@/pages/AdminAudit').then((modul) => ({ default: modul.AdminAudit })))
const Settings = lazy(() => import('@/pages/Settings').then((modul) => ({ default: modul.Settings })))
const AiSettings = lazy(() => import('@/pages/settings/AiTab').then((modul) => ({ default: modul.AiTab })))
const PanelBackups = lazy(() => import('@/pages/PanelBackups').then((modul) => ({ default: modul.PanelBackups })))
const PanelDatabase = lazy(() => import('@/pages/PanelDatabase').then((modul) => ({ default: modul.PanelDatabase })))

export function DashboardBereich() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { items } = usePanelNavigation()
  const inhaltRef = useRef<HTMLDivElement>(null)

  const headerMotiv = useTageszeitMotiv('dashboard')

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
    if (erlaubt.has('/settings')) {
      erlaubt.add('/admin/ai-providers')
    }
    return DASHBOARD_SEITEN.filter((seite) => erlaubt.has(seite.to)).map((seite) => ({
      ...seite,
      label: t(seite.labelKey),
      icon: items.find((eintrag) => eintrag.to === seite.to)?.icon ?? (seite.to === '/admin/ai-providers' ? Bot : undefined),
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
    <div className="relative isolate flex h-full min-h-0 w-full flex-col overflow-hidden">
      {/* Weicher atmosphärischer Tageszeit-Hintergrund geht direkt hinter die Menü-Punkte */}
      <TageszeitHintergrund
        motiv={headerMotiv}
        hoehe="h-[520px] sm:h-[580px] lg:h-[640px]"
        deckkraft="opacity-55"
        ebene="-z-10"
      />

      {/* Freischwebende Menü-Reiter (Schwebe-Buttons) direkt über dem Hintergrund */}
      <div className="relative z-20 flex shrink-0 items-center justify-between gap-2 px-3.5 sm:px-6 lg:px-8 pt-3 sm:pt-3.5 pb-1 max-w-7xl 2xl:max-w-[1600px] w-full mx-auto">
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

      <div
        ref={inhaltRef}
        className={`min-h-0 flex-1 flex flex-col relative z-10 ${
          location.pathname === '/' || location.pathname === '/servers'
            ? 'overflow-hidden'
            : 'overflow-y-auto overscroll-contain px-3.5 sm:px-6 lg:px-8 py-3 pb-8'
        }`}
      >
        <ErrorBoundary key={location.pathname} compact>
          <Suspense
            fallback={
              <div className="flex min-h-64 items-center justify-center">
                <Loader label="Maunting Service Manager" />
              </div>
            }
          >
            <Routes>
              <Route path="/" element={<Dashboard ohneHintergrund />} />
              <Route path="/servers" element={<Servers ohneHintergrund />} />
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
                path="/admin/ai-providers"
                element={
                  <RequirePermission routeKey="settings">
                    <AiSettings />
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
