import React from 'react'
import { renderRoleIcon } from './IconPicker'

export interface RoleBadgeProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'color'> {
  name: string
  color?: string | null
  icon?: string | null
  isAdmin?: boolean
  size?: 'sm' | 'md'
  variant?: 'solid' | 'subtle'
  className?: string
}

export function RoleBadge({
  name,
  color = '#3b82f6',
  icon,
  isAdmin = false,
  size = 'sm',
  variant = 'solid',
  className = '',
  ...props
}: RoleBadgeProps) {
  const effectiveColor = color || '#3b82f6'
  const effectiveIconKey = icon || (isAdmin ? 'crown' : null)
  const iconSizeClass = size === 'sm' ? 'h-3 w-3 shrink-0' : 'h-3.5 w-3.5 shrink-0'

  if (variant === 'subtle') {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full border font-semibold transition-colors ${
          size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
        } ${className}`}
        style={{
          backgroundColor: `${effectiveColor}1a`, // ~10% opacity
          borderColor: `${effectiveColor}40`,     // ~25% opacity
          color: effectiveColor,
        }}
        {...props}
      >
        {renderRoleIcon(effectiveIconKey, iconSizeClass)}
        <span className="truncate">{name}</span>
      </span>
    )
  }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-semibold text-white transition-colors shadow-2xs ${
        size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
      } ${className}`}
      style={{
        backgroundColor: effectiveColor,
      }}
      {...props}
    >
      {renderRoleIcon(effectiveIconKey, iconSizeClass)}
      <span className="truncate">{name}</span>
    </span>
  )
}
