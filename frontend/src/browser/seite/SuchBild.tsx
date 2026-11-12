/**
 * Datenschutzkonforme Bild-Komponente für Maunting Search.
 *
 * Lädt Vorschaubilder ausschließlich über den authentifizierten Server-Proxy
 * (`/api/browser/suche/bild?u=...`). Sollte ein Bild fehlen oder nicht ladbar
 * sein, blendet sich das Element sauber aus (oder zeigt den optionalen
 * DNA-Fallback), sodass niemals ein kaputtes Browser-Bild-Symbol erscheint.
 */
import { useEffect, useRef, useState } from 'react'

import { useBildquelle, vorladenBildquelle } from '@/components/ai/geo/Regionalbild'

export interface SuchBildProps {
  url?: string | null
  alt?: string
  className?: string
  fallback?: React.ReactNode
  width?: number
  height?: number
  priority?: 'high' | 'low'
}

/** Lädt ein Such- oder Wikipedia-Bild vorab, noch bevor `Wissenskarte` rendert. */
export function vorladenSuchBild(url?: string | null): void {
  if (!url) return
  vorladenBildquelle(`/browser/suche/bild?u=${encodeURIComponent(url)}`, 'high')
}

export function SuchBild({ url, alt = '', className = '', fallback = null, width, height, priority }: SuchBildProps) {
  const pfad = url ? `/browser/suche/bild?u=${encodeURIComponent(url)}` : null
  const { quelle, fehlgeschlagen, bildFehler } = useBildquelle(pfad)
  const hoch = priority === 'high'
  const [geladen, setGeladen] = useState(hoch)
  const imgRef = useRef<HTMLImageElement | null>(null)

  useEffect(() => {
    if (hoch) {
      setGeladen(true)
      return
    }
    const el = imgRef.current
    setGeladen(Boolean(el && el.complete && el.naturalWidth > 0))
  }, [quelle, hoch])

  if (!url || fehlgeschlagen || !quelle) {
    return fallback ? <>{fallback}</> : null
  }

  return (
    <img
      ref={imgRef}
      src={quelle}
      alt={alt}
      width={width}
      height={height}
      loading={hoch ? 'eager' : 'lazy'}
      decoding={hoch ? 'sync' : 'async'}
      {...(priority ? ({ fetchpriority: priority } as Record<string, string>) : {})}
      onLoad={() => setGeladen(true)}
      onError={bildFehler}
      className={`${className} ${hoch ? 'opacity-100' : `transition-opacity duration-150 ${geladen ? 'opacity-100' : 'opacity-0'}`}`}
    />
  )
}
