import React, { useEffect, useRef, useState } from 'react'
import { Check, Hash } from 'lucide-react'

import { still } from '@/lib/still'
import { Ankerfenster } from './Ankerfenster'

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
const FALLBACK_HEX = '#3b82f6'

interface Hsv {
  h: number
  s: number
  v: number
}

function hexZuRgb(hex: string): [number, number, number] | null {
  const sauber = hex.trim().replace(/^#/, '')
  const voll =
    sauber.length === 3
      ? sauber
          .split('')
          .map((z) => z + z)
          .join('')
      : sauber
  if (!/^[0-9a-fA-F]{6}$/.test(voll)) return null
  return [parseInt(voll.slice(0, 2), 16), parseInt(voll.slice(2, 4), 16), parseInt(voll.slice(4, 6), 16)]
}

function rgbZuHsv(r: number, g: number, b: number): Hsv {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / d) % 6)
    else if (max === gn) h = 60 * ((bn - rn) / d + 2)
    else h = 60 * ((rn - gn) / d + 4)
  }
  if (h < 0) h += 360
  return { h, s: max === 0 ? 0 : (d / max) * 100, v: max * 100 }
}

function hsvZuRgb(h: number, s: number, v: number): [number, number, number] {
  const sn = s / 100
  const vn = v / 100
  const c = vn * sn
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = vn - c
  let rn = 0
  let gn = 0
  let bn = 0
  if (h < 60) [rn, gn] = [c, x]
  else if (h < 120) [rn, gn] = [x, c]
  else if (h < 180) [gn, bn] = [c, x]
  else if (h < 240) [gn, bn] = [x, c]
  else if (h < 300) [rn, bn] = [x, c]
  else [rn, bn] = [c, x]
  const zu255 = (n: number) => Math.round((n + m) * 255)
  return [zu255(rn), zu255(gn), zu255(bn)]
}

function rgbZuHex(r: number, g: number, b: number): string {
  const teil = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')
  return `#${teil(r)}${teil(g)}${teil(b)}`
}

function hexZuHsv(hex: string): Hsv {
  const rgb = hexZuRgb(hex) ?? hexZuRgb(FALLBACK_HEX)!
  return rgbZuHsv(rgb[0], rgb[1], rgb[2])
}

function hsvZuHex(h: number, s: number, v: number): string {
  const [r, g, b] = hsvZuRgb(h, s, v)
  return rgbZuHex(r, g, b)
}

const klemmen = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

