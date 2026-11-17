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

import { apiStream } from '@/api/client'
import { apiUrl, getIsAbsoluteApi } from '@/config/api'

function brauchtBlob(): boolean {
  if (getIsAbsoluteApi()) return true
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
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
  blobAnfragen.delete(pfad)
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
  if (!brauchtBlob()) {
    const href = apiUrl(pfad)
    if (vorgeladeneAdressen.has(href)) return
    vorgeladeneAdressen.add(href)
    if (vorgeladeneAdressen.size > VORLADE_MAX) {
      const aelteste = vorgeladeneAdressen.values().next().value
      if (aelteste) vorgeladeneAdressen.delete(aelteste)
    }
    if (typeof document !== 'undefined' && priority === 'high') {
      const link = document.createElement('link')
      link.rel = 'preload'
      link.as = 'image'
      link.href = href
      link.setAttribute('fetchpriority', 'high')
      document.head.appendChild(link)
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
 * Im Web trägt das `<img>` das Sitzungscookie, und das lebt 15 Minuten. Nach
 * einer langen Sprachsitzung ohne andere Anfrage bekommt es ein 401, und ein
 * `<img>` frischt keine Sitzung auf. Ein Fehler fragt deshalb einmal über
 * `apiStream` nach — das frischt sie auf — und lädt dann neu; erst wenn auch
 * das scheitert, fehlt das Bild.
 */
export function useBildquelle(pfad: string | null): Bildquelle {
  const direkt = !brauchtBlob()
  const [blob, setBlob] = useState<Blobstand | null>(null)
  const [nachfrage, setNachfrage] = useState<Nachfrage | null>(null)

  useEffect(() => {
    if (!pfad || direkt) return
    let aktiv = true
    let blobUrl: string | null = null
    void ladeBlobGemeinsam(pfad).then((inhalt) => {
      if (!aktiv) return
      if (!inhalt) {
        setBlob({ pfad, quelle: null, fehlgeschlagen: true })
        return
      }
      blobUrl = URL.createObjectURL(inhalt)
      setBlob({ pfad, quelle: blobUrl, fehlgeschlagen: false })
    })
    return () => {
      aktiv = false
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [pfad, direkt])

  const bildFehler = () => {
    if (!pfad) return
    if (!direkt) {
      // Ein Blob, den das `<img>` nicht lesen kann, wird beim nächsten Mal
      // nicht besser.
      setBlob((jetzt) => (jetzt?.pfad === pfad ? { ...jetzt, quelle: null, fehlgeschlagen: true } : jetzt))
      return
    }
    if (nachfrage?.pfad === pfad) {
      if (nachfrage.stand === 'wieder') setNachfrage({ pfad, stand: 'fehlt' })
      return
    }
    setNachfrage({ pfad, stand: 'fragt' })
    void Promise.resolve()
      .then(() => apiStream(pfad, { method: 'GET', headers: { Accept: 'image/*' } }))
      .then((antwort) => {
        // Nur die Auskunft zählt; das Bild selbst lädt gleich das `<img>`.
        void antwort.body?.cancel().catch(() => undefined)
        return antwort.ok
      })
      .catch(() => false)
      .then((da) => {
        setNachfrage((jetzt) => (jetzt?.pfad === pfad ? { pfad, stand: da ? 'wieder' : 'fehlt' } : jetzt))
      })
  }

  if (!pfad) return { quelle: null, fehlgeschlagen: true, bildFehler }
  if (direkt) {
    const stand = nachfrage?.pfad === pfad ? nachfrage.stand : null
    if (stand === 'fehlt') return { quelle: null, fehlgeschlagen: true, bildFehler }
    if (stand === 'fragt') return { quelle: null, fehlgeschlagen: false, bildFehler }
    return { quelle: apiUrl(stand === 'wieder' ? zweiterAnlauf(pfad) : pfad), fehlgeschlagen: false, bildFehler }
  }
  // Ein Blob für einen anderen Pfad gilt nicht mehr, auch nicht für einen Takt.
  return blob?.pfad === pfad
    ? { quelle: blob.quelle, fehlgeschlagen: blob.fehlgeschlagen, bildFehler }
    : { quelle: null, fehlgeschlagen: false, bildFehler }
}
