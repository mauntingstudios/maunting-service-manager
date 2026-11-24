import { useState, useEffect, lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Shell } from './components/layout/Shell'
import { ProtectedRoute } from './components/ProtectedRoute'
import { PublicOnlyRoute } from './components/PublicOnlyRoute'
import { RequirePermission } from './components/RequirePermission'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ToastContainer } from '@/components/app/ToastContainer'
import { ConfirmDialog } from '@/components/app/ConfirmDialog'
import { PromptDialog } from '@/components/app/PromptDialog'
import { Loader } from '@/components/app/Loader'
import { SmartcardWalletModal } from './desktop/vault/SmartcardWalletModal'

function WalletRoute() {
  const navigate = useNavigate()
  return <SmartcardWalletModal isOpen={true} onClose={() => navigate(-1)} />
}

const SetupWizard = lazy(() => import('./pages/SetupWizard').then(module => ({ default: module.SetupWizard })))
const Login = lazy(() => import('./pages/Login').then(module => ({ default: module.Login })))
const Register = lazy(() => import('./pages/Register').then(module => ({ default: module.Register })))
const ForgotPassword = lazy(() => import('./pages/ForgotPassword').then(module => ({ default: module.ForgotPassword })))
const ResetPassword = lazy(() => import('./pages/ResetPassword').then(module => ({ default: module.ResetPassword })))
const LocalhostFreigabe = lazy(() => import('./pages/LocalhostFreigabe').then(module => ({ default: module.LocalhostFreigabe })))
const AiFreigabe = lazy(() => import('./pages/AiFreigabe').then(module => ({ default: module.AiFreigabe })))
const BrowserBestaetigung = lazy(() => import('./pages/BrowserBestaetigung').then(module => ({ default: module.BrowserBestaetigung })))
const Dashboard = lazy(() => import('./pages/Dashboard').then(module => ({ default: module.Dashboard })))
const Servers = lazy(() => import('./pages/Servers').then(module => ({ default: module.Servers })))
const Teams = lazy(() => import('./pages/Teams').then(module => ({ default: module.Teams })))
const ServerDetail = lazy(() => import('./pages/ServerDetail').then(module => ({ default: module.ServerDetail })))
const Users = lazy(() => import('./pages/Users').then(module => ({ default: module.Users })))
const Roles = lazy(() => import('./pages/Roles').then(module => ({ default: module.Roles })))
const Settings = lazy(() => import('./pages/Settings').then(module => ({ default: module.Settings })))
const AiProviders = lazy(() => import('./pages/settings/AiTab').then(module => ({ default: module.AiTab })))
const Profile = lazy(() => import('./pages/Profile').then(module => ({ default: module.Profile })))
const Docs = lazy(() => import('./pages/Docs').then(module => ({ default: module.Docs })))
const BlueprintsDocs = lazy(() => import('./pages/docs/BlueprintsDocs').then(module => ({ default: module.BlueprintsDocs })))
const OAuthDocs = lazy(() => import('./pages/docs/OAuthDocs').then(module => ({ default: module.OAuthDocs })))
const SelfHostingDocs = lazy(() => import('./pages/docs/SelfHostingDocs').then(module => ({ default: module.SelfHostingDocs })))
const HosterApiDocs = lazy(() => import('./pages/docs/HosterApiDocs').then(module => ({ default: module.HosterApiDocs })))
const Blueprints = lazy(() => import('./pages/Blueprints').then(module => ({ default: module.Blueprints })))
const PanelBackups = lazy(() => import('./pages/PanelBackups').then(module => ({ default: module.PanelBackups })))
const PanelDatabase = lazy(() => import('./pages/PanelDatabase').then(module => ({ default: module.PanelDatabase })))
const AdminNodes = lazy(() => import('./pages/AdminNodes').then(module => ({ default: module.AdminNodes })))
const AdminAudit = lazy(() => import('./pages/AdminAudit').then(module => ({ default: module.AdminAudit })))
const Privacy = lazy(() => import('./pages/Privacy').then(module => ({ default: module.Privacy })))
const Ai = lazy(() => import('./pages/Ai').then(module => ({ default: module.Ai })))
const Calendar = lazy(() => import('./pages/Calendar').then(module => ({ default: module.Calendar })))
const Notes = lazy(() => import('./pages/Notes').then(module => ({ default: module.Notes })))
const Messenger = lazy(() => import('./pages/Messenger').then(module => ({ default: module.Messenger })))
const Documents = lazy(() => import('./pages/Documents').then(module => ({ default: module.Documents })))
const DocumentShareClaim = lazy(() => import('./pages/DocumentShareClaim').then(module => ({ default: module.DocumentShareClaim })))
const Benutzerprofil = lazy(() => import('./pages/Benutzerprofil').then(module => ({ default: module.Benutzerprofil })))
const ShopWeiche = lazy(() => import('./shop/ShopWeiche').then(module => ({ default: module.ShopWeiche })))
const ShopRahmen = lazy(() => import('./shop/ShopRahmen').then(module => ({ default: module.ShopRahmen })))
const NewsWeiche = lazy(() => import('./pages/NewsWeiche').then(module => ({ default: module.NewsWeiche })))
const NewsOverview = lazy(() => import('./pages/NewsOverview').then(module => ({ default: module.NewsOverview })))
const NewsDetail = lazy(() => import('./pages/NewsDetail').then(module => ({ default: module.NewsDetail })))
const ShopStart = lazy(() => import('./shop/pages/ShopStart').then(module => ({ default: module.ShopStart })))
const ShopSpiel = lazy(() => import('./shop/pages/ShopSpiel').then(module => ({ default: module.ShopSpiel })))
const ShopKasse = lazy(() => import('./shop/pages/ShopKasse').then(module => ({ default: module.ShopKasse })))
const KontoWeiche = lazy(() => import('./shop/pages/konto/KontoWeiche').then(module => ({ default: module.KontoWeiche })))
const KontoBestellungen = lazy(() => import('./shop/pages/konto/KontoBestellungen').then(module => ({ default: module.KontoBestellungen })))
const KontoBestellungDetail = lazy(() => import('./shop/pages/konto/KontoBestellungDetail').then(module => ({ default: module.KontoBestellungDetail })))
const KontoRechnungen = lazy(() => import('./shop/pages/konto/KontoRechnungen').then(module => ({ default: module.KontoRechnungen })))
const KontoZahlungsmethoden = lazy(() => import('./shop/pages/konto/KontoZahlungsmethoden').then(module => ({ default: module.KontoZahlungsmethoden })))
const KontoAbos = lazy(() => import('./shop/pages/konto/KontoAbos').then(module => ({ default: module.KontoAbos })))
const KontoProfil = lazy(() => import('./shop/pages/konto/KontoProfil').then(module => ({ default: module.KontoProfil })))
import { apiUrl } from '@/config/api'
import { PANEL_HOME } from '@/lib/panelWege'
import { useAuthStore } from '@/stores/authStore'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'
import { PrivacyAcknowledgementNotice } from '@/components/app/PrivacyAcknowledgementNotice'
import { PrivacyNoticeVisibilityContext } from '@/components/app/PrivacyNoticeVisibility'
import { SupportWidgetLoader } from './components/SupportWidgetLoader'
import { initOfflineSync } from './lib/offlineSync'
import { cleanupPreloadUrlParam } from './lib/preloadSelbstheilung'
import { useKontoBundNachholen } from './hooks/useKontoBundNachholen'
import { SaisonDeko } from './season/SaisonDeko'

