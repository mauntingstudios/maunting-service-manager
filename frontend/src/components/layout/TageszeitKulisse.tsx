import { type ReactNode } from 'react'
import { TageszeitHintergrund } from './TageszeitHintergrund'
import { useTageszeitMotiv } from '@/lib/tageszeit'

export interface TageszeitKulisseProps {
  children: ReactNode
  className?: string
}

/**
 * Vollflächiger Tageszeit-Hintergrund ohne Kartenrahmen: dieselben Szenen wie
 * `TageszeitBanner`, aber über die obere Fläche verteilt und weich in die
 * Oberfläche verlaufend. Für Bildschirme, die kein Banner brauchen (z. B. die
 * Tresor-Sperre).
 */
export function TageszeitKulisse({ children, className = '' }: TageszeitKulisseProps) {
  const motiv = useTageszeitMotiv()

  return (
    <div className={`relative isolate flex h-full w-full flex-col overflow-hidden ${className}`}>
      <TageszeitHintergrund motiv={motiv} hoehe="h-[70%]" deckkraft="opacity-35" ebene="-z-10" verlauf="" />
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-transparent via-surface/40 to-surface"
        aria-hidden="true"
      />
      {children}
    </div>
  )
}
