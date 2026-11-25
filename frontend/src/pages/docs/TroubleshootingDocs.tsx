import { useTranslation } from 'react-i18next'
import { AlertTriangle, BookOpen, HardDrive, Terminal, Wrench } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PageHeader, buttonClasses } from '@maunting/ui'

interface ErrorEntry {
  code: string
  titleKey: string
  bodyKey: string
}

const STEAM_ERRORS: ErrorEntry[] = [
  {
    code: '0x202 / UpdateResult 43',
    titleKey: 'docsTroubleshooting.steam.err0x202Title',
    bodyKey: 'docsTroubleshooting.steam.err0x202Body',
  },
  {
    code: 'Missing configuration',
    titleKey: 'docsTroubleshooting.steam.errMissingConfigTitle',
    bodyKey: 'docsTroubleshooting.steam.errMissingConfigBody',
  },
  {
    code: '0x226 / 0x206 / Timed out',
    titleKey: 'docsTroubleshooting.steam.err0x226Title',
    bodyKey: 'docsTroubleshooting.steam.err0x226Body',
  },
  {
    code: 'Login / Steam Guard',
    titleKey: 'docsTroubleshooting.steam.errLoginTitle',
    bodyKey: 'docsTroubleshooting.steam.errLoginBody',
  },
]

const GENERAL_ERRORS: ErrorEntry[] = [
  {
    code: 'ENOSPC / EDQUOT',
    titleKey: 'docsTroubleshooting.general.errDiskTitle',
    bodyKey: 'docsTroubleshooting.general.errDiskBody',
  },
  {
    code: 'Exit 137 / OOMKilled',
    titleKey: 'docsTroubleshooting.general.errOomTitle',
    bodyKey: 'docsTroubleshooting.general.errOomBody',
  },
  {
    code: 'Exit 126 / EACCES',
    titleKey: 'docsTroubleshooting.general.errPermTitle',
    bodyKey: 'docsTroubleshooting.general.errPermBody',
  },
  {
    code: 'Address already in use',
    titleKey: 'docsTroubleshooting.general.errPortTitle',
    bodyKey: 'docsTroubleshooting.general.errPortBody',
  },
  {
    code: 'HTTP 401/403/404 / DNS',
    titleKey: 'docsTroubleshooting.general.errNetworkTitle',
    bodyKey: 'docsTroubleshooting.general.errNetworkBody',
  },
  {
    code: 'SQLite / Config',
    titleKey: 'docsTroubleshooting.general.errConfigTitle',
    bodyKey: 'docsTroubleshooting.general.errConfigBody',
  },
]

