import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil, Plus, RefreshCw, TicketPercent, Trash2 } from 'lucide-react'
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
import {
  shopAdminApi,
  type ShopCoupon,
  type ShopCouponDiscountType,
  type ShopCouponScope,
  type ShopCouponWrite,
  type ShopPlan,
} from '@/api/shop'
import { useHasPermission } from '@/hooks/useHasPermission'
import { formatEuro } from '@/shop/preis'
import { confirm } from '@/stores/confirmStore'
import { toast } from '@/stores/toastStore'

interface CouponDraft {
  code: string
  name: string
  promoText: string
  discountType: ShopCouponDiscountType
  discountValue: string
  scope: ShopCouponScope
  targetPlanIds: number[]
  minGrossEuro: string
  maxRedemptions: string
  bannerCooldownHours: string
  validFrom: string
  validUntil: string
  showBadge: boolean
  showBanner: boolean
  active: boolean
}

const CODE_RE = /^[A-Z0-9_-]{3,48}$/

const LEER: CouponDraft = {
  code: '',
  name: '',
  promoText: '',
  discountType: 'percent',
  discountValue: '10',
  scope: 'all',
  targetPlanIds: [],
  minGrossEuro: '0',
  maxRedemptions: '',
  bannerCooldownHours: '6',
  validFrom: '',
  validUntil: '',
  showBadge: true,
  showBanner: false,
  active: true,
}

function zahl(wert: string): number | null {
  const bereinigt = wert.trim().replace(',', '.')
  if (!bereinigt) return null
  const num = Number(bereinigt)
  return Number.isFinite(num) && num >= 0 ? num : null
}

