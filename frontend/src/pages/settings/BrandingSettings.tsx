import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Image as ImageIcon, Trash2, Upload } from 'lucide-react'
import { Button, Dropdown, Input } from '@maunting/ui'
import { api, SanitizedApiError } from '@/api/client'
import { apiUrl } from '@/config/api'
import { toast } from '@/stores/toastStore'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'
import type { BrandLogoSlot, BrandLogoSlotInfo, PanelSettings } from './types'

interface BrandingSettingsProps {
  settings: PanelSettings
  canWrite: boolean
  onChange: (patch: Partial<PanelSettings>) => void
}

const LOGO_SLOTS: Array<{ slot: BrandLogoSlot; labelKey: string }> = [
  { slot: 'default', labelKey: 'settings.branding.slots.default' },
  { slot: 'birthday', labelKey: 'settings.branding.slots.birthday' },
  { slot: 'halloween', labelKey: 'settings.branding.slots.halloween' },
  { slot: 'christmas', labelKey: 'settings.branding.slots.christmas' },
]

export function BrandingSettings({ settings, canWrite, onChange }: BrandingSettingsProps) {
  const { t } = useTranslation()
  const [busySlot, setBusySlot] = useState<BrandLogoSlot | null>(null)
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({})

  const handleUpload = async (slot: BrandLogoSlot, file: File | undefined) => {
    if (!file || !canWrite) return
    setBusySlot(slot)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await api<{ slot: BrandLogoSlot } & BrandLogoSlotInfo>(
        `/settings/branding/logo/${slot}`,
        { method: 'POST', body: form },
      )
      const nextLogos = {
        ...settings.brand_logos,
        [slot]: {
          configured: res.configured,
          version: res.version,
          url: res.url,
        },
      }
      const patch: Partial<PanelSettings> = { brand_logos: nextLogos }
      if (slot === 'default') {
        patch.brand_logo_mode = 'custom'
      } else if (settings.brand_season_logo_mode === 'default') {
        patch.brand_season_logo_mode = 'custom'
      }
      onChange(patch)
      await usePublicSettingsStore.getState().refresh()
      toast.success(t('settings.branding.logoUploaded'))
    } catch (err: unknown) {
      toast.error(err instanceof SanitizedApiError ? err.message : t('settings.branding.logoUploadFailed'))
    } finally {
      setBusySlot(null)
    }
  }

  const handleDelete = async (slot: BrandLogoSlot) => {
    if (!canWrite) return
    setBusySlot(slot)
    try {
      await api(`/settings/branding/logo/${slot}`, { method: 'DELETE' })
      const nextLogos = {
        ...settings.brand_logos,
        [slot]: { configured: false, version: null, url: null },
      }
      const patch: Partial<PanelSettings> = { brand_logos: nextLogos }
      if (slot === 'default') {
        patch.brand_logo_mode = 'default'
      } else {
        const remainingSeasonal = (['birthday', 'halloween', 'christmas'] as BrandLogoSlot[]).some(
          (s) => s !== slot && nextLogos[s]?.configured,
        )
        if (!remainingSeasonal && settings.brand_season_logo_mode === 'custom') {
          patch.brand_season_logo_mode = 'default'
        }
      }
      onChange(patch)
      await usePublicSettingsStore.getState().refresh()
      toast.success(t('settings.branding.logoRemoved'))
    } catch (err: unknown) {
      toast.error(err instanceof SanitizedApiError ? err.message : t('settings.branding.logoRemoveFailed'))
    } finally {
      setBusySlot(null)
    }
  }

  return (
    <div className="msm-card p-6 space-y-6">
      <div>
        <h3 className="font-headline text-headline-sm text-primary">
          {t('settings.branding.title')}
        </h3>
        <p className="mt-1 text-xs text-on-surface-variant">
          {t('settings.branding.subtitle')}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input
          label={t('settings.branding.brandName')}
          type="text"
          value={settings.brand_name}
          onChange={(e) => onChange({ brand_name: e.target.value })}
          disabled={!canWrite}
          maxLength={64}
          placeholder="Maunting Service Manager"
        />
        <Input
          label={t('settings.branding.brandTagline')}
          type="text"
          value={settings.brand_tagline}
          onChange={(e) => onChange({ brand_tagline: e.target.value })}
          disabled={!canWrite}
          maxLength={160}
          placeholder={t('settings.branding.brandTaglinePlaceholder')}
        />
        <Input
          label={t('settings.branding.aiName')}
          type="text"
          value={settings.brand_ai_name}
          onChange={(e) => onChange({ brand_ai_name: e.target.value })}
          disabled={!canWrite}
          maxLength={40}
          placeholder="Singra"
        />
        <Input
          label={t('settings.branding.aiEmail')}
          type="email"
          value={settings.brand_ai_email}
          onChange={(e) => onChange({ brand_ai_email: e.target.value })}
          disabled={!canWrite}
          maxLength={254}
          placeholder="singra@mauntingstudios.de"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-outline-variant/25 pt-5">
        <div>
          <label className="block font-label-md text-label-md text-on-surface-variant mb-1.5 uppercase tracking-wider">
            {t('settings.branding.logoMode')}
          </label>
          <Dropdown
            value={settings.brand_logo_mode}
            onChange={(val) => onChange({ brand_logo_mode: val as 'default' | 'custom' })}
            disabled={!canWrite}
            options={[
              { value: 'default', label: t('settings.branding.logoModeDefault') },
              { value: 'custom', label: t('settings.branding.logoModeCustom') },
            ]}
            aria-label={t('settings.branding.logoMode')}
          />
        </div>
        <div>
          <label className="block font-label-md text-label-md text-on-surface-variant mb-1.5 uppercase tracking-wider">
            {t('settings.branding.seasonLogoMode')}
          </label>
          <Dropdown
            value={settings.brand_season_logo_mode}
            onChange={(val) =>
              onChange({ brand_season_logo_mode: val as 'default' | 'custom' | 'disabled' })
            }
            disabled={!canWrite}
            options={[
              { value: 'default', label: t('settings.branding.seasonModeDefault') },
              { value: 'custom', label: t('settings.branding.seasonModeCustom') },
              { value: 'disabled', label: t('settings.branding.seasonModeDisabled') },
            ]}
            aria-label={t('settings.branding.seasonLogoMode')}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-outline-variant/25 pt-5">
        {LOGO_SLOTS.map(({ slot, labelKey }) => {
          const info = settings.brand_logos?.[slot]
          const isBusy = busySlot === slot
          return (
            <div
              key={slot}
              className="flex items-center justify-between gap-3 rounded-xl border border-outline-variant/35 bg-surface-container-low/40 p-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full border border-outline-variant/30 bg-surface-container">
                  {info?.configured && info.url ? (
                    <img
                      src={apiUrl(info.url)}
                      alt={t(labelKey)}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <ImageIcon className="h-4 w-4 text-on-surface-variant" aria-hidden="true" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-on-surface truncate">
                    {t(labelKey)}
                  </div>
                  <div className="text-xs text-on-surface-variant">
                    {info?.configured
                      ? t('settings.branding.customActive')
                      : t('settings.branding.standardActive')}
                  </div>
                </div>
              </div>

              {canWrite && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <input
                    ref={(el) => {
                      fileInputs.current[slot] = el
                    }}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    aria-label={`${t('settings.branding.uploadLogo')} (${t(labelKey)})`}
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      e.target.value = ''
                      void handleUpload(slot, f)
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={isBusy}
                    onClick={() => fileInputs.current[slot]?.click()}
                  >
                    <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('settings.branding.uploadLogo')}
                  </Button>
                  {info?.configured && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      disabled={isBusy}
                      aria-label={`${t('settings.branding.removeLogo')} (${t(labelKey)})`}
                      onClick={() => void handleDelete(slot)}
                    >
                      <Trash2 className="h-4 w-4 text-status-destructive" aria-hidden="true" />
                    </Button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <p className="text-xs text-on-surface-variant">
        {t('settings.branding.accentHint')}
      </p>
    </div>
  )
}