function App() {
  const location = useLocation()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const shopEnabled = usePublicSettingsStore((s) => s.shop_enabled)
  const calendarEnabled = usePublicSettingsStore((s) => s.calendar_enabled)
  const notesEnabled = usePublicSettingsStore((s) => s.notes_enabled)
  const docsEnabled = usePublicSettingsStore((s) => s.docs_enabled)
  const socialEnabled = usePublicSettingsStore((s) => s.social_enabled)
  const isNewsPath = location.pathname === '/news' || location.pathname.startsWith('/news/')
  const istShopRoute =
    location.pathname === '/' ||
    location.pathname.startsWith('/shop') ||
    location.pathname.startsWith('/konto') ||
    (shopEnabled && isNewsPath)
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null)
  const [setupEmailConfigured, setSetupEmailConfigured] = useState(false)
  const [privacyNoticeVisible, setPrivacyNoticeVisible] = useState(true)
  // Einzelne Felder statt des ganzen Stores: sonst zeichnete jede Änderung am
  // Benutzer (Avatar, Status) den ganzen Routenbaum samt Shell neu.

  // Der Konto-Schluessel wird auch ausserhalb des Messengers nachgeholt. Der
  // Lauf ist idempotent und still; er sendet nur an freigegebene Geraete.
  useKontoBundNachholen(isAuthenticated)

  useEffect(() => {
    cleanupPreloadUrlParam()
    void usePublicSettingsStore.getState().refresh()
    return initOfflineSync()
  }, [])

  useEffect(() => {
    fetch(apiUrl('/auth/setup-status'), { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        setSetupRequired(data.setup_required)
        setSetupEmailConfigured(Boolean(data.email_configured))
      })
      .catch(() => setSetupRequired(false))
  }, [])

  // Den Anmeldezustand einmal beim Start klären. Ohne das bliebe isAuthenticated bei
  // einem harten Reload auf /privacy dauerhaft false — die Route gewinnt gegen /*,
  // ProtectedRoute mountet nie und ein angemeldeter Benutzer sähe die Seite ohne Panel.
  useEffect(() => {
    void useAuthStore.getState().checkAuth()
  }, [])

  if (setupRequired === null) {
    return <Loader fullScreen label="Maunting Service Manager" />
  }

  if (setupRequired) {
    return (
      <Suspense fallback={
        <Loader fullScreen label="Maunting Service Manager" />
      }>
        <SetupWizard
          onComplete={() => setSetupRequired(false)}
          emailConfigured={setupEmailConfigured}
        />
      </Suspense>
    )
  }

  return (
    <PrivacyNoticeVisibilityContext.Provider value={privacyNoticeVisible}>
      <SaisonDeko />
      <ErrorBoundary>
      <Suspense fallback={
        <Loader fullScreen label="Maunting Service Manager" />
      }>
        <Routes>
        {/* Oeffentliche Storefront. Der Shop-Schalter entscheidet, ob sie
            sichtbar ist; aus = `/` fuehrt ins Panel. */}
        <Route path="/" element={<ShopWeiche />}>
          <Route index element={<ShopStart />} />
          <Route path="shop" element={<Navigate to="/" replace />} />
          <Route path="shop/:spielId" element={<ShopSpiel />} />
          <Route path="shop/:spielId/kasse" element={<ShopKasse />} />
          <Route path="shop/addon/:addonId/kasse" element={<ShopKasse />} />
        </Route>

        {/* Integriertes News-System für Storefront und Self-Hosted-Community */}
        <Route element={<NewsWeiche />}>
          <Route path="/news" element={<NewsOverview />} />
          <Route path="/news/:slug" element={<NewsDetail />} />
        </Route>

        {/* Kundenbereich bleibt fuer bestehende Abos/Rechnungen/Profil auch
            dann erreichbar, wenn die Storefront deaktiviert ist. */}
        <Route path="/konto" element={<ShopRahmen />}>
          <Route element={<KontoWeiche />}>
            <Route index element={<Navigate to="bestellungen" replace />} />
            <Route path="bestellungen" element={<KontoBestellungen />} />
            <Route path="bestellungen/:id" element={<KontoBestellungDetail />} />
            <Route path="rechnungen" element={<KontoRechnungen />} />
            <Route path="zahlungsmethoden" element={<KontoZahlungsmethoden />} />
            <Route path="abos" element={<KontoAbos />} />
            <Route path="profil" element={<KontoProfil />} />
          </Route>
        </Route>

        {/* Oeffentliche Auth-Routen — nur fuer nicht-eingeloggte User */}
        <Route path="/login" element={<PublicOnlyRoute><Login /></PublicOnlyRoute>} />
        <Route path="/register" element={<PublicOnlyRoute><Register /></PublicOnlyRoute>} />
        <Route path="/reset-password" element={<ResetPassword />} />
        {/* Einmal-Link per Mail (Befund 46): ohne `PublicOnlyRoute`, damit er
            auch bei offener Sitzung funktioniert. Das Token allein genügt
            nicht — die Sitzung muss weiter einem Admin gehören. */}
        <Route path="/localhost-freigabe" element={<LocalhostFreigabe />} />
        {/* Ohne Anmeldung, und ohne `PublicOnlyRoute`: der Link kommt per
            Mail und muss auch dann funktionieren, wenn im selben Browser
            noch eine Sitzung offen ist. Das Token im Pfad ist die ganze
            Berechtigung. */}
        <Route path="/ai/freigabe/:token" element={<AiFreigabe />} />
        {/* Passkey-Bestaetigung fuer die App. Ohne Anmeldung, den Menschen
            belegt der Passkey; die Kennung steht im Fragment. */}
        <Route path="/bestaetigen" element={<BrowserBestaetigung />} />
        <Route path="/forgot-password" element={<PublicOnlyRoute><ForgotPassword /></PublicOnlyRoute>} />
        
        {/* Oeffentliche Datenschutz-Route, wenn nicht eingeloggt */}
        {!isAuthenticated && <Route path="/privacy" element={<Privacy />} />}

        {/* Geschuetzte App-Routen */}
        <Route path="/*" element={<ProtectedRoute><Shell /></ProtectedRoute>}>
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="servers" element={<Servers />} />
          <Route path="servers/:id" element={<ServerDetail />} />
          <Route
            path="users"
            element={
              <RequirePermission routeKey="users">
                <Users />
              </RequirePermission>
            }
          />
          <Route
            path="roles"
            element={
              <RequirePermission routeKey="roles">
                <Roles />
              </RequirePermission>
            }
          />
          <Route
            path="settings"
            element={
              <RequirePermission routeKey="settings">
                <Settings />
              </RequirePermission>
            }
          />
          <Route
            path="admin/ai-providers"
            element={
              <RequirePermission routeKey="settings">
                <AiProviders />
              </RequirePermission>
            }
          />
          <Route path="profile" element={<Profile />} />
          <Route path="einstellungen" element={<Navigate to="/profile" replace />} />
          <Route
            path="calendar"
            element={
              calendarEnabled ? (
                <RequirePermission routeKey="calendar">
                  <Calendar />
                </RequirePermission>
              ) : (
                <Navigate to={PANEL_HOME} replace />
              )
            }
          />
          <Route
            path="notes"
            element={
              notesEnabled ? (
                <RequirePermission routeKey="notes">
                  <Notes />
                </RequirePermission>
              ) : (
                <Navigate to={PANEL_HOME} replace />
              )
            }
          />
          <Route
            path="dokumente"
            element={
              docsEnabled ? (
                <RequirePermission routeKey="dokumente">
                  <Documents />
                </RequirePermission>
              ) : (
                <Navigate to={PANEL_HOME} replace />
              )
            }
          />
          <Route
            path="dokumente/freigabe/:token"
            element={docsEnabled ? <DocumentShareClaim /> : <Navigate to={PANEL_HOME} replace />}
          />
          <Route
            path="dokumente/:uid"
            element={
              docsEnabled ? (
                <RequirePermission routeKey="dokumente">
                  <Documents />
                </RequirePermission>
              ) : (
                <Navigate to={PANEL_HOME} replace />
              )
            }
          />
          <Route path="social" element={<Navigate to="/profile" replace />} />
          <Route
            path="chat"
            element={
              socialEnabled ? (
                <RequirePermission routeKey="chat">
                  <Messenger />
                </RequirePermission>
              ) : (
                <Navigate to={PANEL_HOME} replace />
              )
            }
          />
          <Route
            path="chat/join/:inviteCode"
            element={
              socialEnabled ? (
                <RequirePermission routeKey="chat">
                  <Messenger />
                </RequirePermission>
              ) : (
                <Navigate to={PANEL_HOME} replace />
              )
            }
          />
          <Route path="messenger" element={<Navigate to={socialEnabled ? '/chat' : PANEL_HOME} replace />} />
          <Route
            path="user/:userId"
            element={
              socialEnabled ? (
                <RequirePermission routeKey="chat">
                  <Benutzerprofil />
                </RequirePermission>
              ) : (
                <Navigate to={PANEL_HOME} replace />
              )
            }
          />
          <Route path="ai" element={<RequirePermission routeKey="ai"><Ai /></RequirePermission>} />
          <Route path="teams" element={<Teams />} />
          <Route path="wallet" element={<WalletRoute />} />
          <Route path="docs" element={<RequirePermission routeKey="docs"><Docs /></RequirePermission>} />
          <Route path="docs/blueprints" element={<RequirePermission routeKey="docs"><BlueprintsDocs /></RequirePermission>} />
          <Route path="docs/oauth" element={<RequirePermission routeKey="docs"><OAuthDocs /></RequirePermission>} />
          <Route path="docs/self-hosting" element={<RequirePermission routeKey="docs"><SelfHostingDocs /></RequirePermission>} />
          <Route path="docs/hoster-api" element={<RequirePermission routeKey="docs"><HosterApiDocs /></RequirePermission>} />
          <Route path="privacy" element={<Privacy />} />
          <Route
            path="blueprints"
            element={
              <RequirePermission routeKey="blueprints">
                <Blueprints />
              </RequirePermission>
            }
          />
          <Route
            path="panel-backups"
            element={
              <RequirePermission routeKey="panelBackups">
                <PanelBackups />
              </RequirePermission>
            }
          />
          <Route
            path="panel-database"
            element={
              <RequirePermission routeKey="panelDatabase">
                <PanelDatabase />
              </RequirePermission>
            }
          />
          <Route
            path="admin/nodes"
            element={
              <RequirePermission routeKey="nodes">
                <AdminNodes />
              </RequirePermission>
            }
          />
          <Route
            path="admin/audit"
            element={
              <RequirePermission routeKey="audit">
                <AdminAudit />
              </RequirePermission>
            }
          />
          <Route path="*" element={<RequirePermission routeKey="missing-route" />} />
        </Route>
      </Routes>
      </Suspense>
      </ErrorBoundary>
      {!istShopRoute && <PrivacyAcknowledgementNotice onVisibilityChange={setPrivacyNoticeVisible} />}
      <SupportWidgetLoader enabled={istShopRoute ? true : !privacyNoticeVisible} />
      <ToastContainer />
      <ConfirmDialog />
      <PromptDialog />
    </PrivacyNoticeVisibilityContext.Provider>
  )
}

export default App
