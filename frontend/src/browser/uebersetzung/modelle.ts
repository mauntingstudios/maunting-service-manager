/**
 * Die Sprachmodelle der Übersetzung und die Engine (WASM): woher, wie groß,
 * welche SHA-256. Die Liste steht fest in `modelle.json`
 * (`browser/scripts/uebersetzung-holen.mjs`); was der Server sonst liefert,
 * zählt nicht.
 *
 * Geladen wird von Mozilla, beim ersten Übersetzen einer Sprache und nur nach
 * Zustimmung. Das CDN erlaubt keinen Abruf aus der Oberfläche (keine
 * CORS-Köpfe); Rust holt die Datei (`sprachdaten.rs`). In den Cache der
 * Oberfläche kommt sie erst, wenn Größe und Prüfsumme stimmen, und beim Lesen
 * wird sie noch einmal geprüft (AGENTS.md Punkt 81).
 */
import { nativ } from '../services/nativ'
import { istAndroid } from '../services/plattform'
import liste from './modelle.json'

/** Nur der Schlüssel im Cache; geladen wird über Rust. */
export const CDN = 'https://firefox-settings-attachments.cdn.mozilla.net/'
const CACHE = 'msb-uebersetzung'
/** Alle Modelle haben Englisch auf einer Seite; andere Paare gehen darüber. */
const MITTE = 'en'

export interface Datei {
  ort: string
  groesse: number
  sha256: string
}

export type Art = 'model' | 'lex' | 'vocab' | 'srcvocab' | 'trgvocab'
type Paar = Partial<Record<Art, Datei & { name: string }>>

const PAARE = liste.paare as Record<string, Paar>
/** Dieselben Paare in der Fassung, die Mozilla nur für Android anbietet. */
const ANDROID = (liste.android ?? {}) as Record<string, Paar>
export const WASM: Datei = liste.wasm

/** Die Dateien eines Paares für diese Plattform; Android hat eigene, kleinere. */
function dateien(paar: string): Paar | undefined {
  return (istAndroid() ? ANDROID[paar] : undefined) ?? PAARE[paar]
}

/** Die Modelle von `von` nach `nach`: direkt oder über Englisch, sonst `null`. */
export function weg(von: string, nach: string): string[] | null {
  if (!von || von === nach) return null
  if (PAARE[`${von}-${nach}`]) return [`${von}-${nach}`]
  const hin = `${von}-${MITTE}`
  const her = `${MITTE}-${nach}`
  return PAARE[hin] && PAARE[her] ? [hin, her] : null
}

/** Sprachen, aus denen sich nach `nach` übersetzen lässt. */
export function quellen(nach: string): string[] {
  const alle = new Set(Object.keys(PAARE).flatMap((p) => p.split(/-(?=[^-]+$)/)))
  return [...alle].filter((s) => weg(s, nach)).sort()
}

/** Sprachen, in die sich aus `von` (oder generell) übersetzen lässt. */
export function ziele(von?: string): string[] {
  const alle = new Set(Object.keys(PAARE).flatMap((p) => p.split(/-(?=[^-]+$)/)))
  if (!von) return [...alle].sort()
  return [...alle].filter((s) => weg(von, s)).sort()
}

/** Die Sprache eines `lang`-Attributs, wie sie die Liste nennt (`de-DE` → `de`), oder `''`. */
export function spracheVon(lang: string): string {
  const [haupt, ...rest] = lang.toLowerCase().split(/[-_]/)
  let sprache = haupt === 'no' ? 'nb' : haupt
  // Chinesisch: traditionell nur mit Taiwan/Hongkong/Macau oder Hant; ohne
  // Angabe und mit CN/SG ist es vereinfacht.
  if (haupt === 'zh') sprache = rest.some((r) => ['hant', 'tw', 'hk', 'mo'].includes(r)) ? 'zh-Hant' : 'zh-Hans'
  return quellen(MITTE).includes(sprache) || sprache === MITTE ? sprache : ''
}

/** Die Dateien eines Paares mit dem Namen, an dem die Engine die Genauigkeit erkennt. */
export function dateienVon(paar: string): { dateien: Partial<Record<Art, Datei>>; name: string } {
  const p = dateien(paar)
  if (!p?.model) throw new Error('modell')
  return { dateien: p, name: p.model.name }
}

