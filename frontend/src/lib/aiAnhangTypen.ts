/**
 * Was ein KI-Anhang ist — unabhaengig davon, ob er schon hochgeladen wurde.
 *
 * Eine Datei ist fuer den Chat nur eines von vier Dingen: Bild, Text,
 * Dokument oder etwas, das der Server nur benennen kann. Die Einordnung
 * entscheidet ueber die Vorschau im Composer, nicht ueber die Annahme: die
 * verbindliche Pruefung macht der Server an Inhalt und Endung.
 */

/** Muss zu `MAX_UPLOAD_BYTES` in `ai_attachment_processor.py` passen. */
export const MAX_ANHANG_BYTES = 32 * 1024 * 1024

export type AnhangArt = 'image' | 'text' | 'document' | 'binary'

const BILD_ENDUNG = /\.(png|jpe?g|webp|gif|heic|heif|avif|bmp|tiff?)$/i
const DOKUMENT_ENDUNG = /\.(pdf|docx|xlsx|pptx|odt|ods|odp)$/i
const TEXT_ENDUNG = new Set([
  'txt', 'log', 'md', 'markdown', 'rst', 'csv', 'tsv', 'json', 'jsonl',
  'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'properties', 'env',
  'html', 'htm', 'css', 'js', 'jsx', 'ts', 'tsx', 'py', 'sh', 'sql', 'java',
  'c', 'h', 'cpp', 'hpp', 'go', 'rs', 'rb', 'php', 'bat', 'cmd', 'ps1',
  'svg', 'kt', 'kts', 'swift', 'lua', 'pl', 'r', 'scala', 'cs', 'fs', 'vb',
  'asm', 'm', 'mm', 'gradle', 'lock', 'gitignore', 'editorconfig',
])
const TEXT_NAMEN = new Set([
  'dockerfile', 'makefile', 'procfile', 'license', 'readme', 'changelog',
])

function endung(name: string): string {
  const treffer = /\.([^.\\/]+)$/.exec(name)
  return treffer ? treffer[1].toLowerCase() : ''
}

export function istBildDatei(datei: File): boolean {
  const typ = (datei.type || '').toLowerCase()
  // SVG ist XML und geht als Text an das Modell. Ein „Bild“ daraus zu machen
  // wuerde den Code in ein PNG umwandeln, den der Benutzer hochgeladen hat.
  if (typ === 'image/svg+xml') return false
  if (typ.startsWith('image/')) return true
  return BILD_ENDUNG.test(datei.name)
}

/**
 * Kann der Browser diese Bilddatei als Thumbnail zeichnen? HEIC und TIFF
 * sind Bilder, aber nicht in jedem WebView darstellbar; dort steht das
 * Bildsymbol statt eines kaputten <img>.
 */
export function istVorschauFaehig(datei: File): boolean {
  const typ = (datei.type || '').toLowerCase()
  if (typ.startsWith('image/')) {
    return /^image\/(png|jpe?g|webp|gif|avif|bmp)$/.test(typ)
  }
  return /\.(png|jpe?g|webp|gif|avif|bmp)$/i.test(datei.name)
}

export function istBildAnhang(mediaType: string): boolean {
  const typ = (mediaType || '').toLowerCase()
  // SVG wird als Text extrahiert und nicht als Bild an das Modell geschickt.
  return typ.startsWith('image/') && typ !== 'image/svg+xml'
}

export function dateiArt(datei: File): AnhangArt {
  if (istBildDatei(datei)) return 'image'
  const suffix = endung(datei.name)
  const name = datei.name.toLowerCase()
  if (DOKUMENT_ENDUNG.test(datei.name)) return 'document'
  if (TEXT_ENDUNG.has(suffix) || TEXT_NAMEN.has(name)) return 'text'
  if ((datei.type || '').toLowerCase().startsWith('text/')) return 'text'
  return 'binary'
}

export function anhangArt(mediaType: string, name = ''): AnhangArt {
  if (istBildAnhang(mediaType)) return 'image'
  if (DOKUMENT_ENDUNG.test(name)) return 'document'
  const suffix = endung(name)
  if (TEXT_ENDUNG.has(suffix) || TEXT_NAMEN.has(name.toLowerCase())) return 'text'
  if ((mediaType || '').toLowerCase().startsWith('text/')) return 'text'
  return 'binary'
}

export function lesbareGroesse(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
}
