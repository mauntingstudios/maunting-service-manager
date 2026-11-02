import React, { useEffect, useState } from 'react'
import { Check, Hash } from 'lucide-react'

export const ROLE_COLOR_PRESETS = [
  { label: 'Blau', value: '#3b82f6' },
  { label: 'Smaragd', value: '#10b981' },
  { label: 'Violett', value: '#8b5cf6' },
  { label: 'Bernstein', value: '#f59e0b' },
  { label: 'Rose', value: '#f43f5e' },
  { label: 'Cyan', value: '#06b6d4' },
  { label: 'Indigo', value: '#6366f1' },
  { label: 'Schiefer', value: '#64748b' },
  { label: 'Orange', value: '#f97316' },
  { label: 'Pink', value: '#ec4899' },
  { label: 'Teal', value: '#14b8a6' },
  { label: 'Gelb', value: '#eab308' },
] as const

export interface ColorPickerProps {
  value: string
  onChange: (color: string) => void
  disabled?: boolean
  className?: string
  label?: string
}

const HEX_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

export function ColorPicker({
  value,
  onChange,
  disabled = false,
  className = '',
  label,
}: ColorPickerProps) {
  const currentColor = value || '#3b82f6'
  const [hexInput, setHexInput] = useState(currentColor.toUpperCase())

  useEffect(() => {
    setHexInput(currentColor.toUpperCase())
  }, [currentColor])

  const handlePresetClick = (presetHex: string) => {
    if (disabled) return
    setHexInput(presetHex.toUpperCase())
    onChange(presetHex)
  }

  const handleHexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let raw = e.target.value.trim()
    if (!raw.startsWith('#')) {
      raw = '#' + raw
    }
    setHexInput(raw.toUpperCase())
    if (HEX_REGEX.test(raw)) {
      onChange(raw.toLowerCase())
    }
  }

  const handleHexBlur = () => {
    if (!HEX_REGEX.test(hexInput)) {
      setHexInput(currentColor.toUpperCase())
    }
  }

  return (
    <div className={`space-y-2.5 ${className}`}>
      {label && (
        <label className="block text-xs font-semibold text-on-surface">
          {label}
        </label>
      )}

      {/* 12 Presets Grid */}
      <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label={label || 'Farbauswahl'}>
        {ROLE_COLOR_PRESETS.map((preset) => {
          const isSelected = currentColor.toLowerCase() === preset.value.toLowerCase()

          return (
            <button
              key={preset.value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={disabled}
              onClick={() => handlePresetClick(preset.value)}
              className={`relative h-7 w-7 rounded-lg transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 flex items-center justify-center ${
                isSelected
                  ? 'scale-110 ring-2 ring-primary ring-offset-2 ring-offset-surface shadow-sm'
                  : 'hover:scale-105 opacity-85 hover:opacity-100 disabled:opacity-50'
              }`}
              style={{ backgroundColor: preset.value }}
              title={preset.label}
              aria-label={preset.label}
            >
              {isSelected && (
                <Check className="h-3.5 w-3.5 text-white drop-shadow-xs" />
              )}
            </button>
          )
        })}
      </div>

      {/* Custom Hex Input mit Live-Vorschau */}
      <div className="flex items-center gap-2 pt-0.5">
        <div
          className="h-8 w-8 rounded-lg shrink-0 border border-outline-variant/40 shadow-xs flex items-center justify-center transition-colors"
          style={{ backgroundColor: HEX_REGEX.test(hexInput) ? hexInput : currentColor }}
        >
          <span className="sr-only">Aktuelle Farbe: {currentColor}</span>
        </div>

        <div className="relative flex-1 max-w-[10rem]">
          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5 text-on-surface-variant/60">
            <Hash className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <input
            type="text"
            value={hexInput.replace(/^#/, '')}
            onChange={(e) => {
              const val = e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6)
              handleHexChange({ target: { value: '#' + val } } as any)
            }}
            onBlur={handleHexBlur}
            disabled={disabled}
            placeholder="3B82F6"
            maxLength={6}
            className="msm-input h-8 pl-7 text-xs font-mono uppercase tracking-wider disabled:opacity-50"
            aria-label="Hex-Farbwert"
          />
        </div>

        <span className="text-[11px] text-on-surface-variant font-mono">
          {HEX_REGEX.test(hexInput) ? 'Gültig' : 'HEX (#RRGGBB)'}
        </span>
      </div>
    </div>
  )
}
