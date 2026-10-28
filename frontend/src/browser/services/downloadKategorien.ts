/**
 * Klassifizierung von Dateiendungen in handliche Kategorien für Filter
 * und Symbole in der Download-Liste.
 */

export type DownloadKategorie = 'alle' | 'dokumente' | 'bilder' | 'programme' | 'archive' | 'andere'

const DOKUMENTE_ENDUNGEN = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'txt', 'rtf', 'odt', 'ods', 'odp', 'csv', 'tsv', 'epub', 'md',
])

const BILDER_ENDUNGEN = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'tiff', 'avif',
])

const PROGRAMME_ENDUNGEN = new Set([
  'exe', 'msi', 'bat', 'cmd', 'ps1', 'sh', 'apk', 'appimage', 'deb', 'rpm', 'dmg',
])

const ARCHIVE_ENDUNGEN = new Set([
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'tgz',
])

export function kategorieFuerDatei(dateiname: string): DownloadKategorie {
  const teile = dateiname.split(/[\\/]/)
  const reinerName = teile[teile.length - 1] || dateiname
  const punktIndex = reinerName.lastIndexOf('.')
  if (punktIndex <= 0) return 'andere'
  const endung = reinerName.slice(punktIndex + 1).toLowerCase()

  if (DOKUMENTE_ENDUNGEN.has(endung)) return 'dokumente'
  if (BILDER_ENDUNGEN.has(endung)) return 'bilder'
  if (PROGRAMME_ENDUNGEN.has(endung)) return 'programme'
  if (ARCHIVE_ENDUNGEN.has(endung)) return 'archive'
  return 'andere'
}
