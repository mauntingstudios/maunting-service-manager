import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronRight, Clock, Copy, TicketPercent, X } from 'lucide-react'
import { Badge, Button } from '@maunting/ui'
import { shopCatalogApi, type ShopPublicBannerPromo } from '@/api/shop'
import { still } from '@/lib/still'
import { formatEuro } from '../preis'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'

const DISMISS_PREFIX = 'msm_shop_promo_dismissed:'
const ROTATE_MS = 12_000

interface CountdownResult {
  abgelaufen: boolean
  label: string
  iso: string
}

interface TemporalDurationLike {
  years?: number
  months?: number
  days?: number
  hours?: number
  minutes?: number
  seconds?: number
  toLocaleString: (locale: string, opts: { style: string }) => string
  toString: () => string
}

interface TemporalInstantLike {
  epochMilliseconds: number
  until: (
    other: TemporalInstantLike,
    opts: { largestUnit: string; smallestUnit: string },
  ) => TemporalDurationLike
}

interface TemporalGlobal {
  Now: { instant: () => TemporalInstantLike }
  Instant: { from: (iso: string) => TemporalInstantLike }
}

type DurationFormatCtor = new (
  locale: string,
  opts: { style: 'narrow' | 'short' | 'long' | 'digital' },
) => { format: (parts: Record<string, number>) => string }

