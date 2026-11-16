/**
 * Zeit- und Dauerformatierung sowie Log-Bereinigung fuer Deployments.
 * Nutzt Temporal + Intl.DurationFormat wenn nativ vorhanden und faellt
 * fuer aeltere Browser / Testumgebungen sauber auf Intl.RelativeTimeFormat zurueck.
 */

const ANSI_ESCAPE_PATTERN = /\x1b\[[0-9;?]*[ -/]*[@-~]/g

export function stripAnsiCodes(raw: string): string {
  return (raw || '').replace(ANSI_ESCAPE_PATTERN, '').replace(/\r\n?/g, '\n')
}

function resolveIntlLocale(locale?: string): string {
  const clean = (locale || '').trim().toLowerCase()
  if (clean.startsWith('en')) return 'en-US'
  return 'de-DE'
}

function parseTimestampMs(iso: string | null | undefined): number | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

type TemporalLike = {
  Instant?: {
    from: (iso: string) => {
      until: (other: unknown, opts: { largestUnit: string; smallestUnit: string }) => {
        hours?: number
        minutes?: number
        seconds?: number
        toLocaleString: (locale: string, opts: { style: string }) => string
      }
    }
    fromEpochMilliseconds: (ms: number) => unknown
  }
}

export function formatBuildDuration(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
  locale: string = 'de',
  nowMs: number = Date.now(),
): string | null {
  const startMs = parseTimestampMs(startIso)
  if (startMs === null) return null
  const endMs = parseTimestampMs(endIso) ?? nowMs
  const diffSec = Math.max(0, Math.round((endMs - startMs) / 1000))
  const intlLocale = resolveIntlLocale(locale)

  const temporalApi = (globalThis as { Temporal?: TemporalLike }).Temporal
  if (temporalApi?.Instant && startIso) {
    try {
      const tStart = temporalApi.Instant.from(startIso)
      const tEnd = endIso
        ? temporalApi.Instant.from(endIso)
        : temporalApi.Instant.fromEpochMilliseconds(nowMs)
      const dur = tStart.until(tEnd, { largestUnit: 'hour', smallestUnit: 'second' })
      if (typeof dur.toLocaleString === 'function') {
        return dur.toLocaleString(intlLocale, { style: 'short' })
      }
    } catch {
      // Fallback unterhalb nutzen
    }
  }

  const hours = Math.floor(diffSec / 3600)
  const minutes = Math.floor((diffSec % 3600) / 60)
  const seconds = diffSec % 60
  const DurationFmt = (
    Intl as {
      DurationFormat?: new (
        l: string,
        o: { style: string },
      ) => { format: (v: Record<string, number>) => string }
    }
  ).DurationFormat
  if (typeof DurationFmt === 'function') {
    const parts: Record<string, number> = {}
    if (hours > 0) parts.hours = hours
    if (minutes > 0) parts.minutes = minutes
    if (seconds > 0 || (hours === 0 && minutes === 0)) parts.seconds = seconds
    return new DurationFmt(intlLocale, { style: 'short' }).format(parts)
  }

  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

export function formatRelativeTime(
  iso: string | null | undefined,
  locale: string = 'de',
  nowMs: number = Date.now(),
): string | null {
  const targetMs = parseTimestampMs(iso)
  if (targetMs === null) return null
  const diffSec = Math.round((targetMs - nowMs) / 1000)
  const absSec = Math.abs(diffSec)
  const intlLocale = resolveIntlLocale(locale)

  if (absSec < 15) {
    return intlLocale.startsWith('en') ? 'just now' : 'gerade eben'
  }

  const rtf = new Intl.RelativeTimeFormat(intlLocale, { numeric: 'auto' })
  if (absSec < 60) return rtf.format(diffSec, 'second')
  const diffMin = Math.round(diffSec / 60)
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, 'minute')
  const diffHours = Math.round(diffMin / 60)
  if (Math.abs(diffHours) < 24) return rtf.format(diffHours, 'hour')
  const diffDays = Math.round(diffHours / 24)
  if (Math.abs(diffDays) < 30) return rtf.format(diffDays, 'day')
  const diffMonths = Math.round(diffDays / 30)
  return rtf.format(diffMonths, 'month')
}
