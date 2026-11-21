import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy, TicketPercent, X } from 'lucide-react'
import { Badge, Button } from '@maunting/ui'
import { shopCatalogApi, type ShopPublicBannerPromo } from '@/api/shop'
import { still } from '@/lib/still'
import { formatEuro } from '../preis'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'

const DISMISS_PREFIX = 'msm_shop_promo_dismissed:'

function istImCooldown(code: string, cooldownHours: number): boolean {
  if (cooldownHours <= 0 || typeof window === 'undefined') return false
  try {
    const raw = window.localStorage.getItem(`${DISMISS_PREFIX}${code}`)
    if (!raw) return false
    const dismissedAt = Number(raw)
    if (!Number.isFinite(dismissedAt)) return false
    return Date.now() - dismissedAt < cooldownHours * 3_600_000
  } catch (err) {
    still(err, 'shopPromoBanner.cooldownRead')
    return false
  }
}

export function ShopPromoBanner() {
  const { t } = useTranslation()
  const shopEnabled = usePublicSettingsStore((s) => s.shop_enabled)
  const [banner, setBanner] = useState<ShopPublicBannerPromo | null>(null)
  const [ausgeblendet, setAusgeblendet] = useState(false)
  const [kopiert, setKopiert] = useState(false)

  useEffect(() => {
    if (!shopEnabled) {
      setBanner(null)
      return
    }
    const fetchPromos = shopCatalogApi.getPromos
    if (!fetchPromos) return
    let aktiv = true
    void fetchPromos()
      .then((res) => {
        if (!aktiv) return
        const b = res?.banner ?? null
        if (!b || istImCooldown(b.code, b.cooldown_hours)) {
          setBanner(null)
        } else {
          setBanner(b)
        }
      })
      .catch(() => {
        if (aktiv) setBanner(null)
      })
    return () => {
      aktiv = false
    }
  }, [shopEnabled])

  if (!shopEnabled || !banner || ausgeblendet) return null

  const rabattText =
    banner.discount_type === 'percent'
      ? t('shop.promo.prozentRabatt', { prozent: banner.discount_value })
      : t('shop.promo.festRabatt', { betrag: formatEuro(banner.discount_value) })

  const codeKopieren = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(banner.code)
    }
    setKopiert(true)
    window.setTimeout(() => setKopiert(false), 2000)
  }

  const schliessen = () => {
    try {
      window.localStorage.setItem(`${DISMISS_PREFIX}${banner.code}`, String(Date.now()))
    } catch (err) {
      still(err, 'shopPromoBanner.cooldownWrite')
    }
    setAusgeblendet(true)
  }

  return (
    <div
      role="region"
      aria-label={t('shop.promo.aktionBadge')}
      className="border-b border-primary/30 bg-primary/10 text-on-surface"
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center gap-2.5">
          <Badge variant="success" className="gap-1">
            <TicketPercent className="h-3.5 w-3.5" aria-hidden="true" />
            {rabattText}
          </Badge>
          <span className="font-medium text-on-surface">
            {banner.promo_text || banner.name}
          </span>
          <span className="text-xs text-on-surface-variant">
            {t('shop.promo.codeLabel')}:{' '}
            <code className="rounded bg-surface-container-high px-1.5 py-0.5 font-mono font-bold text-primary">
              {banner.code}
            </code>
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" className="gap-1.5" onClick={codeKopieren}>
            {kopiert ? (
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {kopiert ? t('shop.promo.kopiert') : t('shop.promo.kopieren')}
          </Button>
          <button
            type="button"
            onClick={schliessen}
            aria-label={t('shop.promo.schliessen')}
            className="grid h-8 w-8 place-items-center rounded-lg text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  )
}
