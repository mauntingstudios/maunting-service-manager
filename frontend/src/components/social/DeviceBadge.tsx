import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Kurzinfo } from '@/Singra/UI'
import type { PraesenzClient } from '@/api/social'

export type DeviceType = 'web' | 'desktop' | 'mobile'

interface DeviceBadgeProps {
  /** Welche Oberfläche offen ist. Fehlt sie, entscheidet die Plattform. */
  client?: PraesenzClient | string | null
  deviceType?: DeviceType | string | null
  className?: string
  showLabel?: boolean
}

const GLobus = (
  <>
    <circle cx="12" cy="12" r="10" />
    <line x1="2" x2="22" y1="12" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </>
)

const Bildschirm = (
  <>
    <rect width="20" height="14" x="2" y="3" rx="2" />
    <line x1="8" x2="16" y1="21" y2="21" />
    <line x1="12" x2="12" y1="17" y2="21" />
  </>
)

const Handy = (
  <>
    <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
    <path d="M12 18h.01" />
  </>
)

const Kompass = (
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="m16.24 7.76-2.12 6.36-6.36 2.12 2.12-6.36z" />
  </>
)

/**
 * Zeigt, wo jemand gerade offen ist: Web-Panel, Pontis oder MSM-App.
 *
 * Bis 27.10.2026 meldeten beide Apps dieselbe Plattform, und ein schmales
 * Browserfenster galt als Handy. Der Name kommt jetzt aus dem Client; ohne ihn
 * fällt das Abzeichen auf die Plattform zurück (Altbestand).
 */
export function DeviceBadge({
  client,
  deviceType = 'web',
  className = '',
  showLabel = false,
}: DeviceBadgeProps) {
  const { t } = useTranslation()

  const art = artFuer(client, deviceType, t)

  return (
    <Huelle text={art.text} sichtbar={showLabel}>
      <span
        role="img"
        className={`inline-flex items-center gap-1.5 text-xs font-medium ${art.farbe} ${className}`}
        aria-label={art.text}
      >
        <svg
          className="w-3.5 h-3.5 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {art.symbol}
        </svg>
        {showLabel && <span>{art.text}</span>}
      </span>
    </Huelle>
  )
}

function artFuer(
  client: PraesenzClient | string | null | undefined,
  deviceType: DeviceType | string | null | undefined,
  t: (schluessel: string) => string,
): { text: string; farbe: string; symbol: ReactNode } {
  if (client === 'pontis') {
    return { text: t('presence.client.pontis'), farbe: 'text-primary/90', symbol: Kompass }
  }
  if (client === 'mss') {
    const mobil = (deviceType || 'desktop').toLowerCase() === 'mobile'
    return {
      text: t('presence.client.mss'),
      farbe: 'text-primary/90',
      symbol: mobil ? Handy : Bildschirm,
    }
  }
  if (client === 'web') {
    return { text: t('presence.client.web'), farbe: 'text-on-surface-variant/80', symbol: GLobus }
  }

  const type = (deviceType || 'web').toLowerCase()
  if (type === 'mobile') {
    return { text: t('social.device.mobile'), farbe: 'text-tertiary/90', symbol: Handy }
  }
  if (type === 'desktop') {
    return { text: t('social.device.desktop'), farbe: 'text-primary/90', symbol: Bildschirm }
  }
  return { text: t('social.device.web'), farbe: 'text-on-surface-variant/80', symbol: GLobus }
}

/** Steht der Name nicht sichtbar daneben, zeigt ihn eine Kurzinfo am Symbol. */
function Huelle({ text, sichtbar, children }: { text: string; sichtbar: boolean; children: ReactNode }) {
  return sichtbar ? <>{children}</> : <Kurzinfo text={text}>{children}</Kurzinfo>
}
