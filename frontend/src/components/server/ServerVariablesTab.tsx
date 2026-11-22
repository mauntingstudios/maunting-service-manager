import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Cpu,
  Eye,
  EyeOff,
  FolderUp,
  Gamepad2,
  GitBranch,
  Layers,
  Lock,
  RefreshCw,
  RotateCcw,
  Save,
  Shield,
  Sliders,
} from 'lucide-react'
import {
  Badge,
  Button,
  Dropdown,
  Input,
  Spinner,
  Switch,
  Zustandsflaeche,
  type DropdownOption,
} from '@maunting/ui'
import {
  serverVariablesApi,
  type ServerVariableItem,
  type ServerVariablesResponse,
} from '@/api/serverVariables'
import { still } from '@/lib/still'
import { toast } from '@/stores/toastStore'

interface ServerVariablesTabProps {
  serverId: number
  canEdit: boolean
  onOpenFiles?: () => void
  onRestart?: () => void
}

const CUSTOM_SELECT_SENTINEL = '__msm_custom__'
const GROUP_ORDER = [
  'version',
  'general',
  'deployment',
  'gameplay',
  'performance',
  'security',
]

function groupIcon(group: string) {
  switch (group) {
    case 'version':
      return Layers
    case 'deployment':
      return GitBranch
    case 'gameplay':
      return Gamepad2
    case 'performance':
      return Cpu
    case 'security':
      return Shield
    default:
      return Sliders
  }
}

