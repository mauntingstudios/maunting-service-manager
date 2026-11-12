import { ArrowRight, Image as ImageIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { Treffer } from '../MsmSuche'
import { SuchBild } from '../SuchBild'
import { host, istLogoOderGrafik } from './helfer'

interface Props {
  treffer: Treffer[]
  onBild: (treffer: Treffer) => void
  onAlle: () => void
}

/** Die Bilder zu dieser Suche, aus den vorhandenen Vorschauen der Webtreffer. */
export function BilderStreifen({ treffer, onBild, onAlle }: Props) {
  const { t } = useTranslation()
  const bilder = treffer.filter((x) => x.bild).slice(0, 6)
  if (bilder.length < 2) return null

  return (
    <section
      aria-label={t('browser.msmSuche.bilderTitel')}
      className="border-t border-outline-variant/25 pt-5"
    >
      <h2 className="mb-3 flex items-center gap-2 text-title-sm font-semibold text-on-surface">
        <ImageIcon className="h-4 w-4 text-primary" aria-hidden="true" />
        <span>{t('browser.msmSuche.bilderTitel')}</span>
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {bilder.map((x, idx) => {
          const bezeichnung = x.titel || host(x.url)
          const domain = host(x.url)
          const istLogo = istLogoOderGrafik(x.bild, bezeichnung)
          return (
            <button
              key={`${x.url}-${idx}`}
              type="button"
              onClick={() => onBild(x)}
              aria-label={bezeichnung}
              className="group relative aspect-[16/10] overflow-hidden rounded-xl border border-outline-variant/35 bg-surface-container/80 shadow-sm transition-all duration-200 hover:border-primary/50 hover:shadow-float"
            >
              <SuchBild
                url={x.bild}
                alt={bezeichnung}
                className={
                  istLogo
                    ? 'h-full w-full object-contain p-2.5 bg-surface-container-low/90 transition-transform duration-300 group-hover:scale-105'
                    : 'h-full w-full object-cover transition-transform duration-300 group-hover:scale-105'
                }
              />
              <span className="absolute inset-x-0 bottom-0 block truncate bg-gradient-to-t from-black/80 via-black/35 to-transparent px-2.5 pb-2 pt-8 text-label-sm text-white transition-opacity duration-150 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100">
                <span className="block truncate font-medium">{bezeichnung}</span>
                <span className="block truncate text-white/75">{domain}</span>
              </span>
            </button>
          )
        })}
      </div>
      <div className="mt-2.5">
        <button
          type="button"
          onClick={onAlle}
          className="inline-flex items-center gap-1.5 rounded-full px-1 py-0.5 text-label-md font-medium text-primary decoration-primary/60 underline-offset-4 transition-colors hover:underline"
        >
          <span>{t('browser.msmSuche.bilderAlleAnsehen')}</span>
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </section>
  )
}