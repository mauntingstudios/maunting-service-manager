import { Link, NavLink, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  Bot,
  CreditCard,
  LayoutDashboard,
  ReceiptText,
  Repeat,
  ShoppingBag,
  User,
} from 'lucide-react'
import { buttonClasses } from '@maunting/ui'
import { Avatar } from '@/components/app/Avatar'
import { useHasPermission } from '@/hooks/useHasPermission'
import { PANEL_HOME } from '@/lib/panelWege'
import { useAuthStore } from '@/stores/authStore'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'

const EINTRAEGE = [
  { to: '/konto/bestellungen', labelKey: 'shop.konto.nav.bestellungen', icon: ShoppingBag },
  { to: '/konto/rechnungen', labelKey: 'shop.konto.nav.rechnungen', icon: ReceiptText },
  { to: '/konto/zahlungsmethoden', labelKey: 'shop.konto.nav.zahlungsmethoden', icon: CreditCard },
  { to: '/konto/abos', labelKey: 'shop.konto.nav.abos', icon: Repeat },
  { to: '/konto/profil', labelKey: 'shop.konto.nav.profil', icon: User },
]

export function KontoRahmen() {
  const { t } = useTranslation()
  const user = useAuthStore((s) => s.user)
  const canUseAi = useHasPermission('ai.chat.use')
  const shopEnabled = usePublicSettingsStore((s) => s.shop_enabled)

  return (
    <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          {user && (
            <Avatar
              src={user.avatar_url}
              name={user.username}
              size="lg"
              className="shrink-0"
            />
          )}
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              {t('shop.konto.kicker')}
            </p>
            <h1 className="mt-0.5 truncate font-headline text-2xl font-extrabold text-on-surface sm:text-3xl">
              {user?.username || t('shop.konto.titel')}
            </h1>
            <p className="mt-0.5 truncate text-sm text-on-surface-variant">
              {user?.email || t('shop.konto.untertitel')}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canUseAi && (
            <Link to="/ai" className={buttonClasses('secondary', 'sm', 'gap-1.5')}>
              <Bot className="h-4 w-4 text-primary" aria-hidden="true" />
              {t('shop.kopf.kiChat')}
            </Link>
          )}
          <Link to={PANEL_HOME} className={buttonClasses('secondary', 'sm', 'gap-1.5')}>
            <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
            {t('shop.kopf.dashboard')}
          </Link>
        </div>
      </div>

      <nav className="mt-6 flex flex-wrap gap-2" aria-label={t('shop.konto.navigation')}>
        {EINTRAEGE.map(({ to, labelKey, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-semibold transition-colors ${
                isActive
                  ? 'border-primary/50 bg-primary/15 text-primary'
                  : 'border-outline-variant/40 bg-surface-container text-on-surface-variant hover:text-on-surface'
              }`
            }
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {t(labelKey)}
          </NavLink>
        ))}
      </nav>

      <div className="mt-6">
        <Outlet />
      </div>

      <div className="mt-8 flex flex-wrap gap-4 text-sm">
        {shopEnabled && (
          <Link to="/" className="inline-flex items-center gap-1 text-primary hover:underline">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {t('shop.konto.zurueck')}
          </Link>
        )}
        <Link to={PANEL_HOME} className="text-on-surface-variant hover:text-on-surface">
          {t('shop.konto.zumPanel')}
        </Link>
      </div>
    </section>
  )
}
