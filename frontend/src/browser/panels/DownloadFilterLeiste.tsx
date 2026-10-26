/**
 * Modulare Filterleiste für das Download-Panel:
 * - Suchfeld für Dateinamen und Quell-Domain
 * - Barrierefreies Design-DNA Dropdown für Dateikategorien
 * - Aktionen zum Öffnen des Download-Ordners und Leeren der Liste
 */
import { FolderOpen, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button, Dropdown, type DropdownOption, Input, Kurzinfo } from '@/Singra/UI'

import type { DownloadKategorie } from '../services/downloadKategorien'

interface DownloadFilterLeisteProps {
  suche: string
  setSuche: (suche: string) => void
  kategorie: DownloadKategorie
  setKategorie: (kategorie: DownloadKategorie) => void
  onOrdnerOeffnen?: () => void
  onLeerenKlick: () => void
  hatEintraege: boolean
  istAndroid: boolean
}

export function DownloadFilterLeiste({
  suche,
  setSuche,
  kategorie,
  setKategorie,
  onOrdnerOeffnen,
  onLeerenKlick,
  hatEintraege,
  istAndroid,
}: DownloadFilterLeisteProps) {
  const { t } = useTranslation()

  const optionen: DropdownOption[] = [
    { value: 'alle', label: t('browser.downloads.kategorien.alle') },
    { value: 'dokumente', label: t('browser.downloads.kategorien.dokumente') },
    { value: 'bilder', label: t('browser.downloads.kategorien.bilder') },
    { value: 'programme', label: t('browser.downloads.kategorien.programme') },
    { value: 'archive', label: t('browser.downloads.kategorien.archive') },
    { value: 'andere', label: t('browser.downloads.kategorien.andere') },
  ]

  return (
    <div className="flex shrink-0 flex-col gap-2 p-3 border-b border-surface-container-highest">
      <div className="flex items-center justify-between gap-2">
        {!istAndroid && onOrdnerOeffnen ? (
          <Kurzinfo text={t('browser.downloads.ordnerOeffnen')} seite="anfang">
            <Button
              variant="ghost"
              size="sm"
              onClick={onOrdnerOeffnen}
              className="gap-1.5"
            >
              <FolderOpen className="h-4 w-4" aria-hidden="true" />
              <span>{t('browser.downloads.ordner')}</span>
            </Button>
          </Kurzinfo>
        ) : (
          <span className="text-title-sm font-medium text-on-surface">
            {t('browser.downloads.titel')}
          </span>
        )}
        {hatEintraege && (
          <Button variant="ghost" size="sm" onClick={onLeerenKlick}>
            {t('browser.downloads.listeLeeren')}
          </Button>
        )}
      </div>

      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-on-surface-variant"
          aria-hidden="true"
        />
        <Input
          value={suche}
          onChange={(e) => setSuche(e.target.value)}
          aria-label={t('browser.downloads.suchen')}
          placeholder={t('browser.downloads.suchen')}
          className="pl-9"
        />
      </div>

      <div className="w-full">
        <Dropdown
          value={kategorie}
          onChange={(wert) => setKategorie(wert as DownloadKategorie)}
          options={optionen}
          aria-label={t('browser.downloads.kategorieFilter')}
          className="w-full"
        />
      </div>
    </div>
  )
}