export function ServerVariablesTab({
  serverId,
  canEdit,
  onOpenFiles,
  onRestart,
}: ServerVariablesTabProps) {
  const { t } = useTranslation()
  const [data, setData] = useState<ServerVariablesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [clearedSecrets, setClearedSecrets] = useState<Record<string, boolean>>({})
  const [customSelectKeys, setCustomSelectKeys] = useState<Record<string, boolean>>({})
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, boolean>>({})
  const [restartHint, setRestartHint] = useState(false)

  const resetEdits = useCallback((res: ServerVariablesResponse) => {
    const nextDrafts: Record<string, string> = {}
    const nextCustom: Record<string, boolean> = {}
    for (const item of res.variables) {
      nextDrafts[item.key] = item.type === 'secret' ? '' : item.value
      if (item.type === 'select' && item.allow_custom) {
        const matchesOption = item.options.some((opt) => opt.value === item.value)
        if (item.value && !matchesOption) {
          nextCustom[item.key] = true
        }
      }
    }
    setDrafts(nextDrafts)
    setClearedSecrets({})
    setCustomSelectKeys(nextCustom)
  }, [])

  const laden = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await serverVariablesApi.get(serverId)
      setData(res)
      resetEdits(res)
    } catch (err: unknown) {
      still(err, 'serverVariables.laden')
      setError(err instanceof Error ? err.message : t('serverVariables.ladeFehler'))
    } finally {
      setLoading(false)
    }
  }, [resetEdits, serverId, t])

  useEffect(() => {
    void laden()
  }, [laden])

  const groupedVariables = useMemo(() => {
    if (!data) return []
    const buckets = new Map<string, ServerVariableItem[]>()
    for (const item of data.variables) {
      const key = item.group || 'general'
      const list = buckets.get(key) ?? []
      list.push(item)
      buckets.set(key, list)
    }
    return Array.from(buckets.entries()).sort(([a], [b]) => {
      const idxA = GROUP_ORDER.indexOf(a)
      const idxB = GROUP_ORDER.indexOf(b)
      if (idxA >= 0 && idxB >= 0) return idxA - idxB
      if (idxA >= 0) return -1
      if (idxB >= 0) return 1
      return a.localeCompare(b)
    })
  }, [data])

  const dirtyPayload = useMemo(() => {
    if (!data) return {} as Record<string, string | null>
    const changes: Record<string, string | null> = {}
    for (const item of data.variables) {
      const editable = canEdit && item.customer_editable
      if (!editable) continue
      const cur = drafts[item.key] ?? ''
      if (item.type === 'secret') {
        if (clearedSecrets[item.key] && item.is_set) {
          changes[item.key] = null
        } else if (cur !== '') {
          changes[item.key] = cur
        }
      } else if (cur !== item.value) {
        changes[item.key] = cur === item.default ? null : cur
      }
    }
    return changes
  }, [canEdit, clearedSecrets, data, drafts])

  const dirtyKeys = Object.keys(dirtyPayload)

  const handleSave = async () => {
    if (!data || dirtyKeys.length === 0 || !canEdit) return
    setSaving(true)
    try {
      const res = await serverVariablesApi.update(serverId, dirtyPayload)
      setData(res.variables)
      resetEdits(res.variables)
      setRestartHint(res.restart_recommended)
      toast.success(t('serverVariables.gespeichert'))
    } catch (err: unknown) {
      still(err, 'serverVariables.speichern')
      toast.error(err instanceof Error ? err.message : t('serverVariables.speicherFehler'))
    } finally {
      setSaving(false)
    }
  }

  const resetField = (item: ServerVariableItem) => {
    if (item.type === 'secret') {
      setDrafts((prev) => ({ ...prev, [item.key]: '' }))
      if (item.is_set && !item.required) {
        setClearedSecrets((prev) => ({ ...prev, [item.key]: true }))
      }
      return
    }
    setDrafts((prev) => ({ ...prev, [item.key]: item.default }))
    if (item.type === 'select' && item.allow_custom) {
      const matchesDefault = item.options.some((opt) => opt.value === item.default)
      setCustomSelectKeys((prev) => ({ ...prev, [item.key]: !matchesDefault }))
    }
  }

  const showUploadBanner = Boolean(
    onOpenFiles &&
      data &&
      (data.source_type === 'manualUpload' ||
        data.variables.some(
          (v) => v.key === 'GIT_REPO_URL' || v.key === 'BOT_ENTRY_FILE',
        )),
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 py-14">
        <Spinner className="h-6 w-6 text-primary" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <Zustandsflaeche
        art="fehler"
        titel={t('serverVariables.fehlerTitel')}
        text={error ?? t('serverVariables.ladeFehler')}
        erneutLabel={t('common.retry', { defaultValue: 'Erneut laden' })}
        onErneut={() => void laden()}
      />
    )
  }

  if (!data.has_variables) {
    return (
      <Zustandsflaeche
        art="leer"
        titel={t('serverVariables.leerTitel')}
        text={t('serverVariables.leerText')}
      />
    )
  }

  return (
    <div className="space-y-5">
      {showUploadBanner && (
        <div className="flex flex-col gap-3 rounded-2xl border border-primary/25 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-primary/25 bg-surface-container text-primary">
              <FolderUp className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-on-surface">
                {t('serverVariables.uploadBannerTitel')}
              </h3>
              <p className="text-xs leading-relaxed text-on-surface-variant">
                {data.upload_hint ?? t('serverVariables.uploadBannerText')}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onOpenFiles}
            className="shrink-0"
          >
            {t('serverVariables.dateiTabOeffnen')}
          </Button>
        </div>
      )}

      {restartHint && data.is_running && (
        <div className="flex flex-col gap-3 rounded-2xl border border-status-warning/40 bg-status-warning/10 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <RefreshCw
              className="mt-0.5 h-5 w-5 shrink-0 text-status-warning"
              aria-hidden="true"
            />
            <div className="space-y-0.5">
              <p className="text-sm font-semibold text-on-surface">
                {t('serverVariables.neustartHinweisTitel')}
              </p>
              <p className="text-xs text-on-surface-variant">
                {t('serverVariables.neustartHinweisText')}
              </p>
            </div>
          </div>
          {onRestart && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onRestart}
              className="shrink-0 gap-1.5"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              {t('serverVariables.jetztNeustarten')}
            </Button>
          )}
        </div>
      )}

      {!canEdit && (
        <div className="flex items-center gap-2.5 rounded-xl border border-outline-variant/30 bg-surface-container/60 px-4 py-3 text-xs text-on-surface-variant">
          <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{t('serverVariables.nurLeseHinweis')}</span>
        </div>
      )}

      {groupedVariables.map(([group, items]) => {
        const Icon = groupIcon(group)
        const groupTitle = t(`serverVariables.gruppen.${group}`, {
          defaultValue: group.charAt(0).toUpperCase() + group.slice(1),
        })
        return (
          <section
            key={group}
            className="space-y-4 rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 p-5 shadow-sm backdrop-blur-md"
          >
            <div className="flex items-center justify-between gap-2 border-b border-outline-variant/20 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="grid h-8 w-8 place-items-center rounded-lg border border-outline-variant/30 bg-surface-container text-primary">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </div>
                <h3 className="text-sm font-semibold text-on-surface">
                  {groupTitle}
                </h3>
              </div>
              <Badge variant="default">{items.length}</Badge>
            </div>

            <div className="space-y-3">
              {items.map((item) => {
                const editable = canEdit && item.customer_editable && !saving
                const curVal = drafts[item.key] ?? ''
                const isSecret = item.type === 'secret'
                const isDirty = dirtyKeys.includes(item.key)
                const isModified = isSecret
                  ? item.is_set && !clearedSecrets[item.key]
                  : item.has_override || curVal !== item.default

                const dropdownOptions: DropdownOption[] = item.options.map((opt) => ({
                  value: opt.value,
                  label: opt.label,
                  badge: opt.badge ? (
                    <Badge variant="info">{opt.badge}</Badge>
                  ) : undefined,
                }))
                if (item.allow_custom) {
                  dropdownOptions.push({
                    value: CUSTOM_SELECT_SENTINEL,
                    label: t('serverVariables.eigenerWert'),
                  })
                }
                const isCustomSelectActive =
                  item.type === 'select' &&
                  item.allow_custom &&
                  (Boolean(customSelectKeys[item.key]) ||
                    (curVal !== '' &&
                      !item.options.some((opt) => opt.value === curVal)))

                const dropdownSelected = isCustomSelectActive
                  ? CUSTOM_SELECT_SENTINEL
                  : curVal

                return (
                  <div
                    key={item.key}
                    className="flex flex-col gap-3 rounded-xl border border-outline-variant/25 bg-surface-container/60 p-4 lg:flex-row lg:items-start lg:justify-between"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-on-surface">
                          {item.label}
                          {item.required && (
                            <span className="ml-1 text-status-destructive">*</span>
                          )}
                        </span>
                        <span className="rounded-md border border-outline-variant/30 bg-surface-container-low px-1.5 py-0.5 font-mono text-xs text-on-surface-variant">
                          {item.key}
                        </span>
                        {!item.customer_editable && (
                          <Badge variant="warning">
                            {t('serverVariables.nurBetreiber')}
                          </Badge>
                        )}
                        {isSecret && item.is_set && !clearedSecrets[item.key] && (
                          <Badge variant="success">
                            {t('serverVariables.gesetzt')}
                          </Badge>
                        )}
                        {!isSecret && isModified && (
                          <Badge variant="info">
                            {t('serverVariables.angepasst')}
                          </Badge>
                        )}
                      </div>
                      {item.description && (
                        <p className="text-xs leading-relaxed text-on-surface-variant">
                          {item.description}
                        </p>
                      )}
                    </div>

                    <div className="flex w-full shrink-0 flex-col gap-2 lg:w-80">
                      <div className="flex items-center gap-2">
                        {item.type === 'boolean' && (
                          <div className="flex w-full items-center justify-between rounded-xl border border-outline-variant/30 bg-surface-container-low px-3.5 py-2">
                            <span className="text-xs font-medium text-on-surface">
                              {curVal === 'true'
                                ? t('serverVariables.aktiviert')
                                : t('serverVariables.deaktiviert')}
                            </span>
                            <Switch
                              checked={curVal === 'true'}
                              disabled={!editable}
                              aria-label={item.label}
                              onCheckedChange={(checked) =>
                                setDrafts((prev) => ({
                                  ...prev,
                                  [item.key]: checked ? 'true' : 'false',
                                }))
                              }
                            />
                          </div>
                        )}

                        {item.type === 'select' && (
                          <div className="flex-1 space-y-2">
                            <Dropdown
                              value={dropdownSelected || null}
                              options={dropdownOptions}
                              searchable={dropdownOptions.length > 6}
                              disabled={!editable}
                              aria-label={item.label}
                              onChange={(next) => {
                                if (next === CUSTOM_SELECT_SENTINEL) {
                                  setCustomSelectKeys((prev) => ({
                                    ...prev,
                                    [item.key]: true,
                                  }))
                                  return
                                }
                                setCustomSelectKeys((prev) => ({
                                  ...prev,
                                  [item.key]: false,
                                }))
                                setDrafts((prev) => ({
                                  ...prev,
                                  [item.key]: next,
                                }))
                              }}
                            />
                            {isCustomSelectActive && (
                              <Input
                                value={curVal}
                                disabled={!editable}
                                placeholder={
                                  item.placeholder ??
                                  t('serverVariables.eigenerWertPlatzhalter')
                                }
                                aria-label={`${item.label} (${t('serverVariables.eigenerWert')})`}
                                onChange={(event) =>
                                  setDrafts((prev) => ({
                                    ...prev,
                                    [item.key]: event.target.value,
                                  }))
                                }
                              />
                            )}
                          </div>
                        )}

                        {isSecret && (
                          <div className="flex flex-1 items-center gap-1.5">
                            <div className="relative flex-1">
                              <Input
                                type={revealedSecrets[item.key] ? 'text' : 'password'}
                                value={curVal}
                                disabled={!editable}
                                autoComplete="new-password"
                                placeholder={
                                  clearedSecrets[item.key]
                                    ? t('serverVariables.wirdGeloescht')
                                    : item.is_set
                                      ? t('serverVariables.secretMaskiertPlatzhalter')
                                      : (item.placeholder ??
                                        t('serverVariables.secretPlatzhalter'))
                                }
                                aria-label={item.label}
                                onChange={(event) => {
                                  const nextVal = event.target.value
                                  setDrafts((prev) => ({
                                    ...prev,
                                    [item.key]: nextVal,
                                  }))
                                  if (nextVal !== '') {
                                    setClearedSecrets((prev) => ({
                                      ...prev,
                                      [item.key]: false,
                                    }))
                                  }
                                }}
                              />
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label={
                                revealedSecrets[item.key]
                                  ? t('serverVariables.secretVerbergen')
                                  : t('serverVariables.secretAnzeigen')
                              }
                              onClick={() =>
                                setRevealedSecrets((prev) => ({
                                  ...prev,
                                  [item.key]: !prev[item.key],
                                }))
                              }
                            >
                              {revealedSecrets[item.key] ? (
                                <EyeOff className="h-4 w-4" aria-hidden="true" />
                              ) : (
                                <Eye className="h-4 w-4" aria-hidden="true" />
                              )}
                            </Button>
                          </div>
                        )}

                        {(item.type === 'string' ||
                          item.type === 'number' ||
                          item.type === 'git_url') && (
                          <div className="flex-1 space-y-1">
                            <Input
                              type={
                                item.type === 'number'
                                  ? 'number'
                                  : item.type === 'git_url'
                                    ? 'url'
                                    : 'text'
                              }
                              min={item.min ?? undefined}
                              max={item.max ?? undefined}
                              value={curVal}
                              disabled={!editable}
                              placeholder={item.placeholder ?? undefined}
                              aria-label={item.label}
                              onChange={(event) =>
                                setDrafts((prev) => ({
                                  ...prev,
                                  [item.key]: event.target.value,
                                }))
                              }
                            />
                            {item.type === 'number' &&
                              (item.min != null || item.max != null) && (
                                <p className="text-xs text-on-surface-variant">
                                  {t('serverVariables.zahlenBereich', {
                                    min: item.min ?? '–',
                                    max: item.max ?? '–',
                                  })}
                                </p>
                              )}
                          </div>
                        )}

                        {editable &&
                          (isDirty ||
                            (!isSecret && isModified) ||
                            (isSecret && item.is_set && !item.required)) && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={saving}
                              aria-label={t('serverVariables.feldZuruecksetzen', {
                                label: item.label,
                              })}
                              onClick={() => resetField(item)}
                            >
                              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                          )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}

      {canEdit && dirtyKeys.length > 0 && (
        <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/35 bg-surface-container-high/95 px-4 py-3 shadow-lg backdrop-blur-xl">
          <span className="text-sm font-medium text-on-surface">
            {t('serverVariables.ungespeicherteAenderungen', {
              count: dirtyKeys.length,
            })}
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={() => resetEdits(data)}
            >
              {t('serverVariables.verwerfen')}
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={saving}
              onClick={() => void handleSave()}
              className="gap-1.5"
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              {saving
                ? t('serverVariables.speichert')
                : t('serverVariables.speichern')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
