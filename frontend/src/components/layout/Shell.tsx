import { useEffect, useMemo, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { VersionFooter } from '@/components/VersionFooter'
import { AiRunNotice } from '@/components/ai/AiRunNotice'
import { ServerIncidentNotifier } from '@/components/notifications/ServerIncidentNotifier'
import { FreundschaftsWache } from '@/components/social/FreundschaftsWache'
import { PasskeyFernBestaetigung } from '@/components/PasskeyFernBestaetigung'
import { PanelPopupModal } from '@/components/popups/PanelPopupModal'
import { AnrufEbene } from '@/components/calling/AnrufEbene'
import { CrossDeviceCallBanner } from '@/components/calling/CrossDeviceCallBanner'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { OfflineBanner } from './OfflineBanner'
import { TageszeitHintergrund } from './TageszeitHintergrund'
import { headerHintergrundWaehlen } from '@/lib/tageszeit'
import { api } from '@/api/client'
import { useMessengerSperreBereitschaft } from '@/hooks/useMessengerSperre'
import { usePresenceAndActivity } from '@/hooks/usePresenceAndActivity'
import { MessengerHintergrund } from '@/browser/MessengerHintergrund'
import { chatIstOffen } from '@/lib/chatVollbild'
import { SmartcardWalletModal } from '@/desktop/vault/SmartcardWalletModal'

export function Shell() {
  useMessengerSperreBereitschaft()

  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false)
  const [sidebarHidden, setSidebarHidden] = useState(false)
  const [socialEnabled, setSocialEnabled] = useState(true)
  const [walletOpen, setWalletOpen] = useState(false)
  const mobileNavigationTriggerRef = useRef<HTMLButtonElement>(null)

  const { status: presenceStatus, effectiveStatus: presenceEffektiv, changeStatus: handlePresenceChange } = usePresenceAndActivity(socialEnabled, true)

  useEffect(() => {
    const handleOpenWallet = () => setWalletOpen(true)
    window.addEventListener('msm:open-wallet', handleOpenWallet)
    return () => window.removeEventListener('msm:open-wallet', handleOpenWallet)
  }, [])

  useEffect(() => {
    api<{ social_enabled?: boolean }>('/settings/public')
      .then((res) => {
        if (typeof res.social_enabled === 'boolean') {
          setSocialEnabled(res.social_enabled)
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const handleToggle = (e: Event) => {
      const custom = e as CustomEvent<{ hidden?: boolean }>
      setSidebarHidden(
        typeof custom.detail?.hidden === 'boolean'
          ? custom.detail.hidden
          : (prev) => !prev,
      )
    }
    window.addEventListener('msm:toggle-sidebar', handleToggle)
    return () => window.removeEventListener('msm:toggle-sidebar', handleToggle)
  }, [])

  useEffect(() => {
    if (!mobileNavigationOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        mobileNavigationTriggerRef.current?.focus()
        setMobileNavigationOpen(false)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [mobileNavigationOpen])

  const closeMobileNavigation = () => {
    mobileNavigationTriggerRef.current?.focus()
    setMobileNavigationOpen(false)
  }

  const location = useLocation()
  const isAiPage = location.pathname === '/ai' || location.pathname.startsWith('/ai')
  const isChatPage = location.pathname === '/chat' || location.pathname.startsWith('/chat')
  const isDocsPage = location.pathname === '/dokumente' || location.pathname.startsWith('/dokumente/')
  const isTeamsPage = location.pathname === '/teams' || location.pathname.startsWith('/teams')
  const isNotesPage = location.pathname === '/notes' || location.pathname === '/notizen'
  const isCalendarPage = location.pathname === '/calendar' || location.pathname === '/kalender'
  const isDashboardPage = location.pathname === '/' || location.pathname === '/dashboard'
  const isServersPage = location.pathname === '/servers'
  const isFullHeightPage =
    isAiPage ||
    isChatPage ||
    isDocsPage ||
    isTeamsPage ||
    isNotesPage ||
    isCalendarPage ||
    isDashboardPage ||
    isServersPage
  /*
   * Der offene Chat beginnt am Handy ganz oben: die eigene Kopfzeile der Hülle
   * fällt weg, der Chat-Kopf trägt den Zurück-Pfeil. Zurück führt in die Liste,
   * dort ist die Leiste wieder da.
   */
  const chatVollbild = isChatPage && chatIstOffen(location.search)

  /*
   * Dieselbe Tageszeit-Szene wie im Dashboard, aber für die Seiten, die keine
   * eigene Bühne mitbringen. Dashboard, Server, Teams, Notizen, Kalender, KI,
   * Messenger und der Dokumenteneditor haben ihren Hintergrund selbst; Hilfe
   * und Datenschutz bleiben ruhig. Bis 09.11.2026 fehlte das Bild auf Nodes,
   * Benutzern, Rollen, Audit, Einstellungen, Blueprints und den Panel-Seiten —
   * dort begann die Seite auf nacktem Grund, während die Nachbarseite die
   * Szene trug.
   */
  const istHilfeOderRecht = location.pathname === '/docs'
    || location.pathname.startsWith('/docs/')
    || location.pathname === '/privacy'
  const zeigeSeitenhintergrund = !isFullHeightPage && !istHilfeOderRecht
  const stunde = useMemo(() => new Date().getHours(), [])
  const seitenMotiv = useMemo(() => headerHintergrundWaehlen(stunde), [stunde])

  return (
    // `overflow-x-clip` statt `overflow-x-hidden`: `hidden` auf einer Achse
    // lässt die andere zu `auto` rechnen und macht diese Wurzel damit zum
    // Scroll-Container. Weil sie mit `min-h-screen` mitwächst, scrollt sie nie
    // — und jedes `position: sticky` darunter, allen voran `.msm-topbar`,
    // bekommt dadurch nie einen Versatz. `clip` klemmt den waagerechten
    // Überlauf genauso ab, erzeugt aber keinen Scroll-Container.
    //
    // `100dvh` statt `h-screen` auf den Vollhöhen-Seiten: `vh` rechnet am
    // Telefon mit der Höhe **ohne** eingefahrene Adressleiste und ist damit
    // größer als das, was man sieht. Im Messenger hieß das, dass die
    // Eingabeleiste unter den Bildschirmrand rutschte, sobald der Browser seine
    // Leiste einblendet — also genau beim Tippen. `dvh` folgt dem wirklich
    // sichtbaren Bereich. Die mobile Navigation unten macht es schon so.
    <div className={`bg-background text-on-surface flex relative overflow-x-clip ${isFullHeightPage ? 'h-[100dvh] max-h-[100dvh] overflow-hidden' : 'min-h-screen'}`}>
      {/* Sidebar */}
      {!sidebarHidden && (
        <Sidebar
          presenceStatus={presenceStatus}
          effectiveStatus={presenceEffektiv}
          onPresenceChange={handlePresenceChange}
        />
      )}

      {mobileNavigationOpen && (
        <div className="fixed inset-0 z-50 h-[100dvh] w-screen overflow-hidden lg:hidden" role="presentation" data-testid="mobile-navigation-layer">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            aria-hidden="true"
            onClick={closeMobileNavigation}
          />
          <Sidebar
            mobile
            onNavigate={closeMobileNavigation}
            presenceStatus={presenceStatus}
            effectiveStatus={presenceEffektiv}
            onPresenceChange={handlePresenceChange}
          />
        </div>
      )}

      {/* Main Content Area */}
      <div className={`flex-1 ${sidebarHidden ? 'ml-0' : 'lg:ml-60'} flex flex-col min-w-0 relative z-10 transition-all duration-300 ${isFullHeightPage ? 'h-[100dvh] max-h-[100dvh] overflow-hidden' : ''}`}>
        {!chatVollbild && (
          <Topbar
            menuButtonRef={mobileNavigationTriggerRef}
            onOpenNavigation={() => setMobileNavigationOpen(true)}
            onOpenWallet={() => setWalletOpen(true)}
          />
        )}
        <OfflineBanner />
        <CrossDeviceCallBanner />
        {/* Ohne `overflow-auto`: `main` hat als `flex-1` in einer Spalte ohne
            feste Höhe immer genau seine Inhaltshöhe, lief also nie über. Die
            Klasse hat nur einen Scroll-Container erzeugt, an dem sich die
            Klebeelemente der Seiten (Reiterleiste, Inhaltsverzeichnisse)
            vergeblich ausgerichtet haben. Breite Inhalte bringen ihr eigenes
            `overflow-x-auto` mit. */}
        <main className={`isolate flex-1 relative flex flex-col min-h-0 ${isFullHeightPage ? `p-0 overflow-hidden ${chatVollbild ? '' : 'h-[calc(100dvh-3rem)] max-h-[calc(100dvh-3rem)] lg:h-[100dvh] lg:max-h-[100dvh]'}` : 'p-margin-mobile md:p-margin-desktop'}`}>
          {zeigeSeitenhintergrund && (
            <TageszeitHintergrund
              motiv={seitenMotiv}
              hoehe="h-[420px] sm:h-[520px] lg:h-[600px]"
              deckkraft="opacity-45"
              ebene="-z-10"
            />
          )}
          <div className={`relative z-10 flex-1 w-full flex flex-col min-h-0 ${isFullHeightPage ? 'h-full overflow-hidden' : ''}`}>
            <ErrorBoundary key={location.pathname} compact>
              <Outlet />
            </ErrorBoundary>
          </div>

          {!isFullHeightPage && <VersionFooter />}
        </main>
      </div>

      {/* Meldet unten rechts, wenn ein KI-Auftrag fertig ist oder wartet —
          auf jeder Seite. Der Gegenwert dazu, dass die KI im Hintergrund
          weiterarbeitet: sonst muesste man den Chat offen lassen, also genau
          das tun, was nicht mehr noetig sein soll. */}
      <AiRunNotice />

      {/* Push- & Pop-up-Benachrichtigungen bei Server-Vorfällen & Kalender-Erinnerungen */}
      <ServerIncidentNotifier />
      <FreundschaftsWache />
      <PasskeyFernBestaetigung />
      {socialEnabled && !isChatPage && <MessengerHintergrund />}

      {/* Aktive Pop-ups / Ankündigungen des Panels */}
      <PanelPopupModal />

      {/* Anruf-Overlay für Direkt- und Gruppenanrufe (global im Shell verfügbar) */}
      <AnrufEbene />

      {/* Vollbild Smartcard-Wallet-Modus für Mobilgeräte */}
      <SmartcardWalletModal isOpen={walletOpen} onClose={() => setWalletOpen(false)} />
    </div>
  )
}
