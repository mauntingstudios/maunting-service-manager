/**
 * Foto-Sticker: quadratisch zuschneiden, Text und weißen Rand ins Bild rechnen.
 *
 * Text und Rand liegen danach in den Pixeln. Die Gegenseite braucht weder
 * Schriften noch diesen Code; das Bild reist als `data:image/…` im
 * verschlüsselten Payload und sieht überall gleich aus.
 */

import { ladeStempelSchriften } from '@/components/social/augenblickStempel'
import type { StickerMotiv } from './stickerCatalog'
import {
  STICKER_BILD_MAX_ZEICHEN,
  stickerLabel,
  type BildStickerEintrag,
  type BildStickerStil,
} from './stickerPacks'

export const BILD_STICKER_KANTE = 512
export const BILD_STICKER_TEXT_MAX = 40

export const BILD_STICKER_STILE: { id: BildStickerStil; labelKey: string }[] = [
  { id: 'fett', labelKey: 'messenger.photoSticker.styles.bold' },
  { id: 'handschrift', labelKey: 'messenger.photoSticker.styles.handwriting' },
  { id: 'elegant', labelKey: 'messenger.photoSticker.styles.elegant' },
  { id: 'digital', labelKey: 'messenger.photoSticker.styles.digital' },
]

function schrift(stil: BildStickerStil, px: number): string {
  if (stil === 'handschrift') return `700 ${px}px Caveat, cursive`
  if (stil === 'elegant') return `italic 400 ${px}px "Playfair Display", serif`
  if (stil === 'digital') return `700 ${px}px Orbitron, monospace`
  return `700 ${px}px Manrope, sans-serif`
}

/** Runde Form ohne `roundRect`: Die WebView-Untergrenze ist älter als die Methode. */
function rundeForm(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  breite: number,
  hoehe: number,
  radius: number,
) {
  const r = Math.max(0, Math.min(radius, Math.min(breite, hoehe) / 2))
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + breite, y, x + breite, y + hoehe, r)
  ctx.arcTo(x + breite, y + hoehe, x, y + hoehe, r)
  ctx.arcTo(x, y + hoehe, x, y, r)
  ctx.arcTo(x, y, x + breite, y, r)
  ctx.closePath()
}

function ladeBild(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const bild = new Image()
    bild.onload = () => resolve(bild)
    bild.onerror = () => reject(new Error('Das Bild lässt sich nicht öffnen'))
    bild.src = dataUrl
  })
}

/** Mittiger Quadrat-Ausschnitt; das Ergebnis hat genau `kante` × `kante`. */
async function zuschneiden(dataUrl: string, kante: number): Promise<HTMLCanvasElement> {
  const bild = await ladeBild(dataUrl)
  const breite = bild.naturalWidth
  const hoehe = bild.naturalHeight
  if (!breite || !hoehe) throw new Error('Das Bild ist leer')
  const seite = Math.min(breite, hoehe)
  const canvas = document.createElement('canvas')
  canvas.width = kante
  canvas.height = kante
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Kein Zeichenbereich für den Sticker')
  ctx.drawImage(
    bild,
    (breite - seite) / 2,
    (hoehe - seite) / 2,
    seite,
    seite,
    0,
    0,
    kante,
    kante,
  )
  return canvas
}

function zeichneText(
  ctx: CanvasRenderingContext2D,
  kante: number,
  text: string,
  stil: BildStickerStil,
) {
  const sauber = text.trim().slice(0, BILD_STICKER_TEXT_MAX)
  if (!sauber) return
  let px = Math.round(kante * 0.115)
  ctx.font = schrift(stil, px)
  const maxBreite = kante * 0.84
  const gemessen = ctx.measureText(sauber).width
  if (gemessen > maxBreite) {
    px = Math.max(12, Math.floor((px * maxBreite) / gemessen))
    ctx.font = schrift(stil, px)
  }
  const breite = ctx.measureText(sauber).width
  const hoehe = px * 1.8
  const x = (kante - breite - px * 1.6) / 2
  const y = kante * 0.82 - hoehe / 2
  ctx.fillStyle = 'rgba(10, 12, 16, 0.55)'
  rundeForm(ctx, x, y, breite + px * 1.6, hoehe, hoehe / 2)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = 'rgba(0,0,0,0.35)'
  ctx.shadowBlur = px * 0.1
  ctx.fillText(sauber, kante / 2, y + hoehe / 2)
  ctx.shadowColor = 'transparent'
}

/**
 * Rechnet aus einem Bild einen fertigen Sticker.
 *
 * `bild` ist das Vollbild (512, WebP), `miniatur` die kleine Fassung fürs
 * Raster. Ist das Bild zu groß, wirft es; die Ablage prüft dieselbe Grenze
 * noch einmal, weil sie der letzte Schreibweg ist.
 */
export async function erstelleBildSticker(
  dataUrl: string,
  text: string,
  stil: BildStickerStil,
  kante = BILD_STICKER_KANTE,
): Promise<{ bild: string; miniatur: string }> {
  if (!dataUrl.startsWith('data:image/')) {
    throw new Error('Das ist kein Bild')
  }
  if (text.trim()) await ladeStempelSchriften()
  const foto = await zuschneiden(dataUrl, kante)
  const ziel = document.createElement('canvas')
  ziel.width = kante
  ziel.height = kante
  const ctx = ziel.getContext('2d')
  if (!ctx) throw new Error('Kein Zeichenbereich für den Sticker')

  const radius = kante * 0.12
  ctx.save()
  rundeForm(ctx, 0, 0, kante, kante, radius)
  ctx.clip()
  ctx.drawImage(foto, 0, 0)
  zeichneText(ctx, kante, text, stil)
  ctx.restore()

  // Der weiße Rand liegt auf der Kante, die Ecken bleiben durchsichtig.
  const rand = Math.max(6, Math.round(kante * 0.022))
  ctx.lineWidth = rand
  ctx.strokeStyle = '#ffffff'
  rundeForm(ctx, rand / 2, rand / 2, kante - rand, kante - rand, radius - rand / 2)
  ctx.stroke()

  const bild = ziel.toDataURL('image/webp', 0.9)
  if (!istBildDaten(bild)) throw new Error('Der Sticker wurde zu groß')

  const mini = document.createElement('canvas')
  mini.width = 128
  mini.height = 128
  const mctx = mini.getContext('2d')
  if (!mctx) throw new Error('Kein Zeichenbereich für die Vorschau')
  mctx.drawImage(ziel, 0, 0, 128, 128)
  const miniatur = mini.toDataURL('image/webp', 0.8)

  return { bild, miniatur: istBildDaten(miniatur) ? miniatur : bild }
}

export function istBildDaten(bild: string): boolean {
  return bild.startsWith('data:image/') && bild.length <= STICKER_BILD_MAX_ZEICHEN
}

export function blobAlsDatenUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const leser = new FileReader()
    leser.onload = () => resolve(String(leser.result || ''))
    leser.onerror = () => reject(leser.error ?? new Error('Bild nicht lesbar'))
    leser.readAsDataURL(blob)
  })
}

/** Was die Blase und der Versand aus einem gespeicherten Foto-Sticker machen. */
export function bildStickerMotiv(eintrag: BildStickerEintrag, bild: string): StickerMotiv {
  return {
    id: eintrag.id,
    label: stickerLabel(eintrag),
    bild,
    mix: true,
  }
}
