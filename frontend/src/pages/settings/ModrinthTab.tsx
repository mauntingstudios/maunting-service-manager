import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Package, Save, Send, Trash2, Undo2 } from 'lucide-react'
import { api } from '@/api/client'
import { toast } from '@/stores/toastStore'
import { useHasPermission } from '@/hooks/useHasPermission'
import { Button, PasswordInput, Spinner } from '@maunting/ui'
import { PanelSettings, EMPTY_PANEL_SETTINGS } from './types'

export function ModrinthTab() {
  const { t } = useTranslation()
  const canWrite = useHasPermission('panel.settings.write')
  const [settings, setSettings] = useState<PanelSettings>(EMPTY_PANEL_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [newKey, setNewKey] = useState('')
  const [clearKey, setClearKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  const fetchSettings = async () => {
    try {
      const data = await api<PanelSettings>('/settings')
      setSettings(data)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchSettings()
  }, [])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      if (clearKey) {
        await api('/settings/modrinth-api-key', { method: 'DELETE' })
        setClearKey(false)
        setNewKey('')
        toast.success(t('settings.modrinthRemoved'))
      } else if (newKey.trim()) {
        await api('/settings/modrinth-api-key', {
          method: 'POST',
          body: JSON.stringify({ modrinth_api_key: newKey.trim() }),
        })
        toast.success(t('settings.modrinthSaved'))
        setNewKey('')
      }
      await fetchSettings()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    try {
      const res = await api<{ message: string; valid: boolean }>('/settings/modrinth-key/test', {
        method: 'POST',
      })
      if (res.valid) {
        toast.success(res.message)
      } else {
        toast.error(res.message)
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" className="text-primary" />
      </div>
    )
  }

  const hasChanges = Boolean(newKey.trim() || clearKey)
  const sourceLabel = settings.modrinth_api_source === 'env' ? '.env' : 'Panel-DB'

  return (
    <div className="space-y-6">
      <div className="msm-card p-6">
        <div className="flex items-center gap-2 mb-2">
          <Package className="h-5 w-5 text-secondary" aria-hidden="true" />
          <h2 className="font-headline text-title-lg font-semibold text-on-surface">
            {t('settings.modrinthApiKey')}
          </h2>
        </div>
        <p className="text-sm text-on-surface-variant mb-6">
          {t('settings.modrinthOptionalNote')}
        </p>

        <form onSubmit={handleSave} className="space-y-4">
          <fieldset disabled={!canWrite} className="space-y-4 border-0 p-0 m-0">
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                settings.modrinth_api_configured ? 'bg-status-success' : 'bg-on-surface-variant'
              }`}
            />
            <span className="font-body-md text-sm text-on-surface">
              {settings.modrinth_api_configured
                ? t('settings.modrinthConfigured')
                : t('settings.modrinthPublicMode')}
              {settings.modrinth_api_source && settings.modrinth_api_source !== 'none' && (
                <span className="ml-2 font-mono text-xs text-on-surface-variant">
                  ({sourceLabel})
                </span>
              )}
            </span>
          </div>

          <div className="rounded-xl border border-outline-variant/40 bg-surface-container-low/35 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                {t('settings.modrinthTokenLabel')}
              </label>
              {clearKey ? (
                <span className="text-xs text-status-warning flex items-center gap-1.5">
                  {t('settings.keyWillBeCleared')}
                  <button
                    type="button"
                    onClick={() => setClearKey(false)}
                    className="font-medium text-primary hover:underline inline-flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
                  >
                    <Undo2 className="h-3 w-3" />
                    {t('common.undo')}
                  </button>
                </span>
              ) : settings.modrinth_api_configured && canWrite ? (
                <button
                  type="button"
                  onClick={() => {
                    setClearKey(true)
                    setNewKey('')
                  }}
                  className="inline-flex items-center gap-1 text-xs text-on-surface-variant hover:text-status-destructive transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
                  aria-label={t('settings.modrinthDeleteKey')}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{t('settings.modrinthDeleteKey')}</span>
                </button>
              ) : null}
            </div>

            <PasswordInput
              value={newKey}
              disabled={!canWrite || saving || clearKey}
              onChange={(e) => {
                setNewKey(e.target.value)
                setClearKey(false)
              }}
              placeholder={
                clearKey
                  ? t('settings.keyWillBeCleared')
                  : settings.modrinth_api_configured
                    ? t('settings.keyConfiguredHint')
                    : 'mrp_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'
              }
            />

            <p className="msm-field-help">
              {t('settings.modrinthKeyHint')}{' '}
              <a
                href="https://modrinth.com/settings/pats"
                target="_blank"
                rel="noopener noreferrer"
                className="text-secondary hover:underline"
              >
                modrinth.com/settings/pats
              </a>
            </p>
          </div>
          </fieldset>

          <div className="flex gap-3 justify-end flex-wrap pt-2">
            <Button
              variant="secondary"
              type="button"
              onClick={handleTest}
              disabled={testing}
              className="inline-flex items-center gap-2 disabled:opacity-50"
            >
              {testing ? <Spinner /> : <Send className="w-4 h-4" />}
              {t('settings.modrinthTest')}
            </Button>
            <Button
              type="submit"
              disabled={saving || !hasChanges || !canWrite}
              className="inline-flex items-center gap-2 disabled:opacity-50"
            >
              {saving ? <Spinner /> : <Save className="w-4 h-4" />}
              {t('settings.modrinthSaveKey')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
