/**
 * Bereitet einen KI-Anhang im Browser auf.
 *
 * Der Server normalisiert Bilder noch einmal selbst; hier geht es nur darum,
 * ein 8-MB-Kamerafoto nicht unnoetig ueber die Leitung zu schicken und das
 * 20-MiB-Request-Limit gar nicht erst zu beruehren. Was der Browser nicht
 * dekodieren kann (typisch: HEIC in einer alten WebView), bleibt unveraendert
 * und geht an den Server, der es mit pillow-heif versucht.
 */

import i18n from '@/i18n'

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
const ZIEL_BYTES = 1.5 * 1024 * 1024
const MAX_KANTE = 2048

function istBild(file: File): boolean {
  if ((file.type || '').startsWith('image/')) return true
  return /\.(png|jpe?g|webp|gif|heic|heif|avif|bmp|tiff?)$/i.test(file.name)
}

function neuerName(name: string, mime: string): string {
  if (mime === 'image/png') return name.replace(/\.[^.]+$/, '') + '.png'
  if (mime === 'image/jpeg') return name.replace(/\.[^.]+$/, '') + '.jpg'
  return name
}

async function alsBlob(canvas: HTMLCanvasElement, mime: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), mime, 0.86))
}

/**
 * Gibt eine Datei zurueck, die hochgeladen werden darf. Wirft mit einem
 * uebersetzten Satz, wenn die Datei auch nach der Aufbereitung zu gross ist.
 */
export async function bereiteAiAnhangAuf(file: File): Promise<File> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(i18n.t('ai.attachments.tooLarge'))
  }
  if (!istBild(file) || file.size <= ZIEL_BYTES) return file
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    // HEIC/AVIF ohne Decoder: der Server entscheidet.
    return file
  }

  try {
    const faktor = Math.min(1, MAX_KANTE / Math.max(bitmap.width, bitmap.height))
    const breite = Math.max(1, Math.round(bitmap.width * faktor))
    const hoehe = Math.max(1, Math.round(bitmap.height * faktor))
    const canvas = document.createElement('canvas')
    canvas.width = breite
    canvas.height = hoehe
    const kontext = canvas.getContext('2d')
    if (!kontext) return file
    // Transparente Bilder als PNG behalten, Fotos als JPEG verkleinern.
    const transparent = /\/(png|webp|gif)$/i.test(file.type || '')
    if (!transparent) {
      kontext.fillStyle = '#ffffff'
      kontext.fillRect(0, 0, breite, hoehe)
    }
    kontext.drawImage(bitmap, 0, 0, breite, hoehe)
    const mime = transparent ? 'image/png' : 'image/jpeg'
    const blob = await alsBlob(canvas, mime)
    if (!blob || blob.size >= file.size) return file
    return new File([blob], neuerName(file.name, mime), {
      type: mime,
      lastModified: file.lastModified,
    })
  } catch {
    return file
  } finally {
    bitmap.close?.()
  }
}
