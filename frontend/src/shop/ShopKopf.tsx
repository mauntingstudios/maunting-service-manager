import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Bot,
  LayoutDashboard,
  LogIn,
  LogOut,
  ReceiptText,
  Repeat,
  User as UserIcon,
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
  const { isAuthenticated, user, logout } = useAuthStore()
  const canUseAi = useHasPermission('ai.chat.use')
  const shopEnabled = usePublicSettingsStore((s) => s.shop_enabled)

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

  return (
    <header className="sticky top-0 z-30 border-b border-outline-variant/30 bg-background/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-6">
          <Link
            to={shopEnabled ? '/' : PANEL_HOME}
            className="flex shrink-0 items-center gap-2 rounded-lg focus-visible:ring-2 focus-visible:ring-primary/50"
            aria-label={t('shop.kopf.startseite')}
          >
            <Logo size="sm" />
            <span className="font-headline text-sm font-bold text-primary">MSM Shop</span>
          </Link>

          {shopEnabled && (
            <nav
              className="hidden items-center gap-4 text-sm font-medium text-on-surface-variant md:flex"
              aria-label={t('shop.kopf.bereiche')}
            >
              <Link to="/#shop-spiele" className="transition-colors hover:text-on-surface">
                {t('shop.kopf.spiele')}
              </Link>
              <Link to="/#shop-addons" className="transition-colors hover:text-on-surface">
                {t('shop.kopf.addons')}
              </Link>
            </nav>
          )}
        </div>

        <nav className="flex items-center gap-2" aria-label={t('shop.kopf.navigation')}>
          {isAuthenticated ? (
            <>
              {canUseAi && (
                <Link
                  to="/ai"
                  className={buttonClasses('ghost', 'sm', 'gap-1.5 text-primary hover:bg-primary/10')}
                >
                  <Bot className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden sm:inline">{t('shop.kopf.kiChat')}</span>
                </Link>
              )}
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
    </header>
  )
}
