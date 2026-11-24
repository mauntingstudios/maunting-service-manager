import { Link, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LogIn } from 'lucide-react'
import { buttonClasses } from '@maunting/ui'
import { Logo } from '@/components/Logo'
import { Shell } from '@/components/layout/Shell'
import { ShopRahmen } from '@/shop/ShopRahmen'
import { useAuthStore } from '@/stores/authStore'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'

/**
 * Bindeglied zwischen Storefront, Panel und öffentlicher Lesehülle für `/news`:
 * - Bei aktivem Shop gilt die Storefront-Navigation (`ShopRahmen`), auch für Gäste.
 * - Im Self-Hosted-Betrieb erhalten angemeldete Benutzer ihre gewohnte `Shell`.
 * - Ungemeldete Besucher im Self-Hosted-Betrieb sehen eine kompakte Lesehülle.
 */
export function NewsWeiche() {
  const { t } = useTranslation()
  const shopEnabled = usePublicSettingsStore((s) => s.shop_enabled)
  const customBrand = usePublicSettingsStore((s) => s.branding?.custom_name || '')
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  if (shopEnabled) {
    return <ShopRahmen />
  }

  if (isAuthenticated) {
    return <Shell />
  }

  const brandName = customBrand || 'MSM'

  return (
    <div className="flex min-h-dvh flex-col bg-background text-on-surface">
      <header className="sticky top-0 z-30 border-b border-outline-variant/30 bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link to="/news" className="flex items-center gap-2.5">
            <Logo size="sm" />
            <span className="font-headline text-sm font-bold text-primary">{brandName}</span>
            <span className="text-xs font-medium text-on-surface-variant">/ {t('news.kicker')}</span>
          </Link>
          <Link to="/login" className={buttonClasses('primary', 'sm', 'gap-1.5')}>
            <LogIn className="h-4 w-4" aria-hidden="true" />
            <span>{t('shop.kopf.anmelden')}</span>
          </Link>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-outline-variant/30 bg-surface-container-low/50 py-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 text-xs text-on-surface-variant sm:px-6 lg:px-8">
          <span>{brandName}</span>
          <Link to="/privacy" className="hover:text-on-surface">
            {t('shop.fuss.datenschutz')}
          </Link>
        </div>
      </footer>
    </div>
  )
}
