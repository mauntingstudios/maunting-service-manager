import type { HeaderHintergrundVariante } from '@/lib/tageszeit'

export interface TageszeitHintergrundProps {
  motiv: HeaderHintergrundVariante
  /** Höhe der Bildfläche (Tailwind-Klasse), z. B. `h-64` oder `h-[70%]` */
  hoehe?: string
  /** Deckkraft des Bildes (Tailwind-Klasse) */
  deckkraft?: string
  /** Verlauf, der das Bild nach unten in die Oberfläche übergehen lässt */
  verlauf?: string
  /** Positionsklassen der Ebenen, z. B. `-z-10` hinter Inhalten */
  ebene?: string
}

const AUSLAUF =
  'linear-gradient(to bottom, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.68) 50%, rgba(0,0,0,0.2) 80%, transparent 100%)'

/**
 * Die drei Ebenen einer Tageszeit-Szene: Bild mit weichem Auslauf, farbige
 * Stimmung und Verlauf in die Oberfläche. Wird von Banner, Kulisse und
 * Tresor-Dashboard gemeinsam genutzt.
 */
export function TageszeitHintergrund({
  motiv,
  hoehe = 'h-64',
  deckkraft = 'opacity-40',
  verlauf = 'bg-gradient-to-b from-surface/15 via-surface/65 to-surface',
  ebene = '',
}: TageszeitHintergrundProps) {
  return (
    <>
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 ${ebene} ${hoehe} bg-cover ${deckkraft} transition-opacity duration-700`}
        style={{
          backgroundImage: `url('${motiv.pfad}')`,
          backgroundPosition: motiv.position,
          maskImage: AUSLAUF,
          WebkitMaskImage: AUSLAUF,
        }}
        aria-hidden="true"
      />
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 ${ebene} ${hoehe}`}
        style={{ background: motiv.ueberlagerung }}
        aria-hidden="true"
      />
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 ${ebene} ${hoehe} ${verlauf}`}
        aria-hidden="true"
      />
    </>
  )
}
