import { useId, type ReactNode } from 'react'
import { Download } from 'lucide-react'

interface DownloadKnopfProps {
  href: string
  icon: ReactNode
  /** Der Name — `titel`, nicht `title`: Letzteres zeichnete der Browser als Tooltip. */
  titel: string
  subtext: string
  tooltip: string
}

/**
 * Der Download-Knopf in der Kopfleiste: ein Symbol, das beim Überfahren und
 * beim Tastaturfokus seinen Namen ausklappt.
 *
 * Bewusst nur die Darstellung: Ob ein Knopf überhaupt erscheint, entscheidet
 * jede Seite selbst (`BrowserDownloadBadge`, `DesktopAppDownloadBadge`). Der
 * Name bleibt immer im DOM, nur die Breite ist zu — Screenreader und Tests
 * sehen ihn auch ohne Hover.
 */
/**
 * Die Download-Zeile fürs mobile Menü: gleiche Aussage wie der Knopf, aber
 * als 48 px hohe Zeile mit sichtbarem Namen — am Finger gibt es kein Hover,
 * das ihn ausklappen könnte.
 */
export function DownloadZeile({ href, icon, titel, subtext, tooltip }: DownloadKnopfProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={tooltip}
      className="flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-on-surface transition-colors hover:bg-surface-container-high"
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center text-primary" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{titel}</span>
        <span className="block truncate text-label-sm text-on-surface-variant">{subtext}</span>
      </span>
      <Download className="h-4 w-4 shrink-0 text-on-surface-variant" aria-hidden="true" />
    </a>
  )
}

export function DownloadKnopf({ href, icon, titel, subtext, tooltip }: DownloadKnopfProps) {
  const hinweisId = useId()
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={tooltip}
      aria-describedby={hinweisId}
      className="group inline-flex h-9 items-center gap-0 overflow-hidden rounded-xl border border-outline-variant/30 bg-surface-container-high/60 text-on-surface-variant transition-colors duration-150 hover:border-primary/40 hover:bg-surface-container-highest/80 hover:text-on-surface focus-visible:border-primary/40 focus-visible:text-on-surface"
    >
      <span id={hinweisId} className="sr-only">{subtext}</span>
      <span className="grid h-9 w-9 shrink-0 place-items-center text-primary" aria-hidden="true">
        {icon}
      </span>
      <span
        aria-hidden="true"
        className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-[max-width,opacity,margin] duration-150 motion-safe:group-hover:mr-2.5 motion-safe:group-hover:max-w-44 motion-safe:group-hover:opacity-100 motion-safe:group-focus-visible:mr-2.5 motion-safe:group-focus-visible:max-w-44 motion-safe:group-focus-visible:opacity-100"
      >
        <span className="flex items-center gap-1 text-xs font-medium">
          {titel}
          <Download className="h-3 w-3 text-primary" />
        </span>
      </span>
    </a>
  )
}