function formatRestzeit(
  validUntilIso: string | null | undefined,
  locale: string,
  jetztMs: number,
): CountdownResult | null {
  if (!validUntilIso) return null

  const targetMs = Date.parse(validUntilIso)
  if (!Number.isFinite(targetMs)) return null

  const temporal = (globalThis as { Temporal?: TemporalGlobal }).Temporal
  if (temporal?.Instant && temporal?.Now) {
    try {
      const now = temporal.Now.instant()
      const end = temporal.Instant.from(validUntilIso)
      if (end.epochMilliseconds <= now.epochMilliseconds) {
        return { abgelaufen: true, label: '', iso: 'PT0S' }
      }
      const diff = now.until(end, { largestUnit: 'day', smallestUnit: 'second' })
      return {
        abgelaufen: false,
        label: diff.toLocaleString(locale, { style: 'narrow' }),
        iso: diff.toString(),
      }
    } catch (err) {
      still(err, 'shopPromoBanner.temporalCountdown')
    }
  }

  const diffMs = targetMs - jetztMs
  if (diffMs <= 0) {
    return { abgelaufen: true, label: '', iso: 'PT0S' }
  }

  const totalSec = Math.floor(diffMs / 1000)
  const days = Math.floor(totalSec / 86_400)
  const hours = Math.floor((totalSec % 86_400) / 3_600)
  const minutes = Math.floor((totalSec % 3_600) / 60)
  const seconds = totalSec % 60

  const datePart = days > 0 ? `${days}D` : ''
  const iso = `P${datePart}T${hours}H${minutes}M${seconds}S`

  const DurationFormat = (Intl as { DurationFormat?: DurationFormatCtor }).DurationFormat
  if (typeof DurationFormat === 'function') {
    const parts: Record<string, number> = {}
    if (days > 0) parts.days = days
    if (hours > 0 || days > 0) parts.hours = hours
    parts.minutes = minutes
    parts.seconds = seconds
    return {
      abgelaufen: false,
      label: new DurationFormat(locale, { style: 'narrow' }).format(parts),
      iso,
    }
  }

  const hh = String(hours).padStart(2, '0')
  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')
  return {
    abgelaufen: false,
    label: days > 0 ? `${days}d ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`,
    iso,
  }
}

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
  const { t, i18n } = useTranslation()
  const shopEnabled = usePublicSettingsStore((s) => s.shop_enabled)
  const [alleBanner, setAlleBanner] = useState<ShopPublicBannerPromo[]>([])
  const [ausgeblendetCodes, setAusgeblendetCodes] = useState<string[]>([])
  const [aktiverIndex, setAktiverIndex] = useState(0)
  const [jetztMs, setJetztMs] = useState(() => Date.now())
  const [kopiert, setKopiert] = useState(false)

  useEffect(() => {
    if (!shopEnabled) {
      setAlleBanner([])
      return
    }
    const fetchPromos = shopCatalogApi.getPromos
    if (!fetchPromos) return
    let aktiv = true
    void fetchPromos()
      .then((res) => {
        if (!aktiv) return
        const liste =
          res?.banners && res.banners.length > 0
            ? res.banners
            : res?.banner
              ? [res.banner]
              : []
        setAlleBanner(liste.filter((b) => !istImCooldown(b.code, b.cooldown_hours)))
        setAktiverIndex(0)
      })
      .catch((err: unknown) => {
        still(err, 'shopPromoBanner.fetch')
        if (aktiv) setAlleBanner([])
      })
    return () => {
      aktiv = false
    }
  }, [shopEnabled])

  const sichtbareBanner = useMemo(() => {
    return alleBanner.filter((b) => {
      if (ausgeblendetCodes.includes(b.code)) return false
      if (b.valid_until) {
        const parsed = Date.parse(b.valid_until)
        if (Number.isFinite(parsed) && parsed <= jetztMs) return false
      }
      return true
    })
  }, [alleBanner, ausgeblendetCodes, jetztMs])

  const hatFlashSale = useMemo(
    () => sichtbareBanner.some((b) => Boolean(b.valid_until)),
    [sichtbareBanner],
  )

  useEffect(() => {
    if (!shopEnabled || !hatFlashSale) return
    const tick = window.setInterval(() => {
      setJetztMs(Date.now())
    }, 1000)
    return () => window.clearInterval(tick)
  }, [shopEnabled, hatFlashSale])

  useEffect(() => {
    if (!shopEnabled || sichtbareBanner.length <= 1) return
    const timer = window.setInterval(() => {
      setAktiverIndex((vorher) => (vorher + 1) % sichtbareBanner.length)
    }, ROTATE_MS)
    return () => window.clearInterval(timer)
  }, [shopEnabled, sichtbareBanner.length])

  if (!shopEnabled || sichtbareBanner.length === 0) return null

  const banner = sichtbareBanner[aktiverIndex % sichtbareBanner.length]
  const locale = i18n.language.startsWith('de') ? 'de-DE' : 'en-US'
  const countdown = formatRestzeit(banner.valid_until, locale, jetztMs)
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
    setAusgeblendetCodes((prev) => [...prev, banner.code])
    setAktiverIndex(0)
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
          {countdown && !countdown.abgelaufen && (
            <span className="inline-flex items-center gap-1 rounded-md border border-primary/25 bg-background/70 px-2 py-0.5 text-xs text-primary">
              <Clock className="h-3 w-3" aria-hidden="true" />
              <span>{t('shop.promo.endetIn')}</span>
              <time dateTime={countdown.iso} className="font-mono font-semibold tabular-nums">
                {countdown.label}
              </time>
            </span>
          )}
          <span className="text-xs text-on-surface-variant">
            {t('shop.promo.codeLabel')}:{' '}
            <code className="rounded bg-surface-container-high px-1.5 py-0.5 font-mono font-bold text-primary">
              {banner.code}
            </code>
          </span>
        </div>

        <div className="flex items-center gap-2">
          {sichtbareBanner.length > 1 && (
            <button
              type="button"
              onClick={() => setAktiverIndex((i) => (i + 1) % sichtbareBanner.length)}
              aria-label={t('shop.promo.naechste')}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-outline-variant/40 bg-surface-container/60 px-2 text-xs font-medium tabular-nums text-on-surface-variant hover:text-on-surface"
            >
              <span>
                {(aktiverIndex % sichtbareBanner.length) + 1}/{sichtbareBanner.length}
              </span>
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
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