export function ColorPicker({
  value,
  onChange,
  disabled = false,
  className = '',
  label,
}: ColorPickerProps) {
  const currentColor = value || FALLBACK_HEX
  const [hexInput, setHexInput] = useState(currentColor.toUpperCase())
  const [offen, setOffen] = useState(false)
  const [hsv, setHsv] = useState<Hsv>(() => hexZuHsv(currentColor))
  const ausloeserRef = useRef<HTMLButtonElement>(null)
  const flaecheRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setHexInput(currentColor.toUpperCase())
  }, [currentColor])

  useEffect(() => {
    setHsv(hexZuHsv(currentColor))
  }, [currentColor])

  const melde = (naechste: Hsv) => {
    setHsv(naechste)
    onChange(hsvZuHex(naechste.h, naechste.s, naechste.v))
  }

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

  const farbeAusZeiger = (clientX: number, clientY: number): Hsv | null => {
    const feld = flaecheRef.current?.getBoundingClientRect()
    if (!feld || feld.width === 0 || feld.height === 0) return null
    return {
      h: hsv.h,
      s: klemmen(((clientX - feld.left) / feld.width) * 100, 0, 100),
      v: klemmen((1 - (clientY - feld.top) / feld.height) * 100, 0, 100),
    }
  }

  const handleFlaechenZeiger = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons !== 1) return
    const naechste = farbeAusZeiger(e.clientX, e.clientY)
    if (naechste) melde(naechste)
  }

  const handleFlaechenTasten = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const schritt = e.shiftKey ? 10 : 1
    let naechste: Hsv | null = null
    if (e.key === 'ArrowLeft') naechste = { ...hsv, s: klemmen(hsv.s - schritt, 0, 100) }
    else if (e.key === 'ArrowRight') naechste = { ...hsv, s: klemmen(hsv.s + schritt, 0, 100) }
    else if (e.key === 'ArrowUp') naechste = { ...hsv, v: klemmen(hsv.v + schritt, 0, 100) }
    else if (e.key === 'ArrowDown') naechste = { ...hsv, v: klemmen(hsv.v - schritt, 0, 100) }
    else if (e.key === 'Home') naechste = { ...hsv, s: 0, v: 100 }
    else if (e.key === 'End') naechste = { ...hsv, s: 100, v: 100 }
    if (naechste) {
      e.preventDefault()
      melde(naechste)
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
      <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label={label || 'Farbauswahl'}>
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
              className={`relative h-8 w-8 rounded-lg transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 flex items-center justify-center ${
                isSelected
                  ? 'scale-110 ring-2 ring-primary ring-offset-2 ring-offset-surface shadow-sm'
                  : 'hover:scale-105 opacity-85 hover:opacity-100 disabled:opacity-50'
              }`}
              style={{ backgroundColor: preset.value }}
              aria-label={preset.label}
            >
              {isSelected && (
                <Check className="h-3.5 w-3.5 text-white drop-shadow-sm" />
              )}
            </button>
          )
        })}
      </div>

      {/* Custom Hex Input mit Live-Vorschau — die Vorschau öffnet die Palette */}
      <div className="flex items-center gap-2 pt-0.5">
        <button
          ref={ausloeserRef}
          type="button"
          disabled={disabled}
          onClick={() => setOffen((war) => !war)}
          aria-haspopup="dialog"
          aria-expanded={offen}
          aria-label="Farbpalette öffnen"
          className="h-8 w-8 rounded-lg shrink-0 border border-outline-variant/40 shadow-sm transition-all hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50 disabled:hover:scale-100"
          style={{ backgroundColor: HEX_REGEX.test(hexInput) ? hexInput : currentColor }}
        >
          <span className="sr-only">Aktuelle Farbe: {currentColor}</span>
        </button>

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

        <span className="text-label-sm text-on-surface-variant font-mono">
          {HEX_REGEX.test(hexInput) ? 'Gültig' : 'HEX (#RRGGBB)'}
        </span>
      </div>

      <Ankerfenster
        offen={offen && !disabled}
        onSchliessen={() => setOffen(false)}
        anker={ausloeserRef}
        label="Eigene Farbe wählen"
        className="w-64 p-3.5"
      >
        <div className="space-y-3">
          <div
            ref={flaecheRef}
            role="slider"
            tabIndex={0}
            aria-label="Sättigung und Helligkeit"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(hsv.s)}
            aria-valuetext={`${Math.round(hsv.s)} Prozent Sättigung, ${Math.round(hsv.v)} Prozent Helligkeit`}
            className="relative h-40 w-full cursor-crosshair touch-none rounded-lg border border-outline-variant/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            style={{
              background: `linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 100%), linear-gradient(to right, rgba(255,255,255,1) 0%, rgba(255,255,255,0) 100%), hsl(${Math.round(hsv.h)}, 100%, 50%)`,
            }}
            onPointerDown={(e) => {
              try {
                e.currentTarget.setPointerCapture(e.pointerId)
              } catch (err) {
                // jsdom kennt keine Zeigerbindung; das Ziehen läuft trotzdem.
                still(err, 'ColorPicker.zeigerbindung')
              }
              const naechste = farbeAusZeiger(e.clientX, e.clientY)
              if (naechste) melde(naechste)
            }}
            onPointerMove={handleFlaechenZeiger}
            onKeyDown={handleFlaechenTasten}
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md"
              style={{
                left: `${hsv.s}%`,
                top: `${100 - hsv.v}%`,
                backgroundColor: hsvZuHex(hsv.h, hsv.s, hsv.v),
              }}
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="font-label-md text-label-md uppercase tracking-wider text-on-surface-variant">
                Farbton
              </span>
              <span className="font-mono-sm text-mono-sm text-on-surface-variant">
                {Math.round(hsv.h)}°
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={359}
              step={1}
              value={Math.round(hsv.h)}
              onChange={(e) => melde({ ...hsv, h: Number(e.target.value) })}
              aria-label="Farbton"
              className="h-3 w-full cursor-pointer appearance-none rounded-full disabled:cursor-not-allowed disabled:opacity-50 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-white/90 [&::-webkit-slider-thumb]:shadow-md [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-white/90 [&::-moz-range-track]:bg-transparent"
              style={{
                background:
                  'linear-gradient(to right, hsl(0,100%,50%), hsl(60,100%,50%), hsl(120,100%,50%), hsl(180,100%,50%), hsl(240,100%,50%), hsl(300,100%,50%), hsl(360,100%,50%))',
              }}
            />
          </div>

          <div className="flex items-center gap-2.5 rounded-lg border border-outline-variant/40 bg-surface-container-low/60 px-2.5 py-2">
            <span
              aria-hidden="true"
              className="h-8 w-8 shrink-0 rounded-md border border-outline-variant/40 shadow-sm"
              style={{ backgroundColor: hsvZuHex(hsv.h, hsv.s, hsv.v) }}
            />
            <span className="font-mono-sm text-mono-sm uppercase tracking-wider text-on-surface">
              {hsvZuHex(hsv.h, hsv.s, hsv.v)}
            </span>
          </div>
        </div>
      </Ankerfenster>
    </div>
  )
}
