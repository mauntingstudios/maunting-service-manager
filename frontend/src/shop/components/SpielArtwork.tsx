import { useState } from 'react'
import { motivFuer } from '../spielArtwork'
import type { ShopSpiel } from '../typen'

interface SpielArtworkProps {
  spiel: ShopSpiel
  className?: string
}

export function SpielArtwork({ spiel, className = '' }: SpielArtworkProps) {
  const [fehler, setFehler] = useState(false)
  const motiv = motivFuer(spiel.motiv)
  const Icon = motiv.icon
  const zeigeBild = Boolean(spiel.bildUrl) && !fehler

  return (
    <div
      className={`relative aspect-[16/9] overflow-hidden bg-gradient-to-br ${motiv.klassen} ${className}`}
    >
      {zeigeBild ? (
        <img
          src={spiel.bildUrl}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover opacity-90"
          onError={() => setFehler(true)}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <Icon className="h-16 w-16 text-on-surface/40" aria-hidden="true" />
        </div>
      )}
      <div
        className="absolute inset-0 bg-gradient-to-t from-background/80 via-background/10 to-transparent"
        aria-hidden="true"
      />
    </div>
  )
}
