import { LOGO_CONFIG } from '@/config/logo'
import { useEffect, useState } from 'react'
import { SaisonLogo } from '@/season/SaisonLogo'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'

interface LogoProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeClasses = {
  sm: 'w-6 h-6',
  md: 'w-10 h-10',
  lg: 'w-16 h-16',
} as const

/**
 * Central Logo component.
 *
 * Displays the configured MSM or Whitelabel logo and falls back to brand
 * initials when the image fails to load.
 */
export function Logo({ size = 'md', className = '' }: LogoProps) {
  const branding = usePublicSettingsStore((s) => s.branding)
  const effectiveSrc =
    branding?.logo_mode === 'custom' && branding.logo_url ? branding.logo_url : LOGO_CONFIG.src
  const effectiveAlt = branding?.custom_name || LOGO_CONFIG.alt
  const fallbackText = branding?.custom_name
    ? branding.custom_name.slice(0, 3).toUpperCase()
    : 'MSM'
  const [failed, setFailed] = useState(false)
  const cls = sizeClasses[size]

  useEffect(() => {
    setFailed(false)
  }, [effectiveSrc])

  return (
    <div className={`${cls} relative flex-shrink-0 ${className}`}>
      {!failed ? (
        <SaisonLogo
          art="msm"
          standardSrc={LOGO_CONFIG.src}
          alt={effectiveAlt}
          className={`${cls} msm-logo-bild block object-cover rounded-full border border-primary/20`}
          onError={() => setFailed(true)}
        />
      ) : (
        <div
          className={`${cls} msm-logo-bild flex items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-label-sm font-bold text-primary`}
          aria-label={effectiveAlt}
          role="img"
        >
          {fallbackText}
        </div>
      )}
    </div>
  )
}