function alleDateien(paare: string[]): Datei[] {
  return [WASM, ...paare.flatMap((p) => Object.values(dateien(p) ?? {}))]
}

async function sha256(daten: ArrayBuffer): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', daten))
  return Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Wandelt rohe Daten aus Tauri-IPC (ArrayBuffer, Uint8Array oder number[])
 * verlässlich in einen echten ArrayBuffer um, damit Prüfsummen und Worker-Transfers
 * deterministisch funktionieren.
 */
export function zuArrayBuffer(daten: unknown): ArrayBuffer {
  if (!daten) throw new Error('netz')
  if (daten instanceof ArrayBuffer || Object.prototype.toString.call(daten) === '[object ArrayBuffer]') {
    return daten as ArrayBuffer
  }
  if (ArrayBuffer.isView(daten)) {
    return daten.byteOffset === 0 && daten.byteLength === daten.buffer.byteLength
      ? (daten.buffer as ArrayBuffer)
      : (daten.buffer.slice(daten.byteOffset, daten.byteOffset + daten.byteLength) as ArrayBuffer)
  }
  if (Array.isArray(daten)) {
    return new Uint8Array(daten).buffer as ArrayBuffer
  }
  if (typeof daten === 'string') {
    const roh = atob(daten)
    const bytes = new Uint8Array(roh.length)
    for (let i = 0; i < roh.length; i++) bytes[i] = roh.charCodeAt(i)
    return bytes.buffer as ArrayBuffer
  }
  throw new Error('netz')
}

const passt = async (d: Datei, daten: ArrayBuffer) => daten.byteLength === d.groesse && (await sha256(daten)) === d.sha256

/** Wie viele Bytes für diese Paare noch zu laden sind. */
export async function fehlendeGroesse(paare: string[]): Promise<number> {
  const cache = await caches.open(CACHE)
  let summe = 0
  for (const d of alleDateien(paare)) if (!(await cache.match(CDN + d.ort))) summe += d.groesse
  return summe
}

/**
 * Eine Datei aus dem Cache oder von Mozilla. `fortschritt` bekommt die neu
 * geladenen Bytes. Was nicht passt, wird verworfen und nie benutzt.
 */
export async function holen(d: Datei, fortschritt: (bytes: number) => void = () => {}): Promise<ArrayBuffer> {
  const adresse = CDN + d.ort
  const cache = await caches.open(CACHE)
  const gemerkt = await cache.match(adresse)
  if (gemerkt) {
    const daten = await gemerkt.arrayBuffer()
    if (await passt(d, daten)) return daten
    await cache.delete(adresse)
  }
  let bisher = 0
  const datenRaw = await nativ
    .sprachdatenLaden(d.ort, (bytes) => {
      fortschritt(bytes - bisher)
      bisher = bytes
    })
    .catch((f) => {
      throw new Error(f === 'groesse' ? 'pruefsumme' : 'netz')
    })
  if (!datenRaw) throw new Error('netz')
  const daten = zuArrayBuffer(datenRaw)
  if (!(await passt(d, daten))) throw new Error('pruefsumme')
  // `Response` kopiert die Bytes; der Puffer darf danach an den Worker gehen.
  await cache.put(adresse, new Response(daten))
  return daten
}

/** Geladene Paare mit ihrer Größe auf dem Gerät. */
export async function geladen(): Promise<{ paar: string; groesse: number }[]> {
  if (typeof caches === 'undefined') return []
  const da = new Set((await (await caches.open(CACHE)).keys()).map((r) => r.url))
  return Object.keys(PAARE)
    .map((paar) => [paar, dateien(paar)] as const)
    .filter(([, p]) => p && Object.values(p).length > 0 && Object.values(p).every((d) => da.has(CDN + d.ort)))
    .map(([paar, p]) => ({ paar, groesse: Object.values(p!).reduce((n, d) => n + d.groesse, 0) }))
}

/** Entfernt ein Paar; ohne Angabe alles samt Engine. */
export async function entfernen(paar?: string): Promise<void> {
  if (!paar) {
    await caches.delete(CACHE)
    return
  }
  const cache = await caches.open(CACHE)
  for (const d of Object.values(dateien(paar) ?? {})) await cache.delete(CDN + d.ort)
}
