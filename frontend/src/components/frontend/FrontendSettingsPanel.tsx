import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2 } from 'lucide-react'
import { Badge, Button, Input, Spinner, Switch } from '@maunting/ui'
import { frontendApi, type FrontendOverview, type VerifyDomainResponse } from '@/api/frontend'
import { toast } from '@/stores/toastStore'

interface FrontendSettingsPanelProps {
  serverId: number
  onUpdated?: () => void
}

export function FrontendSettingsPanel({ serverId, onUpdated }: FrontendSettingsPanelProps) {
  const { t } = useTranslation()
  const [overview, setOverview] = useState<FrontendOverview | null>(null)
  const [branch, setBranch] = useState('main')
  const [autoDeploy, setAutoDeploy] = useState(true)
  const [previewsEnabled, setPreviewsEnabled] = useState(true)
  const [domain, setDomain] = useState('')
  const [envProd, setEnvProd] = useState<Array<{ key: string; value: string }>>([])
  const [envPreview, setEnvPreview] = useState<Array<{ key: string; value: string }>>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [clearingCache, setClearingCache] = useState(false)
  const [verifyReport, setVerifyReport] = useState<VerifyDomainResponse | null>(null)

  const load = useCallback(async () => {
    try {
      const ov = await frontendApi.getOverview(serverId)
      setOverview(ov)
      setBranch(ov.production_branch)
      setAutoDeploy(ov.auto_deploy)
      setPreviewsEnabled(ov.previews_enabled)
      setDomain(ov.domain ?? '')
      setEnvProd(Object.entries(ov.env_production ?? {}).map(([key, value]) => ({ key, value: String(value) })))
      setEnvPreview(Object.entries(ov.env_preview ?? {}).map(([key, value]) => ({ key, value: String(value) })))
    } catch {
      toast.error(t('frontendDeployments.loadError'))
    } finally {
      setLoading(false)
    }
  }, [serverId, t])

  useEffect(() => {
    load()
  }, [load])

  const rowsToDict = (rows: Array<{ key: string; value: string }>) => {
    const out: Record<string, string> = {}
    for (const r of rows) {
      const k = r.key.trim()
      if (k) out[k] = r.value
    }
    return out
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const updated = await frontendApi.updateSettings(serverId, {
        production_branch: branch.trim() || 'main',
        auto_deploy: autoDeploy,
        previews_enabled: previewsEnabled,
        domain: domain.trim() || null,
        env_production: rowsToDict(envProd),
        env_preview: rowsToDict(envPreview),
      })
      setOverview(updated)
      toast.success(t('frontendDeployments.settingsSaved'))
      onUpdated?.()
    } catch {
      toast.error(t('frontendDeployments.actionError'))
    } finally {
      setSaving(false)
    }
  }

  const handleVerifyDomain = async () => {
    setVerifying(true)
    try {
      const res = await frontendApi.verifyDomain(serverId)
      setVerifyReport(res)
      if (res.verified) {
        toast.success(t('frontendDeployments.domainVerified'))
        await load()
        onUpdated?.()
      } else {
        toast.error(t('frontendDeployments.domainVerifyFailed'))
      }
    } catch {
      toast.error(t('frontendDeployments.domainVerifyFailed'))
    } finally {
      setVerifying(false)
    }
  }

  const handleClearCache = async () => {
    setClearingCache(true)
    try {
      await frontendApi.clearCache(serverId)
      toast.success(t('frontendDeployments.cacheCleared', { defaultValue: 'Build-Cache geleert' }))
    } catch {
      toast.error(t('frontendDeployments.actionError'))
    } finally {
      setClearingCache(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-outline-variant/40 bg-surface-container p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-on-surface">
            {t('frontendDeployments.gitSettingsTitle')}
          </h3>
          <Badge variant={overview?.webhook_registered ? 'success' : 'default'}>
            {overview?.webhook_registered
              ? t('frontendDeployments.webhookActive')
              : t('frontendDeployments.pollerActive')}
          </Badge>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-on-surface-variant">
            {t('frontendDeployments.productionBranch')}
          </label>
          <Input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" />
        </div>

        <div className="flex items-center justify-between gap-4">
          <span className="text-sm text-on-surface">{t('frontendDeployments.autoDeployLabel')}</span>
          <Switch checked={autoDeploy} onCheckedChange={setAutoDeploy} />
        </div>

        <div className="flex items-center justify-between gap-4">
          <span className="text-sm text-on-surface">{t('frontendDeployments.previewsLabel')}</span>
          <Switch checked={previewsEnabled} onCheckedChange={setPreviewsEnabled} />
        </div>
      </section>

      <section className="rounded-xl border border-outline-variant/40 bg-surface-container p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-on-surface">{t('frontendDeployments.domainTitle')}</h3>
          {overview?.domain && (
            <Badge variant={overview.domain_verified ? 'success' : 'warning'}>
              {overview.domain_verified
                ? t('frontendDeployments.verified')
                : t('frontendDeployments.unverified')}
            </Badge>
          )}
        </div>

        <Input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="app.deinedomain.de"
        />

        {overview?.domain && !overview.domain_verified && overview.domain_verify_txt_host && (
          <div className="rounded-lg border border-outline-variant/40 bg-surface-container-low p-3 text-xs space-y-2">
            <p className="font-medium text-on-surface">{t('frontendDeployments.dnsInstructions')}</p>
            <p className="font-mono break-all">
              TXT {overview.domain_verify_txt_host} → {overview.domain_verify_txt_value}
            </p>
            {verifyReport && !verifyReport.verified && (
              <div className="rounded border border-status-warning/40 bg-status-warning/10 p-2 space-y-1 text-on-surface">
                <p>
                  TXT-Nachweis:{' '}
                  <strong className={verifyReport.txt_ok ? 'text-status-success' : 'text-status-destructive'}>
                    {verifyReport.txt_ok ? 'OK' : 'Fehlt noch'}
                  </strong>
                  {' · '}
                  A-Record:{' '}
                  <strong className={verifyReport.a_ok ? 'text-status-success' : 'text-status-destructive'}>
                    {verifyReport.a_ok
                      ? 'OK'
                      : `Erwartet ${verifyReport.expected_ip || 'Server-IP'}, gefunden: ${(verifyReport.actual_ips || []).join(', ') || 'keine'}`}
                  </strong>
                </p>
                {verifyReport.caddy_error && (
                  <p className="text-status-destructive font-mono">{verifyReport.caddy_error}</p>
                )}
              </div>
            )}
            <Button variant="secondary" size="sm" onClick={handleVerifyDomain} disabled={verifying}>
              {verifying ? t('common.loading') : t('frontendDeployments.verifyDomain')}
            </Button>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-outline-variant/40 bg-surface-container p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-on-surface">
            {t('frontendDeployments.buildCacheTitle', { defaultValue: 'Build-Cache' })}
          </h3>
          <p className="text-xs text-on-surface-variant">
            {t('frontendDeployments.buildCacheHint', {
              defaultValue: 'Abhängigkeiten werden pro Server zwischengespeichert, damit wiederholte Builds schneller laufen.',
            })}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={handleClearCache} disabled={clearingCache}>
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          {clearingCache
            ? t('common.loading')
            : t('frontendDeployments.clearCache', { defaultValue: 'Build-Cache leeren' })}
        </Button>
      </section>

      <section className="rounded-xl border border-outline-variant/40 bg-surface-container p-4 sm:p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-on-surface">{t('frontendDeployments.envTitle')}</h3>
          <p className="text-xs text-on-surface-variant">{t('frontendDeployments.envHint')}</p>
        </div>

        {([
          { label: t('frontendDeployments.envProduction'), rows: envProd, setRows: setEnvProd },
          { label: t('frontendDeployments.envPreview'), rows: envPreview, setRows: setEnvPreview },
        ] as const).map((group) => (
          <div key={group.label} className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-on-surface-variant">{group.label}</span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => group.setRows([...group.rows, { key: '', value: '' }])}
              >
                {t('frontendDeployments.addEnv')}
              </Button>
            </div>
            {group.rows.map((row, idx) => (
              <div key={idx} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <Input
                  value={row.key}
                  onChange={(e) => {
                    const next = [...group.rows]
                    next[idx] = { ...row, key: e.target.value }
                    group.setRows(next)
                  }}
                  placeholder="VITE_API_URL"
                />
                <Input
                  value={row.value}
                  onChange={(e) => {
                    const next = [...group.rows]
                    next[idx] = { ...row, value: e.target.value }
                    group.setRows(next)
                  }}
                  placeholder="https://api.example.com"
                />
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => group.setRows(group.rows.filter((_, i) => i !== idx))}
                >
                  {t('common.delete')}
                </Button>
              </div>
            ))}
          </div>
        ))}
      </section>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? t('common.loading') : t('common.save')}
        </Button>
      </div>
    </div>
  )
}
