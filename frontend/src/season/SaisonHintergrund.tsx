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
  { x: 5, groesse: 34, dauer: 24, verzoegerung: -4, deckkraft: 0.32 },
  { x: 12, groesse: 24, dauer: 29, verzoegerung: -16, deckkraft: 0.26 },
  { x: 19, groesse: 40, dauer: 26, verzoegerung: -10, deckkraft: 0.34 },
  { x: 27, groesse: 28, dauer: 32, verzoegerung: -21, deckkraft: 0.28 },
  { x: 35, groesse: 36, dauer: 23, verzoegerung: -7, deckkraft: 0.31 },
  { x: 43, groesse: 22, dauer: 30, verzoegerung: -18, deckkraft: 0.25 },
  { x: 51, groesse: 42, dauer: 27, verzoegerung: -12, deckkraft: 0.36 },
  { x: 59, groesse: 26, dauer: 31, verzoegerung: -24, deckkraft: 0.27 },
  { x: 66, groesse: 38, dauer: 25, verzoegerung: -6, deckkraft: 0.33 },
  { x: 73, groesse: 20, dauer: 33, verzoegerung: -19, deckkraft: 0.24 },
  { x: 80, groesse: 32, dauer: 28, verzoegerung: -14, deckkraft: 0.30 },
  { x: 87, groesse: 44, dauer: 22, verzoegerung: -9, deckkraft: 0.37 },
  { x: 93, groesse: 26, dauer: 34, verzoegerung: -26, deckkraft: 0.27 },
  { x: 97, groesse: 18, dauer: 27, verzoegerung: -15, deckkraft: 0.22 },
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