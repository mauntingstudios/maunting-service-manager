/**
 * Die Blob-Routen des Tresors (`/api/vault/blobs`). Hier gehen nur Chiffrat,
 * Kennungen und Größen über die Leitung; was ein Blob enthält, weiß nur der
 * Tresor-Eintrag.
 */

import { api, apiStream, SanitizedApiError } from '@/api/client'
import i18n from '@/i18n'

let bucketMelder: (() => Promise<void>) | null = null
let laufendesMelden: Promise<void> | null = null
let zurueckgesetzt: () => boolean = () => false

/**
 * Der Tresor sagt hier, wie er seinen Bucket beim Server neu hinterlegt. Die
 * Dateien hängen am Bucket, nicht am Konto; fehlt dem Server die Zuordnung
 * (das Melden beim Einrichten ist gescheitert), antworten die Datei-Routen 409
 * `VAULT_BUCKET_UNBEKANNT`.
 */
export function bucketMelderSetzen(melder: (() => Promise<void>) | null): void {
  bucketMelder = melder
}

/**
 * Ob der offene Tresor auf einem anderen Gerät zurückgesetzt wurde. Dann geht
 * keine Datei-Anfrage mehr hinaus.
 */
export function zurueckgesetztFrage(frage: () => boolean): void {
  zurueckgesetzt = frage
}

/**
 * Basis der Blob-Routen: privat `/api/vault`, Team `/api/teams/<id>/vault`.
 * Es ist immer nur ein Tresor offen; der jeweilige Store setzt die Basis beim
 * Entsperren und der private beim Sperren/Öffnen zurück auf privat.
 */
let blobTeamId: number | null = null
const bucketTeamMap = new Map<string, number>()

export function teamFuerBucketMerken(bucketId: string, teamId: number): void {
  bucketTeamMap.set(bucketId.toLowerCase(), teamId)
}

export function blobBasisSetzen(teamId: number | null): void {
  blobTeamId = teamId
}

export function blobBasis(bucket?: string): string {
  if (bucket) {
    const tid = bucketTeamMap.get(bucket.toLowerCase())
    if (tid !== undefined) return `/api/teams/${tid}/vault`
  }
  return blobTeamId ? `/api/teams/${blobTeamId}/vault` : '/api/vault'
}

/** Meldet auf `VAULT_BUCKET_UNBEKANNT` den Bucket einmal neu und wiederholt. */
async function mitBucket<T>(anfrage: () => Promise<T>): Promise<T> {
  if (zurueckgesetzt()) throw new SanitizedApiError(i18n.t('errors.vault_zurueckgesetzt'), { status: 410, code: 'VAULT_ZURUECKGESETZT' })
  try {
    return await anfrage()
  } catch (err) {
    if (!(err instanceof SanitizedApiError) || err.code !== 'VAULT_BUCKET_UNBEKANNT' || !bucketMelder) throw err
    // Viele Uploads zugleich laufen in dieselbe Antwort; gemeldet wird einmal.
    laufendesMelden ??= bucketMelder().finally(() => {
      laufendesMelden = null
    })
    await laufendesMelden
    return anfrage()
  }
}

export interface TresorSpeicher {
  belegt: number
  quote: number
  in_loeschung: number
  /** Nicht gelöschte Blobs; je Datei und Fassung sind es drei. */
  blobs: number
}

export interface BlobStand {
  state: 'offen' | 'fertig' | 'geloescht'
  chunk_count: number
  vorhanden: number[]
}

/**
 * Schreibende Anfragen nennen den Bucket, zu dem die Datei gehört. Der Server
 * nimmt sie nur an, wenn das noch der Bucket des Kontos ist, sonst 410: nach
 * einem Zurücksetzen auf einem anderen Gerät landeten Dateien des alten
 * Tresors sonst im neuen (bis 02.10.2026).
 */
function mitBucketKopf(bucket: string, kopf: Record<string, string> = {}): Record<string, string> {
  return { ...kopf, 'X-MSM-Vault-Bucket': bucket }
}

export function speicherAbfragen(bucket?: string): Promise<TresorSpeicher> {
  return api<TresorSpeicher>(`${blobBasis(bucket)}/speicher`)
}

export async function blobReservieren(
  bucket: string,
  id: string,
  chunkAnzahl: number,
  bytes: number,
  loeschPruefwert: string,
): Promise<void> {
  await mitBucket(() =>
    api(`${blobBasis(bucket)}/blobs`, {
      method: 'POST',
      headers: mitBucketKopf(bucket),
      body: JSON.stringify({ id, chunk_count: chunkAnzahl, bytes_total: bytes, delete_verifier: loeschPruefwert }),
    }),
  )
}

export function blobStand(bucket: string, id: string): Promise<BlobStand> {
  return mitBucket(() => api<BlobStand>(`${blobBasis(bucket)}/blobs/${id}/status`, { headers: mitBucketKopf(bucket) }))
}

