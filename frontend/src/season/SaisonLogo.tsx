import { SEASON_ASSETS } from './assets'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'

interface SaisonLogoProps {
  /** `msm` nutzt das Datenportal, `pontis` das Browser-Emblem. */
  art: 'msm' | 'pontis'
  /** Das bestehende Standard-Logo; es wird nicht ersetzt, nur ausgeblendet. */
  standardSrc: string
  className?: string
  alt: string
  onError?: () => void
}

/**
 * Standard-, Halloween- und Weihnachts-Logo nebeneinander im DOM. Welches
 * sichtbar ist, entscheidet `data-season` per CSS. Bei benutzerdefiniertem
 * Whitelabeling (`branding`) werden eigene WebP-Logos oder deaktivierte
 * Saisonlogos beruecksichtigt.
 */
export function SaisonLogo({ art, standardSrc, className = '', alt, onError }: SaisonLogoProps) {
  const branding = usePublicSettingsStore((s) => s.branding)

  const effectiveStandard =
    art === 'msm' && branding?.logo_mode === 'custom' && branding.logo_url
      ? branding.logo_url
      : standardSrc

  if (art === 'msm' && branding?.season_logo_mode === 'disabled') {
    return (
      <img
        src={effectiveStandard}
        alt={alt}
        className={className}
        onError={onError}
      />
    )
  }

  const useCustomSeasons = art === 'msm' && branding?.season_logo_mode === 'custom'
  const birthday =
    (useCustomSeasons && branding?.season_logos?.birthday) ||
    (art === 'msm' ? SEASON_ASSETS.birthday.logoMsm : SEASON_ASSETS.birthday.logoPontis)
  const halloween =
    (useCustomSeasons && branding?.season_logos?.halloween) ||
    (art === 'msm' ? SEASON_ASSETS.halloween.logoMsm : SEASON_ASSETS.halloween.logoPontis)
  const christmas =
    (useCustomSeasons && branding?.season_logos?.christmas) ||
    (art === 'msm' ? SEASON_ASSETS.christmas.logoMsm : SEASON_ASSETS.christmas.logoPontis)

  return (
    <>
      <img src={effectiveStandard} alt={alt} className={`season-logo-standard ${className}`} onError={onError} />
      <img src={birthday} alt="" aria-hidden="true" loading="lazy" decoding="async" className={`season-logo-birthday ${className}`} onError={onError} />
      <img src={halloween} alt="" aria-hidden="true" loading="lazy" decoding="async" className={`season-logo-halloween ${className}`} onError={onError} />
      <img src={christmas} alt="" aria-hidden="true" loading="lazy" decoding="async" className={`season-logo-christmas ${className}`} onError={onError} />
    </>
  )
}
