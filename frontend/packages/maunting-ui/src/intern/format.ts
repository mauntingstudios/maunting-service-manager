/** Die 12/24-Stunden-Einstellung des Panels. */
export type PanelTimeFormat = '24h' | '12h'

const KIB = 1024
const MIB = KIB * 1024
const GIB = MIB * 1024
const TIB = GIB * 1024

const STUFEN = [
  { name: 'KB', teiler: KIB, stellen: 1 },
  { name: 'MB', teiler: MIB, stellen: 1 },
  { name: 'GB', teiler: GIB, stellen: 2 },
  { name: 'TB', teiler: TIB, stellen: 2 },
] as const

/** „512 B“, „1.5 KB“, „3.00 GB“. Unbekannt heißt „-“, „0 B“ heißt leer. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '-'
  if (Math.round(bytes) < KIB) return `${Math.round(bytes)} B`
  for (const [i, { name, teiler, stellen }] of STUFEN.entries()) {
    const wert = (bytes / teiler).toFixed(stellen)
    if (Number(wert) < 1024 || i === STUFEN.length - 1) return `${wert} ${name}`
  }
  return '-'
}

export interface ZeitpunktOptionen {
  /** Die 12/24-Stunden-Einstellung des Panels; ohne sie gilt die Sprache. */
  zeitformat?: PanelTimeFormat
  /** Die Zeit steht schon als Ortszeit in UTC (z. B. EXIF). */
  utc?: boolean
}

/** „02.10.2026, 14:05“ in der Sprache der App. */
export function formatZeitpunkt(wann: number | Date, sprache: string, optionen: ZeitpunktOptionen = {}): string {
  const datum = wann instanceof Date ? wann : new Date(wann)
  if (Number.isNaN(datum.getTime())) return '-'
  return new Intl.DateTimeFormat(sprache, {
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: optionen.zeitformat ? optionen.zeitformat === '12h' : undefined,
    timeZone: optionen.utc ? 'UTC' : undefined,
  }).format(datum)
}
