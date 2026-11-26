import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Route, Save, SlidersHorizontal, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { aiApi, type AiRouterConfig, type AiRouterPoolEntry } from '@/api/ai'
import { SanitizedApiError } from '@/api/client'
import { toast } from '@/stores/toastStore'
import { Button, Dropdown, NumberStepper, Spinner, Switch } from '@maunting/ui'

type TierKey = 'eco' | 'standard' | 'flagship' | 'fallback'

const TIER_ORDER: readonly TierKey[] = ['eco', 'standard', 'flagship', 'fallback']

const TIER_POOL_FIELD: Record<TierKey, 'eco_models' | 'standard_models' | 'flagship_models' | 'fallback_models'> = {
  eco: 'eco_models',
  standard: 'standard_models',
  flagship: 'flagship_models',
  fallback: 'fallback_models',
}

const TIER_WEIGHT_FIELD: Record<TierKey, 'eco_weight' | 'standard_weight' | 'flagship_weight' | 'fallback_weight'> = {
  eco: 'eco_weight',
  standard: 'standard_weight',
  flagship: 'flagship_weight',
  fallback: 'fallback_weight',
}

export function AiRouterSettingsCard({ canWrite }: { canWrite: boolean }) {
  const { t } = useTranslation()
  const [config, setConfig] = useState<AiRouterConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [weightsOpen, setWeightsOpen] = useState(false)
  const [weightDrafts, setWeightDrafts] = useState<Partial<Record<TierKey, string>>>({})

  const load = useCallback(async () => {
    try {
      const data = await aiApi.getRouterConfig()
      setConfig(data)
    } catch (error: unknown) {
      toast.error(error instanceof SanitizedApiError ? error.message : t('ai.router.errors.load'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const handleProvidersChanged = () => {
      void load()
    }
    window.addEventListener('msm:ai-providers-changed', handleProvidersChanged)
    return () => {
      window.removeEventListener('msm:ai-providers-changed', handleProvidersChanged)
    }
  }, [load])

  const allModelChoices = useMemo(() => {
    if (!config) return []
    const items: Array<{ value: string; label: string; hint: string; provider_id: number; model: string }> = []
    for (const prov of config.available_providers) {
      for (const model of prov.models) {
        items.push({
          value: `${prov.provider_id}::${model}`,
          label: model,
          hint: prov.provider_name,
          provider_id: prov.provider_id,
          model,
        })
      }
    }
    return items
  }, [config])

  const save = async (nextConfig?: AiRouterConfig) => {
    const target = nextConfig ?? config
    if (!target || !canWrite || saving) return
    setSaving(true)
    try {
      const saved = await aiApi.updateRouterConfig({
        enabled: target.enabled,
        eco_models: target.eco_models.map((e) => ({ provider_id: e.provider_id, model: e.model })),
        standard_models: target.standard_models.map((e) => ({ provider_id: e.provider_id, model: e.model })),
        flagship_models: target.flagship_models.map((e) => ({ provider_id: e.provider_id, model: e.model })),
        fallback_models: target.fallback_models.map((e) => ({ provider_id: e.provider_id, model: e.model })),
        eco_weight: target.eco_weight,
        standard_weight: target.standard_weight,
        flagship_weight: target.flagship_weight,
        fallback_weight: target.fallback_weight,
      })
      setConfig(saved)
      toast.success(t('ai.router.saved'))
    } catch (error: unknown) {
      toast.error(error instanceof SanitizedApiError ? error.message : t('ai.router.errors.save'))
    } finally {
      setSaving(false)
    }
  }

  const addModelToTier = (tier: TierKey, encoded: string) => {
    if (!config || !encoded) return
    const choice = allModelChoices.find((c) => c.value === encoded)
    if (!choice) return
    const field = TIER_POOL_FIELD[tier]
    const current = config[field]
    if (current.some((e) => e.provider_id === choice.provider_id && e.model === choice.model)) {
      return
    }
    const prov = config.available_providers.find((p) => p.provider_id === choice.provider_id)
    const entry: AiRouterPoolEntry = {
      provider_id: choice.provider_id,
      model: choice.model,
      provider_name: prov?.provider_name,
      available: true,
    }
    setConfig({ ...config, [field]: [...current, entry] })
  }

  const removeModelFromTier = (tier: TierKey, idx: number) => {
    if (!config) return
    const field = TIER_POOL_FIELD[tier]
    setConfig({
      ...config,
      [field]: config[field].filter((_, i) => i !== idx),
    })
  }

  const moveModelInTier = (tier: TierKey, idx: number, dir: -1 | 1) => {
    if (!config) return
    const field = TIER_POOL_FIELD[tier]
    const nextIdx = idx + dir
    const list = [...config[field]]
    if (nextIdx < 0 || nextIdx >= list.length) return
    const [moved] = list.splice(idx, 1)
    list.splice(nextIdx, 0, moved)
    setConfig({ ...config, [field]: list })
  }

  if (loading) {
    return (
      <div className="msm-card flex h-24 items-center justify-center p-6">
        <Spinner size="md" className="text-primary" />
      </div>
    )
  }

  if (!config) return null

  const totalConfigured = TIER_ORDER.reduce(
    (sum, tier) => sum + config[TIER_POOL_FIELD[tier]].filter((e) => e.available !== false).length,
    0,
  )

  return (
    <section className="msm-card space-y-5 p-6" aria-labelledby="ai-router-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl space-y-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <Route className="h-5 w-5 text-primary" aria-hidden="true" />
            <h3 id="ai-router-title" className="font-headline text-title-lg font-semibold text-on-surface">
              {t('ai.router.title')}
            </h3>
            <span
              className={`rounded-full px-2.5 py-0.5 text-label-sm font-medium ${
                config.enabled && totalConfigured > 0
                  ? 'bg-status-success/15 text-status-success'
                  : 'bg-surface-container-high text-on-surface-variant'
              }`}
            >
              {config.enabled && totalConfigured > 0
                ? t('ai.router.statusActive')
                : config.enabled
                  ? t('ai.router.statusNoModels')
                  : t('ai.router.statusOff')}
            </span>
          </div>
          <p className="text-sm text-on-surface-variant">{t('ai.router.description')}</p>
        </div>

        <div className="flex items-center gap-3">
          <Switch
            checked={config.enabled}
            disabled={!canWrite || saving}
            onCheckedChange={(checked) => setConfig({ ...config, enabled: checked })}
            aria-label={t('ai.router.enableToggle')}
          />
          {canWrite && (
            <Button type="button" onClick={() => void save()} disabled={saving}>
              <Save className="h-4 w-4" aria-hidden="true" />
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          )}
        </div>
      </div>

      {allModelChoices.length === 0 ? (
        <div className="rounded-xl border border-outline-variant/40 bg-surface-container-low/30 p-4 text-sm text-on-surface-variant">
          {t('ai.router.noConfiguredProviders')}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {TIER_ORDER.map((tier) => {
            const pool = config[TIER_POOL_FIELD[tier]]
            const remainingChoices = allModelChoices.filter(
              (c) => !pool.some((e) => e.provider_id === c.provider_id && e.model === c.model),
            )
            return (
              <div
                key={tier}
                className="flex flex-col justify-between space-y-3 rounded-xl border border-outline-variant/40 bg-surface-container-low/35 p-4"
              >
                <div className="space-y-2.5">
                  <div>
                    <h4 className="text-sm font-semibold text-on-surface">
                      {t(`ai.router.tiers.${tier}.title`)}
                    </h4>
                    <p className="text-xs text-on-surface-variant">
                      {t(`ai.router.tiers.${tier}.description`)}
                    </p>
                  </div>

                  {pool.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-outline-variant/40 px-3 py-2 text-xs text-on-surface-variant">
                      {t('ai.router.emptyPool')}
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {pool.map((entry, idx) => (
                        <li
                          key={`${entry.provider_id}:${entry.model}`}
                          className="flex items-center justify-between gap-2 rounded-lg border border-outline-variant/30 bg-surface-container/60 px-3 py-2 text-xs"
                        >
                          <div className="min-w-0 flex-1">
                            <span className="font-mono font-medium text-on-surface break-all">
                              {entry.model}
                            </span>
                            <span className="ml-2 text-on-surface-variant">
                              ({entry.provider_name ?? `#${entry.provider_id}`})
                            </span>
                            {entry.available === false && (
                              <span className="ml-2 text-status-warning">
                                {t('ai.router.unavailable')}
                              </span>
                            )}
                          </div>
                          {canWrite && (
                            <div className="flex shrink-0 items-center gap-1">
                              <button
                                type="button"
                                disabled={idx === 0 || saving}
                                onClick={() => moveModelInTier(tier, idx, -1)}
                                className="rounded p-1 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface disabled:opacity-30"
                                aria-label={t('ai.router.moveUp')}
                              >
                                <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                disabled={idx === pool.length - 1 || saving}
                                onClick={() => moveModelInTier(tier, idx, 1)}
                                className="rounded p-1 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface disabled:opacity-30"
                                aria-label={t('ai.router.moveDown')}
                              >
                                <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                disabled={saving}
                                onClick={() => removeModelFromTier(tier, idx)}
                                className="rounded p-1 text-on-surface-variant hover:bg-status-destructive/15 hover:text-status-destructive disabled:opacity-30"
                                aria-label={t('ai.router.removeModel')}
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {canWrite && (
                  <Dropdown
                    value=""
                    disabled={saving || remainingChoices.length === 0}
                    placeholder={
                      remainingChoices.length > 0
                        ? t('ai.router.addModelPlaceholder')
                        : t('ai.router.allModelsAdded')
                    }
                    options={remainingChoices.map((c) => ({
                      value: c.value,
                      label: c.label,
                      hint: c.hint,
                    }))}
                    onChange={(val) => addModelToTier(tier, val)}
                    aria-label={`${t('ai.router.addModelPlaceholder')}: ${t(`ai.router.tiers.${tier}.title`)}`}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="border-t border-outline-variant/25 pt-3">
        <button
          type="button"
          onClick={() => setWeightsOpen((prev) => !prev)}
          aria-expanded={weightsOpen}
          className="inline-flex items-center gap-2 text-xs font-medium text-on-surface-variant hover:text-on-surface"
        >
          {weightsOpen ? (
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          {t('ai.router.weightsToggle')}
        </button>

        {weightsOpen && (
          <div className="mt-3 space-y-3 rounded-xl border border-outline-variant/30 bg-surface-container-low/25 p-4">
            <p className="text-xs text-on-surface-variant">{t('ai.router.weightsHint')}</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {TIER_ORDER.map((tier) => {
                const weightField = TIER_WEIGHT_FIELD[tier]
                const val = config[weightField]
                return (
                  <div key={tier} className="space-y-1.5">
                    <label
                      htmlFor={`router-weight-${tier}`}
                      className="block text-xs font-medium text-on-surface"
                    >
                      {t(`ai.router.tiers.${tier}.short`)}
                    </label>
                    <NumberStepper
                      id={`router-weight-${tier}`}
                      min={1}
                      max={100}
                      step={1}
                      value={weightDrafts[tier] ?? Math.round(val * 10)}
                      disabled={!canWrite || saving}
                      onValueChange={(raw) => {
                        setWeightDrafts((prev) => ({ ...prev, [tier]: raw }))
                        if (/^\d+$/.test(raw)) {
                          const n = Number(raw)
                          if (n >= 1 && n <= 100) {
                            setConfig({ ...config, [weightField]: Number((n / 10).toFixed(1)) })
                          }
                        }
                      }}
                      onBlur={() => {
                        const raw = weightDrafts[tier]
                        if (raw !== undefined) {
                          const n = /^\d+$/.test(raw) ? Number(raw) : Math.round(val * 10)
                          const clamped = Math.max(1, Math.min(100, Number.isFinite(n) ? n : 10))
                          setConfig({ ...config, [weightField]: Number((clamped / 10).toFixed(1)) })
                          setWeightDrafts((prev) => {
                            const next = { ...prev }
                            delete next[tier]
                            return next
                          })
                        }
                      }}
                      aria-label={`${t('ai.router.weightsToggle')}: ${t(`ai.router.tiers.${tier}.short`)}`}
                    />
                    <span className="block text-label-sm text-on-surface-variant">
                      {val.toFixed(1)}x
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
