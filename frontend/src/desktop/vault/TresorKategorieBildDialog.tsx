/**
 * TresorKategorieBildDialog — Auswahl oder lokaler Bildupload für Kategorien
 * und Ordner im Tresor.
 *
 * Eigene Bilder werden clientseitig auf maximal 640×360 Pixel skaliert und als
 * WebP-Data-URL im verschlüsselten Ordner-Eintrag (`extra.titelbild`) bzw.
 * für Standardkategorien lokal im Gerät gespeichert.
 */
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ImagePlus, RotateCcw } from 'lucide-react'
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle } from '@maunting/ui'
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

async function komprimiereBildDatei(datei: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const leser = new FileReader()
    leser.onerror = () => reject(new Error('Datei konnte nicht gelesen werden'))
    leser.onload = () => {
      const bild = new Image()
      bild.onerror = () => reject(new Error('Bild konnte nicht dekodiert werden'))
      bild.onload = () => {
        const zielBreite = 640
        const zielHoehe = 360
        const leinwand = document.createElement('canvas')
        leinwand.width = zielBreite
        leinwand.height = zielHoehe
        const kontext = leinwand.getContext('2d')
        if (!kontext) {
          resolve(String(leser.result ?? ''))
          return
        }
        const skalierung = Math.max(zielBreite / bild.width, zielHoehe / bild.height)
        const breite = bild.width * skalierung
        const hoehe = bild.height * skalierung
        const x = (zielBreite - breite) / 2
        const y = (zielHoehe - hoehe) / 2
        kontext.drawImage(bild, x, y, breite, hoehe)
        resolve(leinwand.toDataURL('image/webp', 0.82))
      }
      bild.src = String(leser.result ?? '')
    }
    leser.readAsDataURL(datei)
  })
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
  const dateiEingabeRef = useRef<HTMLInputElement | null>(null)

  const eigenesBildVerarbeiten = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const datei = event.target.files?.[0]
    event.target.value = ''
    if (!datei) return
    try {
      const dataUrl = await komprimiereBildDatei(datei)
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

          <input
            ref={dateiEingabeRef}
            type="file"
            accept="image/*"
            onChange={eigenesBildVerarbeiten}
            className="hidden"
          />

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-outline-variant/20">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => dateiEingabeRef.current?.click()}
              >
                <ImagePlus className="h-4 w-4" aria-hidden="true" />
                {t('mss.vault.dashboard.eigenesBildHochladen')}
              </Button>
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
