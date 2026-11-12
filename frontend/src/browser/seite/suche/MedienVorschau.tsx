import { ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, useZurueckSchliesst } from '@maunting/ui'

import type { Treffer } from '../MsmSuche'
import { SuchBild } from '../SuchBild'
import { bildaufloesung, bildformat, host } from './helfer'

/**
 * Medien-Vorschau: Bilder und Videos erst prüfen, dann öffnen. Zurück schließt
 * (`useZurueckSchliesst`), damit die Geste unter Android nicht die App beendet.
 */
export function MedienVorschauDialog({
  vorschau,
  onSchliessen,
  onOeffnen,
}: {
  vorschau: { treffer: Treffer; art: 'bild' | 'video' } | null
  onSchliessen: () => void
  onOeffnen: (url: string, imNeuenTab?: boolean) => void
}) {
  const { t } = useTranslation()
  useZurueckSchliesst(!!vorschau, onSchliessen)
  const aufloesung = bildaufloesung(vorschau?.treffer.bildBreite, vorschau?.treffer.bildHoehe)
  const format = bildformat(vorschau?.treffer.bildOriginal || vorschau?.treffer.bild)
  return (
    <Dialog open={!!vorschau} onOpenChange={(offen) => !offen && onSchliessen()}>
      <DialogContent aria-label={t('browser.msmSuche.medienVorschauTitel')}>
        <DialogHeader>
          <DialogTitle>{vorschau?.treffer.titel || t('browser.msmSuche.medienVorschauTitel')}</DialogTitle>
        </DialogHeader>
        {vorschau && (
          <div className="space-y-3">
            {vorschau.treffer.bild && (
              <SuchBild
                url={vorschau.treffer.bild}
                alt={vorschau.treffer.titel}
                width={vorschau.treffer.bildBreite}
                height={vorschau.treffer.bildHoehe}
                className="max-h-[50vh] w-full rounded-xl border border-outline-variant/40 bg-surface-container object-contain"
              />
            )}
            {vorschau.treffer.inhalt && (
              <p className="line-clamp-4 text-body-sm text-on-surface-variant">{vorschau.treffer.inhalt}</p>
            )}
            {vorschau.art === 'bild' && (
              <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-label-sm">
                <dt className="text-on-surface-variant">{t('browser.msmSuche.bildQuelle')}</dt>
                <dd className="truncate text-on-surface">
                  {vorschau.treffer.quelle || host(vorschau.treffer.url)}
                </dd>
                {aufloesung && (
                  <>
                    <dt className="text-on-surface-variant">{t('browser.msmSuche.bildAufloesung')}</dt>
                    <dd className="text-on-surface">{aufloesung}</dd>
                  </>
                )}
                {format && (
                  <>
                    <dt className="text-on-surface-variant">{t('browser.msmSuche.bildFormat')}</dt>
                    <dd className="text-on-surface">{format}</dd>
                  </>
                )}
                {vorschau.treffer.bildOriginal && (
                  <>
                    <dt className="text-on-surface-variant">{t('browser.msmSuche.bildOriginal')}</dt>
                    <dd className="min-w-0">
                      <a
                        href={vorschau.treffer.bildOriginal}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="break-all text-primary hover:underline"
                      >
                        {vorschau.treffer.bildOriginal}
                      </a>
                    </dd>
                  </>
                )}
              </dl>
            )}
            <p className="truncate text-label-sm text-on-surface-variant">{vorschau.treffer.url}</p>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onSchliessen}>
            {t('common.close')}
          </Button>
          {vorschau && (
            <Button type="button" variant="primary" onClick={() => onOeffnen(vorschau.treffer.url)}>
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t('browser.msmSuche.medienVorschauOeffnen')}</span>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}