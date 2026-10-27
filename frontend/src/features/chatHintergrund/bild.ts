/**
 * Ein eigenes Hintergrundbild klein genug machen.
 *
 * Ein Foto aus der Kamera hat 4000 px und mehr; als Data-URL sprengt es jede
 * Ablage und jede Nachricht. Verkleinert wird auf höchstens 1600 px und WebP;
 * reicht das Ergebnis noch über die Grenze, wird die Qualität gesenkt, nicht
 * die Kantenlänge. Was danach zu groß ist, wird abgewiesen und gesagt.
 */

/** Zielgröße des fertigen Data-URL; 2 MiB Bild brauchen rund 2,8 Mio Zeichen. */
export const MAX_HINTERGRUND_ZEICHEN = 2_800_000
const KANTE = 1600
const QUALITAETEN = [0.86, 0.72, 0.58, 0.45] as const

const BILD_ZEICHEN = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/

export async function bildAlsHintergrund(
  datei: Blob,
  maxZeichen = MAX_HINTERGRUND_ZEICHEN,
): Promise<string | null> {
  try {
    if (typeof document === 'undefined') return null
    if (typeof createImageBitmap === 'function') {
      const bild = await createImageBitmap(datei)
      const fakt = Math.min(1, KANTE / Math.max(bild.width, bild.height))
      const breite = Math.max(1, Math.round(bild.width * fakt))
      const hoehe = Math.max(1, Math.round(bild.height * fakt))
      const leinwand = document.createElement('canvas')
      leinwand.width = breite
      leinwand.height = hoehe
      const stift = leinwand.getContext('2d')
      if (!stift) return null
      stift.drawImage(bild, 0, 0, breite, hoehe)
      bild.close()
      for (const qualitaet of QUALITAETEN) {
        const url = leinwand.toDataURL('image/webp', qualitaet)
        if (url.length <= maxZeichen && BILD_ZEICHEN.test(url)) return url
      }
      return null
    }

    // Ohne Bilddekodierung bleibt nur die Originaldatei; die Grenze gilt dann
    // genauso und wird hier geprüft, statt sie später zu entdecken.
    if (datei.size > 2 * 1024 * 1024) return null
    const url = await new Promise<string | null>((fertig) => {
      const leser = new FileReader()
      leser.onload = () => fertig(typeof leser.result === 'string' ? leser.result : null)
      leser.onerror = () => fertig(null)
      leser.readAsDataURL(datei)
    })
    return url && url.length <= maxZeichen && BILD_ZEICHEN.test(url) ? url : null
  } catch {
    return null
  }
}
