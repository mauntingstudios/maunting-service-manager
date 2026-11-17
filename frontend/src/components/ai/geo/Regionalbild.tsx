/**
 * Das Bild einer Regionsanalyse: die neueste Sentinel-2-Szene oder das
 * Kartenbild — mit dem, was es ist, und wem es gehört.
 *
 * Ein Kartenbild ist ein Mosaik aus vielen Aufnahmen. Es steht deshalb als
 * „Mosaik, kein Überflug" da und nie mit einem Datum; eine Szene zeigt ihren
 * Aufnahmezeitpunkt und die Bewölkung.
 *
 * Das Panel holt das Bild (`/api/ai/geo/image`), der Browser fragt nie ArcGIS
 * oder Copernicus selbst. Geladen wird über `useBildquelle`: im Web direkt
 * mit dem Sitzungscookie, in der Desktop-App als Blob mit dem Bearer-Token.
 */
import { useState } from 'react'
import { ImageOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { AiSatelliteLayer } from '@/api/ai'
import { useBildquelle } from '@/hooks/useBildquelle'
import { regionalbildPfad } from './regionalAnalysis'

interface RegionalbildProps {
  layer: AiSatelliteLayer
  location: string
  className?: string
}

type Ladezustand = 'laedt' | 'da' | 'fehlt'

export function Regionalbild({ layer, location, className = '' }: RegionalbildProps) {
  const { t, i18n } = useTranslation()
  const { quelle, fehlgeschlagen, bildFehler } = useBildquelle(regionalbildPfad(layer))
  const [geladen, setGeladen] = useState<string | null>(null)
  const zustand: Ladezustand = fehlgeschlagen ? 'fehlt' : quelle !== null && geladen === quelle ? 'da' : 'laedt'

  const szene = layer.kind === 'scene'
  const zeitpunkt = szene && layer.captured_at ? new Date(layer.captured_at) : null
  const datum = zeitpunkt && !Number.isNaN(zeitpunkt.getTime())
    ? zeitpunkt.toLocaleDateString(i18n.language, { day: 'numeric', month: 'long', year: 'numeric' })
    : null
  const titel = szene ? layer.mission || t('ai.geo.image.scene') : t('ai.geo.image.map')
  const angabe = szene
    ? [
        datum ? t('ai.geo.image.capturedOn', { date: datum }) : t('ai.geo.captureTimeUnknown'),
        typeof layer.cloud_cover_percent === 'number'
          ? t('ai.geo.image.clouds', { percent: Math.round(layer.cloud_cover_percent) })
          : null,
      ].filter(Boolean).join(', ')
    : t('ai.geo.image.mosaic')

  return (
    <figure
      className={`relative aspect-video overflow-hidden rounded-xl border border-outline-variant/30 bg-surface-container-lowest ${className}`}
      aria-busy={zustand === 'laedt'}
    >
      {quelle && zustand !== 'fehlt' && (
        <img
          src={quelle}
          alt={t('ai.geo.image.alt', { location })}
          onLoad={() => setGeladen(quelle)}
          onError={bildFehler}
          className={`h-full w-full object-cover motion-safe:transition-opacity motion-safe:duration-500 ${
            zustand === 'da' ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}
      {zustand === 'laedt' && (
        <div className="absolute inset-0 animate-pulse bg-surface-container-high/60" aria-hidden="true" />
      )}
      {zustand === 'fehlt' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-on-surface-variant">
          <ImageOff className="h-7 w-7 text-primary/70" aria-hidden="true" />
          <p className="mt-2 text-xs font-medium text-on-surface">{t('ai.geo.image.unavailable')}</p>
        </div>
      )}
      {/* Untereinander statt nebeneinander: im schmalen Reiter bräche die
          Quelle sonst neben der Angabe in drei Zeilen. */}
      <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-surface-container-lowest/95 via-surface-container-lowest/75 to-transparent px-3 pb-2 pt-10 text-label-sm leading-snug">
        <span className="block font-semibold text-on-surface">{titel}</span>
        <span className="block text-on-surface-variant">{angabe}</span>
        {layer.attribution && (
          <span className="mt-0.5 block leading-tight text-on-surface-variant">
            {t('ai.geo.image.source', { source: layer.attribution })}
          </span>
        )}
      </figcaption>
    </figure>
  )
}
