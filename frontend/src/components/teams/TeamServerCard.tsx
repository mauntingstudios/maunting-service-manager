import { useMemo } from 'react'
import { Check, CheckCircle2, Eye, Shield, ShieldCheck, Terminal, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TeamServer } from '@/api/teams'

export interface TeamServerCardProps {
  server: TeamServer
  assignedKeys: string[]
  onChangeKeys: (keys: string[]) => void
  disabled?: boolean
  roleName?: string
}

/**
 * Moderne, interaktive Server-Rechtekarte.
 *
 * Bietet 1-Klick Schnellvorlagen (Kein Zugriff, Beobachter, Operator, Vollzugriff)
 * und direkte, klickbare Rechte-Chips ohne umständliche Dropdowns.
 * Zugänglich und vollständig kompatibel mit Screenreadern und Test-Suiten.
 */
export function TeamServerCard({
  server,
  assignedKeys,
  onChangeKeys,
  disabled = false,
  roleName,
}: TeamServerCardProps) {
  const { t } = useTranslation()

  const allKeys = server.permission_keys
  const assignedSet = useMemo(() => new Set(assignedKeys), [assignedKeys])

  // Presets ableiten
  const observerPreset = useMemo(() => {
    const desired = ['server.view', 'server.console_read', 'server.logs']
    return allKeys.filter((k) => desired.some((d) => k.includes(d) || k.endsWith('.view') || k.endsWith('.read')))
  }, [allKeys])

  const operatorPreset = useMemo(() => {
    const desired = [
      'server.view', 'server.start', 'server.stop', 'server.restart',
      'server.console_read', 'server.console_send',
    ]
    return allKeys.filter((k) => desired.some((d) => k === d || k.includes('start') || k.includes('stop') || k.includes('restart') || k.includes('console')))
  }, [allKeys])

  const isFullAccess = allKeys.length > 0 && allKeys.every((k) => assignedSet.has(k))
  const isNoAccess = assignedKeys.length === 0

  const isObserverActive =
    !isNoAccess &&
    !isFullAccess &&
    observerPreset.length > 0 &&
    observerPreset.every((k) => assignedSet.has(k)) &&
    assignedKeys.every((k) => observerPreset.includes(k))

  const isOperatorActive =
    !isNoAccess &&
    !isFullAccess &&
    operatorPreset.length > 0 &&
    operatorPreset.every((k) => assignedSet.has(k)) &&
    assignedKeys.every((k) => operatorPreset.includes(k))

  const toggleKey = (key: string) => {
    if (disabled) return
    if (assignedSet.has(key)) {
      onChangeKeys(assignedKeys.filter((k) => k !== key))
    } else {
      onChangeKeys([...assignedKeys, key])
    }
  }

  return (
    <article className="overflow-hidden rounded-2xl border border-outline-variant/35 bg-surface-container-low/60 backdrop-blur-md shadow-sm transition-all hover:border-outline-variant/60">
      {/* Server Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant/25 bg-surface-container-high/35 px-4 py-3 sm:px-5">
        <div className="flex items-center gap-3 min-w-0">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary border border-primary/25 shadow-sm">
            <Terminal className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="font-headline text-sm sm:text-base font-bold text-on-surface truncate">
                {server.server_name}
              </h4>
              {roleName && (
                <span className="inline-flex items-center rounded-md bg-secondary/15 px-2 py-0.5 text-xs font-semibold text-secondary border border-secondary/25">
                  {roleName}
                </span>
              )}
            </div>
            <p className="text-xs text-on-surface-variant font-mono">
              ID #{server.server_id}
            </p>
          </div>
        </div>

        {/* Status / Access Pill */}
        <div>
          {isFullAccess ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-status-success/15 border border-status-success/30 px-3 py-1 text-xs font-semibold text-status-success">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t('teams.fullAccess', 'Vollzugriff')}</span>
            </span>
          ) : isNoAccess ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-container-high border border-outline-variant/30 px-3 py-1 text-xs font-medium text-on-surface-variant">
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t('teams.noAccess', 'Kein Zugriff')}</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 border border-primary/25 px-3 py-1 text-xs font-semibold text-primary">
              <Shield className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{assignedKeys.length} von {allKeys.length} aktiv</span>
            </span>
          )}
        </div>
      </div>

      <div className="p-4 sm:p-5 space-y-4">
        {/* Schnellzugriff Vorlagen */}
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant block mb-2">
            {t('teams.quickPresets', 'Schnellvorlagen')}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {/* Kein Zugriff */}
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChangeKeys([])}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-all ${
                isNoAccess
                  ? 'bg-on-surface/15 text-on-surface border border-outline-variant font-semibold'
                  : 'bg-surface-container-high/50 text-on-surface-variant border border-outline-variant/30 hover:border-outline-variant hover:text-on-surface hover:bg-surface-container-high'
              }`}
            >
              <X className="h-3.5 w-3.5" />
              <span>{t('teams.noAccess', 'Kein Zugriff')}</span>
            </button>

            {/* Beobachter */}
            {observerPreset.length > 0 && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChangeKeys(observerPreset)}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-all ${
                  isObserverActive
                    ? 'bg-secondary/25 text-secondary border border-secondary/40 font-semibold shadow-sm'
                    : 'bg-surface-container-high/50 text-on-surface-variant border border-outline-variant/30 hover:border-secondary/30 hover:text-secondary hover:bg-surface-container-high'
                }`}
              >
                <Eye className="h-3.5 w-3.5" />
                <span>{t('teams.observerPreset', 'Beobachter')}</span>
              </button>
            )}

            {/* Operator */}
            {operatorPreset.length > 0 && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChangeKeys(operatorPreset)}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-all ${
                  isOperatorActive
                    ? 'bg-primary/25 text-primary border border-primary/40 font-semibold shadow-sm'
                    : 'bg-surface-container-high/50 text-on-surface-variant border border-outline-variant/30 hover:border-primary/30 hover:text-primary hover:bg-surface-container-high'
                }`}
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>{t('teams.operatorPreset', 'Operator')}</span>
              </button>
            )}

            {/* Vollzugriff */}
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChangeKeys([...allKeys])}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-all ${
                isFullAccess
                  ? 'bg-status-success/20 text-status-success border border-status-success/40 font-semibold shadow-sm'
                  : 'bg-surface-container-high/50 text-on-surface-variant border border-outline-variant/30 hover:border-status-success/30 hover:text-status-success hover:bg-surface-container-high'
              }`}
            >
              <Check className="h-3.5 w-3.5" />
              <span>{t('teams.fullAccess', 'Vollzugriff')}</span>
            </button>
          </div>
        </div>

        {/* Einzelne Rechte-Chips */}
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant block mb-2">
            {t('teams.permissions', 'Rechte')}
          </span>

          <div
            role="listbox"
            aria-label={`${t('teams.permissions')}: ${server.server_name}`}
            aria-multiselectable="true"
            className="flex flex-wrap gap-2"
          >
            {allKeys.map((key) => {
              const isSelected = assignedSet.has(key)
              const label = t(`permissionDetails.${key.replace(/\./g, '_')}.title`, { defaultValue: key })

              return (
                <button
                  key={key}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={disabled}
                  onClick={() => toggleKey(key)}
                  className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition-all active:scale-95 ${
                    isSelected
                      ? 'bg-primary/20 text-primary border border-primary/40 shadow-sm font-semibold'
                      : 'bg-surface-container-high/60 text-on-surface-variant border border-outline-variant/30 hover:border-outline-variant hover:text-on-surface hover:bg-surface-container-high'
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  <span
                    className={`grid h-4 w-4 place-items-center rounded-md border transition-all ${
                      isSelected
                        ? 'border-primary bg-primary text-on-primary'
                        : 'border-outline-variant bg-surface-container'
                    }`}
                  >
                    {isSelected && <Check className="h-3 w-3 stroke-[3]" />}
                  </span>
                  <span>{label}</span>
                </button>
              )
            })}
          </div>
          <p className="mt-2 text-xs text-on-surface-variant/80">
            {t('teams.serverSichtAuto')}
          </p>
        </div>
      </div>
    </article>
  )
}
