import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LayoutDashboard, LogIn } from 'lucide-react'
import { buttonClasses } from '@maunting/ui'
import { Logo } from '@/components/Logo'
import { PANEL_HOME } from '@/lib/panelWege'
import { useAuthStore } from '@/stores/authStore'

export function ShopKopf() {
  const { t } = useTranslation()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  return (
    <header className="sticky top-0 z-30 border-b border-outline-variant/30 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link
          to="/"
          className="flex items-center gap-2 rounded-lg focus-visible:ring-2 focus-visible:ring-primary/50"
          aria-label={t('shop.kopf.startseite')}
        >
          <Logo size="sm" />
          <span className="font-headline text-sm font-bold text-primary">MSM Shop</span>
        </Link>

        <nav className="flex items-center gap-2" aria-label={t('shop.kopf.navigation')}>
          {isAuthenticated ? (
            <>
              <Link to="/konto/bestellungen" className={buttonClasses('ghost', 'sm')}>
                {t('shop.kopf.konto')}
              </Link>
              <Link to={PANEL_HOME} className={buttonClasses('secondary', 'sm', 'gap-2')}>
                <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
                {t('shop.kopf.dashboard')}
              </Link>
            </>
          ) : (
            <Link to="/login" className={buttonClasses('primary', 'sm', 'gap-2')}>
              <LogIn className="h-4 w-4" aria-hidden="true" />
              {t('shop.kopf.anmelden')}
            </Link>
          )}
        </nav>
      </div>
    </header>
  )
}
