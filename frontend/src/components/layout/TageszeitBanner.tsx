import { useMemo, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/authStore'
import { useMedienabfrage } from '@/hooks/useMedienabfrage'
import { TageszeitHintergrund } from './TageszeitHintergrund'
import { begruessungSchluessel, headerHintergrundWaehlen } from '@/lib/tageszeit'

export interface TageszeitBannerProps {
  /** Bereichsname über der Begrüßung (z. B. „Dashboard“, „Kalender“, „Notizen“, „Maunting Docs“) */
  bereich?: string
  /** Optionales Symbol vor dem Bereichsnamen */
  icon?: ReactNode
  /** Erklärender Untertitel unter der Begrüßung */
  untertitel?: string
  /** Kürzerer Untertitel auf schmalen Bildschirmen */
  untertitelKurz?: string
  /** Aktionen oder Status-Badges rechts neben der Begrüßung */
  actions?: ReactNode
  /** Optionaler Zusatzinhalt innerhalb der atmosphärischen Fläche */
  children?: ReactNode
  /** Kompaktere Höhe für eingebettete Ansichten */
  kompakt?: boolean
  className?: string
}

/**
 * Atmosphärischer Kopfbereich mit tageszeitabhängigem Hintergrundbild
 * (Morgen, Tag, Abend, Nacht × je 5 Varianten), weichem Übergang zur
 * Oberfläche und persönlicher Tageszeit-Begrüßung.
 */
export function TageszeitBanner({
  bereich,
  icon,
  untertitel,
  untertitelKurz,
  actions,
  children,
  kompakt = false,
  className = '',
}: TageszeitBannerProps) {
  const { t } = useTranslation()
  const angemeldeterName = useAuthStore((s) => s.user?.username)
  const istSchmal = useMedienabfrage('(max-width: 767.98px)')
  const zufall = useRef(Math.random() * 5)

  const stunde = new Date().getHours()
  const headerMotiv = useMemo(
    () => headerHintergrundWaehlen(stunde, zufall.current),
    [stunde],
  )

  const begruessung = angemeldeterName
    ? t(begruessungSchluessel(stunde, istSchmal, zufall.current), { name: angemeldeterName })
    : t('common.begruessung.ohneName')

  const bildHoehe = kompakt ? 'h-48' : 'h-64'

  return (
    <section
      className={`relative overflow-hidden rounded-2xl border border-outline-variant/20 bg-surface-container-low/65 ${className}`}
    >
      {/* Tageszeit-Hintergrundbild mit weichem Übergang nach unten */}
      <TageszeitHintergrund
        motiv={headerMotiv}
        hoehe={bildHoehe}
        verlauf="bg-gradient-to-b from-surface/10 via-surface/60 to-surface-container-low/95"
      />

      <div
        className={`relative flex flex-col gap-4 ${
          kompakt ? 'px-4 py-4 sm:px-5 sm:py-4' : 'px-4 py-5 sm:px-6 sm:py-6'
        }`}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 space-y-1">
            {bereich && (
              <div className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant/25 bg-surface-container/75 px-2.5 py-0.5 text-label-sm font-semibold text-primary backdrop-blur-md">
                {icon}
                <span>{bereich}</span>
              </div>
            )}
            <h1 className="font-headline text-xl font-bold tracking-tight text-on-surface sm:text-2xl lg:text-3xl">
              {begruessung}
            </h1>
            {untertitel && (
              <>
                <p className="hidden text-sm text-on-surface-variant sm:block">{untertitel}</p>
                <p className="text-xs text-on-surface-variant sm:hidden">
                  {untertitelKurz ?? untertitel}
                </p>
              </>
            )}
          </div>

          {actions && (
            <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>
          )}
        </div>

        {children}
      </div>
    </section>
  )
}
