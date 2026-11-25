/**
 * Hoster-Anbindung (Phase 6).
 *
 * Die Ansicht ist reine Konfiguration. Jede Entscheidung — welcher Blueprint,
 * welche Ressourcen, welcher Kunde welchen Server sehen darf — trifft das
 * Backend. Ein frisch erzeugter API-Key oder Webhook-Secret wird genau einmal
 * angezeigt und danach verworfen; es gibt keinen Lesepfad dafuer.
 */
import { useCallback, useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  FlaskConical,
  KeyRound,
  Pause,
  Pencil,
  Play,
  Plug,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  ShoppingBag,
  Sparkles,
  Trash2,
  XCircle,
} from 'lucide-react'

import {
  hosterApi,
  type HosterDelivery,
  type HosterIntegration,
  type HosterProduct,
  type HosterService,
  type HosterSimulationResponse,
} from '@/api/hoster'
import { shopAdminApi, type ShopPlan } from '@/api/shop'
import { still } from '@/lib/still'
import { api, SanitizedApiError } from '@/api/client'
import { Button, NumberStepper, Switch, buttonClasses } from '@maunting/ui'
import { Dropdown } from '@maunting/ui'
import { SecretOnce } from '@/components/app/SecretOnce'
import { confirm } from '@/stores/confirmStore'
import { toast } from '@/stores/toastStore'
import type { User } from '@/types'
import { isSafeRelativePath } from '@/shop/safeUrl'

import { Spinner } from '@maunting/ui'
/**
 * Handoff-Link same-origin oeffnen: der absolute Link wird aus MSM_PANEL_URL
 * gebaut und zeigt in der Dev-Umgebung am Frontend vorbei. Der Pfad ueber die
 * eigene Origin laeuft durch den Vite-Proxy, und der mitgesendete Referer
 * (deshalb `rel="noopener"` ohne `noreferrer`) laesst das Backend auf diese
 * Origin zurueckleiten — nur bei exaktem Treffer in der CORS-Allowlist.
 */
function handoffPath(url: string): string {
  try {
    const parsed = new URL(url)
    const path = `${parsed.pathname}${parsed.search}`
    return isSafeRelativePath(path) ? path : '/'
  } catch {
    return isSafeRelativePath(url) ? url : '/'
  }
}

