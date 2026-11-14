import { useTranslation } from 'react-i18next'
import {
  Folder,
  KeyRound,
  Plus,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  WifiOff,
  X,
} from 'lucide-react'
import { Button, Input } from '@maunting/ui'
import { toast } from '@/stores/toastStore'
import type { VaultAnsicht } from './vaultAnsichten'
import { TRESOR_FILTER, type TresorFilter } from './vaultKennzahlen'

export interface VaultHeaderBereichProps {
  ansichtsTitel: string
  isTeam: boolean
  teamName?: string
  ansicht: VaultAnsicht
  filter: TresorFilter
  onFilterChange: (next: TresorFilter) => void
  filterLabels: Record<TresorFilter, string>
  ordnerFilter: string | null
  ordnerFilterName?: string
  onClearOrdnerFilter: () => void
  searchQuery: string
  onSearchQueryChange: (q: string) => void
  onNewEntry: () => void
  syncStatus: string
  onSyncWithServer: () => Promise<void>
  showRotationPreparedBanner: boolean
  isOwner: boolean
  onOpenRotation: () => void
  onAbortRotation: () => void
  zurueckgesetzt: boolean
  activeHasHint: boolean | null
  dismissedHintReminder: boolean
  onDismissHintReminder: () => void
  editHintInput: string
  onEditHintInputChange: (val: string) => void
  isSavingHint: boolean
  onSavingHintChange: (saving: boolean) => void
  onSaveHint: (hint: string) => Promise<void>
  onClearEditHintInput: () => void
}

