import { useEffect, useRef } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PANEL_HOME } from '@/lib/panelWege'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'
import { ShopPromoBanner } from './components/ShopPromoBanner'
import { ShopKopf } from './ShopKopf'

export function ShopRahmen() {
  const { t } = useTranslation()
  const location = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const shopEnabled = usePublicSettingsStore((s) => s.shop_enabled)
  const customBrand = usePublicSettingsStore((s) => s.branding?.custom_name || '')

  useEffect(() => {
    mainRef.current?.focus()
    if (!location.hash) {
      window.scrollTo({ top: 0 })
    }
  }, [location.pathname, location.hash])

  return (
    <div className="flex min-h-dvh flex-col bg-background text-on-surface">
      <a
        href="#shop-inhalt"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-on-primary"
      >
        {t('shop.fuss.zumInhalt')}
      </a>

      {shopEnabled && <ShopPromoBanner />}
      <ShopKopf />

      <main id="shop-inhalt" ref={mainRef} tabIndex={-1} className="flex-1 outline-none">
        <Outlet />
      </main>

      <footer className="mt-auto border-t border-outline-variant/30 bg-surface-container-low/40">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-8 text-xs text-on-surface-variant sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>
            {customBrand
              ? `${customBrand} · Bereitgestellt mit MSM von Maunting Studios`
              : t('shop.fuss.hinweis')}
          </p>
          <nav className="flex flex-wrap gap-4" aria-label={t('shop.fuss.navigation')}>
            <Link to="/privacy" className="hover:text-on-surface">
              {t('shop.fuss.datenschutz')}
            </Link>
            <Link to="/konto/bestellungen" className="hover:text-on-surface">
              {t('shop.kopf.konto')}
            </Link>
            <Link to={PANEL_HOME} className="hover:text-on-surface">
              {t('shop.fuss.panel')}
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
