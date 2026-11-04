/**
 * Größen, Zeitpunkte und Dauern, wie sie überall in der Oberfläche stehen.
 *
 * Bis 02.10.2026 gab es die Bytes fünfmal (Dateimanager, Postgres-Studio, zwei
 * im Messenger, Aufräumkarte), jedes Mal mit eigenen Stufen: im Messenger
 * endete die Skala bei MB, eine unbekannte Größe hieß dort „0 B“. Die Dauer
 * eines Videos, einer Sprachnachricht und eines Anrufs sah dreimal anders aus.
 */
import { formatBytes, formatZeitpunkt } from '@maunting/ui'

export { formatBytes, formatZeitpunkt }
export type { ZeitpunktOptionen } from '@maunting/ui'

/** Dauer eines Videos, einer Sprachnachricht, eines Anrufs: „0:07“, „12:34“, „1:02:03“. */
export function formatDauer(sekunden: number): string {
  const s = Number.isFinite(sekunden) ? Math.max(0, Math.floor(sekunden)) : 0
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const rest = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`
}
