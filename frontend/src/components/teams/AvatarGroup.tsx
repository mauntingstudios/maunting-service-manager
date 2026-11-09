import React from 'react'
import { Avatar } from '@/components/app/Avatar'

export interface AvatarGroupItem {
  id?: string | number
  name?: string | null
  src?: string | null
  avatar_url?: string | null
}

export interface AvatarGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  items: AvatarGroupItem[]
  max?: number
  size?: 'xs' | 'sm' | 'md' | 'lg'
  ringClassName?: string
  onOverflowClick?: () => void
}

const spacingClasses = {
  xs: '-space-x-1.5',
  sm: '-space-x-2',
  md: '-space-x-2.5',
  lg: '-space-x-3',
}

const badgeSizeClasses = {
  xs: 'h-6 min-w-[1.5rem] px-1 text-label-sm',
  sm: 'h-8 min-w-[2rem] px-1.5 text-xs',
  md: 'h-10 min-w-[2.5rem] px-2 text-xs font-semibold',
  lg: 'h-12 min-w-[3rem] px-2.5 text-sm font-semibold',
}

/**
 * Gestapelte Avatar-Gruppe für Teammitglieder mit Überlauf-Zähler (+N).
 */
export function AvatarGroup({
  items,
  max = 4,
  size = 'sm',
  ringClassName = 'ring-2 ring-surface-container-high/90',
  className = '',
  onOverflowClick,
  ...props
}: AvatarGroupProps) {
  if (!items || items.length === 0) return null

  const visibleItems = items.slice(0, max)
  const overflowCount = Math.max(0, items.length - max)

  return (
    <div
      role="group"
      aria-label="Mitglieder"
      className={`inline-flex items-center ${spacingClasses[size]} ${className}`}
      {...props}
    >
      {visibleItems.map((item, index) => (
        <div
          key={item.id ?? `${item.name ?? 'member'}-${index}`}
          className={`relative rounded-full transition-transform duration-200 hover:z-10 hover:scale-105 ${ringClassName}`}
        >
          <Avatar
            src={item.src ?? item.avatar_url}
            name={item.name}
            size={size}
            alt={item.name || undefined}
          />
        </div>
      ))}

      {overflowCount > 0 && (
        <button
          type="button"
          disabled={!onOverflowClick}
          onClick={onOverflowClick}
          aria-label={`Weitere ${overflowCount} Mitglieder anzeigen`}
          className={`relative inline-flex items-center justify-center rounded-full font-medium text-on-surface-variant border border-outline-variant/30 bg-surface-container-high/90 backdrop-blur-md transition-transform duration-200 hover:z-10 ${
            onOverflowClick ? 'cursor-pointer hover:scale-105 hover:bg-surface-container-highest active:scale-95 text-primary' : ''
          } ${badgeSizeClasses[size]} ${ringClassName}`}
        >
          +{overflowCount}
        </button>
      )}
    </div>
  )
}
