import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Dropdown,
  Input,
  Spinner,
  Switch,
  Zustandsflaeche,
} from '@maunting/ui'
import { SanitizedApiError, api } from '@/api/client'
import { rbacApi } from '@/api/rbac'
import {
  shopAdminApi,
  type ShopAddon,
  type ShopAddonCategory,
  type ShopAddonWrite,
  type ShopRoleBenefits,
} from '@/api/shop'
import { useHasPermission } from '@/hooks/useHasPermission'
import { still } from '@/lib/still'
import { formatAddonBenefits } from '@/shop/addonBenefits'
import { formatEuro } from '@/shop/preis'
import { confirm } from '@/stores/confirmStore'
import { toast } from '@/stores/toastStore'
import type { Role } from '@/types/permissions'

interface VaultQuotaRow {
  role_id: number
  role_name: string
  quota_bytes: number | null
}

interface AiLimitRow {
  role_id: number
  role_name: string
  configured: boolean
  daily_token_limit: number | null
  weekly_token_limit: number | null
  monthly_token_limit: number | null
  monthly_realtime_minutes_limit: number | null
  monthly_dictation_minutes_limit: number | null
  allow_all_models: boolean
  model_access?: Array<{ allow_all: boolean; allowed_models: string[] }>
}

interface AddonDraft {
  name: string
  slug: string
  description: string
  category: ShopAddonCategory
  priceEuro: string
  taxRate: string
  extraSlots: string
  extraStorageMb: string
  extraBackups: string
  extraAiTokens: string
  roleId: string
  sortOrder: string
  active: boolean
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const LEER: AddonDraft = {
  name: '',
  slug: '',
  description: '',
  category: 'role',
  priceEuro: '4.99',
  taxRate: '19',
  extraSlots: '',
  extraStorageMb: '',
  extraBackups: '',
  extraAiTokens: '',
  roleId: '',
  sortOrder: '0',
  active: true,
}

const KATEGORIE_REIHENFOLGE: ShopAddonCategory[] = [
  'role',
  'ai_quota',
  'storage',
  'slots',
  'backups',
]

function nameZuSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

function zahl(wert: string): number | null {
  const bereinigt = wert.trim().replace(',', '.')
  if (!bereinigt) return null
  const num = Number(bereinigt)
  return Number.isFinite(num) && num >= 0 ? num : null
}

function euroInCent(wert: string): number {
  const num = zahl(wert)
  return num === null ? 0 : Math.round(num * 100)
}

function addonZuDraft(addon: ShopAddon): AddonDraft {
  return {
    name: addon.name,
    slug: addon.slug,
    description: addon.description ?? '',
    category: addon.category,
    priceEuro: (addon.price_cents / 100).toFixed(2),
    taxRate: String(addon.tax_rate_percent),
    extraSlots: addon.extra_slots === null ? '' : String(addon.extra_slots),
    extraStorageMb:
      addon.extra_storage_mb === null ? '' : String(addon.extra_storage_mb),
    extraBackups: addon.extra_backups === null ? '' : String(addon.extra_backups),
    extraAiTokens:
      addon.extra_ai_tokens === null ? '' : String(addon.extra_ai_tokens),
    roleId: addon.role_id === null ? '' : String(addon.role_id),
    sortOrder: String(addon.sort_order),
    active: addon.active,
  }
}

function draftZuPayload(draft: AddonDraft): ShopAddonWrite {
  const intOderNull = (wert: string): number | null => {
    const num = zahl(wert)
    return num === null ? null : Math.round(num)
  }
  const sortNum = Number(draft.sortOrder.trim() || '0')
  return {
    slug: draft.slug.trim(),
    name: draft.name.trim(),
    description: draft.description.trim() || null,
    category: draft.category,
    price_cents: euroInCent(draft.priceEuro),
    currency: 'EUR',
    billing_interval: 'month',
    tax_rate_percent: Math.round(zahl(draft.taxRate) ?? 19),
    extra_slots: draft.category === 'slots' ? intOderNull(draft.extraSlots) : null,
    extra_storage_mb:
      draft.category === 'storage' ? intOderNull(draft.extraStorageMb) : null,
    extra_backups:
      draft.category === 'backups' ? intOderNull(draft.extraBackups) : null,
    extra_ai_tokens:
      draft.category === 'ai_quota' ? intOderNull(draft.extraAiTokens) : null,
    role_id: draft.roleId ? Number(draft.roleId) : null,
    active: draft.active,
    sort_order: Number.isFinite(sortNum) ? Math.round(sortNum) : 0,
  }
}

function pruefeDraft(draft: AddonDraft): string | null {
  if (!draft.name.trim()) return 'name'
  const slug = draft.slug.trim()
  if (slug.length < 2 || !SLUG_RE.test(slug)) return 'slug'
  if (zahl(draft.priceEuro) === null) return 'price'
  const tax = zahl(draft.taxRate)
  if (tax === null || tax < 0 || tax > 100) return 'tax'
  if (draft.category === 'role') {
    return draft.roleId ? null : 'role'
  }
  if (draft.roleId) return null
  if (draft.category === 'ai_quota' && (zahl(draft.extraAiTokens) ?? 0) <= 0) {
    return 'quota'
  }
  if (draft.category === 'slots' && (zahl(draft.extraSlots) ?? 0) <= 0) {
    return 'quota'
  }
  if (draft.category === 'backups' && (zahl(draft.extraBackups) ?? 0) <= 0) {
    return 'quota'
  }
  if (draft.category === 'storage' && (zahl(draft.extraStorageMb) ?? 0) <= 0) {
    return 'quota'
  }
  return null
}

export function ShopAddonsEditor() {
  const { t, i18n } = useTranslation()
  const sprache = i18n.language.startsWith('de') ? 'de' : 'en'
  const canWriteSettings = useHasPermission('panel.settings.write')
  const canWriteShop = useHasPermission('shop.write')
  const canWrite = canWriteSettings || canWriteShop
  const [addons, setAddons] = useState<ShopAddon[] | null>(null)
  const [roles, setRoles] = useState<Role[]>([])
  const [vaultQuotas, setVaultQuotas] = useState<VaultQuotaRow[]>([])
  const [aiLimits, setAiLimits] = useState<AiLimitRow[]>([])
  const [dialogOffen, setDialogOffen] = useState(false)
  const [editing, setEditing] = useState<ShopAddon | null>(null)
  const [draft, setDraft] = useState<AddonDraft>(LEER)
  const [slugManuell, setSlugManuell] = useState(false)
  const [busy, setBusy] = useState(false)

  const laden = () => {
    void shopAdminApi
      .listAddons()
      .then(setAddons)
      .catch((error: unknown) => {
        toast.error(
          error instanceof SanitizedApiError ? error.message : t('settings.shop.addons.fehler'),
        )
        setAddons([])
      })
    void rbacApi
      .listRoles()
      .then(setRoles)
      .catch((err: unknown) => {
        still(err, 'shopAddonsEditor.roles')
        setRoles([])
      })
    void api<VaultQuotaRow[]>('/settings/tresor-speicher')
      .then((rows) => setVaultQuotas(Array.isArray(rows) ? rows : []))
      .catch((err: unknown) => {
        still(err, 'shopAddonsEditor.vaultQuotas')
        setVaultQuotas([])
      })
    void api<AiLimitRow[]>('/ai/settings/role-limits')
      .then((rows) => setAiLimits(Array.isArray(rows) ? rows : []))
      .catch((err: unknown) => {
        still(err, 'shopAddonsEditor.aiLimits')
        setAiLimits([])
      })
  }

  useEffect(() => {
    laden()
  }, [])

  const liveBenefitsByRoleId = useMemo(() => {
    const map = new Map<number, ShopRoleBenefits>()
    const vaultMap = new Map(vaultQuotas.map((row) => [row.role_id, row]))
    const aiMap = new Map(aiLimits.map((row) => [row.role_id, row]))
    for (const role of roles) {
      if (role.is_system) continue
      const vaultRow = vaultMap.get(role.id)
      const aiRow = aiMap.get(role.id)
      let modelCount = 0
      if (aiRow && !aiRow.allow_all_models && Array.isArray(aiRow.model_access)) {
        for (const access of aiRow.model_access) {
          if (!access.allow_all && Array.isArray(access.allowed_models)) {
            modelCount += access.allowed_models.filter((m) => String(m).trim()).length
          } else if (access.allow_all) {
            modelCount += 1
          }
        }
      }
      map.set(role.id, {
        role_name: role.name,
        vault_quota_bytes: vaultRow?.quota_bytes ?? null,
        ai_daily_tokens: aiRow?.daily_token_limit ?? null,
        ai_weekly_tokens: aiRow?.weekly_token_limit ?? null,
        ai_monthly_tokens: aiRow?.monthly_token_limit ?? null,
        ai_realtime_minutes: aiRow?.monthly_realtime_minutes_limit ?? null,
        ai_dictation_minutes: aiRow?.monthly_dictation_minutes_limit ?? null,
        ai_model_count: modelCount,
      })
    }
    return map
  }, [roles, vaultQuotas, aiLimits])

  const kategorieLabel = (category: ShopAddonCategory) => {
    switch (category) {
      case 'ai_quota':
        return t('settings.shop.addons.katAiQuota')
      case 'slots':
        return t('settings.shop.addons.katSlots')
      case 'backups':
        return t('settings.shop.addons.katBackups')
      case 'storage':
        return t('settings.shop.addons.katStorage')
      case 'role':
        return t('settings.shop.addons.katRole')
    }
  }

  const rollenName = (roleId: number | null) => {
    if (roleId === null) return null
    return roles.find((role) => role.id === roleId)?.name ?? `#${roleId}`
  }

  const effektText = (addon: ShopAddon): string => {
    const benefits =
      addon.role_benefits ??
      (addon.role_id !== null ? liveBenefitsByRoleId.get(addon.role_id) ?? null : null)
    const teile = formatAddonBenefits(
      {
        ...addon,
        grants_role: addon.role_id !== null,
        role_benefits: benefits,
      },
      t,
      sprache,
    )
    return teile.join(' · ') || addon.slug
  }

  const oeffneNeu = () => {
    const standardRolle = roles.find((role) => !role.is_system)
    setEditing(null)
    setDraft({
      ...LEER,
      roleId: standardRolle ? String(standardRolle.id) : '',
    })
    setSlugManuell(false)
    setDialogOffen(true)
  }

  const oeffneBearbeiten = (addon: ShopAddon) => {
    setEditing(addon)
    setDraft(addonZuDraft(addon))
    setSlugManuell(true)
    setDialogOffen(true)
  }

  const setzeName = (wert: string) => {
    setDraft((alt) => ({
      ...alt,
      name: wert,
      slug: !slugManuell && !editing ? nameZuSlug(wert) : alt.slug,
    }))
  }

  const setzeSlug = (wert: string) => {
    setSlugManuell(true)
    setDraft((alt) => ({ ...alt, slug: wert.toLowerCase() }))
  }

  const setze = <K extends keyof AddonDraft>(feld: K, wert: AddonDraft[K]) => {
    setDraft((alt) => ({ ...alt, [feld]: wert }))
  }

  const speichern = async () => {
    const problem = pruefeDraft(draft)
    if (problem === 'name') {
      toast.error(t('settings.shop.addons.pflichtfelder'))
      return
    }
    if (problem === 'slug') {
      toast.error(t('settings.shop.addons.slugFehler'))
      return
    }
    if (problem === 'price' || problem === 'tax') {
      toast.error(t('settings.shop.addons.steuerFehler'))
      return
    }
    if (problem === 'quota') {
      toast.error(t('settings.shop.addons.kontingentFehler'))
      return
    }
    if (problem === 'role') {
      toast.error(t('settings.shop.addons.rolleFehler'))
      return
    }
    setBusy(true)
    try {
      const payload = draftZuPayload(draft)
      if (editing) {
        await shopAdminApi.updateAddon(editing.id, payload)
      } else {
        await shopAdminApi.createAddon(payload)
      }
      toast.success(t('settings.shop.addons.gespeichert'))
      setDialogOffen(false)
      laden()
    } catch (error: unknown) {
      toast.error(
        error instanceof SanitizedApiError ? error.message : t('settings.shop.addons.fehler'),
      )
    } finally {
      setBusy(false)
    }
  }

  const loeschen = async (addon: ShopAddon) => {
    if (
      !(await confirm({
        title: t('settings.shop.addons.loeschen'),
        message: t('settings.shop.addons.loeschenFrage', { name: addon.name }),
        danger: true,
      }))
    ) {
      return
    }
    try {
      await shopAdminApi.deleteAddon(addon.id)
      toast.success(t('settings.shop.addons.geloescht'))
      laden()
    } catch (error: unknown) {
      toast.error(
        error instanceof SanitizedApiError ? error.message : t('settings.shop.addons.fehler'),
      )
    }
  }

  const kategorieOptionen = KATEGORIE_REIHENFOLGE.map((kat) => ({
    value: kat,
    label: kategorieLabel(kat),
  }))

  const rollenOptionen = [
    { value: '', label: t('settings.shop.addons.keineRolle') },
    ...roles
      .filter((role) => !role.is_system)
      .map((role) => ({ value: String(role.id), label: role.name })),
  ]
  if (
    draft.roleId &&
    !rollenOptionen.some((option) => option.value === draft.roleId)
  ) {
    rollenOptionen.push({
      value: draft.roleId,
      label: `#${draft.roleId}`,
    })
  }

  const selectedRoleId = draft.roleId ? Number(draft.roleId) : null
  const selectedRoleBenefits =
    selectedRoleId !== null
      ? liveBenefitsByRoleId.get(selectedRoleId) ??
        (editing?.role_id === selectedRoleId ? editing.role_benefits ?? null : null)
      : null
  const selectedBenefitLines = selectedRoleBenefits
    ? formatAddonBenefits(
        { category: 'role', grants_role: true, role_benefits: selectedRoleBenefits },
        t,
        sprache,
      )
    : []

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-headline text-base font-bold text-on-surface">
            {t('settings.shop.addons.titel')}
          </h3>
          <p className="mt-1 text-sm text-on-surface-variant">
            {t('settings.shop.addons.untertitel')}
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          className="gap-2"
          onClick={oeffneNeu}
          disabled={!canWrite}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('settings.shop.addons.neu')}
        </Button>
      </div>

