/**
 * TresorKategorieBildDialog — Auswahl oder lokaler Bildupload für Kategorien
 * und Ordner im Tresor.
 *
 * Eigene Bilder werden clientseitig auf maximal 640×360 Pixel skaliert und als
 * WebP-Data-URL im verschlüsselten Ordner-Eintrag (`extra.titelbild`) bzw.
 * für Standardkategorien lokal im Gerät gespeichert.
 */
import { useTranslation } from 'react-i18next'
import { Check, ImagePlus, RotateCcw } from 'lucide-react'
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, FileButton } from '@maunting/ui'
import { compressImageToWebp } from '@/lib/imageCompression'
import { still } from '@/lib/still'
import { KATEGORIE_HINTERGRUENDE } from './vaultKennzahlen'

export interface TresorKategorieBildDialogProps {
  offen: boolean
  kategorieName: string
  aktuellesBild?: string
  onSchliessen: () => void
  onBildWaehlen: (bildQuelle: string) => void
  onStandardWiederherstellen?: () => void
}

export function TresorKategorieBildDialog({
  offen,
  kategorieName,
  aktuellesBild,
  onSchliessen,
  onBildWaehlen,
  onStandardWiederherstellen,
}: TresorKategorieBildDialogProps) {
  const { t } = useTranslation()

  const eigenesBildVerarbeiten = async (datei: File) => {
    try {
      const dataUrl = await compressImageToWebp(datei, {
        targetWidth: 640,
        targetHeight: 360,
        quality: 0.82,
      })
      onBildWaehlen(dataUrl)
      onSchliessen()
    } catch (err) {
      still(err, 'TresorKategorieBildDialog.eigenesBild')
    }
  }

  return (
    <Dialog
      open={offen}
      onOpenChange={(open) => {
        if (!open) onSchliessen()
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader className="px-5 py-4 pr-14">
          <DialogTitle className="text-sm">
            {t('mss.vault.dashboard.hintergrundWaehlen', { name: kategorieName })}
          </DialogTitle>
          <p className="text-xs text-on-surface-variant">
            {t('mss.vault.dashboard.hintergrundAendern')}
          </p>
        </DialogHeader>
        <div className="space-y-4 p-5">
          <div className="max-h-[340px] overflow-y-auto pr-1 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {KATEGORIE_HINTERGRUENDE.map((motiv) => {
              const aktiv = aktuellesBild === motiv.pfad
              return (
                <button
                  key={motiv.id}
                  type="button"
                  onClick={() => {
                    onBildWaehlen(motiv.pfad)
                    onSchliessen()
                  }}
                  aria-label={motiv.label}
                  className={`group relative h-24 overflow-hidden rounded-xl border text-left transition-all ${
                    aktiv
                      ? 'border-primary ring-2 ring-primary/40'
                      : 'border-outline-variant/25 hover:border-outline-variant/50'
                  }`}
                >
                  <img
                    src={motiv.pfad}
                    alt={motiv.label}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
                  <span className="absolute bottom-2 left-2.5 right-2 truncate text-xs font-medium text-white">
                    {motiv.label}
                  </span>
                  {aktiv && (
                    <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-on-primary">
                      <Check className="h-3 w-3" aria-hidden="true" />
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-outline-variant/20">
            <div className="flex flex-wrap items-center gap-2">
              <FileButton
                variant="secondary"
                size="sm"
                accept="image/*"
                onFile={(datei) => void eigenesBildVerarbeiten(datei)}
              >
                <ImagePlus className="h-4 w-4" aria-hidden="true" />
                {t('mss.vault.dashboard.eigenesBildHochladen')}
              </FileButton>
              {onStandardWiederherstellen && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onStandardWiederherstellen()
                    onSchliessen()
                  }}
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('mss.vault.dashboard.standardBildWiederherstellen')}
                </Button>
              )}
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={onSchliessen}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
