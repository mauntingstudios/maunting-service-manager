import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Activity,
  Archive,
  ArrowUpDown,
  CreditCard,
  FileText,
  FolderLock,
  Images,
  KeyRound,
  LayoutGrid,
  Monitor,
  Shield,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2,
} from 'lucide-react'
import type { VaultAnsicht } from './vaultAnsichten'

export interface VaultSidebarZaehler {
  passwoerter?: number
  karten?: number
  dateien?: number
  notizen?: number
  fotos?: number
  archiv?: number
}

export interface VaultSidebarProps {
  ansicht: VaultAnsicht
  onAnsicht: (ansicht: VaultAnsicht) => void
  anzahlImPapierkorb: number
  anzahlEintraege: number
  syncStatus: 'synced' | 'syncing' | 'offline' | 'error' | 'idle'
  onSperren: () => void
  tresorName?: string
  notizenAktiv?: boolean
  zaehler?: VaultSidebarZaehler
  onNotizen?: () => void
  onPasswortGenerieren?: () => void
  onSicherheitscheck?: () => void
  onImportExport?: () => void
  onHinweisVerwalten?: () => void
}

const SYMBOL = 'h-4 w-4 shrink-0'

/** Seitenleiste am Rechner. Die Reiter behalten role="tab" für Screenreader & Tests. */
export function VaultSidebar({
  ansicht,
  onAnsicht,
  anzahlImPapierkorb,
  anzahlEintraege,
  syncStatus,
  onSperren,
  tresorName = 'MSM',
  notizenAktiv = false,
  zaehler,
  onNotizen,
  onPasswortGenerieren,
  onSicherheitscheck,
  onImportExport,
  onHinweisVerwalten,
}: VaultSidebarProps) {
  const { t } = useTranslation()

  const eintrag = (id: VaultAnsicht, labelKey: string, icon: ReactNode, badge?: number, ueberschreibeAktiv?: boolean) => {
    const aktiv = ueberschreibeAktiv !== undefined ? ueberschreibeAktiv : ansicht === id
    return (
      <button
        key={id}
        type="button"
        role="tab"
        aria-selected={ansicht === id}
        onClick={() => onAnsicht(id)}
        className={`flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left text-sm transition-colors ${
          aktiv
            ? 'border-primary/30 bg-primary/15 text-on-surface font-medium'
            : 'border-transparent text-on-surface-variant hover:bg-surface-container/70 hover:text-on-surface'
        }`}
      >
        <span className={aktiv ? 'text-primary' : 'text-on-surface-variant/80'}>{icon}</span>
        <span className="min-w-0 flex-1 truncate">{t(labelKey)}</span>
        {typeof badge === 'number' && badge > 0 ? (
          <span className="shrink-0 rounded-full border border-outline-variant/20 bg-surface-container px-2 py-0.5 text-label-sm font-medium text-on-surface-variant">
            {badge}
          </span>
        ) : null}
        {aktiv ? <span className="h-4 w-0.5 shrink-0 rounded-full bg-primary" aria-hidden="true" /> : null}
      </button>
    )
  }

  const werkzeugEintrag = (schluessel: string, label: string, icon: ReactNode, onClick?: () => void) => {
    if (!onClick) return null
    return (
      <button
        key={schluessel}
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-2.5 rounded-xl border border-transparent px-2.5 py-1.5 text-left text-xs text-on-surface-variant transition-colors hover:bg-surface-container/70 hover:text-on-surface"
      >
        <span className="text-on-surface-variant/80">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </button>
    )
  }

  const gruppe = (titel: string, kinder: ReactNode) => (
    <div className="space-y-1 px-2.5 py-1.5">
      <p className="px-2 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-on-surface-variant/70">
        {titel}
      </p>
      {kinder}
    </div>
  )

  return (
    <nav
      aria-label={t('mss.vault.titelManager')}
      className="hidden w-60 shrink-0 flex-col border-r border-outline-variant/30 bg-surface-container vault-sidebar msm-sidebar md:flex xl:w-64"
    >
      {/* Marken-Kopfbereich */}
      <div className="flex items-center gap-2.5 border-b border-outline-variant/15 px-3.5 py-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/15 text-primary">
          <Shield className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-on-surface">{tresorName}</div>
          <div className="truncate text-label-sm text-on-surface-variant/80">
            {t('mss.vault.titelManager')}
          </div>
        </div>
      </div>

      <div
        role="tablist"
        aria-orientation="vertical"
        aria-label={t('mss.vault.titelManager')}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto py-2"
      >
        <div className="px-2.5">
          {eintrag('uebersicht', 'mss.vault.dashboard.uebersicht', <LayoutGrid className={SYMBOL} />)}
        </div>

        {gruppe(
          t('mss.vault.dashboard.gruppeInhalt'),
          <>
            {eintrag(
              'tresor',
              'mss.vault.ansicht.tresor',
              <KeyRound className={SYMBOL} />,
              zaehler?.passwoerter,
              ansicht === 'tresor' && !notizenAktiv,
            )}
            {eintrag('zahlung', 'mss.vault.ansicht.zahlung', <CreditCard className={SYMBOL} />, zaehler?.karten)}
            {eintrag('dateien', 'mss.vault.ansicht.dateien', <FolderLock className={SYMBOL} />, zaehler?.dateien)}
            {onNotizen && (
              <button
                type="button"
                onClick={onNotizen}
                className={`flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left text-sm transition-colors ${
                  ansicht === 'tresor' && notizenAktiv
                    ? 'border-primary/30 bg-primary/15 text-on-surface font-medium'
                    : 'border-transparent text-on-surface-variant hover:bg-surface-container/70 hover:text-on-surface'
                }`}
              >
                <span className={ansicht === 'tresor' && notizenAktiv ? 'text-primary' : 'text-on-surface-variant/80'}>
                  <FileText className={SYMBOL} />
                </span>
                <span className="min-w-0 flex-1 truncate">{t('mss.vault.dashboard.filterNotizen')}</span>
                {typeof zaehler?.notizen === 'number' && zaehler.notizen > 0 ? (
                  <span className="shrink-0 rounded-full border border-outline-variant/20 bg-surface-container px-2 py-0.5 text-label-sm font-medium text-on-surface-variant">
                    {zaehler.notizen}
                  </span>
                ) : null}
              </button>
            )}
            {eintrag('fotos', 'mss.vault.ansicht.fotos', <Images className={SYMBOL} />, zaehler?.fotos)}
          </>,
        )}

        {gruppe(
          t('mss.vault.dashboard.gruppeVerwaltung'),
          <>
            {eintrag('archiv', 'mss.vault.ansicht.archiv', <Archive className={SYMBOL} />, zaehler?.archiv)}
            {eintrag('papierkorb', 'mss.vault.ansicht.papierkorb', <Trash2 className={SYMBOL} />, anzahlImPapierkorb)}
          </>,
        )}

        {(onPasswortGenerieren || onSicherheitscheck || onImportExport || onHinweisVerwalten) &&
          gruppe(
            t('mss.vault.dashboard.werkzeuge'),
            <>
              {werkzeugEintrag(
                'generator',
                t('mss.vault.dashboard.passwortGenerieren'),
                <Sparkles className={SYMBOL} />,
                onPasswortGenerieren,
              )}
              {werkzeugEintrag(
                'sicherheit',
                t('mss.vault.dashboard.sicherheitscheck'),
                <ShieldCheck className={SYMBOL} />,
                onSicherheitscheck,
              )}
              {werkzeugEintrag(
                'datenleck',
                t('mss.vault.dashboard.datenleckMonitor'),
                <Activity className={SYMBOL} />,
                onSicherheitscheck,
              )}
              {werkzeugEintrag(
                'importExport',
                t('mss.vault.dashboard.importExport'),
                <ArrowUpDown className={SYMBOL} />,
                onImportExport,
              )}
              {werkzeugEintrag(
                'hinweisVerwalten',
                t('mss.vault.hinweisVerwalten'),
                <KeyRound className={SYMBOL} />,
                onHinweisVerwalten,
              )}
            </>,
          )}
      </div>

      {/* Synchronisations-Box & Sperren */}
      <div className="shrink-0 border-t border-outline-variant/20 p-3 space-y-2">
        <div className="rounded-xl border border-outline-variant/20 bg-surface-container/60 p-2.5 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-label-sm font-semibold text-on-surface">
              {t('mss.vault.dashboard.synchronisation')}
            </span>
            <span className="shrink-0 text-label-sm text-on-surface-variant/80">
              {t('mss.vault.dashboard.eintraegeAnzahl', { count: anzahlEintraege })}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span
              className={`inline-flex min-w-0 items-center gap-1.5 text-xs ${
                syncStatus === 'offline' || syncStatus === 'error'
                  ? 'text-status-warning'
                  : 'text-on-surface-variant'
              }`}
              role="status"
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  syncStatus === 'offline' || syncStatus === 'error'
                    ? 'bg-status-warning'
                    : syncStatus === 'syncing'
                      ? 'animate-pulse bg-primary'
                      : 'bg-status-success'
                }`}
                aria-hidden="true"
              />
              <span className="truncate">
                {syncStatus === 'offline' || syncStatus === 'error'
                  ? t('mss.vault.dashboard.offline')
                  : t('mss.vault.dashboard.synchronisiert')}
              </span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 text-on-surface-variant/70" aria-hidden="true">
              <Monitor className="h-3.5 w-3.5" />
              <Smartphone className="h-3.5 w-3.5" />
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={onSperren}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-outline-variant/20 bg-surface-container/60 px-2.5 py-2 text-xs font-medium text-on-surface-variant transition-colors hover:border-status-destructive/40 hover:bg-status-destructive/10 hover:text-status-destructive"
        >
          <Shield className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{t('mss.vault.sperren')}</span>
        </button>
      </div>
    </nav>
  )
}
