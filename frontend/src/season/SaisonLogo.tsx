import { SEASON_ASSETS } from './assets'

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
 * sichtbar ist, entscheidet `data-season` per CSS. So bleibt das Standard-Logo
 * vollstaendig erhalten und muss bei Rueckkehr zum Normalzustand nicht
 * erneut geladen werden.
 */
export function SaisonLogo({ art, standardSrc, className = '', alt, onError }: SaisonLogoProps) {
  const birthday = art === 'msm' ? SEASON_ASSETS.birthday.logoMsm : SEASON_ASSETS.birthday.logoPontis
  const halloween = art === 'msm' ? SEASON_ASSETS.halloween.logoMsm : SEASON_ASSETS.halloween.logoPontis
  const christmas = art === 'msm' ? SEASON_ASSETS.christmas.logoMsm : SEASON_ASSETS.christmas.logoPontis

  return (
    <>
      <img src={standardSrc} alt={alt} className={`season-logo-standard ${className}`} onError={onError} />
      <img src={birthday} alt="" aria-hidden="true" loading="lazy" decoding="async" className={`season-logo-birthday ${className}`} onError={onError} />
      <img src={halloween} alt="" aria-hidden="true" loading="lazy" decoding="async" className={`season-logo-halloween ${className}`} onError={onError} />
      <img src={christmas} alt="" aria-hidden="true" loading="lazy" decoding="async" className={`season-logo-christmas ${className}`} onError={onError} />
    </>
  )
}
