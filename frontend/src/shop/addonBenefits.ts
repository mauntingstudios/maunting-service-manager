import type { TFunction } from 'i18next'
import type { ShopAddonCategory, ShopRoleBenefits } from '@/api/shop'

export interface AddonBenefitSource {
  category?: ShopAddonCategory
  extra_ai_tokens?: number | null
  extra_slots?: number | null
  extra_backups?: number | null
  extra_storage_mb?: number | null
  grants_role?: boolean
  role_benefits?: ShopRoleBenefits | null
}

export function formatVaultBytes(bytes: number, sprache: 'de' | 'en' = 'de'): string {
  const gib = bytes / (1024 * 1024 * 1024)
  if (gib >= 1) {
    return `${gib.toLocaleString(sprache === 'de' ? 'de-DE' : 'en-US', {
      maximumFractionDigits: 1,
    })} GB`
  }
  const mib = Math.max(1, Math.round(bytes / (1024 * 1024)))
  return `${mib.toLocaleString(sprache === 'de' ? 'de-DE' : 'en-US')} MB`
}

export function formatAddonBenefits(
  addon: AddonBenefitSource,
  t: TFunction,
  sprache: 'de' | 'en' = 'de',
): string[] {
  const locale = sprache === 'de' ? 'de-DE' : 'en-US'
  const zeilen: string[] = []
  const rb = addon.role_benefits

  if (rb) {
    if (rb.vault_quota_bytes && rb.vault_quota_bytes > 0) {
      zeilen.push(
        t('shop.addons.tresorSpeicher', {
          speicher: formatVaultBytes(rb.vault_quota_bytes, sprache),
        }),
      )
    }
    if (rb.ai_monthly_tokens && rb.ai_monthly_tokens > 0) {
      zeilen.push(
        t('shop.addons.kiMonat', {
          wert: rb.ai_monthly_tokens.toLocaleString(locale),
        }),
      )
    } else if (rb.ai_weekly_tokens && rb.ai_weekly_tokens > 0) {
      zeilen.push(
        t('shop.addons.kiWoche', {
          wert: rb.ai_weekly_tokens.toLocaleString(locale),
        }),
      )
    } else if (rb.ai_daily_tokens && rb.ai_daily_tokens > 0) {
      zeilen.push(
        t('shop.addons.kiTag', {
          wert: rb.ai_daily_tokens.toLocaleString(locale),
        }),
      )
    }
    if (rb.ai_realtime_minutes && rb.ai_realtime_minutes > 0) {
      zeilen.push(
        t('shop.addons.kiSprache', {
          count: rb.ai_realtime_minutes,
        }),
      )
    }
    if (rb.ai_model_count > 0) {
      zeilen.push(
        t('shop.addons.kiModelle', {
          count: rb.ai_model_count,
        }),
      )
    }
  }

  if (zeilen.length === 0) {
    if (addon.extra_ai_tokens) {
      zeilen.push(
        t('shop.addons.aiTokens', { wert: addon.extra_ai_tokens.toLocaleString(locale) }),
      )
    }
    if (addon.extra_slots) {
      zeilen.push(t('shop.addons.extraSlots', { count: addon.extra_slots }))
    }
    if (addon.extra_backups) {
      zeilen.push(t('shop.addons.extraBackups', { count: addon.extra_backups }))
    }
    if (addon.extra_storage_mb) {
      const gb = Math.max(1, Math.round(addon.extra_storage_mb / 1024))
      zeilen.push(t('shop.addons.extraStorage', { gb }))
    }
    if (addon.grants_role || rb) {
      zeilen.push(t('shop.addons.grantsRole'))
    }
  } else {
    if (addon.extra_slots) {
      zeilen.push(t('shop.addons.extraSlots', { count: addon.extra_slots }))
    }
    if (addon.extra_backups) {
      zeilen.push(t('shop.addons.extraBackups', { count: addon.extra_backups }))
    }
  }

  return zeilen
}
