import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock } from 'lucide-react'
import { Button, Dropdown, Input, Spinner, Switch } from '@maunting/ui'
import { SanitizedApiError } from '@/api/client'
import {
  shopAdminOpsApi,
  type ShopHeroMode,
  type ShopLifecycleSettingsDto,
  type ShopShortDurationTierDto,
} from '@/api/shop'
import { still } from '@/lib/still'
import { toast } from '@/stores/toastStore'

const DEFAULT_SHORT_DURATION_TIERS: ShopShortDurationTierDto[] = [
  { days: 3, enabled: true, price_factor_percent: 25, min_price_cents: 199 },
  { days: 7, enabled: true, price_factor_percent: 40, min_price_cents: 299 },
  { days: 14, enabled: true, price_factor_percent: 65, min_price_cents: 499 },
]

const DEFAULT_SETTINGS: ShopLifecycleSettingsDto = {
  cancel_grace_days: 7,
  unpaid_auto_delete_enabled: true,
  unpaid_delete_days: 30,
  allow_customer_immediate_delete: true,
  dunning_reminder_days: [7, 4, 1],
  subscription_discount_percent: 0,
  refund_guarantee_days: 0,
  refund_policy_note: '',
  auto_subdomain_enabled: false,
  auto_subdomain_zone: '',
  pause_freeze_max_days_per_90d: 0,
  shop_checkout_captcha_enabled: false,
  shop_allow_overbooking: false,
  shop_trustpilot_enabled: false,
  shop_trustpilot_url: '',
  shop_discord_invite_url: '',
  shop_hero_mode: 'auto_paid',
  shop_short_durations_enabled: false,
  shop_short_duration_tiers: DEFAULT_SHORT_DURATION_TIERS,
  shop_game_switch_cooldown_hours: 24,
  shop_game_switch_max_per_30d: 4,
  shop_game_switch_allow_higher_price_plan: false,
}

function parseReminderList(raw: string): number[] {
  const seen = new Set<number>()
  for (const part of raw.split(/[\s,;]+/)) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const num = Number(trimmed)
    if (Number.isInteger(num) && num >= 1 && num <= 365) {
      seen.add(num)
    }
  }
  return Array.from(seen).sort((a, b) => b - a).slice(0, 10)
}

