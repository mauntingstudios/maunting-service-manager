import type { ReactNode } from 'react'
import { Minus, Square, X } from 'lucide-react'

import { Kurzinfo } from './Kurzinfo'

/**
 * Die Fensterleiste beider Desktop-Apps.
 *
 * Sie ist der Rahmen des Arbeitsbereichs, nicht die Titelleiste von Windows:
 * links die Marke, in der Mitte der freie Platz (bei Pontis die Tabs), rechts
 * die Werkzeuge und die drei Fensterknöpfe. 40 px hoch, weil die native
 * Seitenfläche von Pontis genau daran anschließt.
 */
export interface FensterSteuerung {
  minimieren: () => void
  maximieren: () => void
  schliessen: () => void
}

export interface FensterleisteProps {
  steuerung: FensterSteuerung
  beschriftungen: { minimieren: string; maximieren: string; schliessen: string }
  marke?: ReactNode
  titel?: ReactNode
  mitte?: ReactNode
  werkzeuge?: ReactNode
  sichtbar?: boolean
  className?: string
}

const knopf = 'mui-fensterknopf flex h-full w-11 items-center justify-center text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface'

export function Fensterleiste({
  steuerung,
  beschriftungen,
  marke,
  titel,
  mitte,
  werkzeuge,
  sichtbar = true,
  className = '',
}: FensterleisteProps) {
  if (!sichtbar) return null

  return (
    <header
      data-tauri-drag-region
      className={`mui-fensterkopf relative z-30 flex h-10 shrink-0 select-none items-stretch border-b border-outline-variant/50 bg-surface-container-lowest/85 backdrop-blur-xl ${className}`}
    >
      {(marke || titel) && (
        <div className="flex shrink-0 items-center gap-2.5 pl-3 pr-1">
          {marke}
          {titel && <span className="text-label-md font-semibold text-on-surface">{titel}</span>}
        </div>
      )}

      <div
        className="flex min-w-0 flex-1 items-stretch"
        onDoubleClick={(event) => {
          if (event.target === event.currentTarget) steuerung.maximieren()
        }}
      >
        {mitte ?? (
          <div
            data-tauri-drag-region
            className="h-full flex-1"
            onDoubleClick={() => steuerung.maximieren()}
          />
        )}
      </div>

      {werkzeuge && <div className="flex shrink-0 items-center gap-0.5 px-1">{werkzeuge}</div>}

      <div className="flex shrink-0 items-stretch">
        <Kurzinfo text={beschriftungen.minimieren} seite="ende" aussen="h-full" portal>
          <button type="button" onClick={steuerung.minimieren} className={knopf} aria-label={beschriftungen.minimieren}>
            <Minus className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </Kurzinfo>
        <Kurzinfo text={beschriftungen.maximieren} seite="ende" aussen="h-full" portal>
          <button type="button" onClick={steuerung.maximieren} className={knopf} aria-label={beschriftungen.maximieren}>
            <Square className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </Kurzinfo>
        <Kurzinfo text={beschriftungen.schliessen} seite="ende" aussen="h-full" portal>
          <button
            type="button"
            onClick={steuerung.schliessen}
            className="mui-fensterknopf mui-fensterknopf--schliessen flex h-full w-11 items-center justify-center text-on-surface-variant transition-colors hover:bg-status-destructive hover:text-white"
            aria-label={beschriftungen.schliessen}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </Kurzinfo>
      </div>
    </header>
  )
}
