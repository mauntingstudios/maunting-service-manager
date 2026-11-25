import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Clock, Copy, TicketPercent, X } from 'lucide-react'
import { Button } from '@maunting/ui'
import { shopCatalogApi, type ShopPublicBannerPromo } from '@/api/shop'
import { still } from '@/lib/still'
import { formatEuro } from '../preis'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'

const DISMISS_PREFIX = 'msm_shop_promo_dismissed:'

interface CountdownResult {
  abgelaufen: boolean
  days: number
  hours: number
  minutes: number
  seconds: number
  iso: string
}

interface TemporalDurationLike {
  days?: number
  hours?: number
  minutes?: number
  seconds?: number
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

function formatRestzeit(
  validUntilIso: string | null | undefined,
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
        return { abgelaufen: true, days: 0, hours: 0, minutes: 0, seconds: 0, iso: 'PT0S' }
      }
      const diff = now.until(end, { largestUnit: 'day', smallestUnit: 'second' })
      return {
        abgelaufen: false,
        days: diff.days ?? 0,
        hours: diff.hours ?? 0,
        minutes: diff.minutes ?? 0,
        seconds: diff.seconds ?? 0,
        iso: diff.toString(),
      }
    } catch (err) {
      still(err, 'shopPromoBanner.temporalCountdown')
    }
  }

  const diffMs = targetMs - jetztMs
  if (diffMs <= 0) {
    return { abgelaufen: true, days: 0, hours: 0, minutes: 0, seconds: 0, iso: 'PT0S' }
  }

  const totalSec = Math.floor(diffMs / 1000)
  const days = Math.floor(totalSec / 86_400)
  const hours = Math.floor((totalSec % 86_400) / 3_600)
  const minutes = Math.floor((totalSec % 3_600) / 60)
  const seconds = totalSec % 60

  const datePart = days > 0 ? `${days}D` : ''
  return {
    abgelaufen: false,
    days,
    hours,
    minutes,
    seconds,
    iso: `P${datePart}T${hours}H${minutes}M${seconds}S`,
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
  const { t } = useTranslation()
  const headingId = useId()
  const shopEnabled = usePublicSettingsStore((s) => s.shop_enabled)
  const [ausgewaehlterBanner, setAusgewaehlterBanner] =
    useState<ShopPublicBannerPromo | null>(null)
  const [geschlossen, setGeschlossen] = useState(false)
  const [jetztMs, setJetztMs] = useState(() => Date.now())
  const [kopiert, setKopiert] = useState(false)

  useEffect(() => {
    if (!shopEnabled) {
      setAusgewaehlterBanner(null)
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
        const jetzt = Date.now()
        const kandidaten = liste.filter((b) => {
          if (istImCooldown(b.code, b.cooldown_hours)) return false
          if (b.valid_until) {
            const parsed = Date.parse(b.valid_until)
            if (Number.isFinite(parsed) && parsed <= jetzt) return false
          }
          return true
        })
        if (kandidaten.length === 0) {
          setAusgewaehlterBanner(null)
          return
        }
        // Genau eine aktive Aktion zufaellig auswaehlen, damit Besucher bei
        // mehreren laufenden Gutscheinen nicht durch mehrere Popups klicken muessen.
        const zufall = kandidaten[Math.floor(Math.random() * kandidaten.length)]
        setAusgewaehlterBanner(zufall)
        setGeschlossen(false)
        setKopiert(false)
      })
      .catch((err: unknown) => {
        still(err, 'shopPromoBanner.fetch')
        if (aktiv) setAusgewaehlterBanner(null)
      })
    return () => {
      aktiv = false
    }
  }, [shopEnabled])

  const abgelaufen = useMemo(() => {
    if (!ausgewaehlterBanner?.valid_until) return false
    const parsed = Date.parse(ausgewaehlterBanner.valid_until)
    return Number.isFinite(parsed) && parsed <= jetztMs
  }, [ausgewaehlterBanner, jetztMs])

  const banner = shopEnabled && !geschlossen && !abgelaufen ? ausgewaehlterBanner : null

  useEffect(() => {
    if (!banner?.valid_until) return
    const tick = window.setInterval(() => {
      setJetztMs(Date.now())
    }, 1000)
    return () => window.clearInterval(tick)
  }, [banner?.valid_until])

  const schliessen = useCallback((code: string) => {
    try {
      window.localStorage.setItem(`${DISMISS_PREFIX}${code}`, String(Date.now()))
    } catch (err) {
      still(err, 'shopPromoBanner.cooldownWrite')
    }
    setGeschlossen(true)
    setKopiert(false)
  }, [])

  useEffect(() => {
    if (!banner) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        schliessen(banner.code)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [banner, schliessen])

  if (!banner) return null

  const countdown = formatRestzeit(banner.valid_until, jetztMs)
  const rabattText =
    banner.discount_type === 'percent'
      ? t('shop.promo.prozentRabatt', { prozent: banner.discount_value })
      : t('shop.promo.festRabatt', { betrag: formatEuro(banner.discount_value) })
  const scopeText =
    banner.scope === 'plans'
      ? t('shop.promo.scopePlans')
      : banner.scope === 'addons'
        ? t('shop.promo.scopeAddons')
        : t('shop.promo.scopeAll')

  const codeKopieren = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(banner.code)
    }
    setKopiert(true)
    window.setTimeout(() => setKopiert(false), 2000)
  }

  const zeitKacheln =
    countdown && !countdown.abgelaufen
      ? [
          ...(countdown.days > 0
            ? [{ wert: String(countdown.days).padStart(2, '0'), einheit: t('shop.promo.tage') }]
            : []),
          { wert: String(countdown.hours).padStart(2, '0'), einheit: t('shop.promo.stunden') },
          { wert: String(countdown.minutes).padStart(2, '0'), einheit: t('shop.promo.minuten') },
          { wert: String(countdown.seconds).padStart(2, '0'), einheit: t('shop.promo.sekunden') },
        ]
      : []

  return (
    <div
      data-testid="shop-promo-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          schliessen(banner.code)
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="msm-card relative w-full max-w-md overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container-high/95 text-on-surface shadow-2xl backdrop-blur-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-outline-variant/25 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary"
              aria-hidden="true"
            >
              <TicketPercent className="h-4 w-4" />
            </span>
            <div className="text-left">
              <p className="text-xs font-semibold text-on-surface">
                {t('shop.promo.aktionBadge')}
              </p>
              <p className="text-xs text-on-surface-variant">{scopeText}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => schliessen(banner.code)}
            aria-label={t('shop.promo.schliessen')}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5 text-center">
          <div className="space-y-1.5">
            <h2
              id={headingId}
              className="font-headline text-3xl font-bold tracking-tight text-on-surface"
            >
              {rabattText}
            </h2>
            <p className="text-sm leading-relaxed text-on-surface-variant">
              {banner.promo_text || banner.name}
            </p>
          </div>

          {countdown && !countdown.abgelaufen && (
            <div className="space-y-2">
              <p className="inline-flex items-center justify-center gap-1.5 text-xs font-medium text-on-surface-variant">
                <Clock className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                <span>{t('shop.promo.endetIn')}</span>
              </p>
              <time
                dateTime={countdown.iso}
                className="mx-auto flex max-w-xs items-center justify-center gap-2"
              >
                {zeitKacheln.map((kachel) => (
                  <div
                    key={kachel.einheit}
                    className="min-w-[3.75rem] flex-1 rounded-xl border border-outline-variant/30 bg-surface-container/70 px-2 py-2"
                  >
                    <div className="font-mono text-xl font-bold tabular-nums text-on-surface">
                      {kachel.wert}
                    </div>
                    <div className="text-[11px] font-medium text-on-surface-variant">
                      {kachel.einheit}
                    </div>
                  </div>
                ))}
              </time>
            </div>
          )}

          <div className="space-y-3 rounded-xl border border-outline-variant/30 bg-surface-container p-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-on-surface-variant">
                {t('shop.promo.codeLabel')}
              </p>
              <p className="mt-1 select-all font-mono text-xl font-bold tracking-widest text-primary">
                {banner.code}
              </p>
            </div>
            <Button variant="primary" size="md" className="w-full gap-2" onClick={codeKopieren}>
              {kopiert ? (
                <Check className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Copy className="h-4 w-4" aria-hidden="true" />
              )}
              {kopiert ? t('shop.promo.kopiert') : t('shop.promo.kopieren')}
            </Button>
            <p className="text-xs text-on-surface-variant">
              {t('shop.promo.checkoutHinweis')}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