export function HosterTab({ canWrite }: { canWrite: boolean }) {
  const { t } = useTranslation()
  const [integrations, setIntegrations] = useState<HosterIntegration[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(false)
  // Ein einmalig angezeigtes Geheimnis. Bewusst nur im Komponentenzustand und
  // nie in localStorage: es soll den Reload nicht ueberleben.
  const [revealed, setRevealed] = useState<{ label: string; value: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const rows = await hosterApi.listIntegrations()
      setIntegrations(rows)
      setSelectedId((current) =>
        current != null && rows.some((row) => row.id === current) ? current : rows[0]?.id ?? null,
      )
    } catch (error: unknown) {
      toast.error(error instanceof SanitizedApiError ? error.message : t('hoster.errors.load'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const selected = integrations.find((row) => row.id === selectedId) ?? null

  const rotate = async (kind: 'api-key' | 'webhook-secret') => {
    if (!selected || !canWrite || busy) return
    setBusy(true)
    try {
      const secret = kind === 'api-key'
        ? await hosterApi.rotateApiKey(selected.id)
        : await hosterApi.rotateWebhookSecret(selected.id)
      setRevealed({
        label: kind === 'api-key' ? t('hoster.apiKey') : t('hoster.webhookSecret'),
        value: secret.value,
      })
      await load()
      toast.success(t('hoster.rotated'))
    } catch (error: unknown) {
      toast.error(error instanceof SanitizedApiError ? error.message : t('hoster.errors.rotate'))
    } finally {
      setBusy(false)
    }
  }

  const removeIntegration = async () => {
    if (!selected || !canWrite || busy) return
    const accepted = await confirm({
      title: t('hoster.deleteTitle'),
      message: t('hoster.deleteConfirm', { name: selected.name }),
      confirmText: t('common.delete'),
      danger: true,
    })
    if (!accepted) return
    setBusy(true)
    try {
      await hosterApi.deleteIntegration(selected.id)
      setSelectedId(null)
      await load()
      toast.success(t('hoster.deleted'))
    } catch (error: unknown) {
      toast.error(error instanceof SanitizedApiError ? error.message : t('hoster.errors.delete'))
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Spinner size="lg" className="text-primary" />
      </div>
    )
  }

  return (
    <section className="space-y-6" aria-labelledby="hoster-title">
      <div className="msm-card flex flex-wrap items-start justify-between gap-4 p-6">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2">
            <Plug className="h-5 w-5 text-secondary" aria-hidden="true" />
            <h3 id="hoster-title" className="font-headline text-title-lg font-semibold text-on-surface">
              {t('hoster.title')}
            </h3>
          </div>
          <p className="mt-2 text-sm text-on-surface-variant">{t('hoster.description')}</p>
          {/* Wer den Shop tatsaechlich anbindet, braucht die Endpunkt- und
              Webhook-Referenz — dieser Reiter erklaert nur die Konfiguration. */}
          <Link
            to="/docs/hoster-api"
            className={buttonClasses('secondary', 'md', 'mt-4')}
          >
            <Plug className="h-4 w-4" aria-hidden="true" />
            {t('hoster.docsLink')}
          </Link>
        </div>
        {canWrite && !creating && (
          <Button type="button" variant="secondary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />{t('hoster.add')}
          </Button>
        )}
      </div>

      {revealed && (
        <SecretOnce
          label={revealed.label}
          value={revealed.value}
          onDismiss={() => setRevealed(null)}
        />
      )}

      {creating && (
        <IntegrationForm
          disabled={busy}
          onCancel={() => setCreating(false)}
          onCreated={async (secret) => {
            setCreating(false)
            setRevealed({ label: t('hoster.apiKey'), value: secret })
            await load()
          }}
        />
      )}

      {integrations.length === 0 && !creating && (
        <div className="msm-card p-6 text-sm text-on-surface-variant">{t('hoster.empty')}</div>
      )}

      {integrations.length > 0 && (
        <div className="msm-card space-y-4 p-6">
          <label className="space-y-1.5 block">
            <span className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              {t('hoster.integration')}
            </span>
            <Dropdown
              value={selectedId === null ? null : String(selectedId)}
              onChange={(value) => setSelectedId(Number(value))}
              options={integrations.map((row) => ({
                value: String(row.id),
                label: `${row.name} (${row.slug})`,
                hint: row.is_sandbox ? t('hoster.sandboxBadge') : t('hoster.liveBadge'),
              }))}
              aria-label={t('hoster.integration')}
              data-testid="hoster-integration-select"
            />
          </label>

          {selected && (
            <>
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    selected.is_sandbox
                      ? 'bg-status-warning/15 text-status-warning border border-status-warning/30'
                      : 'bg-status-success/15 text-status-success border border-status-success/30'
                  }`}
                >
                  {selected.is_sandbox ? (
                    <>
                      <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
                      {t('hoster.sandboxBadge')}
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      {t('hoster.liveBadge')}
                    </>
                  )}
                </span>
                <span className="text-xs text-on-surface-variant">
                  {selected.is_sandbox ? t('hoster.isSandboxHint') : t('hoster.enabled')}
                </span>
              </div>

              <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <Fact
                  label={t('hoster.environment')}
                  value={selected.is_sandbox ? t('hoster.sandboxBadge') : t('hoster.liveBadge')}
                  hint={selected.is_sandbox ? t('hoster.sandboxEnvHint') : t('hoster.liveEnvHint')}
                />
                <Fact
                  label={t('hoster.apiKey')}
                  value={selected.api_key_hint ?? '—'}
                  hint={t('hoster.apiKeyHint')}
                />
                <Fact
                  label={t('hoster.webhookSecret')}
                  value={selected.webhook_secret_configured ? (selected.webhook_secret_hint ?? '••••') : t('hoster.notConfigured')}
                  hint={t('hoster.webhookSecretHint')}
                />
                <Fact label={t('hoster.webhookUrl')} value={selected.webhook_url ?? t('hoster.notConfigured')} />
                <Fact label={t('hoster.graceDays')} value={String(selected.terminate_grace_days)} />
              </dl>
              {canWrite && !editing && (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" disabled={busy} onClick={() => setEditing(true)}>
                    <Pencil className="h-4 w-4" aria-hidden="true" />{t('common.edit')}
                  </Button>
                  <Button type="button" variant="secondary" disabled={busy} onClick={() => void rotate('api-key')}>
                    <RefreshCw className="h-4 w-4" aria-hidden="true" />{t('hoster.rotateApiKey')}
                  </Button>
                  <Button type="button" variant="secondary" disabled={busy} onClick={() => void rotate('webhook-secret')}>
                    <KeyRound className="h-4 w-4" aria-hidden="true" />{t('hoster.rotateWebhookSecret')}
                  </Button>
                  <Button type="button" variant="destructive" disabled={busy} onClick={() => void removeIntegration()}>
                    <Trash2 className="h-4 w-4" aria-hidden="true" />{t('common.delete')}
                  </Button>
                </div>
              )}
              {canWrite && editing && (
                <IntegrationEditForm
                  key={selected.id}
                  integration={selected}
                  disabled={busy}
                  onCancel={() => setEditing(false)}
                  onSaved={async () => {
                    setEditing(false)
                    await load()
                  }}
                />
              )}
            </>
          )}
        </div>
      )}

      {selected && <ProductSection integrationId={selected.id} canWrite={canWrite} />}
      {selected && selected.is_sandbox && (
        <SimulatorSection integration={selected} canWrite={canWrite} onRefresh={load} />
      )}
      {selected && <ServiceSection integrationId={selected.id} />}
      {selected && <DeliverySection integrationId={selected.id} canWrite={canWrite} />}
    </section>
  )
}

function SandboxSchalter({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (v: boolean) => void }) {
  const { t } = useTranslation()
  const name = useId()
  const hinweis = useId()
  return (
    <div className="flex items-center justify-between rounded-xl border border-outline-variant/40 bg-surface-container-low/40 p-4 md:col-span-2">
      <div className="space-y-0.5">
        <span id={name} className="block text-sm font-medium text-on-surface">{t('hoster.isSandbox')}</span>
        <p id={hinweis} className="text-xs text-on-surface-variant">{t('hoster.isSandboxHint')}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-labelledby={name} aria-describedby={hinweis} />
    </div>
  )
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">{label}</dt>
      <dd className="mt-0.5 break-all text-on-surface">{value}</dd>
      {hint && <dd className="mt-0.5 text-xs text-on-surface-variant">{hint}</dd>}
    </div>
  )
}

function IntegrationForm({
  disabled,
  onCancel,
  onCreated,
}: {
  disabled: boolean
  onCancel: () => void
  onCreated: (apiKey: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [serviceUserId, setServiceUserId] = useState('')
  const [webhookUrl, setWebhookUrl] = useState('')
  const [graceDays, setGraceDays] = useState('7')
  const [unpaidDeleteDays, setUnpaidDeleteDays] = useState('')
  const [isSandbox, setIsSandbox] = useState(false)
  const [users, setUsers] = useState<User[]>([])
  const [loadingUsers, setLoadingUsers] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    api<User[]>('/admin/users')
      .then((rows) => {
        if (active) {
          setUsers(rows)
          // Default to first active owner or first user
          const defaultUser = rows.find((u) => u.is_owner && u.is_active) ?? rows.find((u) => u.is_active)
          if (defaultUser) {
            setServiceUserId(String(defaultUser.id))
          }
        }
      })
      .catch(() => {
        if (active) setUsers([])
      })
      .finally(() => {
        if (active) setLoadingUsers(false)
      })
    return () => {
      active = false
    }
  }, [])

  const valid = Boolean(name.trim() && slug.trim() && /^\d+$/.test(serviceUserId))

  return (
    <form
      className="msm-card space-y-5 p-6"
      onSubmit={(event) => {
        event.preventDefault()
        if (!valid || saving) return
        setSaving(true)
        hosterApi
          .createIntegration({
            name: name.trim(),
            slug: slug.trim(),
            enabled: true,
            is_sandbox: isSandbox,
            service_user_id: Number(serviceUserId),
            webhook_url: webhookUrl.trim() || null,
            terminate_grace_days: Number(graceDays) || 0,
            unpaid_delete_days: unpaidDeleteDays.trim()
              ? Math.max(0, Math.min(365, Number(unpaidDeleteDays) || 0))
              : null,
          })
          .then((secret) => onCreated(secret.value))
          .catch((error: unknown) => {
            toast.error(error instanceof SanitizedApiError ? error.message : t('hoster.errors.save'))
          })
          .finally(() => setSaving(false))
      }}
    >
      <fieldset disabled={disabled || saving} className="grid grid-cols-1 gap-4 border-0 p-0 md:grid-cols-2">
        <Field label={t('common.name')} value={name} onChange={setName} hint={t('hoster.nameHint')} />
        <Field label={t('hoster.slug')} value={slug} onChange={setSlug} hint={t('hoster.slugHint')} />
        <label className="space-y-1.5 block">
          <span className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
            {t('hoster.serviceUserId')}
          </span>
          <Dropdown
            value={serviceUserId || null}
            onChange={setServiceUserId}
            disabled={loadingUsers}
            searchable
            placeholder={loadingUsers ? t('common.loading') : t('hoster.noUsersFound')}
            options={users
              .filter((u) => u.is_active)
              .map((u) => ({
                value: String(u.id),
                label: `${u.username} (#${u.id})`,
                hint: u.is_owner ? 'Owner' : undefined,
              }))}
            aria-label={t('hoster.serviceUserId')}
            data-testid="hoster-service-user-select"
          />
          <p className="text-xs text-on-surface-variant">{t('hoster.serviceUserHint')}</p>
        </label>
        <Field
          label={t('hoster.webhookUrl')}
          value={webhookUrl}
          onChange={setWebhookUrl}
          type="url"
          placeholder="https://shop.example/hooks/msm"
          hint={t('hoster.webhookUrlHint')}
        />
        <label className="space-y-1.5">
          <span className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
            {t('hoster.graceDays')}
          </span>
          <NumberStepper value={graceDays} onValueChange={setGraceDays} min={0} max={365} step={1} />
          <p className="text-xs text-on-surface-variant">{t('hoster.graceDaysHint')}</p>
        </label>
        <Field
          label={t('hoster.unpaidDeleteDays')}
          value={unpaidDeleteDays}
          onChange={setUnpaidDeleteDays}
          type="number"
          placeholder={t('hoster.unpaidDeletePlaceholder')}
          hint={t('hoster.unpaidDeleteDaysHint')}
        />
        <SandboxSchalter checked={isSandbox} onCheckedChange={setIsSandbox} />
      </fieldset>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" disabled={saving} onClick={onCancel}>{t('common.cancel')}</Button>
        <Button type="submit" disabled={disabled || saving || !valid}>
          <Save className="h-4 w-4" aria-hidden="true" />{saving ? t('common.loading') : t('common.save')}
        </Button>
      </div>
    </form>
  )
}

/**
 * Nachtraegliches Aendern einer bestehenden Anbindung.
 *
 * Ohne diesen Weg war ein Tippfehler in der Webhook-Adresse endgueltig: das
 * Loeschen lehnt das Backend ab, solange noch ein Vertrag laeuft
 * (hoster_admin.delete_integration antwortet mit 409), und ein Neuanlegen
 * erzeugt zwangslaeufig einen neuen API-Key — den kennt der Shop nicht, die
 * Anbindung waere danach tot.
 *
 * Bewusst nur die drei Felder, die sich im Betrieb wirklich aendern. Name,
 * Slug und Dienstbenutzer bleiben aussen vor: der Slug steckt in den Adressen
 * des Shops, und ein Wechsel des Dienstbenutzers wuerde die Rechte aller
 * bereits erzeugten Server stillschweigend verschieben.
 */
function IntegrationEditForm({
  integration,
  disabled,
  onCancel,
  onSaved,
}: {
  integration: HosterIntegration
  disabled: boolean
  onCancel: () => void
  onSaved: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [webhookUrl, setWebhookUrl] = useState(integration.webhook_url ?? '')
  const [graceDays, setGraceDays] = useState(String(integration.terminate_grace_days))
  const [unpaidDeleteDays, setUnpaidDeleteDays] = useState(
    integration.unpaid_delete_days != null ? String(integration.unpaid_delete_days) : '',
  )
  const [enabled, setEnabled] = useState(integration.enabled)
  const [isSandbox, setIsSandbox] = useState(integration.is_sandbox ?? false)
  const [saving, setSaving] = useState(false)

  return (
    <form
      className="space-y-5 rounded-xl border border-outline-variant/40 bg-surface-container-low/35 p-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (saving) return
        setSaving(true)
        hosterApi
          .updateIntegration(integration.id, {
            webhook_url: webhookUrl.trim() || null,
            terminate_grace_days: Number(graceDays) || 0,
            unpaid_delete_days: unpaidDeleteDays.trim()
              ? Math.max(0, Math.min(365, Number(unpaidDeleteDays) || 0))
              : null,
            enabled,
            is_sandbox: isSandbox,
          })
          .then(async () => {
            toast.success(t('hoster.updated'))
            await onSaved()
          })
          .catch((error: unknown) => {
            toast.error(error instanceof SanitizedApiError ? error.message : t('hoster.errors.save'))
          })
          .finally(() => setSaving(false))
      }}
    >
      <fieldset disabled={disabled || saving} className="grid grid-cols-1 gap-4 border-0 p-0 md:grid-cols-2">
        <Field
          label={t('hoster.webhookUrl')}
          value={webhookUrl}
          onChange={setWebhookUrl}
          type="url"
          placeholder="https://shop.example/hooks/msm"
          hint={t('hoster.webhookUrlHint')}
        />
        <label className="space-y-1.5">
          <span className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
            {t('hoster.graceDays')}
          </span>
          <NumberStepper value={graceDays} onValueChange={setGraceDays} min={0} max={365} step={1} />
          <p className="text-xs text-on-surface-variant">{t('hoster.graceDaysHint')}</p>
        </label>
        <Field
          label={t('hoster.unpaidDeleteDays')}
          value={unpaidDeleteDays}
          onChange={setUnpaidDeleteDays}
          type="number"
          placeholder={t('hoster.unpaidDeletePlaceholder')}
          hint={t('hoster.unpaidDeleteDaysHint')}
        />
        {/* Der Dienstbenutzer laesst sich hier nicht wechseln — was an ihm
            haengt, gehoert trotzdem sichtbar erklaert. */}
        <div className="md:col-span-2 rounded-xl border border-outline-variant/40 bg-surface-container-low/35 p-4">
          <p className="text-xs text-on-surface-variant">{t('hoster.serviceUserHint')}</p>
        </div>
        <SandboxSchalter checked={isSandbox} onCheckedChange={setIsSandbox} />
        <label className="flex min-h-10 items-center justify-between gap-4 text-sm text-on-surface md:col-span-2">
          <span>{t('hoster.enabled')}</span>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </label>
      </fieldset>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" disabled={saving} onClick={onCancel}>{t('common.cancel')}</Button>
        <Button type="submit" disabled={disabled || saving}>
          <Save className="h-4 w-4" aria-hidden="true" />{saving ? t('common.loading') : t('common.save')}
        </Button>
      </div>
    </form>
  )
}

function ProductSection({ integrationId, canWrite }: { integrationId: number; canWrite: boolean }) {
  const { t } = useTranslation()
  const [legacyProducts, setLegacyProducts] = useState<HosterProduct[]>([])
  const [busy, setBusy] = useState(false)

  const loadLegacy = useCallback(() => {
    hosterApi
      .listProducts(integrationId)
      .then(setLegacyProducts)
      .catch((error: unknown) => {
        still(error, 'hoster.legacyProducts')
        setLegacyProducts([])
      })
  }, [integrationId])

  useEffect(loadLegacy, [loadLegacy])

  const openShopSettings = () => {
    window.dispatchEvent(new CustomEvent('msm:open-settings-tab', { detail: { tab: 'shop' } }))
  }

  return (
    <div className="msm-card space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1 max-w-2xl">
          <h4 className="font-headline text-base font-semibold text-on-surface">
            {t('hoster.products.unifiedTitle')}
          </h4>
          <p className="text-sm text-on-surface-variant">
            {t('hoster.products.unifiedDescription')}
          </p>
        </div>
        <Button type="button" variant="secondary" onClick={openShopSettings}>
          <ShoppingBag className="h-4 w-4" aria-hidden="true" />
          {t('hoster.products.openShopSettings')}
        </Button>
      </div>

      {legacyProducts.length > 0 && (
        <details className="rounded-xl border border-outline-variant/40 bg-surface-container-low/40 p-4">
          <summary className="cursor-pointer text-sm font-medium text-on-surface select-none">
            {t('hoster.products.legacyTitle')} ({legacyProducts.length})
          </summary>
          <p className="mt-2 text-xs text-on-surface-variant">{t('hoster.products.legacyHint')}</p>
          <ul className="mt-3 space-y-2">
            {legacyProducts.map((product) => (
              <li
                key={product.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-outline-variant/40 p-3 text-sm"
              >
                <span className="font-medium text-on-surface">{product.external_product_key}</span>
                <span className="text-on-surface-variant">
                  {product.game_type} · {product.ram_limit_mb ?? '—'} MB · {product.cpu_limit_percent ?? '—'} %
                </span>
                {canWrite && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={busy}
                    aria-label={t('common.delete')}
                    onClick={() => {
                      setBusy(true)
                      hosterApi
                        .deleteProduct(integrationId, product.id)
                        .then(() => {
                          loadLegacy()
                          toast.success(t('hoster.products.deleted'))
                        })
                        .catch((error: unknown) => {
                          toast.error(error instanceof SanitizedApiError ? error.message : t('hoster.errors.delete'))
                        })
                        .finally(() => setBusy(false))
                    }}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function ServiceSection({ integrationId }: { integrationId: number }) {
  const { t } = useTranslation()
  const [services, setServices] = useState<HosterService[]>([])

  useEffect(() => {
    let active = true
    hosterApi
      .listServices(integrationId)
      .then((rows) => { if (active) setServices(rows) })
      .catch((error: unknown) => {
        if (active) toast.error(error instanceof SanitizedApiError ? error.message : t('hoster.errors.load'))
      })
    return () => { active = false }
  }, [integrationId, t])

  return (
    <div className="msm-card space-y-3 p-6">
      <h4 className="font-headline text-base font-semibold text-on-surface">{t('hoster.services.title')}</h4>
      {services.length === 0 && (
        <p className="text-sm text-on-surface-variant">{t('hoster.services.empty')}</p>
      )}
      <ul className="space-y-2">
        {services.map((service) => (
          <li
            key={service.external_service_id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-outline-variant/40 p-3 text-sm"
          >
            <span className="font-medium text-on-surface">{service.external_service_id}</span>
            <span className="text-on-surface-variant">
              {t(`hoster.states.${service.desired_state}`, service.desired_state)} → {service.status}
              {service.status_code ? ` (${service.status_code})` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function DeliverySection({ integrationId, canWrite }: { integrationId: number; canWrite: boolean }) {
  const { t } = useTranslation()
  const [deliveries, setDeliveries] = useState<HosterDelivery[]>([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    hosterApi
      .listDeliveries(integrationId)
      .then(setDeliveries)
      .catch((error: unknown) => {
        toast.error(error instanceof SanitizedApiError ? error.message : t('hoster.errors.load'))
      })
  }, [integrationId, t])

  useEffect(load, [load])

  return (
    <div className="msm-card space-y-3 p-6">
      <h4 className="font-headline text-base font-semibold text-on-surface">{t('hoster.deliveries.title')}</h4>
      {deliveries.length === 0 && (
        <p className="text-sm text-on-surface-variant">{t('hoster.deliveries.empty')}</p>
      )}
      <ul className="space-y-2">
        {deliveries.map((delivery) => (
          <li
            key={delivery.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-outline-variant/40 p-3 text-sm"
          >
            <span className="font-medium text-on-surface">{delivery.event_type}</span>
            <span className="text-on-surface-variant">
              {delivery.status} · {t('hoster.deliveries.attempt', { count: delivery.attempt })}
              {delivery.response_code ? ` · HTTP ${delivery.response_code}` : ''}
            </span>
            {canWrite && delivery.status === 'failed' && (
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setBusy(true)
                  hosterApi
                    .retryDelivery(integrationId, delivery.id)
                    .then(() => { load(); toast.success(t('hoster.deliveries.retried')) })
                    .catch((error: unknown) => {
                      toast.error(error instanceof SanitizedApiError ? error.message : t('hoster.errors.save'))
                    })
                    .finally(() => setBusy(false))
                }}
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />{t('hoster.deliveries.retry')}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function SimulatorSection({
  integration,
  canWrite,
  onRefresh,
}: {
  integration: HosterIntegration
  canWrite: boolean
  onRefresh: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [plans, setPlans] = useState<ShopPlan[]>([])
  const [products, setProducts] = useState<HosterProduct[]>([])
  const [services, setServices] = useState<HosterService[]>([])
  const [selectedTarget, setSelectedTarget] = useState<string>('')
  const [selectedServiceId, setSelectedServiceId] = useState<string>('')
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [simResult, setSimResult] = useState<HosterSimulationResponse | null>(null)
  const [copiedPrompt, setCopiedPrompt] = useState(false)
  const [showAiModal, setShowAiModal] = useState(false)

  const reloadData = useCallback(async () => {
    try {
      const [planList, pList, sList] = await Promise.all([
        shopAdminApi.listPlans().catch((err: unknown) => {
          still(err, 'hoster.simulator.plans')
          return [] as ShopPlan[]
        }),
        hosterApi.listProducts(integration.id),
        hosterApi.listServices(integration.id),
      ])
      const activePlans = planList.filter((pl) => pl.active)
      setPlans(activePlans)
      setProducts(pList)
      setServices(sList)
      setSelectedTarget((current) => {
        if (current) return current
        if (activePlans.length > 0) return `plan:${activePlans[0].id}`
        if (pList.length > 0) return `legacy:${pList[0].external_product_key}`
        return current
      })
      setSelectedServiceId((current) =>
        current || (sList.length > 0 ? sList[0].external_service_id : current),
      )
    } catch (err: unknown) {
      still(err, 'hoster.simulator.reload')
    }
  }, [integration.id])

  useEffect(() => {
    void reloadData()
  }, [reloadData])

  const hasOrderTargets = plans.length > 0 || products.length > 0

  const runSimulation = async (
    action: 'order' | 'suspend' | 'reactivate' | 'terminate' | 'test_webhook'
  ) => {
    if (!canWrite || busyAction) return
    setBusyAction(action)
    try {
      const planId = selectedTarget.startsWith('plan:') ? Number(selectedTarget.slice(5)) : undefined
      const legacyKey = selectedTarget.startsWith('legacy:') ? selectedTarget.slice(7) : undefined
      const res = await hosterApi.simulate(integration.id, {
        action,
        plan_id: Number.isFinite(planId) ? planId : undefined,
        product_key: legacyKey || undefined,
        external_service_id: selectedServiceId || undefined,
      })
      setSimResult(res)
      toast.success(res.message)
      await reloadData()
      await onRefresh()
    } catch (error: unknown) {
      toast.error(error instanceof SanitizedApiError ? error.message : t('hoster.errors.save'))
    } finally {
      setBusyAction(null)
    }
  }

  const cleanSandbox = async () => {
    if (!canWrite || busyAction) return
    const accepted = await confirm({
      title: t('hoster.simulator.cleanSandbox'),
      message: t('hoster.simulator.cleanSandboxConfirm'),
      confirmText: t('common.delete'),
      danger: true,
    })
    if (!accepted) return
    setBusyAction('clean')
    try {
      const res = await hosterApi.cleanSandboxData(integration.id)
      setSimResult(null)
      toast.success(
        t('hoster.simulator.cleanSuccess', {
          services: res.deleted_services_count,
          servers: res.deleted_handoffs_count,
        })
      )
      await reloadData()
      await onRefresh()
    } catch (error: unknown) {
      toast.error(error instanceof SanitizedApiError ? error.message : t('hoster.errors.delete'))
    } finally {
      setBusyAction(null)
    }
  }

  const panelOrigin = window.location.origin
  const examplePlanId = plans[0]?.id
  const exampleProductKey = examplePlanId ? `plan:${examplePlanId}` : (products[0]?.external_product_key || 'plan:1')

  const aiStripePrompt = `Hier sind die technischen Eckdaten meines MSM (Maunting Service Manager) Backends für meine Shop-Anbindung:
- Panel Host API: ${panelOrigin}/api/hoster/v1
- Katalog-Abruf: GET ${panelOrigin}/api/hoster/v1/catalog
- Integration Slug: "${integration.slug}"
- API-Key Header: X-MSM-Hoster-Key (im MSM-Panel generiert)
- Webhook Secret Header: X-MSM-Signature (HMAC-SHA256 mit X-MSM-Timestamp)
- Beispiel-Tarifkennung: "${exampleProductKey}"

Bitte erstelle mir einen sauberen, produktionsreifen Stripe Webhook Handler (Node.js mit Express oder Python mit FastAPI), der:
1. Alle aktiven Tarife, Add-ons, Bilder und Start-Variablen über GET ${panelOrigin}/api/hoster/v1/catalog lädt.
2. Bei 'checkout.session.completed' über POST ${panelOrigin}/api/hoster/v1/apply mit Header "X-MSM-Hoster-Key: <MEIN_KEY>" den gewünschten Zustand {"external_subject": customer_id, "desired_state": "active", "email": customer_email, "items": [{"external_service_id": subscription_id, "kind": "server", "product_key": "${exampleProductKey}"}]} im Panel anlegt.
3. Einen Einmal-Login-Link via POST ${panelOrigin}/api/hoster/v1/handoffs mit {"external_service_id": "{subscription_id}"} erzeugt und dem Kunden anzeigt.
4. Bei 'customer.subscription.deleted' den Status über POST ${panelOrigin}/api/hoster/v1/apply auf {"desired_state": "terminated"} setzt.
5. Bei 'invoice.payment_failed' den Status auf {"desired_state": "suspended"} setzt.`

  const copyAiPrompt = async () => {
    try {
      await navigator.clipboard.writeText(aiStripePrompt)
      setCopiedPrompt(true)
      toast.success(t('hoster.simulator.copiedAiPrompt'))
      setTimeout(() => setCopiedPrompt(false), 3000)
    } catch {
      toast.error(t('common.clipboardError'))
    }
  }

  return (
    <div className="msm-card space-y-5 p-6 border-status-warning/25 bg-surface-container-low/20">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div className="rounded-lg bg-status-warning/15 p-2 text-status-warning border border-status-warning/30">
            <FlaskConical className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h4 className="font-headline text-base font-semibold text-on-surface">
              {t('hoster.simulator.title')}
            </h4>
            <p className="text-xs text-on-surface-variant">
              {t('hoster.simulator.description')}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="secondary"
          className="gap-2 text-xs"
          onClick={() => setShowAiModal((v) => !v)}
        >
          <Sparkles className="h-4 w-4 text-status-warning" aria-hidden="true" />
          {t('hoster.simulator.aiDocsTitle')}
        </Button>
      </div>

      {showAiModal && (
        <div className="rounded-xl border border-outline-variant/50 bg-surface-container p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-on-surface">
              {t('hoster.simulator.aiDocsTitle')}
            </span>
            <Button
              type="button"
              variant="secondary"
              className="gap-1.5 text-xs py-1 px-3"
              onClick={() => void copyAiPrompt()}
            >
              {copiedPrompt ? (
                <>
                  <Check className="h-3.5 w-3.5 text-status-success" />
                  {t('hoster.copied')}
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  {t('hoster.simulator.copyAiPrompt')}
                </>
              )}
            </Button>
          </div>
          <p className="text-xs text-on-surface-variant">
            {t('hoster.simulator.aiDocsDesc')}
          </p>
          <pre className="rounded-lg bg-surface-container-lowest p-3 text-xs text-on-surface-variant font-mono whitespace-pre-wrap break-all select-all">
            {aiStripePrompt}
          </pre>
        </div>
      )}

      {hasOrderTargets ? (
        <div className="max-w-sm">
          <label className="block font-label-md text-label-md text-on-surface-variant mb-1.5 uppercase tracking-wider">
            {t('hoster.simulator.selectTarget')}
          </label>
          <Dropdown
            value={selectedTarget || null}
            onChange={(val) => setSelectedTarget(val)}
            options={[
              ...plans.map((pl) => ({
                value: `plan:${pl.id}`,
                label: `${pl.name} (${pl.game_type})`,
              })),
              ...products.map((p) => ({
                value: `legacy:${p.external_product_key}`,
                label: `Legacy: ${p.external_product_key} (${p.game_type})`,
              })),
            ]}
            aria-label={t('hoster.simulator.selectTarget')}
          />
        </div>
      ) : (
        <div className="rounded-lg border border-outline-variant/30 bg-surface-container-low/50 p-3 text-xs text-status-warning/90">
          {t('hoster.simulator.noProductsHint')}
        </div>
      )}

      {/* Mathematisch saubere Button-Leiste / Grid */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <Button
          type="button"
          variant="secondary"
          disabled={!canWrite || Boolean(busyAction) || !hasOrderTargets}
          onClick={() => void runSimulation('order')}
          className="h-11 justify-center gap-2 text-xs font-medium border-status-success/20 hover:border-status-success/50 hover:bg-status-success/10"
        >
          <Play className="h-4 w-4 text-status-success" aria-hidden="true" />
          {busyAction === 'order' ? t('common.loading') : t('hoster.simulator.simulateOrder')}
        </Button>

        <Button
          type="button"
          variant="secondary"
          disabled={!canWrite || Boolean(busyAction) || services.length === 0}
          onClick={() => void runSimulation('suspend')}
          className="h-11 justify-center gap-2 text-xs font-medium border-status-warning/20 hover:border-status-warning/50 hover:bg-status-warning/10"
        >
          <Pause className="h-4 w-4 text-status-warning" aria-hidden="true" />
          {busyAction === 'suspend' ? t('common.loading') : t('hoster.simulator.simulateSuspend')}
        </Button>

        <Button
          type="button"
          variant="secondary"
          disabled={!canWrite || Boolean(busyAction) || services.length === 0}
          onClick={() => void runSimulation('reactivate')}
          className="h-11 justify-center gap-2 text-xs font-medium border-primary/20 hover:border-primary/50 hover:bg-primary/10"
        >
          <RotateCcw className="h-4 w-4 text-primary" aria-hidden="true" />
          {busyAction === 'reactivate' ? t('common.loading') : t('hoster.simulator.simulateReactivate')}
        </Button>

        <Button
          type="button"
          variant="secondary"
          disabled={!canWrite || Boolean(busyAction) || services.length === 0}
          onClick={() => void runSimulation('terminate')}
          className="h-11 justify-center gap-2 text-xs font-medium border-status-destructive/20 hover:border-status-destructive/50 hover:bg-status-destructive/10"
        >
          <XCircle className="h-4 w-4 text-status-destructive" aria-hidden="true" />
          {busyAction === 'terminate' ? t('common.loading') : t('hoster.simulator.simulateTerminate')}
        </Button>

        <Button
          type="button"
          variant="secondary"
          disabled={!canWrite || Boolean(busyAction) || !integration.webhook_url}
          onClick={() => void runSimulation('test_webhook')}
          className="h-11 justify-center gap-2 text-xs font-medium"
        >
          <Send className="h-4 w-4 text-primary" aria-hidden="true" />
          {busyAction === 'test_webhook' ? t('common.loading') : t('hoster.simulator.simulateWebhook')}
        </Button>

        <Button
          type="button"
          variant="destructive"
          disabled={!canWrite || Boolean(busyAction)}
          onClick={() => void cleanSandbox()}
          className="h-11 justify-center gap-2 text-xs font-medium"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          {busyAction === 'clean' ? t('common.loading') : t('hoster.simulator.cleanSandbox')}
        </Button>
      </div>

      {simResult && (
        <div className="rounded-xl border border-outline-variant/40 bg-surface-container-low/60 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-status-success/15 px-2 py-0.5 text-xs font-medium text-status-success border border-status-success/30">
                {simResult.action.toUpperCase()}
              </span>
              <span className="text-sm font-medium text-on-surface">{simResult.message}</span>
            </div>
            {simResult.handoff_url && (
              <a
                href={handoffPath(simResult.handoff_url)}
                target="_blank"
                rel="noopener"
                className={buttonClasses('primary', 'sm', 'font-medium')}
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                {t('hoster.simulator.loginAsCustomer')}
              </a>
            )}
          </div>
          {simResult.service && (
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 pt-1">
              <div>
                <span className="text-on-surface-variant">Service-ID: </span>
                <span className="font-mono text-on-surface">{simResult.service.external_service_id}</span>
              </div>
              <div>
                <span className="text-on-surface-variant">Status: </span>
                <span className="text-on-surface font-semibold">{simResult.service.status}</span>
              </div>
              <div>
                <span className="text-on-surface-variant">Desired State: </span>
                <span className="text-on-surface">{simResult.service.desired_state}</span>
              </div>
              <div>
                <span className="text-on-surface-variant">Server-ID: </span>
                <span className="font-mono text-on-surface">{simResult.service.server_id ?? '—'}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Eingabefeld mit optionaler Erklaerung.
 *
 * Der Hinweis steht als eigene Zeile unter dem Feld und bewusst nicht in einem
 * Tooltip: ein Hover-Hinweis existiert auf Touch-Geraeten nicht und bleibt fuer
 * Screenreader unerreichbar. Weil er im <label> steht, liest der Screenreader
 * ihn zusammen mit der Beschriftung vor.
 */
function Field({
  label,
  value,
  onChange,
  hint,
  className = '',
  ...props
}: {
  label: string
  value: string
  onChange: (value: string) => void
  hint?: string
  className?: string
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <label className={`space-y-1.5 ${className}`}>
      <span className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">{label}</span>
      <input className="msm-input" value={value} onChange={(event) => onChange(event.target.value)} {...props} />
      {hint && <p className="text-xs text-on-surface-variant">{hint}</p>}
    </label>
  )
}
