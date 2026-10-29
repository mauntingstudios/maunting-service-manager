import { useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { SCHICHT, useAnkerLage } from './Ankerlage'

export interface KurzinfoProps {
  /** Der Name oder Hinweis, der an dem Element erscheint. */
  text: string
  children: ReactNode
  /**
   * Zusätzliche Klassen für die Blase. Wo der Name ab einer Breite sichtbar dasteht,
   * blendet `xl:!hidden` sie aus; ohne `!` hinge es an der Reihenfolge im CSS.
   */
  className?: string
  /**
   * `mitte` mittig zum Element; `ende` bündig mit seiner rechten Kante, für
   * Knöpfe am rechten Rand (Menüknöpfe in Kopfzeilen); `anfang` bündig links,
   * für Knöpfe am linken Rand. Sonst stünde die Blase über den Fensterrand.
   */
  seite?: 'mitte' | 'anfang' | 'ende'
  /** `unten` unter dem Element; `oben` für Leisten am unteren Rand; `rechts` für senkrechte Leisten links; `links` für senkrechte Leisten rechts. */
  lage?: 'unten' | 'oben' | 'rechts' | 'links'
  /** Lage und Abstand des Ganzen (etwa `ml-auto`); am Knopf darin wirkten sie nicht mehr. */
  aussen?: string
  /**
   * Rendert die Blase an `body` statt im nächsten Überlauf-Container. Nötig in
   * Zeilen mit `overflow-hidden` (Wischgeste) und in Bannern, die sonst den
   * unteren Rand abschneiden. Standard: aus.
   */
  portal?: boolean
}

const SEITE = {
  mitte: 'left-1/2 -translate-x-1/2',
  anfang: 'left-0',
  ende: 'right-0',
} as const

const LAGE = {
  unten: 'top-full mt-1.5',
  oben: 'bottom-full mb-1.5',
  rechts: 'left-full ml-2 top-1/2 -translate-y-1/2',
  links: 'right-full mr-2 top-1/2 -translate-y-1/2',
} as const

/**
 * Kurzer Name oder Hinweis an einem Element. Ersetzt das native `title`: das
 * zeichnet das Betriebssystem in seinem eigenen Stil, erst nach einer Sekunde
 * und am Finger nie.
 *
 * Der Text steht nur als CSS-Inhalt (`data-kurzinfo`), nicht als zweiter
 * Textknoten neben dem Namen des Knopfs. Lange Hinweise brechen ab 16rem um.
 * Bis zum Zeigen ist die Blase `hidden`: auch unsichtbar (opacity 0) zählte
 * sie zur Rollfläche und gab Listen leeren Rollweg und waagerechte Leisten.
 *
 * Die Blase erscheint beim Überfahren mit der Maus und beim Tastaturfokus,
 * nicht bei Berührung. Vorgelesen wird sie nicht: den Namen trägt das Element
 * selbst (`aria-label`, bei Symbolen `role="img"`), einen Hinweis darüber
 * hinaus `aria-description`; sonst hörte man ihn doppelt.
 *
 * Sie prüft keine Fensterränder; dafür gibt es `seite` und `lage`.
 */
export function Kurzinfo({
  text,
  children,
  className = '',
  seite = 'mitte',
  lage = 'unten',
  aussen = '',
  portal = false,
}: KurzinfoProps) {
  // Bringt `aussen` eine eigene Position mit (`absolute top-2 right-2`), gilt sie;
  // daneben ein `relative` gewönne im gebauten CSS und hielte die Hülle im Fluss.
  const position = /(^|\s)(absolute|fixed|sticky)(?=\s|$)/.test(aussen) ? '' : 'relative'
  const lageKlasse = LAGE[lage]
  const seiteKlasse = lage === 'rechts' || lage === 'links' ? '' : SEITE[seite]
  const ankerRef = useRef<HTMLSpanElement>(null)
  const blaseRef = useRef<HTMLSpanElement>(null)
  const [portalOffen, setPortalOffen] = useState(false)
  const portalLage = useAnkerLage(portal && portalOffen, ankerRef, blaseRef, {
    seite: lage === 'oben' ? 'oben' : 'unten',
    ausrichtung: seite === 'anfang' ? 'start' : 'ende',
    abstand: 6,
  })

  const zeigePortal = portal && portalOffen
  const blaseKlasse = `pointer-events-none w-max max-w-64 rounded-md border border-outline-variant bg-surface-container-highest px-2 py-1 text-label-sm font-medium text-on-surface shadow-lg ${className}`

  return (
    <>
      <span
        ref={ankerRef}
        className={`group/kurzinfo ${position} inline-flex ${aussen}`}
        onPointerEnter={(e) => {
          if (portal && e.pointerType !== 'touch') setPortalOffen(true)
        }}
        onPointerLeave={() => {
          if (portal) setPortalOffen(false)
        }}
        onFocus={(e) => {
          if (!portal) return
          try {
            if (e.target.matches(':focus-visible')) setPortalOffen(true)
          } catch {
            setPortalOffen(true)
          }
        }}
        onBlur={() => {
          if (portal) setPortalOffen(false)
        }}
      >
        {children}
        {!portal && (
          <span
            aria-hidden="true"
            data-kurzinfo={text}
            className={`pointer-events-none before:content-[attr(data-kurzinfo)] absolute z-50 ${lageKlasse} ${seiteKlasse} ${blaseKlasse} hidden [@media(hover:hover)]:group-hover/kurzinfo:block group-has-[:focus-visible]/kurzinfo:block`}
          />
        )}
      </span>
      {zeigePortal &&
        typeof document !== 'undefined' &&
        createPortal(
          <span
            ref={blaseRef}
            aria-hidden="true"
            data-kurzinfo={text}
            className={`fixed ${blaseKlasse}`}
            style={{
              ...(portalLage ?? { left: 0, top: 0, visibility: 'hidden' }),
              zIndex: SCHICHT.popover,
            }}
          >
            {text}
          </span>,
          document.body,
        )}
    </>
  )
}
