import type { HeaderHintergrundVariante } from '@/lib/tageszeit'

export interface TageszeitHintergrundProps {
  motiv: HeaderHintergrundVariante
  /** Höhe der Bildfläche (Tailwind-Klasse), z. B. `h-64`, `h-[70%]` oder `h-full` */
  hoehe?: string
  /** Deckkraft des Bildes (Tailwind-Klasse) */
  deckkraft?: string
  /** Verlauf, der das Bild nach unten in die Oberfläche übergehen lässt */
  verlauf?: string
  /** Positionsklassen der Ebenen, z. B. `-z-10` hinter Inhalten */
  ebene?: string
  /** Eigener Auslauf-Verlauf (Maske), um das Bild nach unten hin wunschgemäß auswässern zu lassen */
  auslaufMaske?: string
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
  auslaufMaske,
}: TageszeitHintergrundProps) {
  const maske = auslaufMaske ?? AUSLAUF

  return (
    <>
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 ${ebene} ${hoehe} bg-cover ${deckkraft} transition-opacity duration-700`}
        style={{
          backgroundImage: `url('${motiv.pfad}')`,
          backgroundPosition: motiv.position,
          maskImage: maske,
          WebkitMaskImage: maske,
        }}
        aria-hidden="true"
      />
      {motiv.ueberlagerung && (
        <div
          className={`pointer-events-none absolute inset-x-0 top-0 ${ebene} ${hoehe}`}
          style={{
            background: motiv.ueberlagerung,
            maskImage: maske,
            WebkitMaskImage: maske,
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
