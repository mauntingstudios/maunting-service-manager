/**
 * Die Quelle eines Panelbilds: direkter Pfad im Web, Blob in der Desktop-App.
 *
 * Im Web lädt ein gewöhnliches `<img>` (oder CSS-`url()`) von der eigenen
 * Herkunft, mit dem Sitzungscookie. In der Desktop-App und bei getrenntem
 * Frontend trägt weder `<img>` noch CSS ein Bearer-Token — dort kommt das
 * Bild über `apiStream` als Blob. Nur dort: die CSP des Panels erlaubt
 * `blob:` nicht.
 */
import { useEffect, useState } from 'react'

import { apiStream, isInternalApiUrl } from '@/api/client'
import { apiUrl, getIsAbsoluteApi } from '@/config/api'

function brauchtBlob(): boolean {
  if (getIsAbsoluteApi()) return true
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
}

function istDirektQuelle(aufgeloest: string | null): boolean {
  if (!aufgeloest) return false
  if (aufgeloest.startsWith('data:') || aufgeloest.startsWith('blob:')) return true
  if (!isInternalApiUrl(aufgeloest)) return true
  return !brauchtBlob()
}

export interface Bildquelle {
  /** Was im `src` des `<img>` steht; `null`, solange nichts zu laden ist. */
  quelle: string | null
  /** Endgültig: Das Panel hat für diesen Pfad kein Bild. */
  fehlgeschlagen: boolean
  /** Gehört an `onError` des `<img>`. */
  bildFehler: () => void
}

interface Blobstand {
  pfad: string
  quelle: string | null
  fehlgeschlagen: boolean
}

interface Nachfrage {
  pfad: string
  stand: 'fragt' | 'wieder' | 'fehlt'
}

/** Ein zweiter Anlauf braucht eine neue Adresse; dieselbe hielte der Browser für erledigt. */
const zweiterAnlauf = (pfad: string) => `${pfad}${pfad.includes('?') ? '&' : '?'}versuch=2`

const VORLADE_MAX = 24
const vorgeladeneAdressen = new Set<string>()
const blobAnfragen = new Map<string, Promise<Blob | null>>()

function ladeBlobGemeinsam(pfad: string): Promise<Blob | null> {
  const vorhanden = blobAnfragen.get(pfad)
  if (vorhanden) return vorhanden
  const stream = apiStream(pfad, { method: 'GET', headers: { Accept: 'image/*' } })
  if (!stream || typeof stream.then !== 'function') {
    return Promise.resolve(null)
  }
  const aufgabe = stream
    .then(async (antwort) => {
      if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`)
      return await antwort.blob()
    })
    .catch(() => {
      blobAnfragen.delete(pfad)
      return null
    })
  blobAnfragen.set(pfad, aufgabe)
  if (blobAnfragen.size > VORLADE_MAX) {
    const aeltester = blobAnfragen.keys().next().value
    if (aeltester) blobAnfragen.delete(aeltester)
  }
  return aufgabe
}

/** Lädt ein API-Bild vorab (Browser-Preload im Web, geteilter Blob-Abruf im Desktop-Modus). */
export function vorladenBildquelle(pfad: string | null, priority: 'high' | 'low' = 'high'): void {
  if (!pfad) return
  const href = apiUrl(pfad)
  if (istDirektQuelle(href)) {
    if (vorgeladeneAdressen.has(href)) return
    vorgeladeneAdressen.add(href)
    if (vorgeladeneAdressen.size > VORLADE_MAX) {
      const aelteste = vorgeladeneAdressen.values().next().value
      if (aelteste) vorgeladeneAdressen.delete(aelteste)
    }
    if (typeof Image !== 'undefined') {
      const img = new Image()
      ;(img as HTMLImageElement & { fetchPriority?: string }).fetchPriority = priority
      img.src = href
    }
    return
  }
  void ladeBlobGemeinsam(pfad)
}

/**
 * Die Quelle eines Panelbilds für ein `<img>`. Ein Blob gehört zu seinem Pfad
 * und wird freigegeben, sobald der Pfad wechselt oder das Bild verschwindet.
 *
 * `data:`, `blob:` sowie externe Nicht-API-URLs werden immer direkt ausgeliefert.
 */
export function useBildquelle(
  pfad: string | null,
  resolveUrl?: (url: string) => string,
): Bildquelle {
  const aufgeloest = pfad ? (resolveUrl ? resolveUrl(pfad) : apiUrl(pfad)) : null
  const direkt = istDirektQuelle(aufgeloest)
  const schluessel = aufgeloest
  const [blob, setBlob] = useState<Blobstand | null>(null)
  const [nachfrage, setNachfrage] = useState<Nachfrage | null>(null)

  useEffect(() => {
    if (!schluessel || direkt) return
    let aktiv = true
    let blobUrl: string | null = null
    void ladeBlobGemeinsam(schluessel).then((inhalt) => {
      if (!aktiv) return
      if (!inhalt) {
        setBlob({ pfad: schluessel, quelle: null, fehlgeschlagen: true })
        return
      }
      blobUrl = URL.createObjectURL(inhalt)
      setBlob({ pfad: schluessel, quelle: blobUrl, fehlgeschlagen: false })
    })
    return () => {
      aktiv = false
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [schluessel, direkt])

  const bildFehler = () => {
    if (!schluessel) return
    if (!direkt) {
      setBlob((jetzt) => (jetzt?.pfad === schluessel ? { ...jetzt, quelle: null, fehlgeschlagen: true } : jetzt))
      return
    }
    if (!isInternalApiUrl(schluessel) || schluessel.startsWith('data:') || schluessel.startsWith('blob:')) {
      setNachfrage({ pfad: schluessel, stand: 'fehlt' })
      return
    }
    if (nachfrage?.pfad === schluessel) {
      if (nachfrage.stand === 'wieder') setNachfrage({ pfad: schluessel, stand: 'fehlt' })
      return
    }
    setNachfrage({ pfad: schluessel, stand: 'fragt' })
    void Promise.resolve()
      .then(() => apiStream(schluessel, { method: 'GET', headers: { Accept: 'image/*' } }))
      .then((antwort) => {
        void antwort.body?.cancel().catch(() => undefined)
        return antwort.ok
      })
      .catch(() => false)
      .then((da) => {
        setNachfrage((jetzt) => (jetzt?.pfad === schluessel ? { pfad: schluessel, stand: da ? 'wieder' : 'fehlt' } : jetzt))
      })
  }

  if (!schluessel) return { quelle: null, fehlgeschlagen: true, bildFehler }
  if (direkt) {
    const stand = nachfrage?.pfad === schluessel ? nachfrage.stand : null
    if (stand === 'fehlt') return { quelle: null, fehlgeschlagen: true, bildFehler }
    if (stand === 'fragt') return { quelle: null, fehlgeschlagen: false, bildFehler }
    return {
      quelle: stand === 'wieder' ? zweiterAnlauf(schluessel) : schluessel,
      fehlgeschlagen: false,
      bildFehler,
    }
  }
  return blob?.pfad === schluessel
    ? { quelle: blob.quelle, fehlgeschlagen: blob.fehlgeschlagen, bildFehler }
    : { quelle: null, fehlgeschlagen: false, bildFehler }
}
