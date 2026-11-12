/**
 * Das Symbol einer Kachel, von der Website selbst. Rust holt es und gibt ein
 * neu kodiertes PNG als `data:`-Adresse zurück (`kachelsymbol.rs`); die
 * Oberfläche lädt keine Adresse der Seite. Bis es da ist, und wenn die Seite
 * keines hat, steht der Anfangsbuchstabe.
 */
import { useEffect, useState } from 'react'
import { BrandIcon, resolveBrandInfo } from '@maunting/ui'

import { nativ } from '../../services/nativ'

/** Ein Aufruf je Adresse und Sitzung, auch wenn mehrere Kacheln sie zeigen. */
const geholt = new Map<string, Promise<string | null>>()

/** Nach einem Import liegen neue Dateien im Kachelcache; beim nächsten Zeigen neu fragen. */
export function kachelnNeuLaden(): void {
  geholt.clear()
}

function holen(url: string): Promise<string | null> {
  let laufend = geholt.get(url)
  if (!laufend) {
    laufend = nativ.kachelSymbol(url).catch(() => null)
    geholt.set(url, laufend)
  }
  return laufend
}

export function KachelSymbol({ url, host }: { url: string; host: string }) {
  const [symbol, setSymbol] = useState<{ url: string; bild: string | null } | null>(null)

  useEffect(() => {
    let aktuell = true
    void holen(url).then((bild) => aktuell && setSymbol({ url, bild }))
    return () => {
      aktuell = false
    }
  }, [url])

  const bild = symbol?.url === url ? symbol.bild : null
  if (!bild) {
    if (resolveBrandInfo(host, url)) {
      return (
        <span className="flex h-full w-full items-center justify-center p-2" aria-hidden="true">
          <BrandIcon name={host} domainOrUrl={url} size="md" bare />
        </span>
      )
    }
    return (
      <span className="text-title-md uppercase" aria-hidden="true">
        {host.charAt(0)}
      </span>
    )
  }
  return <Bild bild={bild} />
}

/** Wie das Bild in den Kreis passt, aus seinen Pixeln gelesen. */
interface Darstellung {
  /** Das Bild füllt sein Quadrat (App-Symbol): ganz in den Kreis, ohne Rand. */
  vollflaechig: boolean
  hintergrund: string
}

const WEISS: Darstellung = { vollflaechig: false, hintergrund: '#ffffff' }

/**
 * Liest ein kleines Raster aus dem Bild. Ein App-Symbol mit deckendem Rand
 * füllt den Kreis in seiner Randfarbe; ein Logo mit transparenter Fläche
 * bekommt hell oder dunkel, je nachdem, was darauf lesbar bleibt (GitHub ist
 * dunkel, also weiß; ein weißes Logo bekommt einen dunklen Grund).
 */
function darstellung(img: HTMLImageElement): Darstellung {
  try {
    const n = 24
    const leinwand = document.createElement('canvas')
    leinwand.width = n
    leinwand.height = n
    const ctx = leinwand.getContext('2d', { willReadFrequently: true })
    if (!ctx) return WEISS
    ctx.drawImage(img, 0, 0, n, n)
    const px = ctx.getImageData(0, 0, n, n).data
    const at = (x: number, y: number) => {
      const i = (y * n + x) * 4
      return { r: px[i], g: px[i + 1], b: px[i + 2], a: px[i + 3] }
    }
    let randDeckend = 0
    let randAnzahl = 0
    let rr = 0
    let rg = 0
    let rb = 0
    for (let k = 0; k < n; k++) {
      for (const p of [at(k, 0), at(k, n - 1), at(0, k), at(n - 1, k)]) {
        randAnzahl++
        if (p.a > 235) {
          randDeckend++
          rr += p.r
          rg += p.g
          rb += p.b
        }
      }
    }
    if (randDeckend / randAnzahl > 0.9) {
      const m = randDeckend
      return { vollflaechig: true, hintergrund: `rgb(${Math.round(rr / m)} ${Math.round(rg / m)} ${Math.round(rb / m)})` }
    }
    let licht = 0
    let sichtbar = 0
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 128) continue
      sichtbar++
      licht += (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255
    }
    if (sichtbar === 0) return WEISS
    return { vollflaechig: false, hintergrund: licht / sichtbar > 0.8 ? '#1b1b1f' : '#ffffff' }
  } catch {
    return WEISS
  }
}

/**
 * Füllt den Kreis: App-Symbole ganz, Logos groß auf hellem oder dunklem Grund.
 * Blendet weich ein, sobald das Bild dekodiert ist.
 */
function Bild({ bild }: { bild: string }) {
  const [da, setDa] = useState(false)
  const [art, setArt] = useState<Darstellung>(WEISS)
  return (
    <img
      src={bild}
      alt=""
      draggable={false}
      onLoad={(e) => {
        setArt(darstellung(e.currentTarget))
        setDa(true)
      }}
      style={{ backgroundColor: art.hintergrund }}
      className={`h-full w-full transition-[opacity,transform] duration-300 ease-out motion-reduce:transition-none ${
        art.vollflaechig ? 'object-cover' : 'object-contain p-1.5'
      } ${da ? 'scale-100 opacity-100' : 'scale-90 opacity-0'}`}
    />
  )
}

