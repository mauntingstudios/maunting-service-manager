import { Link, NavLink, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, CreditCard, ReceiptText, Repeat, ShoppingBag } from 'lucide-react'
import { PANEL_HOME } from '@/lib/panelWege'

const EINTRAEGE = [
  { to: '/konto/bestellungen', labelKey: 'shop.konto.nav.bestellungen', icon: ShoppingBag },
  { to: '/konto/rechnungen', labelKey: 'shop.konto.nav.rechnungen', icon: ReceiptText },
  { to: '/konto/zahlungsmethoden', labelKey: 'shop.konto.nav.zahlungsmethoden', icon: CreditCard },
  { to: '/konto/abos', labelKey: 'shop.konto.nav.abos', icon: Repeat },
]

export function KontoRahmen() {
  const { t } = useTranslation()

  return (
    <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            {t('shop.konto.kicker')}
          </p>
          <h1 className="mt-1 font-headline text-3xl font-extrabold text-on-surface">
            {t('shop.konto.titel')}
          </h1>
          <p className="mt-1 text-sm text-on-surface-variant">{t('shop.konto.untertitel')}</p>
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
        <Link to="/" className="inline-flex items-center gap-1 text-primary hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t('shop.konto.zurueck')}
        </Link>
        <Link to={PANEL_HOME} className="text-on-surface-variant hover:text-on-surface">
          {t('shop.konto.zumPanel')}
        </Link>
      </div>
    </section>
  )
}
