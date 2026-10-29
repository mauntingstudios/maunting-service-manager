import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Clock, Globe, Mail, MapPin, Save, ShieldCheck } from 'lucide-react'

import { api } from '@/api/client'
import { Button, Dropdown, type DropdownOption } from '@/Singra/UI'
import { useAuthStore } from '@/stores/authStore'
import { toast } from '@/stores/toastStore'
import { getAvailableTimezones } from '@/utils/timeFormat'
import type { TresorQuelle } from '@/services/datenexport'
import { DatenexportKarte } from './DatenexportKarte'

/**
 * Reiter „Konto": die Zugangsdaten und was dieses Konto über das Gerät weiß.
 *
 * E-Mail, Zeitzone, Standortfreigabe und der Datenexport. Getrennt vom Reiter
 * „Profil", weil hier nichts steht, was andere sehen; dieselbe Karte nutzen
 * Panel, MSS und Pontis.
 */
export function KontoTab({ tresor }: { tresor?: TresorQuelle & { entsperren: () => void } }) {
  const { t } = useTranslation()
  const { user, updateUser } = useAuthStore()

  const browserZone = typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function'
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : null

  const [selectedZone, setSelectedZone] = useState<string>(
    user?.time_zone || browserZone || 'UTC',
  )
  const [saving, setSaving] = useState(false)
  const [dismissedBrowserHint, setDismissedBrowserHint] = useState(false)
  const [savingLocationSharing, setSavingLocationSharing] = useState(false)
  const [locationSharingError, setLocationSharingError] = useState<string | null>(null)

  useEffect(() => {
    if (user?.time_zone) {
      setSelectedZone(user.time_zone)
    } else if (browserZone) {
      setSelectedZone(browserZone)
    }
  }, [user?.time_zone, browserZone])

  const timezoneOptions: DropdownOption[] = useMemo(() => {
    const zones = getAvailableTimezones()
    const allZones = [...new Set([...(user?.time_zone ? [user.time_zone] : []), ...zones])].sort()
    return allZones.map((z) => ({ value: z, label: z }))
  }, [user?.time_zone])

  const showBrowserHint = !dismissedBrowserHint
    && browserZone
    && user?.time_zone
    && user.time_zone !== browserZone

  const handleSaveTimezone = async (zoneToSave?: string) => {
    const zone = zoneToSave || selectedZone
    setSaving(true)
    try {
      const res = await api<{ time_zone: string | null }>('/auth/me/timezone', {
        method: 'PATCH',
        body: JSON.stringify({ time_zone: zone }),
      })
      updateUser({ time_zone: res.time_zone })
      setSelectedZone(res.time_zone || 'UTC')
      setDismissedBrowserHint(true)
      toast.success(t('profile.timezoneSaved'))
    } catch {
      toast.error(t('profile.timezoneSaveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const requestBrowserLocationPermission = () => new Promise<void>((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('UNSUPPORTED'))
      return
    }

    navigator.geolocation.getCurrentPosition(
      // Die Position wird bewusst nicht entgegengenommen: Die Konto-Einstellung
      // speichert ausschließlich die Einwilligung. Eine konkrete Position gehört
      // nur in den jeweiligen KI-Lauf und darf nie in diesem Profilzustand landen.
      () => resolve(),
      (error) => reject(error),
      { enableHighAccuracy: false, maximumAge: 0, timeout: 10_000 },
    )
  })

  const handleLocationSharingChange = async (enabled: boolean) => {
    setLocationSharingError(null)
    setSavingLocationSharing(true)
    try {
      if (enabled) {
        await requestBrowserLocationPermission()
      }

      const res = await api<{ location_sharing_enabled: boolean }>('/auth/me/location-sharing', {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      })
      updateUser({ location_sharing_enabled: res.location_sharing_enabled })
    } catch (error) {
      const geolocationErrorCode = (error as { code?: unknown } | null)?.code
      if (
        (typeof geolocationErrorCode === 'number' && geolocationErrorCode >= 1 && geolocationErrorCode <= 3) ||
        (error as Error)?.message === 'UNSUPPORTED'
      ) {
        setLocationSharingError(
          t('profile.locationSharingPermissionError'),
        )
      } else {
        setLocationSharingError(t('profile.locationSharingSaveError'))
      }
    } finally {
      setSavingLocationSharing(false)
    }
  }

  return (
    <div className="space-y-6">
      <section className="msm-card p-6" aria-labelledby="account-email-title">
        <div className="flex items-center gap-2 mb-6">
          <Mail className="h-5 w-5 text-secondary" aria-hidden="true" />
          <h2 id="account-email-title" className="font-headline text-title-lg font-semibold text-on-surface">
            {t('profile.tabs.account')}
          </h2>
        </div>

        <p className="font-body-md text-sm text-on-surface">{user?.email}</p>
        {user?.email_verified === false && (
          <span className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-status-destructive/10 text-status-destructive border border-status-destructive/30">
            <AlertTriangle className="w-3 h-3" />
            {t('profile.notVerified')}
          </span>
        )}
      </section>

      <div className="msm-card p-6">
        <div className="flex items-center gap-2 mb-6">
          <Clock className="h-5 w-5 text-secondary" aria-hidden="true" />
          <h2 className="font-headline text-title-lg font-semibold text-on-surface">
            {t('profile.timezoneTitle')}
          </h2>
        </div>

        {showBrowserHint && browserZone && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/10 p-3 text-sm text-on-surface">
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
              <span>
                {t('profile.timezoneBrowserHint', {
                  zone: browserZone,
                  current: user?.time_zone,
                })}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={saving}
                onClick={() => void handleSaveTimezone(browserZone)}
              >
                {t('common.apply')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setDismissedBrowserHint(true)}
              >
                {t('profile.timezoneDismiss')}
              </Button>
            </div>
          </div>
        )}

        <div className="max-w-md space-y-4">
          <div>
            <label
              htmlFor="profile-timezone"
              className="block font-label-md text-label-md text-on-surface-variant mb-1.5 uppercase tracking-wider"
            >
              {t('profile.timezoneLabel')}
            </label>
            <Dropdown
              id="profile-timezone"
              value={selectedZone}
              onChange={setSelectedZone}
              options={timezoneOptions}
              searchable={true}
              searchPlaceholder={t('profile.timezoneSearch')}
              placeholder={t('profile.timezonePlaceholder')}
              aria-label={t('profile.timezoneLabel')}
            />
          </div>

          <div>
            <Button
              type="button"
              variant="primary"
              disabled={saving || (selectedZone === user?.time_zone && Boolean(user?.time_zone))}
              onClick={() => void handleSaveTimezone()}
            >
              <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {saving ? t('common.saving') : t('profile.timezoneSave')}
            </Button>
          </div>
        </div>
      </div>

      <section className="msm-card p-6" aria-labelledby="location-sharing-title">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
              user?.location_sharing_enabled
                ? 'border-primary/30 bg-primary/10 text-primary'
                : 'border-outline-variant bg-surface-container text-on-surface-variant'
            }`}>
              <MapPin className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <h2 id="location-sharing-title" className="font-headline text-title-lg font-semibold text-on-surface">
                {t('profile.locationSharingTitle')}
              </h2>
              <p className="mt-1 max-w-2xl font-body-md text-sm leading-6 text-on-surface-variant">
                {t('profile.locationSharingDescription')}
              </p>
            </div>
          </div>
          <span className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${
            user?.location_sharing_enabled
              ? 'border-status-success/30 bg-status-success/10 text-status-success'
              : 'border-outline-variant bg-surface-container text-on-surface-variant'
          }`}>
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            {user?.location_sharing_enabled
              ? t('profile.locationSharingEnabled')
              : t('profile.locationSharingDisabled')}
          </span>
        </div>

        <div className="mt-4 border-l-2 border-primary/40 pl-3">
          <p className="font-body-md text-xs leading-5 text-on-surface-variant">
            {t('profile.locationSharingPrivacy')}
          </p>
        </div>

        {locationSharingError && (
          <p className="mt-4 text-sm text-status-destructive" role="alert">
            {locationSharingError}
          </p>
        )}

        <div className="mt-5">
          <Button
            type="button"
            variant={user?.location_sharing_enabled ? 'secondary' : 'primary'}
            disabled={savingLocationSharing}
            onClick={() => void handleLocationSharingChange(!user?.location_sharing_enabled)}
          >
            {savingLocationSharing
              ? t('common.saving')
              : user?.location_sharing_enabled
                ? t('profile.locationSharingDisable')
                : t('profile.locationSharingEnable')}
          </Button>
        </div>
      </section>

      <DatenexportKarte tresor={tresor} />
    </div>
  )
}
