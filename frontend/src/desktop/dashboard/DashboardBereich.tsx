/**
 * Die Server-Verwaltung in der App.
 *
 * Gerendert werden **dieselben** Seitenkomponenten wie im Panel
 * (`pages/Settings.tsx` ist dort eine andere Datei als die Geräteeinstellungen
 * der App). Ein Wechsel im Web wirkt damit sofort hier; es gibt keine Kopie.
 * Welche Seite sichtbar ist, entscheidet `usePanelNavigation` — dieselbe Quelle
 * wie die Kopfleiste im Web.
 */
import { lazy, Suspense, useEffect, useRef } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'

import { ErrorBoundary } from '@/components/ErrorBoundary'
import { RequirePermission } from '@/components/RequirePermission'
import { RolePreviewBanner } from '@/components/RolePreviewBanner'
import { DashboardReiter } from '@/components/layout/DashboardReiter'
import { Loader } from '@/components/app/Loader'
import { useZurueckSchliesst } from '@maunting/ui'
import { dashboardElternroute } from './dashboardWege'
import { TageszeitHintergrund } from '@/components/layout/TageszeitHintergrund'
import { useBildquelle } from '@/hooks/useBildquelle'
import { useTageszeitMotiv } from '@/lib/tageszeit'
import { useServerWallpaperStore } from '@/stores/serverWallpaperStore'

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
  const navigate = useNavigate()
  const location = useLocation()
  const inhaltRef = useRef<HTMLDivElement>(null)

  const headerMotiv = useTageszeitMotiv('dashboard')
  // Titelbild: ServerDetail legt das aktive Motiv in den Store — dieselbe
  // Seite wie im Web, also dasselbe Bild. Die Quelle läuft über
  // useBildquelle, weil ein CSS-`url()` in der App kein Bearer-Token trägt.
  // Solange sie lädt oder fehlt, steht das Panorama dahinter.
  const serverWallpaper = useServerWallpaperStore((s) => s.activeWallpaper)
  const { quelle: wallpaperQuelle } = useBildquelle(serverWallpaper ? serverWallpaper.pfad : null)
  const motiv = serverWallpaper && wallpaperQuelle
    ? { ...serverWallpaper, pfad: wallpaperQuelle }
    : headerMotiv

  const eltern = dashboardElternroute(location.pathname)
  // Unter Android beendet Zurück sonst die App: eine Unterseite bekommt einen
  // eigenen Verlaufseintrag und führt zurück in ihre Liste.
  useZurueckSchliesst(Boolean(eltern), () => navigate(eltern ?? '/'))

  // Jede Seite beginnt oben; sonst erbt die nächste den Rollstand der vorigen.
  useEffect(() => {
    // `scrollTo` fehlt in jsdom; ohne den Test dort darf die Seite nicht brechen.
    inhaltRef.current?.scrollTo?.({ top: 0 })
  }, [location.pathname])

  return (
    <div className="relative isolate flex h-full min-h-0 w-full flex-col overflow-hidden">
      {/* Weicher atmosphärischer Tageszeit-Hintergrund geht direkt hinter die Menü-Punkte —
          auf der Server-Detailseite das Titelbild des Servers, sonst das Panorama */}
      <TageszeitHintergrund
        motiv={motiv}
        hoehe="h-[520px] sm:h-[580px] lg:h-[640px]"
        deckkraft="opacity-55"
        ebene="-z-10"
      />

      <RolePreviewBanner />

      {/* Freischwebende Menü-Reiter (Schwebe-Buttons) direkt über dem Hintergrund */}
      <DashboardReiter />

      <div
        ref={inhaltRef}
        className={`min-h-0 flex-1 flex flex-col relative z-10 ${
          location.pathname === '/' || location.pathname === '/servers' || location.pathname === '/admin/nodes'
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
                    <AdminNodes ohneHintergrund />
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
