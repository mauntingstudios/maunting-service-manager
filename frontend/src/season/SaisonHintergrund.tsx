import type { CSSProperties } from 'react'

import { SEASON_ASSETS } from './assets'

interface Partikel {
  x: number
  groesse: number
  dauer: number
  verzoegerung: number
  deckkraft: number
}

/**
 * Viele kleine Partikel im Stil des jeweiligen Event-Motivs, nicht ein
 * grosses Emblem. Die Werte sind fest: gleiche Flugbahn auf jedem Geraet,
 * kein Neu-Wuerfeln bei jedem Rendern.
 */
const PARTIKEL: Partikel[] = [
  { x: 8, groesse: 30, dauer: 26, verzoegerung: -4, deckkraft: 0.28 },
  { x: 26, groesse: 24, dauer: 32, verzoegerung: -18, deckkraft: 0.24 },
  { x: 44, groesse: 36, dauer: 24, verzoegerung: -10, deckkraft: 0.30 },
  { x: 62, groesse: 26, dauer: 30, verzoegerung: -22, deckkraft: 0.25 },
  { x: 79, groesse: 34, dauer: 27, verzoegerung: -14, deckkraft: 0.29 },
  { x: 93, groesse: 22, dauer: 33, verzoegerung: -8, deckkraft: 0.22 },
]

/**
 * Aufsteigende Partikel-Animation. Das Motiv kommt per CSS-Hintergrund aus
 * `SEASON_ASSETS`; `data-season` waehlt die passende Datei. So liegt pro
 * Partikel nur ein Element im DOM, und das jeweils andere Motiv wird gar
 * nicht erst geladen.
 */
export function SaisonHintergrund() {
  const motive = {
    '--season-bg-halloween': `url("${SEASON_ASSETS.halloween.hintergrund}")`,
    '--season-bg-christmas': `url("${SEASON_ASSETS.christmas.hintergrund}")`,
  } as CSSProperties

  return (
    <div className="season-hintergrund" style={motive} aria-hidden="true">
      {PARTIKEL.map((p, index) => (
        <span
          key={index}
          className="season-partikel"
          style={
            {
              '--season-x': `${p.x}%`,
              '--season-size': `${p.groesse}px`,
              '--season-duration': `${p.dauer}s`,
              '--season-delay': `${p.verzoegerung}s`,
              '--season-opacity': p.deckkraft,
            } as CSSProperties
          }
        />
      ))}
    </div>
  )
}