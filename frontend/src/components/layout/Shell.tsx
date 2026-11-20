import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Topbar } from './Topbar'
import { DashboardReiter } from './DashboardReiter'
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
import { RolePreviewBanner } from '@/components/RolePreviewBanner'
import { TageszeitHintergrund } from './TageszeitHintergrund'
import { useTageszeitMotiv } from '@/lib/tageszeit'
import { useAufgeloestesServerWallpaper } from '@/stores/serverWallpaperStore'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'
import { useMessengerSperreBereitschaft } from '@/hooks/useMessengerSperre'
import { usePresenceAndActivity } from '@/hooks/usePresenceAndActivity'
import { MessengerHintergrund } from '@/browser/MessengerHintergrund'
import { chatIstOffen } from '@/lib/chatVollbild'
import { SmartcardWalletModal } from '@/desktop/vault/SmartcardWalletModal'
import { istDashboardRoute } from '@/desktop/dashboard/dashboardWege'
import { PANEL_HOME } from '@/lib/panelWege'

/** Was die Hülle ihren Seiten über den Outlet-Kontext mitteilt. */
export interface ShellOutletKontext {
  /** Die Hülle trägt das Bild; die Seite rendert keines (Dashboard-Routen). */
  ohneHintergrund: boolean
}

export function Shell() {
  useMessengerSperreBereitschaft()

  const socialEnabled = usePublicSettingsStore((s) => s.social_enabled)
  const [walletOpen, setWalletOpen] = useState(false)

  const { status: presenceStatus, effectiveStatus: presenceEffektiv, changeStatus: handlePresenceChange } = usePresenceAndActivity(socialEnabled, true)

  useEffect(() => {
    const handleOpenWallet = () => setWalletOpen(true)
    window.addEventListener('msm:open-wallet', handleOpenWallet)
    return () => window.removeEventListener('msm:open-wallet', handleOpenWallet)
  }, [])

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
  const zeigeDashboardReiter = istDashboardRoute(location.pathname)
  const zeigeSeitenhintergrund = !isFullHeightPage && !istHilfeOderRecht && !zeigeDashboardReiter
  const aktivesServerMotiv = useAufgeloestesServerWallpaper()
  const tageszeitMotiv = useTageszeitMotiv()
  const dashboardBasis = useTageszeitMotiv('dashboard')
  const seitenMotiv = aktivesServerMotiv ?? tageszeitMotiv
  const dashboardMotiv = aktivesServerMotiv ?? dashboardBasis

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
    // sichtbaren Bereich.
    //
    // Die Höhen stehen nirgends als Zahl: Kopfleiste und Reiterzeile sind
    // `shrink-0`-Geschwister, `main` nimmt den Rest (`flex-1`). So bricht keine
    // `calc`-Höhe, wenn eine Zeile wächst oder ein Banner erscheint.
    <div className={`bg-background text-on-surface flex flex-col relative isolate overflow-x-clip ${isFullHeightPage ? 'h-[100dvh] max-h-[100dvh] overflow-hidden' : 'min-h-screen'}`}>
      {/*
       * Das Bild der Server-Verwaltung ab der Oberkante, hinter Kopfleiste,
       * Reitern und Inhalt — wie in der MSS-App. Ohne es läge die
       * Reiterzeile auf flachem Grund und läse sich als dunkler Balken.
       * `isolate` hält die `-z-10`-Ebenen in dieser Wurzel.
       */}
      {zeigeDashboardReiter && (
        <TageszeitHintergrund
          motiv={dashboardMotiv}
          hoehe="h-[520px] sm:h-[580px] lg:h-[640px]"
          deckkraft="opacity-55"
          ebene="-z-10"
        />
      )}
      {!chatVollbild && (
        <Topbar
          onOpenWallet={() => setWalletOpen(true)}
          presenceStatus={presenceStatus}
          effectiveStatus={presenceEffektiv}
          onPresenceChange={handlePresenceChange}
        />
      )}
      {!chatVollbild && zeigeDashboardReiter && <DashboardReiter dashboardPath={PANEL_HOME} />}

      <OfflineBanner />
      <RolePreviewBanner />
      <CrossDeviceCallBanner />
      {/* Ohne `overflow-auto`: `main` hat als `flex-1` in einer Spalte ohne
          feste Höhe immer genau seine Inhaltshöhe, lief also nie über. Die
          Klasse hat nur einen Scroll-Container erzeugt, an dem sich die
          Klebeelemente der Seiten (Reiterleiste, Inhaltsverzeichnisse)
          vergeblich ausgerichtet haben. Breite Inhalte bringen ihr eigenes
          `overflow-x-auto` mit. Auf Vollhöhen-Seiten begrenzt `overflow-hidden`
          den Raum, in dem die Seite selbst rollt. */}
      <main className={`isolate relative flex flex-col flex-1 min-h-0 ${isFullHeightPage ? 'p-0 overflow-hidden' : 'p-margin-mobile md:p-margin-desktop'}`}>
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
            <Outlet context={{ ohneHintergrund: zeigeDashboardReiter } satisfies ShellOutletKontext} />
          </ErrorBoundary>
        </div>

        {!isFullHeightPage && <VersionFooter />}
      </main>

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
