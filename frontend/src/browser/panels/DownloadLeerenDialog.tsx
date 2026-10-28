/**
 * Dialog zur Bestätigung von „Downloads leeren“:
 * - Option 1 (Standard): Nur Einträge aus der Browser-Liste entfernen (Dateien bleiben erhalten)
 * - Option 2 (Checkbox): Zugehörige Dateien ebenfalls von der Festplatte löschen
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/Singra/UI'

interface DownloadLeerenDialogProps {
  offen: boolean
  onSchliessen: () => void
  onBestaetigen: (auchDateienLoeschen: boolean) => void
  anzahlDateien: number
}

export function DownloadLeerenDialog({
  offen,
  onSchliessen,
  onBestaetigen,
  anzahlDateien,
}: DownloadLeerenDialogProps) {
  const { t } = useTranslation()
  const [auchDateien, setAuchDateien] = useState(false)

  const handleBestaetigen = () => {
    onBestaetigen(auchDateien)
    onSchliessen()
    setAuchDateien(false)
  }

  const handleSchliessen = () => {
    onSchliessen()
    setAuchDateien(false)
  }

  return (
    <Dialog open={offen} onOpenChange={(o) => (!o ? handleSchliessen() : null)}>
      <DialogContent showCloseButton>
        <DialogHeader>
          <DialogTitle>{t('browser.downloads.leerenTitel')}</DialogTitle>
          <DialogDescription>
            {t('browser.downloads.leerenBeschreibung')}
          </DialogDescription>
        </DialogHeader>

        <div className="p-6 flex flex-col gap-4">
          <label htmlFor="downloads-auch-dateien-loeschen" className="flex items-start gap-3 cursor-pointer select-none">
            <Checkbox
              checked={auchDateien}
              onCheckedChange={setAuchDateien}
              id="downloads-auch-dateien-loeschen"
              aria-label={t('browser.downloads.auchDateienLoeschen')}
              className="mt-0.5"
            />
            <span className="flex flex-col text-body-sm">
              <span className="font-medium text-on-surface">
                {t('browser.downloads.auchDateienLoeschen')}
              </span>
              <span className="text-label-sm text-on-surface-variant">
                {t('browser.downloads.auchDateienLoeschenHinweis', { anzahl: anzahlDateien })}
              </span>
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={handleSchliessen}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={auchDateien ? 'destructive' : 'primary'}
            size="sm"
            onClick={handleBestaetigen}
          >
            {auchDateien
              ? t('browser.downloads.allesEndgueltigLoeschen')
              : t('browser.downloads.listeLeeren')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