function isoZuLokal(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function lokalZuIso(wert: string): string | null {
  const sauber = wert.trim()
  if (!sauber) return null
  const d = new Date(sauber)
  return Number.isFinite(d.getTime()) ? d.toISOString() : null
}

function couponZuDraft(row: ShopCoupon): CouponDraft {
  return {
    code: row.code,
    name: row.name,
    promoText: row.promo_text ?? '',
    discountType: row.discount_type,
    discountValue:
      row.discount_type === 'percent'
        ? String(row.discount_value)
        : (row.discount_value / 100).toFixed(2),
    scope: row.scope,
    targetPlanIds: row.target_plan_ids,
    minGrossEuro: (row.min_gross_cents / 100).toFixed(2),
    maxRedemptions: row.max_redemptions === null ? '' : String(row.max_redemptions),
    bannerCooldownHours: String(row.banner_cooldown_hours),
    validFrom: isoZuLokal(row.valid_from),
    validUntil: isoZuLokal(row.valid_until),
    showBadge: row.show_badge,
    showBanner: row.show_banner,
    active: row.active,
  }
}

function draftZuPayload(draft: CouponDraft): ShopCouponWrite {
  const wertNum = zahl(draft.discountValue) ?? 0
  const maxNum = zahl(draft.maxRedemptions)
  const cooldownNum = zahl(draft.bannerCooldownHours) ?? 6
  return {
    code: draft.code.trim().toUpperCase(),
    name: draft.name.trim(),
    promo_text: draft.promoText.trim() || null,
    discount_type: draft.discountType,
    discount_value:
      draft.discountType === 'percent' ? Math.round(wertNum) : Math.round(wertNum * 100),
    currency: 'EUR',
    scope: draft.scope,
    target_plan_ids: draft.scope === 'plans' ? draft.targetPlanIds : [],
    min_gross_cents: Math.round((zahl(draft.minGrossEuro) ?? 0) * 100),
    max_redemptions: maxNum !== null && maxNum >= 1 ? Math.round(maxNum) : null,
    valid_from: lokalZuIso(draft.validFrom),
    valid_until: lokalZuIso(draft.validUntil),
    show_badge: draft.showBadge,
    show_banner: draft.showBanner,
    banner_cooldown_hours: Math.round(cooldownNum),
    active: draft.active,
  }
}

function pruefeDraft(draft: CouponDraft): string | null {
  const code = draft.code.trim().toUpperCase()
  if (!CODE_RE.test(code)) return 'code'
  if (!draft.name.trim()) return 'name'
  const val = zahl(draft.discountValue)
  if (val === null || val <= 0) return 'wert'
  if (draft.discountType === 'percent' && (val < 1 || val > 99)) return 'wert'
  return null
}

export function ShopCouponsEditor() {
  const { t } = useTranslation()
  const canWriteSettings = useHasPermission('panel.settings.write')
  const canWriteShop = useHasPermission('shop.write')
  const canWrite = canWriteSettings || canWriteShop

  const [coupons, setCoupons] = useState<ShopCoupon[] | null>(null)
  const [plans, setPlans] = useState<ShopPlan[]>([])
  const [dialogOffen, setDialogOffen] = useState(false)
  const [editing, setEditing] = useState<ShopCoupon | null>(null)
  const [draft, setDraft] = useState<CouponDraft>(LEER)
  const [busy, setBusy] = useState(false)
  const [syncingId, setSyncingId] = useState<number | null>(null)

  const laden = () => {
    void shopAdminApi
      .listCoupons()
      .then(setCoupons)
      .catch((error: unknown) => {
        toast.error(
          error instanceof Error ? error.message : t('settings.shop.coupons.fehler'),
        )
        setCoupons([])
      })
    void shopAdminApi
      .listPlans()
      .then(setPlans)
      .catch(() => setPlans([]))
  }

  useEffect(() => {
    laden()
  }, [])

  const rabattLabel = (row: ShopCoupon) =>
    row.discount_type === 'percent'
      ? `-${row.discount_value} %`
      : `-${formatEuro(row.discount_value)}`

  const bereichLabel = (scope: ShopCouponScope) => {
    if (scope === 'plans') return t('settings.shop.coupons.bereichTarife')
    if (scope === 'addons') return t('settings.shop.coupons.bereichAddons')
    return t('settings.shop.coupons.bereichAlle')
  }

  const oeffneNeu = () => {
    setEditing(null)
    setDraft(LEER)
    setDialogOffen(true)
  }

  const oeffneBearbeiten = (row: ShopCoupon) => {
    setEditing(row)
    setDraft(couponZuDraft(row))
    setDialogOffen(true)
  }

  const setze = <K extends keyof CouponDraft>(feld: K, wert: CouponDraft[K]) => {
    setDraft((alt) => ({ ...alt, [feld]: wert }))
  }

  const toggleZielTarif = (planId: number) => {
    setDraft((alt) => ({
      ...alt,
      targetPlanIds: alt.targetPlanIds.includes(planId)
        ? alt.targetPlanIds.filter((id) => id !== planId)
        : [...alt.targetPlanIds, planId],
    }))
  }

  const speichern = async () => {
    const problem = pruefeDraft(draft)
    if (problem === 'code') {
      toast.error(t('settings.shop.coupons.codeFehler'))
      return
    }
    if (problem === 'name' || problem === 'wert') {
      toast.error(t('settings.shop.coupons.wertFehler'))
      return
    }
    if (draft.validFrom && draft.validUntil && new Date(draft.validUntil) <= new Date(draft.validFrom)) {
      toast.error(t('settings.shop.coupons.zeitraumFehler'))
      return
    }
    setBusy(true)
    try {
      const payload = draftZuPayload(draft)
      if (editing) {
        await shopAdminApi.updateCoupon(editing.id, payload)
      } else {
        await shopAdminApi.createCoupon(payload)
      }
      toast.success(t('settings.shop.coupons.gespeichert'))
      setDialogOffen(false)
      laden()
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : t('settings.shop.coupons.fehler'),
      )
    } finally {
      setBusy(false)
    }
  }

  const loeschen = async (row: ShopCoupon) => {
    if (
      !(await confirm({
        title: t('settings.shop.coupons.loeschen'),
        message: t('settings.shop.coupons.loeschenFrage', { code: row.code }),
        danger: true,
      }))
    ) {
      return
    }
    try {
      await shopAdminApi.deleteCoupon(row.id)
      toast.success(t('settings.shop.coupons.geloescht'))
      laden()
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : t('settings.shop.coupons.fehler'),
      )
    }
  }

  const stripeSync = async (row: ShopCoupon) => {
    setSyncingId(row.id)
    try {
      await shopAdminApi.syncCouponStripe(row.id)
      toast.success(t('settings.shop.coupons.stripeErfolg'))
      laden()
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : t('settings.shop.coupons.stripeFehler'),
      )
    } finally {
      setSyncingId(null)
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-headline text-base font-bold text-on-surface">
            {t('settings.shop.coupons.titel')}
          </h3>
          <p className="mt-1 text-sm text-on-surface-variant">
            {t('settings.shop.coupons.untertitel')}
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
          {t('settings.shop.coupons.neu')}
        </Button>
      </div>

      {coupons === null ? (
        <div className="flex items-center gap-3 text-sm text-on-surface-variant">
          <Spinner size="sm" />
          {t('settings.shop.coupons.laedt')}
        </div>
      ) : coupons.length === 0 ? (
        <Zustandsflaeche
          art="leer"
          titel={t('settings.shop.coupons.leer')}
          text={t('settings.shop.coupons.leerText')}
        />
      ) : (
        <div className="space-y-2">
          {coupons.map((row) => (
            <div
              key={row.id}
              className="msm-card rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-lg bg-primary/15 px-2 py-0.5 font-mono text-xs font-bold text-primary">
                      <TicketPercent className="h-3.5 w-3.5" aria-hidden="true" />
                      {row.code}
                    </span>
                    <h4 className="font-headline text-sm font-semibold text-on-surface">
                      {row.name}
                    </h4>
                    <Badge variant={row.active ? 'success' : 'default'}>
                      {row.active
                        ? t('settings.shop.coupons.aktiv')
                        : t('settings.shop.coupons.inaktiv')}
                    </Badge>
                    <Badge variant="info">{rabattLabel(row)}</Badge>
                    {row.show_banner && (
                      <Badge variant="warning">Banner</Badge>
                    )}
                    {row.stripe_promotion_code_id && (
                      <Badge variant="success">
                        {t('settings.shop.coupons.stripeVerbunden')}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-on-surface-variant">
                    {bereichLabel(row.scope)} ·{' '}
                    {row.max_redemptions
                      ? t('settings.shop.coupons.einloesungenBegrenzt', {
                          count: row.redemption_count,
                          max: row.max_redemptions,
                        })
                      : t('settings.shop.coupons.einloesungen', {
                          count: row.redemption_count,
                        })}
                    {row.promo_text ? ` · ${row.promo_text}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => void stripeSync(row)}
                    disabled={!canWrite || syncingId === row.id}
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('settings.shop.coupons.stripeSync')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => oeffneBearbeiten(row)}
                    disabled={!canWrite}
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('settings.shop.coupons.bearbeiten')}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => void loeschen(row)}
                    disabled={!canWrite}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('settings.shop.coupons.loeschen')}
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOffen} onOpenChange={setDialogOffen}>
        <DialogContent className="max-w-2xl max-h-[90dvh]">
          <DialogHeader>
            <DialogTitle>
              {editing
                ? t('settings.shop.coupons.bearbeiten')
                : t('settings.shop.coupons.neu')}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 space-y-5 overflow-y-auto p-6">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label={t('settings.shop.coupons.code')}
                value={draft.code}
                onChange={(event) => setze('code', event.target.value.toUpperCase())}
                maxLength={48}
              />
              <Input
                label={t('settings.shop.coupons.name')}
                value={draft.name}
                onChange={(event) => setze('name', event.target.value)}
                maxLength={128}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="space-y-1.5">
                <span className="block text-sm font-medium text-on-surface">
                  {t('settings.shop.coupons.rabattTyp')}
                </span>
                <Dropdown
                  value={draft.discountType}
                  onChange={(wert) =>
                    setze('discountType', wert as ShopCouponDiscountType)
                  }
                  options={[
                    { value: 'percent', label: t('settings.shop.coupons.typProzent') },
                    { value: 'fixed_cents', label: t('settings.shop.coupons.typFest') },
                  ]}
                  aria-label={t('settings.shop.coupons.rabattTyp')}
                />
              </label>
              <Input
                label={
                  draft.discountType === 'percent'
                    ? t('settings.shop.coupons.rabattWertProzent')
                    : t('settings.shop.coupons.rabattWertEuro')
                }
                type="number"
                min="1"
                step={draft.discountType === 'percent' ? '1' : '0.01'}
                inputMode="decimal"
                value={draft.discountValue}
                onChange={(event) => setze('discountValue', event.target.value)}
              />
              <label className="space-y-1.5">
                <span className="block text-sm font-medium text-on-surface">
                  {t('settings.shop.coupons.bereich')}
                </span>
                <Dropdown
                  value={draft.scope}
                  onChange={(wert) => setze('scope', wert as ShopCouponScope)}
                  options={[
                    { value: 'all', label: t('settings.shop.coupons.bereichAlle') },
                    { value: 'plans', label: t('settings.shop.coupons.bereichTarife') },
                    { value: 'addons', label: t('settings.shop.coupons.bereichAddons') },
                  ]}
                  aria-label={t('settings.shop.coupons.bereich')}
                />
              </label>
            </div>

            {draft.scope === 'plans' && plans.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {plans.map((plan) => {
                  const aktiv = draft.targetPlanIds.includes(plan.id)
                  return (
                    <Button
                      key={plan.id}
                      type="button"
                      size="sm"
                      variant={aktiv ? 'primary' : 'secondary'}
                      onClick={() => toggleZielTarif(plan.id)}
                    >
                      {plan.name}
                    </Button>
                  )
                })}
              </div>
            )}

            <div className="space-y-3 rounded-xl border border-outline-variant/30 bg-surface-container/60 p-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <Input
                  label={t('settings.shop.coupons.mindestbetrag')}
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={draft.minGrossEuro}
                  onChange={(event) => setze('minGrossEuro', event.target.value)}
                />
                <Input
                  label={t('settings.shop.coupons.maxEinloesungen')}
                  type="number"
                  min="1"
                  inputMode="numeric"
                  value={draft.maxRedemptions}
                  onChange={(event) => setze('maxRedemptions', event.target.value)}
                />
                <Input
                  label={t('settings.shop.coupons.cooldown')}
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={draft.bannerCooldownHours}
                  onChange={(event) => setze('bannerCooldownHours', event.target.value)}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label={t('settings.shop.coupons.gueltigAb')}
                  type="datetime-local"
                  value={draft.validFrom}
                  onChange={(event) => setze('validFrom', event.target.value)}
                />
                <Input
                  label={t('settings.shop.coupons.gueltigBis')}
                  type="datetime-local"
                  value={draft.validUntil}
                  onChange={(event) => setze('validUntil', event.target.value)}
                />
              </div>
            </div>

            <Input
              label={t('settings.shop.coupons.promoText')}
              value={draft.promoText}
              onChange={(event) => setze('promoText', event.target.value)}
              maxLength={240}
            />

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="flex items-center justify-between gap-3 rounded-xl border border-outline-variant/30 bg-surface-container p-3">
                <span className="text-sm font-medium text-on-surface">
                  {t('settings.shop.coupons.badgeAnzeigen')}
                </span>
                <Switch
                  checked={draft.showBadge}
                  onCheckedChange={(wert) => setze('showBadge', wert)}
                  aria-label={t('settings.shop.coupons.badgeAnzeigen')}
                />
              </label>
              <label className="flex items-center justify-between gap-3 rounded-xl border border-outline-variant/30 bg-surface-container p-3">
                <span className="text-sm font-medium text-on-surface">
                  {t('settings.shop.coupons.bannerAnzeigen')}
                </span>
                <Switch
                  checked={draft.showBanner}
                  onCheckedChange={(wert) => setze('showBanner', wert)}
                  aria-label={t('settings.shop.coupons.bannerAnzeigen')}
                />
              </label>
              <label className="flex items-center justify-between gap-3 rounded-xl border border-outline-variant/30 bg-surface-container p-3">
                <span className="text-sm font-medium text-on-surface">
                  {t('settings.shop.coupons.aktiv')}
                </span>
                <Switch
                  checked={draft.active}
                  onCheckedChange={(wert) => setze('active', wert)}
                  aria-label={t('settings.shop.coupons.aktiv')}
                />
              </label>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setDialogOffen(false)}
              disabled={busy}
            >
              {t('settings.shop.coupons.abbrechen')}
            </Button>
            <Button
              variant="primary"
              onClick={() => void speichern()}
              disabled={busy || !canWrite}
            >
              {t('settings.shop.coupons.speichern')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
