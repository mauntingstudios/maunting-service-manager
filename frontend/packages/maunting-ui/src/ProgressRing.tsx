/**
 * ProgressRing — moderner kreisförmiger Auslastungsring auf Basis von
 * nativem `<progress>`, `conic-gradient()` und `@property`-Transition.
 * Unbekannte Werte bleiben ruhig als leerer Track sichtbar, nie als 0% vorgetäuscht.
 */
import type { CSSProperties, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cx } from './intern/cx'

export interface ProgressRingProps {
  /** 0–100, oder null/undefined wenn keine prozentuale Auslastung vorliegt */
  value: number | null | undefined
  /** Sichtbarer Name neben dem Ring (z. B. "CPU", "RAM", "Disk") */
  label: string
  /** Gut lesbarer Hauptwert neben dem Label (z. B. "34.2%", "6.4 GB", "—") */
  displayValue: string
  /** Ruhige Zusatzinfo unter dem Hauptwert (z. B. "von 12.0 GB", "Unbegrenzt") */
  hint?: string
  /** Abweichendes Label für Screenreader */
  ariaLabel?: string
  /** Ruhiges Symbol im Ring, solange kein Prozentwert vorliegt */
  icon?: ReactNode
  /** Färbt den Ring ab 70 % in Warnung und ab 90 % in Gefahr um */
  heat?: boolean
  /** Ring-Durchmesser in Pixeln (Standard: 48) */
  size?: number
  className?: string
  'data-testid'?: string
}

export function ProgressRing({
  value,
  label,
  displayValue,
  hint,
  ariaLabel,
  icon,
  heat = false,
  size = 48,
  className = '',
  'data-testid': testId,
}: ProgressRingProps) {
  const { t } = useTranslation()
  const known = value != null && Number.isFinite(value)
  const clamped = known ? Math.max(0, Math.min(100, value as number)) : 0

  let fillToken = 'hsl(var(--mui-focus))'
  let glowToken = 'hsl(var(--mui-focus) / 0.16)'
  if (heat && known) {
    if (clamped >= 90) {
      fillToken = 'hsl(var(--mui-danger))'
      glowToken = 'hsl(var(--mui-danger) / 0.2)'
    } else if (clamped >= 70) {
      fillToken = 'hsl(var(--mui-warning))'
      glowToken = 'hsl(var(--mui-warning) / 0.18)'
    }
  }

  const ringStyle = {
    '--ring-size': `${size}px`,
    '--ring-fill': fillToken,
    '--mui-ring-value': known ? clamped : 0,
    boxShadow: known && clamped > 0 ? `0 0 14px ${glowToken}` : undefined,
  } as CSSProperties

  const centerText = known ? `${Math.round(clamped)}%` : null
  const valueText = known
    ? [displayValue, hint].filter(Boolean).join(' · ')
    : t('common.unbekannt')

  return (
    <div className={cx('flex items-center gap-3 min-w-0', className)} data-testid={testId}>
      <div className="relative grid shrink-0 place-items-center">
        <progress
          className="msm-progress-ring"
          style={ringStyle}
          max={100}
          value={known ? Math.round(clamped) : undefined}
          aria-label={ariaLabel ?? label}
          aria-valuetext={valueText}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 grid place-items-center text-label-sm font-medium tabular-nums text-on-surface"
        >
          {centerText ?? (
            <span className="text-on-surface-variant inline-flex items-center justify-center">
              {icon ?? '—'}
            </span>
          )}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-xs font-medium text-on-surface-variant shrink-0">
            {label}
          </span>
          <span className="font-headline text-sm font-semibold text-on-surface tabular-nums truncate">
            {displayValue}
          </span>
        </div>
        {hint ? (
          <p className="text-xs text-on-surface-variant truncate mt-0.5">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  )
}
