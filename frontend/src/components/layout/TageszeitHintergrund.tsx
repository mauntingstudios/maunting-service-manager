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
  'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.85) 30%, rgba(0,0,0,0.45) 60%, rgba(0,0,0,0.12) 85%, transparent 100%)'

/**
 * Die drei Ebenen einer Tageszeit-Szene: Bild mit weichem Auslauf, farbige
 * Stimmung und Verlauf in die Oberfläche. Wird von Dashboard, Teams, Kalender,
 * Notizen, Dokumenten und Kulisse gemeinsam genutzt.
 */
export function TageszeitHintergrund({
  motiv,
  hoehe = 'h-[520px] sm:h-[580px] lg:h-[640px]',
  deckkraft = 'opacity-55',
  verlauf = 'msm-tageszeit-verlauf',
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
      {motiv.ueberlagerung && (
        <div
          className={`pointer-events-none absolute inset-x-0 top-0 ${ebene} ${hoehe}`}
          style={{
            background: motiv.ueberlagerung,
            maskImage: AUSLAUF,
            WebkitMaskImage: AUSLAUF,
          }}
          aria-hidden="true"
        />
      )}
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 ${ebene} ${hoehe} ${verlauf}`}
        aria-hidden="true"
      />
    </>
  )
}