export async function chunkHochladen(bucket: string, id: string, index: number, chiffrat: Uint8Array): Promise<void> {
  await mitBucket(() =>
    apiStream(`${blobBasis(bucket)}/blobs/${id}/chunks/${index}`, {
      method: 'PUT',
      headers: mitBucketKopf(bucket, { 'Content-Type': 'application/octet-stream', Accept: '*/*' }),
      body: chiffrat as BodyInit,
    }),
  )
}

export async function blobFertig(bucket: string, id: string): Promise<void> {
  await mitBucket(() => api(`${blobBasis(bucket)}/blobs/${id}/fertig`, { method: 'POST', headers: mitBucketKopf(bucket) }))
}

export async function chunkLaden(id: string, index: number, signal?: AbortSignal): Promise<Uint8Array> {
  const antwort = await mitBucket(() =>
    apiStream(`${blobBasis()}/blobs/${id}/chunks/${index}`, {
      method: 'GET',
      headers: { Accept: 'application/octet-stream' },
      signal,
    }),
  )
  return new Uint8Array(await antwort.arrayBuffer())
}

/**
 * Bis zu 100 einteilige kleine Blobs (Miniaturen) in einer Anfrage. Fehlt
 * einer, steht er nicht in der Antwort.
 */
export async function kleineLaden(ids: string[]): Promise<Map<string, Uint8Array>> {
  const antwort = await mitBucket(() =>
    apiStream(`${blobBasis()}/blobs/klein`, {
      method: 'POST',
      headers: { Accept: 'application/octet-stream' },
      body: JSON.stringify({ ids }),
    }),
  )
  const daten = new Uint8Array(await antwort.arrayBuffer())
  const sicht = new DataView(daten.buffer, daten.byteOffset, daten.byteLength)
  const ergebnis = new Map<string, Uint8Array>()
  let pos = 0
  for (const id of ids) {
    if (pos + 4 > daten.length) break
    const laenge = sicht.getUint32(pos)
    pos += 4
    if (pos + laenge > daten.length) break
    if (laenge > 0) ergebnis.set(id, daten.slice(pos, pos + laenge))
    pos += laenge
  }
  return ergebnis
}

export async function blobLoeschen(bucket: string, id: string, loeschen: string): Promise<void> {
  await mitBucket(() =>
    api(`${blobBasis(bucket)}/blobs/${id}`, {
      method: 'DELETE',
      headers: mitBucketKopf(bucket),
      body: JSON.stringify({ schluessel: loeschen }),
    }),
  )
}

// ── Posteingang (Kamera-Sicherung, `tresorEingang.ts`) ──
// Abgelegt wird nur vom Hintergrund-Job des Telefons (`KameraArbeit.kt`); die App holt ab.

export interface EingangDatensatz {
  id: string
  ciphertext: string
  created_at: string
}

/** Eine Seite des Posteingangs; `weiter` ist die Kennung, ab der die nächste beginnt. */
export function eingangListe(bucket: string, nach?: string): Promise<{ eintraege: EingangDatensatz[]; weiter: string | null }> {
  const abfrage = nach ? `?nach=${encodeURIComponent(nach)}` : ''
  return mitBucket(() => api(`/api/vault/eingang${abfrage}`, { headers: mitBucketKopf(bucket) }))
}

/** Ein Datensatz aus dem Browser bei gesperrtem Tresor (`tresorGesperrt.ts`). Nur Chiffrat. */
export async function eingangAblegen(bucket: string, id: string, ciphertext: string): Promise<void> {
  await mitBucket(() =>
    api('/api/vault/eingang', { method: 'POST', headers: mitBucketKopf(bucket), body: JSON.stringify({ id, ciphertext }) }),
  )
}

export async function eingangLoeschen(bucket: string, id: string): Promise<void> {
  await mitBucket(() => api(`/api/vault/eingang/${encodeURIComponent(id)}`, { method: 'DELETE', headers: mitBucketKopf(bucket) }))
}

/**
 * Zugang für den Hintergrund-Job dieses Telefons. Ein dauerhafter Zugang,
 * deshalb nur mit frischem Nachweis (AGENTS.md Punkt 21); er fällt mit dieser
 * Sitzung. Geht nur an die App (`kameraEinrichten`), nie in Speicher oder Log.
 */
export async function sicherungszugangAnlegen(bucket: string, nachweis: Record<string, unknown>): Promise<string> {
  const { zugang } = await mitBucket(() =>
    api<{ zugang: string }>('/api/vault/sicherung/zugang', {
      method: 'POST',
      headers: mitBucketKopf(bucket),
      body: JSON.stringify(nachweis),
    }),
  )
  return zugang
}

export async function sicherungszugangEntfernen(): Promise<void> {
  await api('/api/vault/sicherung/zugang', { method: 'DELETE' })
}
