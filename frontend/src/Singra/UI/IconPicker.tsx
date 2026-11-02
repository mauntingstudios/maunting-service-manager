import React from 'react'
import {
  Award,
  Ban,
  Bot,
  Code,
  Compass,
  Crown,
  Eye,
  Flame,
  Gem,
  Heart,
  Lock,
  MessageSquare,
  Shield,
  ShieldCheck,
  Sparkles,
  Star,
  Swords,
  Terminal,
  UserCheck,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react'

export interface RoleIconDef {
  key: string
  label: string
  icon: LucideIcon
}

export const ROLE_ICONS: readonly RoleIconDef[] = [
  { key: 'crown', label: 'Krone (Lead / Inhaber)', icon: Crown },
  { key: 'shield', label: 'Schild (Admin)', icon: Shield },
  { key: 'shield-check', label: 'Geprüft (Moderator)', icon: ShieldCheck },
  { key: 'wrench', label: 'Schraubenschlüssel (Technik)', icon: Wrench },
  { key: 'code', label: 'Code (Entwicklung)', icon: Code },
  { key: 'terminal', label: 'Terminal (Operator)', icon: Terminal },
  { key: 'bot', label: 'Bot (Automatisierung)', icon: Bot },
  { key: 'sparkles', label: 'Glanz (VIP / Feature)', icon: Sparkles },
  { key: 'star', label: 'Stern (Favorit)', icon: Star },
  { key: 'heart', label: 'Herz (Community)', icon: Heart },
  { key: 'flame', label: 'Flamme (Aktivität)', icon: Flame },
  { key: 'zap', label: 'Blitz (Schnelligkeit)', icon: Zap },
  { key: 'award', label: 'Auszeichnung (Veteran)', icon: Award },
  { key: 'user-check', label: 'Benutzer-Check (Verifiziert)', icon: UserCheck },
  { key: 'eye', label: 'Auge (Beobachter / Gast)', icon: Eye },
  { key: 'lock', label: 'Schloss (Sicherheit / Tresor)', icon: Lock },
  { key: 'swords', label: 'Schwerter (Gaming / PvP)', icon: Swords },
  { key: 'compass', label: 'Kompass (Guide / Helfer)', icon: Compass },
  { key: 'gem', label: 'Edelstein (Premium)', icon: Gem },
  { key: 'message-square', label: 'Sprechblase (Redaktion)', icon: MessageSquare },
] as const

const ICON_MAP = new Map<string, LucideIcon>(
  ROLE_ICONS.map((item) => [item.key, item.icon]),
)

export function getRoleIconComponent(key?: string | null): LucideIcon | null {
  if (!key) return null
  return ICON_MAP.get(key) ?? null
}

export function renderRoleIcon(
  key?: string | null,
  className = 'h-3.5 w-3.5',
): React.ReactNode {
  const IconComponent = getRoleIconComponent(key)
  if (!IconComponent) return null
  return <IconComponent className={className} aria-hidden="true" />
}

export interface IconPickerProps {
  value: string | null | undefined
  onChange: (iconKey: string | null) => void
  disabled?: boolean
  className?: string
  label?: string
}

export function IconPicker({
  value,
  onChange,
  disabled = false,
  className = '',
  label,
}: IconPickerProps) {
  const currentKey = value || null

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center justify-between">
        {label && (
          <label className="block text-xs font-semibold text-on-surface">
            {label}
          </label>
        )}
        {currentKey && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(null)}
            className="text-label-sm text-on-surface-variant hover:text-on-surface underline disabled:opacity-50"
          >
            Icon zurücksetzen
          </button>
        )}
      </div>

      <div
        className="flex flex-wrap items-center gap-2 p-2.5 rounded-xl border border-outline-variant/30 bg-surface-container-high/30 max-h-48 overflow-y-auto"
        role="radiogroup"
        aria-label={label || 'Rollen-Icon auswählen'}
      >
        {/* Option 'Kein Icon' */}
        <button
          type="button"
          role="radio"
          aria-checked={currentKey === null}
          disabled={disabled}
          onClick={() => onChange(null)}
          title="Kein Icon"
          aria-label="Kein Icon"
          className={`h-9 w-9 rounded-lg flex items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
            currentKey === null
              ? 'bg-primary/20 text-primary border border-primary/40 shadow-xs'
              : 'text-on-surface-variant/60 hover:text-on-surface hover:bg-surface-container-high'
          }`}
        >
          <Ban className="h-4 w-4" />
        </button>

        {/* 20 Icons */}
        {ROLE_ICONS.map((item) => {
          const isSelected = currentKey === item.key
          const Icon = item.icon

          return (
            <button
              key={item.key}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={disabled}
              onClick={() => onChange(item.key)}
              title={item.label}
              aria-label={item.label}
              className={`h-9 w-9 rounded-lg flex items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                isSelected
                  ? 'bg-primary text-on-primary shadow-sm scale-105'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
              }`}
            >
              <Icon className="h-4 w-4" />
            </button>
          )
        })}
      </div>
    </div>
  )
}
