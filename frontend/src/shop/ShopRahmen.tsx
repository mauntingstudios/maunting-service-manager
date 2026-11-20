import { useEffect, useRef } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PANEL_HOME } from '@/lib/panelWege'
import { ShopKopf } from './ShopKopf'

export function ShopRahmen() {
  const { t } = useTranslation()
  const location = useLocation()
  const mainRef = useRef<HTMLElement>(null)

  useEffect(() => {
    mainRef.current?.focus()
    window.scrollTo({ top: 0 })
  }, [location.pathname])

  return (
    <div className="min-h-screen bg-background text-on-surface">
      <a
        href="#shop-inhalt"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-on-primary"
      >
        {t('shop.fuss.zumInhalt')}
      </a>

      <ShopKopf />

      <main id="shop-inhalt" ref={mainRef} tabIndex={-1} className="outline-none">
        <Outlet />
      </main>

      <footer className="border-t border-outline-variant/30">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-8 text-xs text-on-surface-variant sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>{t('shop.fuss.hinweis')}</p>
          <nav className="flex gap-4" aria-label={t('shop.fuss.navigation')}>
            <Link to="/privacy" className="hover:text-on-surface">
              {t('shop.fuss.datenschutz')}
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
