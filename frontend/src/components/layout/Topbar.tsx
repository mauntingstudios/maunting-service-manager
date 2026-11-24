import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, CreditCard, ExternalLink, LifeBuoy, LogOut, Menu, Newspaper, ReceiptText, ShieldCheck, ShoppingBag, User as UserIcon, X } from 'lucide-react'
import { Blatteintrag, Blattmenue, Kurzinfo } from '@maunting/ui'
import { newsApi } from '@/api/news'
import { still } from '@/lib/still'
import { Avatar } from '@/components/app/Avatar'
import { Logo } from '@/components/Logo'
import { ProfileDropdown, type ProfileDropdownItem } from '@/components/app/ProfileDropdown'
import { BenachrichtigungsGlocke } from '@/components/notifications/BenachrichtigungsGlocke'
import { usePanelNavigation } from './usePanelNavigation'
import { BrowserDownloadBadge } from './BrowserDownloadBadge'
import { DesktopAppDownloadBadge } from './DesktopAppDownloadBadge'
import { dashboardElternroute, dashboardTitelKey, istDashboardRoute } from '@/desktop/dashboard/dashboardWege'
import { useHasPermission } from '@/hooks/useHasPermission'
import { PANEL_HOME } from '@/lib/panelWege'
import {
  isSupportWidgetActive,
  openSupportWidget,
  subscribeSupportWidgetState,
} from '@/lib/supportWidgetLoader'
import { useAuthStore } from '@/stores/authStore'
import { useMessengerNotificationStore } from '@/stores/messengerNotificationStore'
import { useTeamInvitationStore } from '@/stores/teamInvitationStore'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'
import type { EffectivePresenceStatus, PresenceStatus } from '@/hooks/usePresenceAndActivity'

interface TopbarProps {
  onOpenWallet?: () => void
  presenceStatus?: PresenceStatus
  effectiveStatus?: EffectivePresenceStatus
  onPresenceChange?: (status: PresenceStatus) => void
}

/**
 * Die Bereiche der mittleren Reiterleiste, in fester Reihenfolge. Sichtbarkeit
 * und Rechte kommen aus `usePanelNavigation` — ein Bereich ohne Eintrag dort
 * erscheint auch hier nicht. Der Tresor bleibt bewusst außen vor: er ist
 * MSS-only und hat im Web keine Route.
 */
const BEREICH_REIHENFOLGE = [PANEL_HOME, '/ai', '/chat', '/calendar', '/notes', '/dokumente', '/teams', '/docs']

function bereichAktiv(to: string, pathname: string): boolean {
  if (to === PANEL_HOME) return istDashboardRoute(pathname)
  switch (to) {
    case '/ai':
      return pathname === '/ai' || pathname.startsWith('/ai/')
    case '/chat':
      return pathname === '/chat' || pathname.startsWith('/chat/') || pathname.startsWith('/user/') || pathname === '/messenger' || pathname.startsWith('/messenger/')
    case '/calendar':
      return pathname === '/calendar' || pathname === '/kalender'
    case '/notes':
      return pathname === '/notes' || pathname === '/notizen'
    case '/dokumente':
      return pathname === '/dokumente' || pathname.startsWith('/dokumente/')
    case '/teams':
      return pathname === '/teams' || pathname.startsWith('/teams/')
    case '/docs':
      return pathname === '/docs' || pathname.startsWith('/docs/')
    default:
      return false
  }
}

/**
 * Die Kopfleiste des Web-Panels: Marke und Bereichstitel links, die Bereiche
 * als Reiter in der Mitte, Downloads, Glocke und Profil rechts. Dieselbe
 * Anmutung wie die Kopfzeile der MSS-App, nur mit den Routen des Panels.
 */
