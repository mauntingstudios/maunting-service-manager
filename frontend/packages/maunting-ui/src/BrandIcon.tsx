import { useMemo } from 'react'
import { cx } from './intern/cx'
import { resolveBrandInfo } from './brandCatalog'

export interface BrandIconProps {
  /** Name des Dienstes oder Eintrags (z. B. "Google", "Steam", "Heimserver"). */
  name?: string
  /** Zugehörige URL oder Domain (z. B. "https://store.steampowered.com", "revolut.com"). */
  domainOrUrl?: string
  /** Größenstufe des Badges. */
  size?: 'xs' | 'sm' | 'md' | 'lg'
  /** Rendert nur das innere Icon/Monogramm ohne äußeren Badge-Rahmen. */
  bare?: boolean
  /** Zusätzliche CSS-Klassen für den äußeren Container. */
  className?: string
  /** Zusätzliche CSS-Klassen für das innere SVG. */
  iconClassName?: string
}

const MONOGRAM_PALETTES = [
  { bg: 'rgba(56, 189, 248, 0.12)', border: 'rgba(56, 189, 248, 0.26)', text: '#7DD3FC' },
  { bg: 'rgba(45, 212, 191, 0.12)', border: 'rgba(45, 212, 191, 0.26)', text: '#5EEAD4' },
  { bg: 'rgba(52, 211, 153, 0.12)', border: 'rgba(52, 211, 153, 0.26)', text: '#6EE7B7' },
  { bg: 'rgba(96, 165, 250, 0.12)', border: 'rgba(96, 165, 250, 0.26)', text: '#93C5FD' },
  { bg: 'rgba(251, 191, 36, 0.12)', border: 'rgba(251, 191, 36, 0.26)', text: '#FCD34D' },
  { bg: 'rgba(148, 163, 184, 0.14)', border: 'rgba(148, 163, 184, 0.28)', text: '#CBD5E1' },
]

function computeMonogram(name?: string, domainOrUrl?: string): string {
  const rawName = (name || '').trim()
  if (rawName && !rawName.includes('.')) {
    const words = rawName
      .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
      .split(/[\s-]+/)
      .filter(Boolean)
    if (words.length >= 2) {
      return (words[0][0] + words[1][0]).toUpperCase()
    }
    if (words.length === 1 && words[0].length >= 2) {
      return words[0].slice(0, 2).toUpperCase()
    }
    if (words.length === 1 && words[0].length === 1) {
      return words[0].toUpperCase()
    }
  }

  const rawSource = rawName || (domainOrUrl || '').trim()
  if (!rawSource) return 'TR'

  const cleaned = rawSource
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/^www\./i, '')
    .split(/[/?#:]/)[0]
  const parts = cleaned.split('.').filter(Boolean)
  const label = parts.length >= 2 ? parts[parts.length - 2] : parts[0] || cleaned
  const letters = label.replace(/[^\p{L}\p{N}]/gu, '')
  if (letters.length >= 2) return letters.slice(0, 2).toUpperCase()
  if (letters.length === 1) return letters.toUpperCase()
  return 'TR'
}

function hashSeed(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

const SIZE_BOX: Record<NonNullable<BrandIconProps['size']>, string> = {
  xs: 'h-6 w-6 rounded-md text-label-sm',
  sm: 'h-8 w-8 rounded-lg text-label-sm',
  md: 'h-10 w-10 rounded-xl text-xs',
  lg: 'h-12 w-12 rounded-2xl text-sm',
}

const SIZE_SVG: Record<NonNullable<BrandIconProps['size']>, string> = {
  xs: 'h-3.5 w-3.5',
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-6 w-6',
}

/**
 * Lokaler Brand-Icon-Matcher für Tresor, Team-Tresor und Pontis Browser.
 * Löst Domains und Dienstnamen komplett lokal (ohne externe Favicon-Requests)
 * gegen den Marken-Katalog auf und fällt bei unbekannten Diensten auf ein
 * deterministisches Monogramm-Badge im `@maunting/ui`-Stil zurück.
 */
export function BrandIcon({
  name = '',
  domainOrUrl = '',
  size = 'md',
  bare = false,
  className,
  iconClassName,
}: BrandIconProps) {
  const brand = useMemo(() => resolveBrandInfo(name, domainOrUrl), [name, domainOrUrl])
  const monogram = useMemo(() => computeMonogram(name, domainOrUrl), [name, domainOrUrl])
  const palette = useMemo(() => {
    const seed = hashSeed((name || domainOrUrl || 'msm').toLowerCase())
    return MONOGRAM_PALETTES[seed % MONOGRAM_PALETTES.length]
  }, [name, domainOrUrl])

  if (brand) {
    const SvgComp = brand.svg
    if (bare) {
      return <SvgComp className={cx(SIZE_SVG[size], 'shrink-0', iconClassName, className)} />
    }
    return (
      <div
        className={cx(
          'inline-flex shrink-0 items-center justify-center border border-white/[0.08] bg-[#131923]/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]',
          SIZE_BOX[size],
          className,
        )}
        data-brand={brand.name}
      >
        <SvgComp className={cx(SIZE_SVG[size], 'shrink-0', iconClassName)} />
      </div>
    )
  }

  if (bare) {
    return (
      <span
        className={cx(
          'inline-flex shrink-0 items-center justify-center font-semibold tracking-tight select-none',
          SIZE_SVG[size],
          className,
        )}
        style={{ color: palette.text }}
        aria-label={name || domainOrUrl || monogram}
      >
        {monogram}
      </span>
    )
  }

  return (
    <div
      className={cx(
        'inline-flex shrink-0 items-center justify-center border font-semibold tracking-tight select-none shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]',
        SIZE_BOX[size],
        className,
      )}
      style={{
        backgroundColor: palette.bg,
        borderColor: palette.border,
        color: palette.text,
      }}
      data-monogram={monogram}
      aria-label={name || domainOrUrl || monogram}
    >
      {monogram}
    </div>
  )
}