export function ShopLifecycleKarte({ flat = false }: { flat?: boolean } = {}) {
  const { t } = useTranslation()
  const [daten, setDaten] = useState<ShopLifecycleSettingsDto>(DEFAULT_SETTINGS)
  const [reminderInput, setReminderInput] = useState('7, 4, 1')
  const [laedt, setLaedt] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let aktiv = true
    void shopAdminOpsApi
      .getLifecycleSettings()
      .then((werte) => {
        if (!aktiv) return
        if (werte && typeof werte.cancel_grace_days === 'number') {
          setDaten({ ...DEFAULT_SETTINGS, ...werte })
          setReminderInput((werte.dunning_reminder_days ?? []).join(', '))
        }
        setLaedt(false)
      })
      .catch((err: unknown) => {
        still(err, 'shopLifecycle.load')
        if (aktiv) setLaedt(false)
      })
    return () => {
      aktiv = false
    }
  }, [])

  const speichern = async () => {
    if (busy) return
    setBusy(true)
    const payload: ShopLifecycleSettingsDto = {
      ...daten,
      dunning_reminder_days: parseReminderList(reminderInput),
    }
    try {
      const gespeichert = await shopAdminOpsApi.updateLifecycleSettings(payload)
      setDaten(gespeichert)
      setReminderInput((gespeichert.dunning_reminder_days ?? []).join(', '))
      toast.success(t('settings.shop.lifecycle.gespeichert'))
    } catch (error) {
      toast.error(
        error instanceof SanitizedApiError
          ? error.message
          : t('settings.shop.lifecycle.fehler'),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className={
        flat
          ? 'space-y-4'
          : 'msm-card rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 p-5'
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/15 text-primary">
            <Clock className="h-4 w-4" aria-hidden="true" />
          </span>
          <h3 className="font-headline text-base font-semibold text-on-surface">
            {t('settings.shop.lifecycle.titel')}
          </h3>
        </div>
        {laedt && <Spinner size="sm" />}
      </div>

      <p className="mt-3 text-sm leading-relaxed text-on-surface-variant">
        {t('settings.shop.lifecycle.text')}
      </p>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <label className="block space-y-1.5">
            <span className="block text-sm font-semibold text-on-surface">
              {t('settings.shop.lifecycle.cancelGraceDays')}
            </span>
            <Input
              type="number"
              min={0}
              max={365}
              value={String(daten.cancel_grace_days)}
              onChange={(e) =>
                setDaten((alt) => ({
                  ...alt,
                  cancel_grace_days: Math.max(0, Math.min(365, Number(e.target.value) || 0)),
                }))
              }
            />
          </label>
          <p className="text-xs text-on-surface-variant">
            {t('settings.shop.lifecycle.cancelGraceDaysHint')}
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="block space-y-1.5">
            <span className="block text-sm font-semibold text-on-surface">
              {t('settings.shop.lifecycle.unpaidDeleteDays')}
            </span>
            <Input
              type="number"
              min={1}
              max={365}
              disabled={!daten.unpaid_auto_delete_enabled}
              value={String(daten.unpaid_delete_days)}
              onChange={(e) =>
                setDaten((alt) => ({
                  ...alt,
                  unpaid_delete_days: Math.max(1, Math.min(365, Number(e.target.value) || 1)),
                }))
              }
            />
          </label>
          <p className="text-xs text-on-surface-variant">
            {t('settings.shop.lifecycle.unpaidDeleteDaysHint')}
          </p>
        </div>

        <div className="space-y-1.5 md:col-span-2">
          <label className="block space-y-1.5">
            <span className="block text-sm font-semibold text-on-surface">
              {t('settings.shop.lifecycle.dunningReminderDays')}
            </span>
            <Input
              value={reminderInput}
              onChange={(e) => setReminderInput(e.target.value)}
              placeholder="7, 4, 1"
            />
          </label>
          <p className="text-xs text-on-surface-variant">
            {t('settings.shop.lifecycle.dunningReminderDaysHint')}
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <div className="flex items-start gap-3">
          <Switch
            checked={daten.unpaid_auto_delete_enabled}
            onCheckedChange={(checked) =>
              setDaten((alt) => ({ ...alt, unpaid_auto_delete_enabled: checked }))
            }
            aria-label={t('settings.shop.lifecycle.unpaidAutoDelete')}
          />
          <div>
            <span className="block text-sm font-medium text-on-surface">
              {t('settings.shop.lifecycle.unpaidAutoDelete')}
            </span>
            <p className="text-xs text-on-surface-variant">
              {t('settings.shop.lifecycle.unpaidAutoDeleteHint')}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <Switch
            checked={daten.allow_customer_immediate_delete}
            onCheckedChange={(checked) =>
              setDaten((alt) => ({ ...alt, allow_customer_immediate_delete: checked }))
            }
            aria-label={t('settings.shop.lifecycle.allowCustomerImmediateDelete')}
          />
          <div>
            <span className="block text-sm font-medium text-on-surface">
              {t('settings.shop.lifecycle.allowCustomerImmediateDelete')}
            </span>
            <p className="text-xs text-on-surface-variant">
              {t('settings.shop.lifecycle.allowCustomerImmediateDeleteHint')}
            </p>
          </div>
        </div>

        <div className="grid gap-4 pt-2 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="block space-y-1.5">
              <span className="block text-sm font-semibold text-on-surface">
                {t('settings.shop.lifecycle.subscriptionDiscountPercent')}
              </span>
              <Input
                type="number"
                min={0}
                max={50}
                value={String(daten.subscription_discount_percent ?? 0)}
                onChange={(e) =>
                  setDaten((alt) => ({
                    ...alt,
                    subscription_discount_percent: Math.max(0, Math.min(50, Number(e.target.value) || 0)),
                  }))
                }
              />
            </label>
            <p className="text-xs text-on-surface-variant">
              {t('settings.shop.lifecycle.subscriptionDiscountPercentHint')}
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="block space-y-1.5">
              <span className="block text-sm font-semibold text-on-surface">
                {t('settings.shop.lifecycle.refundGuaranteeDays')}
              </span>
              <Input
                type="number"
                min={0}
                max={30}
                value={String(daten.refund_guarantee_days ?? 0)}
                onChange={(e) =>
                  setDaten((alt) => ({
                    ...alt,
                    refund_guarantee_days: Math.max(0, Math.min(30, Number(e.target.value) || 0)),
                  }))
                }
              />
            </label>
            <p className="text-xs text-on-surface-variant">
              {t('settings.shop.lifecycle.refundGuaranteeDaysHint')}
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="block space-y-1.5">
            <span className="block text-sm font-semibold text-on-surface">
              {t('settings.shop.lifecycle.refundPolicyNote')}
            </span>
            <Input
              value={daten.refund_policy_note ?? ''}
              maxLength={300}
              onChange={(e) =>
                setDaten((alt) => ({ ...alt, refund_policy_note: e.target.value }))
              }
            />
          </label>
          <p className="text-xs text-on-surface-variant">
            {t('settings.shop.lifecycle.refundPolicyNoteHint')}
          </p>
        </div>

        <div className="flex items-start gap-3">
          <Switch
            checked={Boolean(daten.auto_subdomain_enabled)}
            onCheckedChange={(checked) =>
              setDaten((alt) => ({ ...alt, auto_subdomain_enabled: checked }))
            }
            aria-label={t('settings.shop.lifecycle.autoSubdomainEnabled')}
          />
          <div className="flex-1 space-y-2">
            <div>
              <span className="block text-sm font-medium text-on-surface">
                {t('settings.shop.lifecycle.autoSubdomainEnabled')}
              </span>
              <p className="text-xs text-on-surface-variant">
                {t('settings.shop.lifecycle.autoSubdomainEnabledHint')}
              </p>
            </div>
            {daten.auto_subdomain_enabled && (
              <div className="space-y-1.5">
                <label className="block space-y-1.5">
                  <span className="block text-sm font-semibold text-on-surface">
                    {t('settings.shop.lifecycle.autoSubdomainZone')}
                  </span>
                  <Input
                    value={daten.auto_subdomain_zone ?? ''}
                    maxLength={120}
                    placeholder="play.deinedomain.gg"
                    onChange={(e) =>
                      setDaten((alt) => ({ ...alt, auto_subdomain_zone: e.target.value }))
                    }
                  />
                </label>
                <p className="text-xs text-on-surface-variant">
                  {t('settings.shop.lifecycle.autoSubdomainZoneHint')}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="block space-y-1.5">
            <span className="block text-sm font-semibold text-on-surface">
              {t('settings.shop.lifecycle.pauseFreezeDays')}
            </span>
            <Input
              type="number"
              min={0}
              max={90}
              value={daten.pause_freeze_max_days_per_90d ?? 0}
              onChange={(e) => {
                const n = Number(e.target.value)
                setDaten((alt) => ({
                  ...alt,
                  pause_freeze_max_days_per_90d: Number.isFinite(n) ? Math.max(0, Math.min(90, n)) : 0,
                }))
              }}
            />
          </label>
          <p className="text-xs text-on-surface-variant">
            {t('settings.shop.lifecycle.pauseFreezeDaysHint')}
          </p>
        </div>

        <div className="flex items-start gap-3">
          <Switch
            checked={Boolean(daten.shop_checkout_captcha_enabled)}
            onCheckedChange={(checked) =>
              setDaten((alt) => ({ ...alt, shop_checkout_captcha_enabled: checked }))
            }
            aria-label={t('settings.shop.lifecycle.checkoutCaptchaEnabled')}
          />
          <div className="flex-1">
            <span className="block text-sm font-medium text-on-surface">
              {t('settings.shop.lifecycle.checkoutCaptchaEnabled')}
            </span>
            <p className="text-xs text-on-surface-variant">
              {t('settings.shop.lifecycle.checkoutCaptchaEnabledHint')}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <Switch
            checked={Boolean(daten.shop_allow_overbooking)}
            onCheckedChange={(checked) =>
              setDaten((alt) => ({ ...alt, shop_allow_overbooking: checked }))
            }
            aria-label={t('settings.shop.lifecycle.allowOverbooking')}
          />
          <div className="flex-1">
            <span className="block text-sm font-medium text-on-surface">
              {t('settings.shop.lifecycle.allowOverbooking')}
            </span>
            <p className="text-xs text-on-surface-variant">
              {t('settings.shop.lifecycle.allowOverbookingHint')}
            </p>
          </div>
        </div>

        <div className="space-y-4 rounded-xl border border-outline-variant/30 bg-surface-container p-4">
          <div>
            <h4 className="font-headline text-sm font-bold text-on-surface">
              {t('settings.shop.lifecycle.trustSectionTitle')}
            </h4>
            <p className="mt-0.5 text-xs text-on-surface-variant">
              {t('settings.shop.lifecycle.trustSectionHint')}
            </p>
          </div>

          <div className="flex items-start gap-3">
            <Switch
              checked={Boolean(daten.shop_trustpilot_enabled)}
              onCheckedChange={(checked) =>
                setDaten((alt) => ({ ...alt, shop_trustpilot_enabled: checked }))
              }
              aria-label={t('settings.shop.lifecycle.trustpilotEnabled')}
            />
            <div className="flex-1 space-y-2">
              <div>
                <span className="block text-sm font-medium text-on-surface">
                  {t('settings.shop.lifecycle.trustpilotEnabled')}
                </span>
                <p className="text-xs text-on-surface-variant">
                  {t('settings.shop.lifecycle.trustpilotEnabledHint')}
                </p>
              </div>
              {daten.shop_trustpilot_enabled && (
                <div className="space-y-1.5">
                  <label className="block space-y-1.5">
                    <span className="block text-sm font-semibold text-on-surface">
                      {t('settings.shop.lifecycle.trustpilotUrl')}
                    </span>
                    <Input
                      type="url"
                      value={daten.shop_trustpilot_url ?? ''}
                      maxLength={512}
                      placeholder="https://www.trustpilot.com/review/deinedomain.de"
                      onChange={(e) =>
                        setDaten((alt) => ({ ...alt, shop_trustpilot_url: e.target.value }))
                      }
                    />
                  </label>
                  <p className="text-xs text-on-surface-variant">
                    {t('settings.shop.lifecycle.trustpilotUrlHint')}
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block space-y-1.5">
              <span className="block text-sm font-semibold text-on-surface">
                {t('settings.shop.lifecycle.heroMode')}
              </span>
              <Dropdown
                value={daten.shop_hero_mode ?? 'auto_paid'}
                onChange={(val) =>
                  setDaten((alt) => ({ ...alt, shop_hero_mode: val as ShopHeroMode }))
                }
                options={[
                  {
                    value: 'auto_paid',
                    label: t('settings.shop.lifecycle.heroModeAutoPaid'),
                  },
                  {
                    value: 'manual',
                    label: t('settings.shop.lifecycle.heroModeManual'),
                  },
                ]}
                aria-label={t('settings.shop.lifecycle.heroMode')}
              />
            </label>
            <p className="text-xs text-on-surface-variant">
              {t('settings.shop.lifecycle.heroModeHint')}
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="block space-y-1.5">
              <span className="block text-sm font-semibold text-on-surface">
                {t('settings.shop.lifecycle.discordInviteUrl')}
              </span>
              <Input
                type="url"
                value={daten.shop_discord_invite_url ?? ''}
                maxLength={512}
                placeholder="https://discord.gg/deinserver"
                onChange={(e) =>
                  setDaten((alt) => ({ ...alt, shop_discord_invite_url: e.target.value }))
                }
              />
            </label>
            <p className="text-xs text-on-surface-variant">
              {t('settings.shop.lifecycle.discordInviteUrlHint')}
            </p>
          </div>
        </div>

        <div className="space-y-4 rounded-xl border border-outline-variant/30 bg-surface-container p-4">
          <div className="flex items-start gap-3">
            <Switch
              checked={Boolean(daten.shop_short_durations_enabled)}
              onCheckedChange={(checked) =>
                setDaten((alt) => ({ ...alt, shop_short_durations_enabled: checked }))
              }
              aria-label={t('settings.shop.lifecycle.shortDurationsEnabled')}
            />
            <div className="flex-1">
              <span className="block text-sm font-medium text-on-surface">
                {t('settings.shop.lifecycle.shortDurationsEnabled')}
              </span>
              <p className="text-xs text-on-surface-variant">
                {t('settings.shop.lifecycle.shortDurationsEnabledHint')}
              </p>
            </div>
          </div>

          {daten.shop_short_durations_enabled && (
            <div className="space-y-3 border-t border-outline-variant/25 pt-3">
              {(daten.shop_short_duration_tiers ?? DEFAULT_SHORT_DURATION_TIERS).map((tier) => {
                const updateTier = (patch: Partial<ShopShortDurationTierDto>) => {
                  setDaten((alt) => ({
                    ...alt,
                    shop_short_duration_tiers: (
                      alt.shop_short_duration_tiers ?? DEFAULT_SHORT_DURATION_TIERS
                    ).map((row) => (row.days === tier.days ? { ...row, ...patch } : row)),
                  }))
                }
                return (
                  <div
                    key={tier.days}
                    className="grid items-end gap-3 rounded-xl border border-outline-variant/25 bg-surface-container-low/70 p-3 sm:grid-cols-[auto_1fr_1fr]"
                  >
                    <label className="flex items-center gap-2.5 self-center">
                      <Switch
                        checked={tier.enabled}
                        onCheckedChange={(checked) => updateTier({ enabled: checked })}
                        aria-label={t('settings.shop.lifecycle.shortDurationDayLabel', {
                          days: tier.days,
                        })}
                      />
                      <span className="min-w-[4.5rem] text-sm font-semibold text-on-surface">
                        {t('settings.shop.lifecycle.shortDurationDayLabel', { days: tier.days })}
                      </span>
                    </label>
                    <Input
                      type="number"
                      min={5}
                      max={100}
                      label={t('settings.shop.lifecycle.shortDurationFactorLabel')}
                      value={tier.price_factor_percent}
                      onChange={(e) => {
                        const n = Number(e.target.value)
                        updateTier({
                          price_factor_percent: Number.isFinite(n)
                            ? Math.max(5, Math.min(100, Math.round(n)))
                            : 5,
                        })
                      }}
                    />
                    <Input
                      type="number"
                      min={100}
                      max={100000}
                      label={t('settings.shop.lifecycle.shortDurationMinPriceLabel')}
                      value={tier.min_price_cents}
                      onChange={(e) => {
                        const n = Number(e.target.value)
                        updateTier({
                          min_price_cents: Number.isFinite(n)
                            ? Math.max(100, Math.min(100000, Math.round(n)))
                            : 100,
                        })
                      }}
                    />
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="space-y-3 rounded-xl border border-outline-variant/30 bg-surface-container p-4 sm:col-span-2">
          <div>
            <span className="block text-sm font-medium text-on-surface">
              {t('settings.shop.lifecycle.gameSwitchSectionTitle')}
            </span>
            <p className="mt-1 text-xs text-on-surface-variant">
              {t('settings.shop.lifecycle.gameSwitchSectionHint')}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Input
                type="number"
                min={0}
                max={720}
                label={t('settings.shop.lifecycle.gameSwitchCooldownLabel')}
                value={daten.shop_game_switch_cooldown_hours ?? 24}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  setDaten((alt) => ({
                    ...alt,
                    shop_game_switch_cooldown_hours: Number.isFinite(n)
                      ? Math.max(0, Math.min(720, Math.round(n)))
                      : 0,
                  }))
                }}
              />
              <p className="mt-1 text-xs text-on-surface-variant">
                {t('settings.shop.lifecycle.gameSwitchCooldownHint')}
              </p>
            </div>
            <div>
              <Input
                type="number"
                min={0}
                max={100}
                label={t('settings.shop.lifecycle.gameSwitchMaxPer30dLabel')}
                value={daten.shop_game_switch_max_per_30d ?? 4}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  setDaten((alt) => ({
                    ...alt,
                    shop_game_switch_max_per_30d: Number.isFinite(n)
                      ? Math.max(0, Math.min(100, Math.round(n)))
                      : 0,
                  }))
                }}
              />
              <p className="mt-1 text-xs text-on-surface-variant">
                {t('settings.shop.lifecycle.gameSwitchMaxPer30dHint')}
              </p>
            </div>
          </div>
          <label className="flex items-start gap-3 pt-1">
            <Switch
              checked={Boolean(daten.shop_game_switch_allow_higher_price_plan)}
              onCheckedChange={(checked) =>
                setDaten((alt) => ({
                  ...alt,
                  shop_game_switch_allow_higher_price_plan: checked,
                }))
              }
              aria-label={t('settings.shop.lifecycle.gameSwitchAllowHigherPriceLabel')}
            />
            <div className="flex-1">
              <span className="block text-sm font-medium text-on-surface">
                {t('settings.shop.lifecycle.gameSwitchAllowHigherPriceLabel')}
              </span>
              <p className="mt-0.5 text-xs text-on-surface-variant">
                {t('settings.shop.lifecycle.gameSwitchAllowHigherPriceHint')}
              </p>
            </div>
          </label>
        </div>
      </div>

      <div className="mt-4">
        <Button variant="primary" onClick={() => void speichern()} disabled={busy}>
          {t('settings.shop.lifecycle.speichern')}
        </Button>
      </div>
    </section>
  )
}