      {addons === null ? (
        <div className="flex items-center gap-3 text-sm text-on-surface-variant">
          <Spinner size="sm" />
          {t('settings.shop.addons.laedt')}
        </div>
      ) : addons.length === 0 ? (
        <Zustandsflaeche
          art="leer"
          titel={t('settings.shop.addons.leer')}
          text={t('settings.shop.addons.leerText')}
        />
      ) : (
        <div className="space-y-2">
          {addons.map((addon) => {
            const rollenLabel = rollenName(addon.role_id)
            return (
              <div
                key={addon.id}
                className="msm-card rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-headline text-sm font-semibold text-on-surface">
                        {addon.name}
                      </h4>
                      <Badge variant={addon.active ? 'success' : 'default'}>
                        {addon.active
                          ? t('settings.shop.addons.aktiv')
                          : t('settings.shop.addons.inaktiv')}
                      </Badge>
                      <Badge variant="info">{kategorieLabel(addon.category)}</Badge>
                      {rollenLabel && <Badge variant="default">{rollenLabel}</Badge>}
                    </div>
                    <p className="mt-1 text-xs text-on-surface-variant">
                      {effektText(addon)} · {formatEuro(addon.price_cents)} /{' '}
                      {t('settings.shop.addons.monat')}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => oeffneBearbeiten(addon)}
                      disabled={!canWrite}
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      {t('settings.shop.addons.bearbeiten')}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => void loeschen(addon)}
                      disabled={!canWrite}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      {t('settings.shop.addons.loeschen')}
                    </Button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Dialog open={dialogOffen} onOpenChange={setDialogOffen}>
        <DialogContent className="max-w-2xl max-h-[90dvh]">
          <DialogHeader>
            <DialogTitle>
              {editing
                ? t('settings.shop.addons.bearbeiten')
                : t('settings.shop.addons.neu')}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 space-y-5 overflow-y-auto p-6">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label={t('settings.shop.addons.name')}
                value={draft.name}
                onChange={(event) => setzeName(event.target.value)}
                maxLength={128}
              />
              <Input
                label={t('settings.shop.addons.slug')}
                value={draft.slug}
                onChange={(event) => setzeSlug(event.target.value)}
                maxLength={64}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="space-y-1.5">
                <span className="block text-sm font-medium text-on-surface">
                  {t('settings.shop.addons.kategorie')}
                </span>
                <Dropdown
                  value={draft.category}
                  onChange={(wert) =>
                    setze('category', wert as ShopAddonCategory)
                  }
                  options={kategorieOptionen}
                  aria-label={t('settings.shop.addons.kategorie')}
                />
              </label>
              <Input
                label={t('settings.shop.addons.preis')}
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={draft.priceEuro}
                onChange={(event) => setze('priceEuro', event.target.value)}
              />
              <Input
                label={t('settings.shop.addons.steuer')}
                type="number"
                min="0"
                max="100"
                inputMode="numeric"
                value={draft.taxRate}
                onChange={(event) => setze('taxRate', event.target.value)}
              />
            </div>

            <div className="space-y-3 rounded-xl border border-outline-variant/30 bg-surface-container/60 p-4">
              <label className="block space-y-1.5">
                <span className="block text-sm font-medium text-on-surface">
                  {t('settings.shop.addons.rolle')}
                </span>
                <Dropdown
                  value={draft.roleId}
                  onChange={(wert) => setze('roleId', wert)}
                  options={rollenOptionen}
                  aria-label={t('settings.shop.addons.rolle')}
                />
              </label>

              {draft.roleId && (
                <div className="space-y-2 rounded-lg border border-outline-variant/25 bg-surface-container-low/70 p-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-on-surface">
                    <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
                    <span>{t('settings.shop.addons.rollenVorschauTitel')}</span>
                  </div>
                  {selectedBenefitLines.length > 0 ? (
                    <ul className="space-y-1 text-xs text-on-surface-variant">
                      {selectedBenefitLines.map((zeile) => (
                        <li key={zeile} className="flex items-center gap-1.5">
                          <Check className="h-3.5 w-3.5 shrink-0 text-status-running" aria-hidden="true" />
                          <span>{zeile}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-on-surface-variant">
                      {t('settings.shop.addons.rollenVorschauLeer')}
                    </p>
                  )}
                  <p className="text-label-sm text-on-surface-variant">
                    {t('settings.shop.addons.rollenHinweis')}
                  </p>
                </div>
              )}

              {draft.category !== 'role' && (
                <div className="pt-1">
                  {draft.category === 'ai_quota' && (
                    <Input
                      label={t('settings.shop.addons.extraAiTokens')}
                      type="number"
                      min="1"
                      inputMode="numeric"
                      value={draft.extraAiTokens}
                      onChange={(event) => setze('extraAiTokens', event.target.value)}
                    />
                  )}
                  {draft.category === 'slots' && (
                    <Input
                      label={t('settings.shop.addons.extraSlots')}
                      type="number"
                      min="1"
                      inputMode="numeric"
                      value={draft.extraSlots}
                      onChange={(event) => setze('extraSlots', event.target.value)}
                    />
                  )}
                  {draft.category === 'backups' && (
                    <Input
                      label={t('settings.shop.addons.extraBackups')}
                      type="number"
                      min="1"
                      inputMode="numeric"
                      value={draft.extraBackups}
                      onChange={(event) => setze('extraBackups', event.target.value)}
                    />
                  )}
                  {draft.category === 'storage' && (
                    <Input
                      label={t('settings.shop.addons.extraStorageMb')}
                      type="number"
                      min="1"
                      inputMode="numeric"
                      value={draft.extraStorageMb}
                      onChange={(event) => setze('extraStorageMb', event.target.value)}
                    />
                  )}
                </div>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label={t('settings.shop.addons.beschreibung')}
                value={draft.description}
                onChange={(event) => setze('description', event.target.value)}
                maxLength={500}
              />
              <Input
                label={t('settings.shop.addons.sortierung')}
                type="number"
                inputMode="numeric"
                value={draft.sortOrder}
                onChange={(event) => setze('sortOrder', event.target.value)}
              />
            </div>

            <label className="flex items-center justify-between gap-4 rounded-xl border border-outline-variant/30 bg-surface-container p-3">
              <span className="text-sm font-medium text-on-surface">
                {t('settings.shop.addons.aktiv')}
              </span>
              <Switch
                checked={draft.active}
                onCheckedChange={(wert) => setze('active', wert)}
                aria-label={t('settings.shop.addons.aktiv')}
              />
            </label>
          </div>

          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setDialogOffen(false)}
              disabled={busy}
            >
              {t('settings.shop.addons.abbrechen')}
            </Button>
            <Button
              variant="primary"
              onClick={() => void speichern()}
              disabled={busy || !canWrite}
            >
              {t('settings.shop.addons.speichern')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
