import { useEffect, useRef, useSyncExternalStore } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LanguageSwitcher } from '@/components/app/LanguageSwitcher'
import { PanelPopupModal } from '@/components/popups/PanelPopupModal'
import { usePublicLegalSettings } from '@/hooks/usePublicLegalSettings'
import { PANEL_HOME } from '@/lib/panelWege'
import {
  isSupportWidgetActive,
  openSupportWidget,
  subscribeSupportWidgetState,
} from '@/lib/supportWidgetLoader'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'
import { ShopPromoBanner } from './components/ShopPromoBanner'
import { ShopKopf } from './ShopKopf'

function isSafeHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

export function ShopRahmen() {
  const { t } = useTranslation()
  const location = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const shopEnabled = usePublicSettingsStore((s) => s.shop_enabled)
  const customBrand = usePublicSettingsStore((s) => s.branding?.custom_name || '')
  const legal = usePublicLegalSettings()
  const rawImprint = legal.imprint_enabled ? legal.imprint_url.trim() : ''
  const imprintUrl =
    rawImprint.startsWith('/') && !rawImprint.startsWith('//')
      ? rawImprint
      : isSafeHttpUrl(rawImprint)
        ? rawImprint
        : ''
  const supportActive = useSyncExternalStore(
    subscribeSupportWidgetState,
    isSupportWidgetActive,
    () => false,
  )

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

      <footer className="mt-auto border-t border-outline-variant/30 bg-surface-container-low/50">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="grid gap-8 md:grid-cols-12">
            <div className="space-y-3 md:col-span-5">
              <p className="font-headline text-sm font-bold text-on-surface">
                {customBrand ? `${customBrand} Shop` : 'MSM Shop'}
              </p>
              <p className="max-w-sm text-xs leading-relaxed text-on-surface-variant">
                {customBrand
                  ? `${customBrand} · Bereitgestellt mit MSM von Maunting Studios`
                  : t('shop.fuss.hinweis')}
              </p>
              <div className="pt-1">
                <LanguageSwitcher />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6 text-xs text-on-surface-variant sm:grid-cols-3 md:col-span-7">
              <div className="space-y-2">
                <p className="font-headline text-xs font-semibold uppercase tracking-wider text-on-surface">
                  {t('shop.fuss.spalteProdukte')}
                </p>
                <ul className="space-y-1.5">
                  <li>
                    <Link to="/#shop-spiele" className="hover:text-on-surface">
                      {t('shop.kopf.spiele')}
                    </Link>
                  </li>
                  <li>
                    <Link to="/#shop-standorte" className="hover:text-on-surface">
                      {t('shop.kopf.standorte')}
                    </Link>
                  </li>
                  <li>
                    <Link to="/#shop-addons" className="hover:text-on-surface">
                      {t('shop.kopf.addons')}
                    </Link>
                  </li>
                </ul>
              </div>

              <div className="space-y-2">
                <p className="font-headline text-xs font-semibold uppercase tracking-wider text-on-surface">
                  {t('shop.fuss.spalteKonto')}
                </p>
                <ul className="space-y-1.5">
                  <li>
                    <Link to="/konto/bestellungen" className="hover:text-on-surface">
                      {t('shop.kopf.konto')}
                    </Link>
                  </li>
                  <li>
                    <Link to="/konto/abos" className="hover:text-on-surface">
                      {t('shop.konto.nav.abos')}
                    </Link>
                  </li>
                  <li>
                    <Link to="/news" className="hover:text-on-surface">
                      {t('shop.kopf.news')}
                    </Link>
                  </li>
                  <li>
                    <Link to={PANEL_HOME} className="hover:text-on-surface">
                      {t('shop.fuss.panel')}
                    </Link>
                  </li>
                </ul>
              </div>

              <nav className="space-y-2" aria-label={t('shop.fuss.navigation')}>
                <p className="font-headline text-xs font-semibold uppercase tracking-wider text-on-surface">
                  {t('shop.fuss.spalteRechtliches')}
                </p>
                <ul className="space-y-1.5">
                  <li>
                    <Link to="/privacy" className="hover:text-on-surface">
                      {t('shop.fuss.datenschutz')}
                    </Link>
                  </li>
                  {imprintUrl && (
                    <li>
                      {imprintUrl.startsWith('/') ? (
                        <Link to={imprintUrl} className="hover:text-on-surface">
                          {t('shop.fuss.impressum')}
                        </Link>
                      ) : (
                        <a
                          href={imprintUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="hover:text-on-surface"
                        >
                          {t('shop.fuss.impressum')}
                        </a>
                      )}
                    </li>
                  )}
                  {supportActive && (
                    <li>
                      <button
                        type="button"
                        onClick={() => openSupportWidget()}
                        className="hover:text-on-surface"
                      >
                        {t('shop.fuss.support')}
                      </button>
                    </li>
                  )}
                </ul>
              </nav>
            </div>
          </div>
        </div>
      </footer>
      <PanelPopupModal surface="shop" />
    </div>
  )
}
