/**
 * Modulares Download-Panel für Maunting Pontis:
 * - Persistente Download-Historie (bis zu 500 Einträge)
 * - Live-Suche und barrierefreie Kategorie-Filterung
 * - Datums-Gruppierung (analog zum Verlauf)
 * - Proaktive Dateiexistenz-Prüfung
 * - Sichere Lösch- und Bereinigungsoptionen
 */
import { useEffect, useMemo, useState } from 'react'
import { FileDown, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Zustandsflaeche } from '@/Singra/UI/Zustandsflaeche'

import { type DownloadKategorie } from '../services/downloadKategorien'
import { type Download, useDownloadsStore } from '../services/downloadsStore'
import { herkunft } from '../services/importDaten'
import { istTauri, nativ } from '../services/nativ'
import { istAndroid } from '../services/plattform'
import { DownloadEintragZeile, dateiname } from './DownloadEintragZeile'
import { DownloadFilterLeiste } from './DownloadFilterLeiste'
import { DownloadLeerenDialog } from './DownloadLeerenDialog'

function laeuft(d: Download): boolean {
  return d.stand === 'start' || d.stand === 'pruefung'
}

function tag(zeit: number): string {
  return new Date(zeit).toDateString()
}

export function DownloadsPanel() {
  const { t, i18n } = useTranslation()
  const downloads = useDownloadsStore((s) => s.downloads)
  const gesehen = useDownloadsStore((s) => s.gesehen)
  const leeren = useDownloadsStore((s) => s.leeren)
  const loeschen = useDownloadsStore((s) => s.loeschen)
  const existenzSetzen = useDownloadsStore((s) => s.existenzSetzen)
  const fertigeDateien = useDownloadsStore((s) => s.fertigeDateien)

  const android = istAndroid()
  const [jetzt, setJetzt] = useState(() => Date.now())
  const [suche, setSuche] = useState('')
  const [kategorie, setKategorie] = useState<DownloadKategorie>('alle')
  const [dialogOffen, setDialogOffen] = useState(false)

  const etwasLaeuft = downloads.some(laeuft)

  useEffect(() => {
    gesehen()
  }, [gesehen, downloads.length])

  useEffect(() => {
    if (!etwasLaeuft) return
    const tick = window.setInterval(() => setJetzt(Date.now()), 5000)
    return () => window.clearInterval(tick)
  }, [etwasLaeuft])

  // Prüft die Existenz der fertigen Dateien auf der Festplatte (Desktop; auf Android regelt Scoped Storage / MediaStore die Ablage)
  useEffect(() => {
    if (!istTauri() || android) return
    const fertige = downloads.filter((d) => d.stand === 'fertig' && d.datei && d.existiert !== false)
    for (const d of fertige) {
      if (!d.datei) continue
      void nativ
        .downloadPruefen(d.datei)
        .then((vorhanden) => {
          if (vorhanden === false) {
            existenzSetzen(d.id, false)
          }
        })
        .catch(() => null)
    }
  }, [downloads.length, existenzSetzen, android])

  const gefiltert = useMemo(() => {
    const s = suche.trim().toLowerCase()
    return downloads.filter((d) => {
      if (kategorie !== 'alle' && d.kategorie !== kategorie) {
        return false
      }
      if (s) {
        const name = dateiname(d.datei, d.url).toLowerCase()
        const quelle = (herkunft(d.url) || '').toLowerCase()
        const url = d.url.toLowerCase()
        if (!name.includes(s) && !quelle.includes(s) && !url.includes(s)) {
          return false
        }
      }
      return true
    })
  }, [downloads, suche, kategorie])

  const dateiLoeschen = async (d: Download) => {
    try {
      if (d.datei) {
        await nativ.downloadLoeschen(d.datei)
      }
    } catch (fehler) {
      console.warn('[MSB] Datei löschen fehlgeschlagen:', fehler)
    } finally {
      loeschen(d.id || d.nr)
    }
  }

  const eintragEntfernen = (d: Download) => {
    loeschen(d.id || d.nr)
  }

  const abbrechen = async (nr: number) => {
    try {
      await nativ.downloadAbbrechen(nr)
    } catch (fehler) {
      console.warn('[MSB] Download abbrechen fehlgeschlagen:', fehler)
    }
  }

  const handleLeerenBestaetigt = async (auchDateien: boolean) => {
    if (auchDateien) {
      const pfade = fertigeDateien()
      for (const p of pfade) {
        try {
          await nativ.downloadLoeschen(p)
        } catch (fehler) {
          console.warn('[MSB] Datei löschen fehlgeschlagen:', fehler)
        }
      }
    }
    leeren()
  }

  const anzahlDateien = fertigeDateien().length

  const onLeerenKlick = () => {
    if (anzahlDateien === 0) {
      leeren()
    } else {
      setDialogOffen(true)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <DownloadFilterLeiste
        suche={suche}
        setSuche={setSuche}
        kategorie={kategorie}
        setKategorie={setKategorie}
        onOrdnerOeffnen={() => void nativ.downloadOrdnerOeffnen()}
        onLeerenKlick={onLeerenKlick}
        hatEintraege={downloads.length > 0}
        istAndroid={android}
      />

      {downloads.length === 0 ? (
        <Zustandsflaeche
          art="leer"
          icon={<FileDown className="h-10 w-10" />}
          text={t('browser.downloads.leer')}
        />
      ) : gefiltert.length === 0 ? (
        <Zustandsflaeche
          art="leer"
          icon={<Search className="h-10 w-10" />}
          text={t('browser.downloads.keineTreffer')}
          ansagen
        />
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {gefiltert.map((d, index) => {
            const vorher = gefiltert[index - 1]
            const datumUeberschrift =
              !vorher || tag(vorher.zeit) !== tag(d.zeit) ? (
                <li
                  key={`datum-${tag(d.zeit)}`}
                  className="px-2 pb-1 pt-3 text-label-sm font-medium text-on-surface-variant list-none"
                >
                  {new Date(d.zeit).toLocaleDateString(i18n.language, {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  })}
                </li>
              ) : null

            return (
              <div key={d.id || d.nr}>
                {datumUeberschrift}
                <DownloadEintragZeile
                  download={d}
                  jetzt={jetzt}
                  istAndroid={android}
                  onOeffnen={(datei) => void nativ.downloadOeffnen(datei)}
                  onZeigen={(datei) => void nativ.downloadZeigen(datei)}
                  onAbbrechen={(nr) => void abbrechen(nr)}
                  onLoeschen={(dl) => void dateiLoeschen(dl)}
                  onEntfernen={(dl) => eintragEntfernen(dl)}
                />
              </div>
            )
          })}
        </ul>
      )}

      <DownloadLeerenDialog
        offen={dialogOffen}
        onSchliessen={() => setDialogOffen(false)}
        onBestaetigen={(auchDateien) => void handleLeerenBestaetigt(auchDateien)}
        anzahlDateien={anzahlDateien}
      />
    </div>
  )
}
