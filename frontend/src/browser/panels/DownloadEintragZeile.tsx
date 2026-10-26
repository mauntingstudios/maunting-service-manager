/**
 * Modulare Eintragszeile für einen einzelnen Download:
 * - Dateityp- und Status-Symbole
 * - Klickbarer Dateiname (öffnet die Datei, falls vorhanden)
 * - Kennzeichnung fehlender/verschobener Dateien
 * - Echte Fortschrittsanzeige mit Rate und ETA bei laufenden Downloads
 * - Barrierefreie Aktions-Schaltflächen (Öffnen, Im Ordner zeigen, Löschen/Entfernen)
 */
import {
  CheckCircle2,
  ExternalLink,
  File,
  FileArchive,
  FileCode,
  FileText,
  FileX,
  FolderOpen,
  Image,
  Loader2,
  ShieldAlert,
  Trash2,
  X,
  XCircle,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Kurzinfo, ProgressBar } from '@/Singra/UI'

import type { DownloadKategorie } from '../services/downloadKategorien'
import type { Download } from '../services/downloadsStore'
import { herkunft } from '../services/importDaten'

interface DownloadEintragZeileProps {
  download: Download
  jetzt: number
  istAndroid: boolean
  onOeffnen: (datei: string) => void
  onZeigen: (datei: string) => void
  onAbbrechen: (nr: number) => void
  onLoeschen: (download: Download) => void
  onEntfernen: (download: Download) => void
}

const STILLSTAND_S = 15

export function dateiname(pfad: string | null, url: string): string {
  if (pfad) return pfad.split(/[\\/]/).pop() || pfad
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop() || url)
  } catch {
    return url
  }
}

export function bytesText(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '–'
  if (bytes < 1024) return `${bytes} B`
  const einheiten = ['KB', 'MB', 'GB', 'TB']
  let wert = bytes / 1024
  let einheit = einheiten[0]
  for (const e of einheiten) {
    einheit = e
    if (wert < 1024 || e === 'TB') break
    wert /= 1024
  }
  return `${wert.toFixed(wert < 10 ? 1 : 0)} ${einheit}`
}

export function dauerText(sekunden: number): string {
  const s = Math.max(0, Math.round(sekunden))
  if (s < 60) return `${s} s`
  const minuten = Math.floor(s / 60)
  if (minuten < 60) return `${minuten} min`
  return `${Math.floor(minuten / 60)} h ${minuten % 60} min`
}

function kategorieSymbol(kat: DownloadKategorie) {
  switch (kat) {
    case 'dokumente':
      return <FileText className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
    case 'bilder':
      return <Image className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
    case 'programme':
      return <FileCode className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
    case 'archive':
      return <FileArchive className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
    default:
      return <File className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
  }
}