export function TroubleshootingDocs() {
  const { t } = useTranslation()

  const toc = [
    { key: 'workflow', title: t('docsTroubleshooting.toc.workflow') },
    { key: 'steam', title: t('docsTroubleshooting.toc.steam') },
    { key: 'general', title: t('docsTroubleshooting.toc.general') },
  ]

  return (
    <div className="msm-page mx-auto max-w-6xl">
      <PageHeader
        eyebrow={t('pageContext.help')}
        title={t('docsTroubleshooting.title')}
        description={t('docsTroubleshooting.subtitle')}
        status={<Wrench className="h-6 w-6 text-primary" aria-hidden="true" />}
      />

      <div className="mb-8 flex flex-wrap gap-3">
        <Link to="/servers" className={buttonClasses('secondary')}>
          <Terminal className="h-4 w-4" aria-hidden="true" />
          {t('docsTroubleshooting.backToServers')}
        </Link>
        <Link to="/docs" className={buttonClasses('ghost')}>
          <BookOpen className="h-4 w-4" aria-hidden="true" />
          {t('docsTroubleshooting.allDocs')}
        </Link>
      </div>

      <details className="msm-card mb-5 p-4 lg:hidden">
        <summary className="cursor-pointer font-label-md text-sm font-semibold text-on-surface">
          {t('docsTroubleshooting.tocTitle')}
        </summary>
        <nav className="mt-3 border-t border-outline-variant pt-3" aria-label={t('docsTroubleshooting.tocTitle')}>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {toc.map(({ key, title }) => (
              <li key={key}>
                <a
                  href={`#troubleshooting-${key}`}
                  className="block min-h-11 py-2 text-sm text-on-surface-variant hover:text-on-surface"
                >
                  {title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </details>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[220px,1fr]">
        <nav className="hidden lg:sticky lg:top-20 lg:block lg:self-start" aria-label={t('docsTroubleshooting.tocTitle')}>
          <h2 className="mb-3 font-headline text-label-lg uppercase tracking-wide text-on-surface-variant">
            {t('docsTroubleshooting.tocTitle')}
          </h2>
          <ul className="space-y-1.5">
            {toc.map(({ key, title }) => (
              <li key={key}>
                <a
                  href={`#troubleshooting-${key}`}
                  className="block text-body-sm text-on-surface-variant transition-colors hover:text-on-surface"
                >
                  {title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-6">
          <section id="troubleshooting-workflow" className="msm-card scroll-mt-20 p-6">
            <div className="mb-3 flex items-center gap-2.5">
              <Terminal className="h-5 w-5 text-primary" aria-hidden="true" />
              <h2 className="font-headline text-headline-sm font-bold text-on-surface">
                {t('docsTroubleshooting.toc.workflow')}
              </h2>
            </div>
            <p className="mb-4 font-body-md text-body-md text-on-surface-variant">
              {t('docsTroubleshooting.workflow.intro')}
            </p>
            <ol className="list-decimal space-y-2 pl-5 font-body-md text-body-md text-on-surface-variant">
              <li>{t('docsTroubleshooting.workflow.step1')}</li>
              <li>{t('docsTroubleshooting.workflow.step2')}</li>
              <li>{t('docsTroubleshooting.workflow.step3')}</li>
            </ol>
          </section>

          <section id="troubleshooting-steam" className="msm-card scroll-mt-20 p-6">
            <div className="mb-4 flex items-center gap-2.5">
              <HardDrive className="h-5 w-5 text-primary" aria-hidden="true" />
              <h2 className="font-headline text-headline-sm font-bold text-on-surface">
                {t('docsTroubleshooting.toc.steam')}
              </h2>
            </div>
            <div className="space-y-4">
              {STEAM_ERRORS.map((entry) => (
                <article
                  key={entry.code}
                  className="rounded-xl border border-outline-variant/40 bg-surface-container-low/60 p-4"
                >
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-status-warning/15 px-2 py-0.5 font-mono text-xs font-semibold text-status-warning">
                      {entry.code}
                    </span>
                    <h3 className="font-headline text-sm font-bold text-on-surface">
                      {t(entry.titleKey)}
                    </h3>
                  </div>
                  <p className="font-body-md text-sm text-on-surface-variant">
                    {t(entry.bodyKey)}
                  </p>
                </article>
              ))}
            </div>
          </section>

          <section id="troubleshooting-general" className="msm-card scroll-mt-20 p-6">
            <div className="mb-4 flex items-center gap-2.5">
              <AlertTriangle className="h-5 w-5 text-status-warning" aria-hidden="true" />
              <h2 className="font-headline text-headline-sm font-bold text-on-surface">
                {t('docsTroubleshooting.toc.general')}
              </h2>
            </div>
            <div className="space-y-4">
              {GENERAL_ERRORS.map((entry) => (
                <article
                  key={entry.code}
                  className="rounded-xl border border-outline-variant/40 bg-surface-container-low/60 p-4"
                >
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-status-destructive/15 px-2 py-0.5 font-mono text-xs font-semibold text-status-destructive">
                      {entry.code}
                    </span>
                    <h3 className="font-headline text-sm font-bold text-on-surface">
                      {t(entry.titleKey)}
                    </h3>
                  </div>
                  <p className="font-body-md text-sm text-on-surface-variant">
                    {t(entry.bodyKey)}
                  </p>
                </article>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