export function Topbar({ onOpenWallet, presenceStatus: propPresenceStatus, effectiveStatus: propEffectiveStatus, onPresenceChange }: TopbarProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout } = useAuthStore()

  const { items: navItems, isOnline } = usePanelNavigation(PANEL_HOME)
  const canUseMessenger = useHasPermission('messenger.use')
  const socialEnabled = usePublicSettingsStore((s) => s.social_enabled)
  const canAccessSocial = socialEnabled && canUseMessenger
  const canViewOperatorDocs = navItems.some((eintrag) => eintrag.to === '/docs')
  const supportActive = useSyncExternalStore(
    subscribeSupportWidgetState,
    isSupportWidgetActive,
    () => false,
  )
  const totalMessengerUnread = useMessengerNotificationStore((s) => s.totalUnreadCount)
  const teamInvitationCount = useTeamInvitationStore((s) => s.count)
  const teamInvitationenLaden = useTeamInvitationStore((s) => s.laden)
  const shopEnabled = usePublicSettingsStore((s) => s.shop_enabled)
  const externalShopUrl = usePublicSettingsStore((s) => s.external_shop_url)
  const customBrand = usePublicSettingsStore((s) => s.branding?.custom_name || '')
  const brandMarkText = customBrand || 'MSM'
  const [blattOffen, setBlattOffen] = useState(false)
  const canManageNews =
    useHasPermission('panel.news.manage') ||
    useHasPermission('panel.settings.write') ||
    useHasPermission('shop.write')
  const [publishedNewsCount, setPublishedNewsCount] = useState(0)

  // Die Hülle meldet die Präsenz; ein zweiter Melder schriebe bei jedem
  // Routenwechsel doppelt.
  const presenceStatus = propPresenceStatus ?? 'auto'
  const handlePresenceChange = onPresenceChange ?? (() => {})

  useEffect(() => {
    if (!isOnline || typeof newsApi?.getSummary !== 'function') return
    let aktiv = true
    newsApi
      .getSummary()
      .then((res) => {
        if (aktiv && typeof res?.published_count === 'number') {
          setPublishedNewsCount(res.published_count)
        }
      })
      .catch((err) => {
        still(err, 'Topbar.newsSummary')
      })
    return () => {
      aktiv = false
    }
  }, [isOnline])

  const showNewsLink = publishedNewsCount > 0 || canManageNews

  useEffect(() => {
    if (!isOnline) return
    void teamInvitationenLaden()
    const beimFokus = () => void teamInvitationenLaden()
    const beimSichtbarwerden = () => {
      if (document.visibilityState === 'visible') void teamInvitationenLaden()
    }
    window.addEventListener('focus', beimFokus)
    document.addEventListener('visibilitychange', beimSichtbarwerden)
    return () => {
      window.removeEventListener('focus', beimFokus)
      document.removeEventListener('visibilitychange', beimSichtbarwerden)
    }
  }, [isOnline, teamInvitationenLaden])

  const handleLogout = async () => {
    setBlattOffen(false)
    await logout()
    navigate('/login', { replace: true })
  }

  const profileMenuItems: ProfileDropdownItem[] = [
    ...(shopEnabled
      ? [
          {
            key: 'shop',
            label: t('shop.kopf.zumShop'),
            icon: <ShoppingBag className="h-4 w-4" />,
            onClick: () => navigate('/'),
          },
          {
            key: 'konto',
            label: t('shop.kopf.konto'),
            icon: <ReceiptText className="h-4 w-4" />,
            onClick: () => navigate('/konto/bestellungen'),
          },
        ]
      : externalShopUrl
        ? [
            {
              key: 'external-shop',
              label: t('shop.kopf.zumShop'),
              icon: <ExternalLink className="h-4 w-4" />,
              onClick: () => {
                window.open(externalShopUrl, '_blank', 'noopener,noreferrer')
              },
            },
          ]
        : []),
    ...(showNewsLink
      ? [
          {
            key: 'news',
            label: t('nav.news'),
            icon: <Newspaper className="h-4 w-4" />,
            onClick: () => navigate('/news'),
          },
        ]
      : []),
    ...(canViewOperatorDocs
      ? []
      : [
          {
            key: 'privacy',
            label: t('shop.fuss.datenschutz'),
            icon: <ShieldCheck className="h-4 w-4" />,
            onClick: () => navigate('/privacy'),
          },
          ...(supportActive
            ? [
                {
                  key: 'support',
                  label: t('nav.support'),
                  icon: <LifeBuoy className="h-4 w-4" />,
                  onClick: () => {
                    openSupportWidget()
                  },
                },
              ]
            : []),
        ]),
    {
      key: 'profile',
      label: t('profile.title'),
      icon: <UserIcon className="h-4 w-4" />,
      onClick: () => navigate('/profile'),
    },
    {
      key: 'logout',
      label: t('nav.logout'),
      icon: <LogOut className="h-4 w-4" />,
      onClick: () => void handleLogout(),
      tone: 'danger',
    },
  ]

  const bereiche = BEREICH_REIHENFOLGE.map((pfad) => navItems.find((eintrag) => eintrag.to === pfad)).filter((eintrag) => eintrag !== undefined)
  const aktiverBereich = bereiche.find((eintrag) => bereichAktiv(eintrag.to, location.pathname))
  const kopfTitel = istDashboardRoute(location.pathname)
    ? t(dashboardTitelKey(location.pathname))
    : (aktiverBereich?.label ?? (location.pathname === '/profile' ? t('profile.title') : brandMarkText))
  const eltern = dashboardElternroute(location.pathname)

  const badgeFuer = (to: string): number | undefined => {
    if (to === '/chat') return totalMessengerUnread > 0 ? totalMessengerUnread : undefined
    if (to === '/teams') return teamInvitationCount > 0 ? teamInvitationCount : undefined
    return undefined
  }

  return (
    <>
      <header className="msm-topbar sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-2 border-b-0 bg-surface-container px-3 sm:px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-2">
          {eltern && (
            <Kurzinfo text={t('common.back')} seite="anfang">
              <button
                type="button"
                onClick={() => navigate(eltern)}
                aria-label={t('common.back')}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-outline-variant/40 bg-surface-container-low text-on-surface transition-colors hover:bg-surface-container max-sm:min-h-11 max-sm:min-w-11"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              </button>
            </Kurzinfo>
          )}
          <div className="flex min-w-0 items-center gap-2">
            <Logo size="sm" />
            <span className="hidden max-w-[10rem] truncate font-headline text-sm font-bold text-primary min-[400px]:inline">{brandMarkText}</span>
            <h1 className="hidden truncate font-headline text-base font-bold text-on-surface sm:block">{kopfTitel}</h1>
          </div>
        </div>

        <nav
          className="hidden min-w-0 items-center rounded-xl border border-outline-variant/30 bg-surface-container-low/60 p-1 backdrop-blur-sm md:flex"
          aria-label={t('mss.app.bereiche')}
        >
          {bereiche.map((eintrag) => {
            const badge = badgeFuer(eintrag.to)
            return (
              <Reiter
                key={eintrag.to}
                aktiv={bereichAktiv(eintrag.to, location.pathname)}
                onClick={() => navigate(eintrag.to)}
                icon={<eintrag.icon className="h-4 w-4 shrink-0" />}
                label={eintrag.label}
                badge={badge}
                pulse={badge !== undefined}
              />
            )
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {shopEnabled && (
            <button
              type="button"
              onClick={() => navigate('/')}
              className="hidden h-8 items-center gap-1.5 rounded-lg border border-outline-variant/40 bg-surface-container-low/80 px-2.5 text-xs font-semibold text-on-surface transition-colors hover:border-primary/40 hover:text-primary sm:inline-flex"
            >
              <ShoppingBag className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t('shop.kopf.shopLink')}</span>
            </button>
          )}
          {!shopEnabled && externalShopUrl && (
            <a
              href={externalShopUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden h-8 items-center gap-1.5 rounded-lg border border-outline-variant/40 bg-surface-container-low/80 px-2.5 text-xs font-semibold text-on-surface transition-colors hover:border-primary/40 hover:text-primary sm:inline-flex"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t('shop.kopf.shopLink')}</span>
            </a>
          )}
          <div className="hidden items-center gap-1.5 lg:flex">
            <BrowserDownloadBadge />
            <DesktopAppDownloadBadge />
          </div>

          <BenachrichtigungsGlocke placement="bottom" align="right" />

          <ProfileDropdown
            user={user}
            items={profileMenuItems}
            placement="bottom-right"
            status={canAccessSocial ? presenceStatus : undefined}
            onStatusChange={canAccessSocial ? handlePresenceChange : undefined}
            effectiveStatus={canAccessSocial ? propEffectiveStatus : undefined}
          />

          <button
            type="button"
            onClick={() => setBlattOffen((offen) => !offen)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-outline-variant/30 bg-surface-container-high/85 text-on-surface shadow-sm backdrop-blur-md transition-all hover:bg-surface-container-high hover:text-primary active:scale-95 sm:h-9 sm:w-9 md:hidden"
            aria-label={t('mss.app.menueOeffnen')}
            aria-expanded={blattOffen}
          >
            {blattOffen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </header>

      <Blattmenue offen={blattOffen} onSchliessen={() => setBlattOffen(false)} titel={t('shell.mainNavigation')}>
        <div className="px-4 pb-6">
          <div className="flex items-center justify-between gap-3 border-b border-outline-variant/30 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar src={user?.avatar_url} name={user?.username} size="md" />
              <div className="min-w-0">
                <span className="block truncate font-headline text-sm font-semibold text-on-surface">{user?.username}</span>
                <p className="truncate text-xs text-on-surface-variant">{user?.email}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setBlattOffen(false)}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-container-high/80 text-on-surface-variant transition-colors hover:text-on-surface"
              aria-label={t('shell.closeNavigation')}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <nav aria-label={t('mss.app.bereiche')} className="grid grid-cols-2 gap-2 py-3">
            {bereiche.map((eintrag) => {
              const aktiv = bereichAktiv(eintrag.to, location.pathname)
              const badge = badgeFuer(eintrag.to)
              const Icon = eintrag.icon
              return (
                <button
                  key={eintrag.to}
                  type="button"
                  onClick={() => { navigate(eintrag.to); setBlattOffen(false) }}
                  aria-current={aktiv ? 'page' : undefined}
                  className={`flex min-h-12 flex-col items-start justify-center gap-1.5 rounded-2xl border p-3 text-left transition-all active:scale-95 ${
                    aktiv
                      ? 'border-primary/40 bg-primary/15 text-primary shadow-sm'
                      : 'border-outline-variant/25 bg-surface-container/70 text-on-surface hover:bg-surface-container-high'
                  }`}
                >
                  <span className="flex w-full items-center justify-between gap-2">
                    <span className={`grid h-9 w-9 place-items-center rounded-xl ${aktiv ? 'bg-primary/20 text-primary' : 'bg-surface-container-high text-on-surface-variant'}`}>
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    {badge !== undefined && (
                      <span className="inline-flex items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-label-sm font-bold text-on-primary">
                        {badge > 99 ? '99+' : badge}
                      </span>
                    )}
                  </span>
                  <span className="w-full truncate text-xs font-semibold">{eintrag.label}</span>
                </button>
              )
            })}
          </nav>

          <div className="border-t border-outline-variant/30 py-1">
            {shopEnabled && (
              <>
                <Blatteintrag
                  icon={<ShoppingBag className="h-4 w-4" aria-hidden="true" />}
                  label={t('shop.kopf.zumShop')}
                  onClick={() => { setBlattOffen(false); navigate('/') }}
                />
                <Blatteintrag
                  icon={<ReceiptText className="h-4 w-4" aria-hidden="true" />}
                  label={t('shop.kopf.konto')}
                  onClick={() => { setBlattOffen(false); navigate('/konto/bestellungen') }}
                />
              </>
            )}
            {!shopEnabled && externalShopUrl && (
              <Blatteintrag
                icon={<ExternalLink className="h-4 w-4" aria-hidden="true" />}
                label={t('shop.kopf.zumShop')}
                onClick={() => {
                  setBlattOffen(false)
                  window.open(externalShopUrl, '_blank', 'noopener,noreferrer')
                }}
              />
            )}
            <BrowserDownloadBadge variante="zeile" />
            <DesktopAppDownloadBadge variante="zeile" />
            {!canViewOperatorDocs && (
              <>
                <Blatteintrag
                  icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
                  label={t('shop.fuss.datenschutz')}
                  onClick={() => { setBlattOffen(false); navigate('/privacy') }}
                />
                {supportActive && (
                  <Blatteintrag
                    icon={<LifeBuoy className="h-4 w-4" aria-hidden="true" />}
                    label={t('nav.support')}
                    onClick={() => { setBlattOffen(false); openSupportWidget() }}
                  />
                )}
              </>
            )}
            {onOpenWallet && (
              <Blatteintrag
                icon={<CreditCard className="h-4 w-4" aria-hidden="true" />}
                label={t('mss.vault.walletModus', 'Smartcard-Wallet')}
                onClick={() => { setBlattOffen(false); onOpenWallet() }}
              />
            )}
            {showNewsLink && (
              <Blatteintrag
                icon={<Newspaper className="h-4 w-4" aria-hidden="true" />}
                label={t('nav.news')}
                onClick={() => { setBlattOffen(false); navigate('/news') }}
              />
            )}
            <Blatteintrag
              icon={<LogOut className="h-4 w-4" aria-hidden="true" />}
              label={t('nav.logout')}
              onClick={() => void handleLogout()}
              gefahr
            />
          </div>
        </div>
      </Blattmenue>
    </>
  )
}

/**
 * Ein Reiter der mittleren Leiste: ruhiges Segment, der aktive hebt sich weich
 * ab. Ohne `xl` steht bei inaktiven Reitern nur das Symbol; die Kurzinfo nennt
 * dann den Namen. Gespiegelt aus der MSS-App (`DesktopApp`), damit beide
 * Oberflächen dieselbe Anmutung tragen.
 */
function Reiter({
  aktiv,
  onClick,
  label,
  icon,
  badge,
  pulse,
}: {
  aktiv: boolean
  onClick: () => void
  label: string
  icon?: ReactNode
  badge?: number
  pulse?: boolean
}) {
  return (
    <Kurzinfo text={label} className={aktiv ? '!hidden' : 'xl:!hidden'}>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={aktiv}
        aria-label={label}
        data-mss-reiter={aktiv ? 'aktiv' : undefined}
        className={`group relative flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all ${
          aktiv
            ? 'bg-surface-container-high text-primary shadow-sm font-semibold'
            : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/40'
        }`}
      >
        <div className="relative flex items-center justify-center">
          {icon}
          {pulse && (
            <span className="absolute -top-1 -right-1 flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
            </span>
          )}
        </div>
        <span className={aktiv ? 'inline' : 'hidden xl:inline'}>{label}</span>
        {badge !== undefined && badge > 0 && (
          <span className="ml-0.5 inline-flex items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-label-sm font-bold text-on-primary">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </button>
    </Kurzinfo>
  )
}
