/**
 * Die Hilfe in der App: dieselben Dokumentationsseiten wie im Web-Panel.
 *
 * Gerendert werden die Komponenten aus `pages/` und `pages/docs/`; es gibt
 * keine zweite Fassung der Texte. Die Routen sind dieselben wie im Panel,
 * damit Links in den Dokumenten unverändert funktionieren.
 */
import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'

import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Loader } from '@/components/app/Loader'

const Docs = lazy(() => import('@/pages/Docs').then((modul) => ({ default: modul.Docs })))
const BlueprintsDocs = lazy(() => import('@/pages/docs/BlueprintsDocs').then((modul) => ({ default: modul.BlueprintsDocs })))
const OAuthDocs = lazy(() => import('@/pages/docs/OAuthDocs').then((modul) => ({ default: modul.OAuthDocs })))
const SelfHostingDocs = lazy(() => import('@/pages/docs/SelfHostingDocs').then((modul) => ({ default: modul.SelfHostingDocs })))
const HosterApiDocs = lazy(() => import('@/pages/docs/HosterApiDocs').then((modul) => ({ default: modul.HosterApiDocs })))

export function istHilfeRoute(pathname: string): boolean {
  return pathname === '/docs' || pathname.startsWith('/docs/')
}

export function HilfeBereich() {
  const location = useLocation()

  return (
    <div className="h-full min-h-0 w-full overflow-y-auto overscroll-contain pb-8">
      <ErrorBoundary key={location.pathname} compact>
        <Suspense
          fallback={
            <div className="flex min-h-64 items-center justify-center">
              <Loader label="Maunting Service Manager" />
            </div>
          }
        >
          <Routes>
            <Route path="/docs" element={<Docs />} />
            <Route path="/docs/blueprints" element={<BlueprintsDocs />} />
            <Route path="/docs/oauth" element={<OAuthDocs />} />
            <Route path="/docs/self-hosting" element={<SelfHostingDocs />} />
            <Route path="/docs/hoster-api" element={<HosterApiDocs />} />
            <Route path="*" element={<Navigate to="/docs" replace />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </div>
  )
}
