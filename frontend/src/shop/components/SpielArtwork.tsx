import { useEffect, useState } from 'react'
import { motivFuer } from '../spielArtwork'
import type { ShopSpiel } from '../typen'

interface SpielArtworkProps {
  spiel: ShopSpiel
  variant?: 'landscape' | 'poster'
  priority?: boolean
  className?: string
}

function withPosterVariant(url: string): string {
  if (!url.startsWith('/api/shop/artwork/')) return url
  return url.includes('?') ? `${url}&variant=poster` : `${url}?variant=poster`
}

export function SpielArtwork({
  spiel,
  variant = 'landscape',
  priority = false,
  className = '',
}: SpielArtworkProps) {
  const posterUrl =
    variant === 'poster' && spiel.bildUrl ? withPosterVariant(spiel.bildUrl) : spiel.bildUrl
  const [src, setSrc] = useState<string | undefined>(posterUrl)
  const [fehler, setFehler] = useState(false)

  useEffect(() => {
    setSrc(posterUrl)
    setFehler(false)
  }, [posterUrl])

  const motiv = motivFuer(spiel.motiv)
  const Icon = motiv.icon
  const zeigeBild = Boolean(src) && !fehler
  const prioritaetProps = priority
    ? ({ fetchpriority: 'high' } as Record<string, string>)
    : ({ loading: 'lazy' } as const)
  const isPoster = variant === 'poster'

  const handleImageError = () => {
    if (isPoster && src !== spiel.bildUrl && spiel.bildUrl) {
      setSrc(spiel.bildUrl)
      return
    }
    setFehler(true)
  }

  return (
    <div
      className={`relative overflow-hidden bg-gradient-to-br ${
        isPoster ? 'aspect-[3/4]' : 'aspect-[16/9]'
      } ${motiv.klassen} ${className}`}
    >
      {zeigeBild ? (
        <img
          src={src}
          alt=""
          width={isPoster ? 600 : 460}
          height={isPoster ? 900 : 215}
          {...prioritaetProps}
          className="block h-full w-full object-cover opacity-95"
          onError={handleImageError}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center pb-14">
          <span
            className={`grid place-items-center rounded-3xl border border-white/10 bg-surface-container/60 shadow-lg ${
              isPoster ? 'h-24 w-24' : 'h-20 w-20'
            }`}
          >
            <Icon className="h-12 w-12 text-primary/70" aria-hidden="true" />
          </span>
        </div>
      )}
      <div
        className={
          isPoster
            ? 'absolute inset-0 bg-gradient-to-t from-background via-background/35 to-background/10'
            : 'absolute inset-0 bg-gradient-to-t from-background/80 via-background/10 to-transparent'
        }
        aria-hidden="true"
      />
    </div>
  )
}
