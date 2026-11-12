import { Globe, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { usePublicLegalSettings } from '@/hooks/usePublicLegalSettings'

/** Die ruhige Produktzeile unter den Treffern: Marke, Rechtliches, Region, Schutz. */
export function SuchFooter({
  regionLabel,
  sicher,
  onDatenschutz,
}: {
  regionLabel: string
  sicher: boolean
  onDatenschutz: () => void
}) {
  const { t } = useTranslation()
  const rechtliches = usePublicLegalSettings()

  return (
    <footer className="mt-auto border-t border-outline-variant/20 bg-surface-container-lowest/80 px-4 py-5 text-label-sm text-on-surface-variant backdrop-blur-sm sm:px-6">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-x-6 gap-y-3 md:pl-[208px]">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <img src="/msp.png" alt="" className="h-4 w-4 rounded-full opacity-80" />
          <span className="font-medium text-on-surface/85">Maunting Search</span>
          <span className="hidden text-on-surface-variant/75 md:inline">
            · {t('browser.msmSuche.footerClaim')}
          </span>
        </div>

        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2" aria-label={t('browser.msmSuche.footerRechtliches')}>
          <button
            type="button"
            onClick={onDatenschutz}
            className="underline-offset-4 transition-colors hover:text-primary hover:underline"
          >
            {t('browser.msmSuche.footerDatenschutz')}
          </button>
          {rechtliches.imprint_enabled && rechtliches.imprint_url && (
            <a
              href={rechtliches.imprint_url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline-offset-4 transition-colors hover:text-primary hover:underline"
            >
              {t('browser.msmSuche.footerImpressum')}
            </a>
          )}
        </nav>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="inline-flex items-center gap-1.5">
            <Globe className="h-3.5 w-3.5 text-primary/80" aria-hidden="true" />
            <span>{regionLabel}</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className={sicher ? 'h-3.5 w-3.5 text-status-success' : 'h-3.5 w-3.5 text-on-surface-variant/70'} aria-hidden="true" />
            <span>{t(sicher ? 'browser.msmSuche.sicherAn' : 'browser.msmSuche.sicherAus')}</span>
          </span>
        </div>
      </div>
    </footer>
  )
}