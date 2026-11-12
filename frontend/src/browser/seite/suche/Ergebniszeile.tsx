import { Badge } from '@maunting/ui'

import type { Treffer } from '../MsmSuche'
import { SeitenSymbol } from '../SeitenSymbol'
import { SuchBild } from '../SuchBild'
import { FormatierterText } from './FormatierterText'
import { datumText, host, istLogoOderGrafik, pfad } from './helfer'
import { useTranslation } from 'react-i18next'

interface Props {
  treffer: Treffer
  sprache: string
  sitelinks?: string[]
  /** Der erste Treffer als hervorgehobene Karte direkt unter dem KI-Überblick. */
  hervorgehoben?: boolean
  onOeffnen: (url: string, neuerTab?: boolean) => void
  onSitelink: (begriff: string) => void
}

function quellZeile(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.host}${pfad(url)}`
  } catch {
    return url
  }
}

/** Eine Zeile der klassischen Trefferliste: Quelle, Titel, Auszug, Datum. */
export function Ergebniszeile({ treffer, sprache, sitelinks = [], hervorgehoben = false, onOeffnen, onSitelink }: Props) {
  const { t } = useTranslation()
  const domain = host(treffer.url)
  const brotkrumen = quellZeile(treffer.url)
  const veroeffentlicht = datumText(treffer.published, sprache)
  const istLogo = istLogoOderGrafik(treffer.bild, `${treffer.titel} ${domain}`)

  return (
    <article
      className={
        hervorgehoben
          ? 'group rounded-2xl border border-primary/35 bg-surface-container/70 p-5 shadow-[inset_0_1px_0_hsl(var(--mui-focus)/0.15),var(--mui-shadow-panel)]'
          : 'group -mx-3 flex items-start gap-3.5 rounded-2xl px-3 py-5 transition-colors duration-150 hover:bg-surface-container-low/45'
      }
    >
      {hervorgehoben && (
        <div className="mb-3">
          <Badge variant="info">{t('browser.msmSuche.topErgebnis')}</Badge>
        </div>
      )}
      <div className={hervorgehoben ? 'flex items-start gap-3.5' : 'contents'}>
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-outline-variant/45 bg-surface-container-high/85 shadow-sm">
          <SeitenSymbol url={treffer.url} host={domain} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="min-w-0 leading-tight">
            <span className="block truncate text-label-md font-medium text-on-surface">{domain}</span>
            <span className="block truncate text-label-sm text-on-surface-variant/85">{brotkrumen}</span>
          </div>

          <button
            type="button"
            onClick={(ev) => onOeffnen(treffer.url, ev.ctrlKey || ev.metaKey)}
            onAuxClick={(ev) => ev.button === 1 && onOeffnen(treffer.url, true)}
            className="mt-1.5 block w-full rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            <h3 className="line-clamp-2 text-title-md font-semibold leading-snug text-primary decoration-primary/60 underline-offset-4 group-hover:underline">
              <FormatierterText text={treffer.titel || domain} />
            </h3>
            {treffer.inhalt && (
              <p className="mt-1 line-clamp-2 text-body-md leading-relaxed text-on-surface-variant sm:line-clamp-3">
                <FormatierterText text={treffer.inhalt} />
              </p>
            )}
          </button>

          {veroeffentlicht && (
            <p className="mt-1 text-label-sm text-on-surface-variant/80">{veroeffentlicht}</p>
          )}

          {sitelinks.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {sitelinks.map((link) => (
                <button
                  key={link}
                  type="button"
                  onClick={() => onSitelink(link)}
                  className="rounded-full border border-outline-variant/30 bg-surface-container-low/70 px-3 py-1 text-label-sm font-medium text-primary backdrop-blur-sm transition-colors hover:border-primary/45 hover:bg-surface-container-high"
                >
                  <FormatierterText text={link} />
                </button>
              ))}
            </div>
          )}
        </div>

        {treffer.bild && (
          <SuchBild
            url={treffer.bild}
            alt=""
            className={
              istLogo
                ? 'hidden h-[84px] w-[112px] shrink-0 rounded-xl border border-outline-variant/35 bg-surface-container-low/90 object-contain p-2 shadow-sm transition-transform duration-200 group-hover:scale-[1.02] sm:block'
                : 'hidden h-[84px] w-[112px] shrink-0 rounded-xl border border-outline-variant/35 bg-surface-container object-cover shadow-sm transition-transform duration-200 group-hover:scale-[1.02] sm:block'
            }
          />
        )}
      </div>
    </article>
  )
}