/** Kopfzeile, Status-Hinweise, Filter-Chips, Suche und Hinweis-Erinnerung des Tresors. */
export function VaultHeaderBereich({
  ansichtsTitel,
  isTeam,
  teamName,
  ansicht,
  filter,
  onFilterChange,
  filterLabels,
  ordnerFilter,
  ordnerFilterName,
  onClearOrdnerFilter,
  searchQuery,
  onSearchQueryChange,
  onNewEntry,
  syncStatus,
  onSyncWithServer,
  showRotationPreparedBanner,
  isOwner,
  onOpenRotation,
  onAbortRotation,
  zurueckgesetzt,
  activeHasHint,
  dismissedHintReminder,
  onDismissHintReminder,
  editHintInput,
  onEditHintInputChange,
  isSavingHint,
  onSavingHintChange,
  onSaveHint,
  onClearEditHintInput,
}: VaultHeaderBereichProps) {
  const { t } = useTranslation()

  return (
    <>
      {/* KOPFZEILE */}
      <div className="flex items-center justify-between border-b border-outline-variant/20 bg-surface-container px-4 py-2.5 backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20">
            <Shield className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xs font-bold text-on-surface">{ansichtsTitel}</h1>
            <p className="truncate text-label-sm text-on-surface-variant">
              {isTeam ? (teamName ? `${teamName} · ${t('teams.vault')}` : t('teams.vault')) : t('mss.vault.titelManager')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {/* Neue Einträge gibt es nur im Tresor und auf der Übersicht; Archiv und Papierkorb nehmen nur auf, was schon da ist. */}
          {(ansicht === 'tresor' || ansicht === 'uebersicht') && (
            <Button
              fingerziel
              onClick={onNewEntry}
              aria-label={t('mss.vault.neuerEintrag')}
              className="hidden md:flex items-center gap-1 bg-primary text-on-primary hover:bg-primary-hover shadow-sm px-2.5 py-1.5 text-xs font-medium"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{t('mss.vault.neuerEintrag')}</span>
            </Button>
          )}

          <Button
            fingerziel
            size="icon"
            variant="ghost"
            onClick={() => void onSyncWithServer()}
            disabled={syncStatus === 'syncing'}
            aria-label={t('mss.vault.abgleichen')}
            className="text-on-surface-variant hover:text-on-surface"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncStatus === 'syncing' ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Unterbrochene Team-Rotation fortsetzen oder abbrechen */}
      {showRotationPreparedBanner && (
        <div role="alert" className="mx-4 mt-2.5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-status-warning/40 bg-status-warning/10 p-3 shadow-sm">
          <p className="text-xs text-on-surface">{t('mss.vault.rotationFortsetzenHinweis')}</p>
          <div className="flex gap-2">
            {isOwner && (
              <Button size="sm" onClick={onOpenRotation} className="text-xs px-3 py-1.5">
                {t('mss.vault.rotationFortsetzen')}
              </Button>
            )}
            {isOwner && (
              <Button size="sm" variant="ghost" onClick={onAbortRotation} className="text-xs px-3 py-1.5">
                {t('mss.vault.rotationAbbrechen')}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Ohne diese Zeile sah man nicht, dass Gespeichertes noch nicht beim Server ist. */}
      {!zurueckgesetzt && (syncStatus === 'offline' || syncStatus === 'error') && (
        <div
          role="status"
          className={`flex items-center gap-2 border-b px-4 py-1.5 text-label-sm ${
            syncStatus === 'error'
              ? 'border-status-destructive/30 bg-status-destructive/10 text-status-destructive'
              : 'border-outline-variant/20 bg-surface-container-low text-on-surface-variant'
          }`}
        >
          {syncStatus === 'error' ? <ShieldAlert className="h-3.5 w-3.5 shrink-0" /> : <WifiOff className="h-3.5 w-3.5 shrink-0" />}
          <span className="min-w-0 flex-1">{t(syncStatus === 'error' ? 'mss.vault.abgleichAbgelehnt' : 'mss.vault.offlineHinweis')}</span>
          <Button fingerziel type="button" variant="ghost" size="sm" onClick={() => void onSyncWithServer()} className="shrink-0">
            {t('common.retry')}
          </Button>
        </div>
      )}

      {/* FILTER, SAMMLUNG UND SUCHE */}
      {ansicht !== 'uebersicht' && (
        <div className="flex flex-col gap-2 border-b border-outline-variant/15 bg-surface-container px-4 py-2">
          {ansicht === 'tresor' && (
            <div className="msm-ohne-rollbalken flex items-center gap-1.5 overflow-x-auto" role="group" aria-label={t('mss.vault.dashboard.werkzeuge')}>
              {TRESOR_FILTER.map((eintrag) => {
                const aktiv = filter === eintrag
                return (
                  <button
                    key={eintrag}
                    type="button"
                    aria-pressed={aktiv}
                    onClick={() => onFilterChange(eintrag)}
                    className={`shrink-0 rounded-full border px-3 py-1 text-xs transition-colors ${
                      aktiv
                        ? 'border-primary/40 bg-primary/15 text-primary'
                        : 'border-outline-variant/40 text-on-surface-variant hover:bg-surface-container'
                    }`}
                  >
                    {filterLabels[eintrag]}
                  </button>
                )
              })}
              {ordnerFilter && (
                <button
                  type="button"
                  onClick={onClearOrdnerFilter}
                  className="flex shrink-0 items-center gap-1.5 rounded-full border border-secondary/40 bg-secondary/15 px-3 py-1 text-xs text-secondary"
                  aria-label={t('mss.vault.dashboard.alleAnsehen')}
                >
                  <Folder className="h-3 w-3" />
                  <span className="max-w-[10rem] truncate">{ordnerFilterName}</span>
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
          <div className="relative w-full md:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 h-3.5 w-3.5 text-on-surface-variant" />
            <Input
              type="search"
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              placeholder={t('common.search')}
              aria-label={t('common.search')}
              className="pl-8 pr-3"
            />
          </div>
        </div>
      )}

      {zurueckgesetzt && (
        <div role="alert" className="mx-4 mt-2.5 flex items-start gap-2.5 rounded-2xl border border-status-destructive/30 bg-status-destructive/10 p-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-status-destructive/20 text-status-destructive">
            <ShieldAlert className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-on-surface">{t('mss.vault.anderswoZurueckgesetzt')}</h3>
            <p className="mt-0.5 text-label-sm text-on-surface-variant">{t('mss.vault.anderswoZurueckgesetztText')}</p>
          </div>
        </div>
      )}

      {/* HINWEIS-ERINNERUNG: Wenn nach dem Entsperren noch kein Hinweis hinterlegt ist (nur privat) */}
      {!isTeam && activeHasHint === false && !dismissedHintReminder && (
        <div className="mx-4 mt-2.5 p-3 rounded-2xl bg-status-warning/10 border border-status-warning/30 text-on-surface shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-status-warning/20 text-status-warning">
                <KeyRound className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-on-surface">{t('mss.vault.keinHinweisHinterlegt')}</h3>
                <p className="text-label-sm text-on-surface-variant mt-0.5">
                  {t('mss.vault.hinweisErklaerungKurz')}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              fingerziel
              onClick={onDismissHintReminder}
              className="text-on-surface-variant hover:text-on-surface"
              aria-label={t('common.close')}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>

          <form
            onSubmit={async (e) => {
              e.preventDefault()
              if (!editHintInput.trim() || isSavingHint) return
              onSavingHintChange(true)
              try {
                await onSaveHint(editHintInput.trim())
                toast.success(t('mss.vault.hinweisHinterlegt'))
                onClearEditHintInput()
              } catch {
                toast.error(t('mss.vault.hinweisSpeichernFehlgeschlagen'))
              } finally {
                onSavingHintChange(false)
              }
            }}
            className="mt-2.5 flex flex-wrap items-center gap-2"
          >
            <div className="min-w-[12rem] flex-1">
              <Input
                type="text"
                value={editHintInput}
                onChange={(e) => onEditHintInputChange(e.target.value)}
                placeholder={t('mss.vault.hinweisPlatzhalterLang')}
                aria-label={t('mss.vault.hinweisBezeichnung')}
              />
            </div>
            <Button
              type="submit"
              disabled={!editHintInput.trim() || isSavingHint}
              size="sm"
              className="bg-status-warning hover:bg-status-warning/90 text-black font-semibold text-xs px-3 py-1.5 shrink-0"
            >
              {isSavingHint ? t('common.saving') : t('mss.vault.hinweisSpeichern')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onDismissHintReminder}
              className="text-xs text-on-surface-variant hover:text-on-surface px-2.5 py-1.5 shrink-0"
            >
              {t('mss.vault.spaeter')}
            </Button>
          </form>
        </div>
      )}
    </>
  )
}