export function DownloadEintragZeile({
  download: d,
  jetzt,
  istAndroid,
  onOeffnen,
  onZeigen,
  onAbbrechen,
  onLoeschen,
  onEntfernen,
}: DownloadEintragZeileProps) {
  const { t } = useTranslation()
  const name = dateiname(d.datei, d.url)
  const aktiv = d.stand === 'start' || d.stand === 'pruefung'
  const fehlt = d.existiert === false
  const istFertig = d.stand === 'fertig' && !!d.datei && !fehlt

  const anteil =
    d.empfangen != null && d.gesamt != null && d.gesamt > 0
      ? Math.max(0, Math.min(100, (d.empfangen / d.gesamt) * 100))
      : null
  const wartetSeit =
    aktiv && d.letzteBytesZeit != null ? Math.max(0, Math.round((jetzt - d.letzteBytesZeit) / 1000)) : null
  const steht = wartetSeit != null && wartetSeit >= STILLSTAND_S

  const details: string[] = []
  if (d.empfangen != null) {
    details.push(
      d.gesamt != null
        ? t('browser.downloads.von', { empfangen: bytesText(d.empfangen), gesamt: bytesText(d.gesamt) })
        : t('browser.downloads.nurEmpfangen', { empfangen: bytesText(d.empfangen) }),
    )
  }
  if (d.bytesProSekunde != null) {
    details.push(t('browser.downloads.rate', { rate: bytesText(Math.round(d.bytesProSekunde)) }))
  }
  if (d.restSekunden != null) {
    details.push(t('browser.downloads.eta', { zeit: dauerText(d.restSekunden) }))
  }

  const quelle = herkunft(d.url)
  const zeitText = new Date(d.zeit).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <li className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-surface-container-high transition-colors">
      {aktiv ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
      ) : d.stand === 'fertig' ? (
        fehlt ? (
          <FileX className="h-4 w-4 shrink-0 text-on-surface-variant" aria-hidden="true" />
        ) : (
          kategorieSymbol(d.kategorie)
        )
      ) : d.stand === 'blockiert' ? (
        <ShieldAlert className="h-4 w-4 shrink-0 text-status-destructive" aria-hidden="true" />
      ) : (
        <XCircle className="h-4 w-4 shrink-0 text-status-destructive" aria-hidden="true" />
      )}

      <span className="min-w-0 flex-1">
        {istFertig ? (
          <button
            type="button"
            onClick={() => onOeffnen(d.datei!)}
            className="block w-full text-left truncate text-body-sm font-medium text-on-surface hover:text-primary hover:underline cursor-pointer"
          >
            {name}
          </button>
        ) : fehlt ? (
          <span className="block truncate text-body-sm text-on-surface-variant line-through">{name}</span>
        ) : (
          <span className="block truncate text-body-sm text-on-surface">{name}</span>
        )}

        <span className="block text-label-sm text-on-surface-variant">
          <span>
            {fehlt ? (
              <span className="text-status-destructive">{t('browser.downloads.dateiFehlt')}</span>
            ) : (
              t(`browser.downloads.stand.${d.stand}`)
            )}
          </span>
          {!aktiv && (
            <span>
              {d.gesamt != null && ` · ${bytesText(d.gesamt)}`}
              {` · ${zeitText}`}
              {quelle && ` · ${quelle}`}
            </span>
          )}
        </span>

        {aktiv && (details.length > 0 || anteil != null) && (
          <span className="mt-1 block">
            <ProgressBar
              value={anteil}
              ariaLabel={t('browser.downloads.fortschrittName', { name })}
              data-testid={`download-fortschritt-${d.nr}`}
            />
            {details.length > 0 && (
              <span className="mt-0.5 block text-label-sm text-on-surface-variant">{details.join(' · ')}</span>
            )}
          </span>
        )}

        {steht && (
          <span className="mt-0.5 block text-label-sm text-on-surface-variant">
            {t('browser.downloads.wartet', { zeit: dauerText(wartetSeit ?? 0) })}
          </span>
        )}
      </span>

      <div className="flex items-center gap-1 shrink-0">
        {istFertig && (
          <>
            <Kurzinfo text={t('browser.downloads.oeffnen')} seite="ende">
              <button
                type="button"
                onClick={() => onOeffnen(d.datei!)}
                aria-label={t('browser.downloads.oeffnenName', { name })}
                className="flex h-7 w-7 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface"
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </button>
            </Kurzinfo>
            <Kurzinfo text={t(istAndroid ? 'browser.downloads.zeigenAndroid' : 'browser.downloads.zeigen')} seite="ende">
              <button
                type="button"
                onClick={() => onZeigen(d.datei!)}
                aria-label={t(istAndroid ? 'browser.downloads.zeigenNameAndroid' : 'browser.downloads.zeigenName', { name })}
                className="flex h-7 w-7 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface"
              >
                <FolderOpen className="h-4 w-4" aria-hidden="true" />
              </button>
            </Kurzinfo>
          </>
        )}

        {aktiv ? (
          <Kurzinfo text={t('browser.downloads.abbrechen')} seite="ende">
            <button
              type="button"
              onClick={() => onAbbrechen(d.nr)}
              aria-label={t('browser.downloads.abbrechenName', { name })}
              className="flex h-7 w-7 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-highest hover:text-status-destructive"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </Kurzinfo>
        ) : (
          <Kurzinfo
            text={t(d.datei && !fehlt ? 'browser.downloads.dateiLoeschen' : 'browser.downloads.entfernen')}
            seite="ende"
          >
            <button
              type="button"
              onClick={() => (d.datei && !fehlt ? onLoeschen(d) : onEntfernen(d))}
              aria-label={t(
                d.datei && !fehlt ? 'browser.downloads.dateiLoeschenName' : 'browser.downloads.entfernenName',
                { name },
              )}
              className="flex h-7 w-7 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-highest hover:text-status-destructive"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </Kurzinfo>
        )}
      </div>
    </li>
  )
}
