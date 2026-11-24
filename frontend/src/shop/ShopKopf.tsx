import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Bot,
  LayoutDashboard,
  LogIn,
  LogOut,
  Menu,
  ReceiptText,
  Repeat,
  User as UserIcon,
  X,
} from 'lucide-react'
import { buttonClasses } from '@maunting/ui'
import { Logo } from '@/components/Logo'
import { ProfileDropdown, type ProfileDropdownItem } from '@/components/app/ProfileDropdown'
import { useHasPermission } from '@/hooks/useHasPermission'
import { PANEL_HOME } from '@/lib/panelWege'
import { useAuthStore } from '@/stores/authStore'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'

export function ShopKopf() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { isAuthenticated, user, logout } = useAuthStore()
  const canUseAi = useHasPermission('ai.chat.use')
  const shopEnabled = usePublicSettingsStore((s) => s.shop_enabled)
  const customBrand = usePublicSettingsStore((s) => s.branding?.custom_name || '')
  const shopBrandTitle = customBrand ? `${customBrand} Shop` : 'MSM Shop'
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const abmelden = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  const profileMenuItems: ProfileDropdownItem[] = [
    {
      key: 'konto-profil',
      label: t('shop.konto.nav.profil'),
      icon: <UserIcon className="h-4 w-4" />,
      onClick: () => navigate('/konto/profil'),
    },
    {
      key: 'konto-bestellungen',
      label: t('shop.konto.nav.bestellungen'),
      icon: <ReceiptText className="h-4 w-4" />,
      onClick: () => navigate('/konto/bestellungen'),
    },
    {
      key: 'konto-abos',
      label: t('shop.konto.nav.abos'),
      icon: <Repeat className="h-4 w-4" />,
      onClick: () => navigate('/konto/abos'),
    },
    ...(canUseAi
      ? [
          {
            key: 'ki-chat',
            label: t('shop.kopf.kiChat'),
            icon: <Bot className="h-4 w-4" />,
            onClick: () => navigate('/ai'),
          },
        ]
      : []),
    {
      key: 'dashboard',
      label: t('shop.kopf.dashboard'),
      icon: <LayoutDashboard className="h-4 w-4" />,
      onClick: () => navigate(PANEL_HOME),
    },
    {
      key: 'logout',
      label: t('nav.logout'),
      icon: <LogOut className="h-4 w-4" />,
      onClick: () => void abmelden(),
      tone: 'danger',
    },
  ]

  const navLinks = [
    {
      to: '/#shop-spiele',
      label: t('shop.kopf.spiele'),
      active: location.pathname === '/' && (location.hash === '' || location.hash === '#shop-spiele'),
    },
    {
      to: '/#shop-standorte',
      label: t('shop.kopf.standorte'),
      active: location.pathname === '/' && location.hash === '#shop-standorte',
    },
    {
      to: '/#shop-addons',
      label: t('shop.kopf.addons'),
      active: location.pathname === '/' && location.hash === '#shop-addons',
    },
    {
      to: '/news',
      label: t('shop.kopf.news'),
      active: location.pathname === '/news' || location.pathname.startsWith('/news/'),
    },
  ]

  return (
    <header className="sticky top-0 z-30 border-b border-outline-variant/25 bg-background/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-6">
          <Link
            to={shopEnabled ? '/' : PANEL_HOME}
            onClick={() => setMobileNavOpen(false)}
            className="flex shrink-0 items-center gap-2.5 rounded-lg focus-visible:ring-2 focus-visible:ring-primary/50"
            aria-label={t('shop.kopf.startseite')}
          >
            <Logo size="sm" />
            <span className="font-headline text-sm font-bold text-primary">{shopBrandTitle}</span>
          </Link>

          {shopEnabled && (
            <nav
              className="hidden items-center gap-1 rounded-full border border-white/10 bg-surface-container/60 p-1 text-sm font-medium text-on-surface-variant backdrop-blur-md md:flex"
              aria-label={t('shop.kopf.bereiche')}
            >
              {navLinks.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`rounded-full px-3.5 py-1.5 transition-colors ${
                    item.active
                      ? 'bg-primary/15 text-primary'
                      : 'hover:bg-white/10 hover:text-on-surface'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          )}
        </div>

        <nav className="flex items-center gap-2" aria-label={t('shop.kopf.navigation')}>
          {shopEnabled && (
            <button
              type="button"
              onClick={() => setMobileNavOpen((prev) => !prev)}
              aria-expanded={mobileNavOpen}
              aria-label={t('shop.kopf.menueOeffnen')}
              className="grid h-9 w-9 place-items-center rounded-full border border-outline-variant/35 bg-surface-container/75 text-on-surface-variant transition-colors hover:text-on-surface md:hidden"
            >
              {mobileNavOpen ? (
                <X className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Menu className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          )}

          {isAuthenticated ? (
            <>
              <Link to={PANEL_HOME} className={buttonClasses('secondary', 'sm', 'gap-1.5')}>
                <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">{t('shop.kopf.dashboard')}</span>
              </Link>
              <ProfileDropdown
                user={user}
                items={profileMenuItems}
                placement="bottom-right"
              />
            </>
          ) : (
            <>
              <Link to="/register" className={buttonClasses('ghost', 'sm', 'hidden sm:inline-flex')}>
                {t('shop.kopf.registrieren')}
              </Link>
              <Link to="/login" className={buttonClasses('primary', 'sm', 'gap-2')}>
                <LogIn className="h-4 w-4" aria-hidden="true" />
                {t('shop.kopf.anmelden')}
              </Link>
            </>
          )}
        </nav>
      </div>

      {shopEnabled && mobileNavOpen && (
        <div className="border-t border-outline-variant/25 bg-surface-container-high/95 px-4 py-3 shadow-lg backdrop-blur-xl md:hidden">
          <nav className="flex flex-col gap-1" aria-label={t('shop.kopf.bereiche')}>
            {navLinks.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setMobileNavOpen(false)}
                className={`rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                  item.active
                    ? 'bg-primary/15 text-primary'
                    : 'text-on-surface-variant hover:bg-white/5 hover:text-on-surface'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </header>
  )
}
