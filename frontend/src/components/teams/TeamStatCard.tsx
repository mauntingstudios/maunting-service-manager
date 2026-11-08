import React, { type CSSProperties, type ReactNode } from 'react'

export type StatAccent = 'blue' | 'green' | 'purple' | 'amber' | 'cyan' | 'pink'

export interface TeamStatCardProps extends React.HTMLAttributes<HTMLDivElement> {
  icon: ReactNode
  value: number | string
  label: string
  accent?: StatAccent
  compact?: boolean
}

const accentStyles: Record<StatAccent, CSSProperties> = {
  blue: {
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
    color: '#60a5fa',
    borderColor: 'rgba(59, 130, 246, 0.3)',
  },
  green: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    color: '#34d399',
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  purple: {
    backgroundColor: 'rgba(168, 85, 247, 0.12)',
    color: '#c084fc',
    borderColor: 'rgba(168, 85, 247, 0.3)',
  },
  amber: {
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    color: '#fbbf24',
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  cyan: {
    backgroundColor: 'rgba(6, 182, 212, 0.12)',
    color: '#22d3ee',
    borderColor: 'rgba(6, 182, 212, 0.3)',
  },
  pink: {
    backgroundColor: 'rgba(244, 63, 94, 0.12)',
    color: '#fb7185',
    borderColor: 'rgba(244, 63, 94, 0.3)',
  },
}

/**
 * KPI- und Metrik-Kachel für Team- und Organisations-Dashboards.
 */
export function TeamStatCard({
  icon,
  value,
  label,
  accent = 'blue',
  compact = false,
  className = '',
  ...props
}: TeamStatCardProps) {
  const currentAccentStyle = accentStyles[accent] ?? accentStyles.blue

  if (compact) {
    return (
      <div
        className={`flex flex-1 min-w-[70px] flex-col items-center justify-center gap-1 rounded-2xl border border-outline-variant/30 bg-surface-container-high/65 p-2 text-center backdrop-blur-xl transition-colors ${className}`}
        {...props}
      >
        <div
          style={currentAccentStyle}
          className="grid h-8 w-8 place-items-center rounded-xl border text-sm"
        >
          {icon}
        </div>
        <span className="font-headline text-base font-bold leading-tight text-on-surface">
          {value}
        </span>
        <span className="text-label-sm font-medium leading-none text-on-surface-variant truncate max-w-full">
          {label}
        </span>
      </div>
    )
  }

  return (
    <div
      className={`group flex items-center gap-3.5 rounded-2xl border border-outline-variant/30 bg-surface-container-high/65 p-4 backdrop-blur-xl transition-all duration-200 hover:border-outline-variant/50 hover:bg-surface-container-high/85 ${className}`}
      {...props}
    >
      <div
        style={currentAccentStyle}
        className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border text-xl shadow-inner transition-transform duration-200 group-hover:scale-105"
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-headline text-2xl font-bold tracking-tight text-on-surface">
          {value}
        </div>
        <div className="text-xs font-medium text-on-surface-variant truncate">
          {label}
        </div>
      </div>
    </div>
  )
}
