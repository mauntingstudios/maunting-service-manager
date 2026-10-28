import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Camera, Loader2, Phone, Shield, Trash2, User } from 'lucide-react'

import { api } from '@/api/client'
import { updatePrivacy } from '@/api/social'
import { BenutzernameInline } from '@/components/BenutzernameInline'
import { InfoKarte } from '@/components/social/InfoKarte'
import { Avatar, Button, Dropdown, type DropdownOption } from '@/Singra/UI'
import { useAuthStore } from '@/stores/authStore'
import { toast } from '@/stores/toastStore'

/**
 * Reiter „Profil": was andere von diesem Konto sehen.
 *
 * Bild, Name, die freiwillige Info und die Sichtbarkeit des Profils. Dieselbe
 * Karte steht im Panel (Profil), in MSS und in Pontis (MSM-Dienste → Profil) —
 * bis 10/2026 lag das in drei fast gleichen Kopien.
 */
export function ProfilTab({ social = true }: { social?: boolean }) {
  const { t } = useTranslation()
  const { user, updateUser } = useAuthStore()

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)

  const handleAvatarChange = async (file?: File | null) => {
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      toast.error(t('profile.avatarSizeLimit'))
      return
    }
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    if (!allowedTypes.includes(file.type)) {
      toast.error(t('profile.avatarInvalidType'))
      return
    }

    setUploadingAvatar(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await api<{ avatar_url: string }>('/auth/me/avatar', {
        method: 'POST',
        body: formData,
      })
      updateUser({ avatar_url: res.avatar_url })
      toast.success(t('profile.avatarUpdated'))
    } catch (err: any) {
      toast.error(err?.detail || t('profile.avatarUpdateFailed'))
    } finally {
      setUploadingAvatar(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleDeleteAvatar = async () => {
    if (!user?.avatar_url) return
    setUploadingAvatar(true)
    try {
      await api('/auth/me/avatar', { method: 'DELETE' })
      updateUser({ avatar_url: null })
      toast.success(t('profile.avatarRemoved'))
    } catch (err: any) {
      toast.error(err?.detail || t('profile.avatarRemoveFailed'))
    } finally {
      setUploadingAvatar(false)
    }
  }

  const [privacyLevel, setPrivacyLevel] = useState<'public' | 'friends' | 'private'>(
    (user?.social_privacy as 'public' | 'friends' | 'private') || 'friends'
  )
  const [savingPrivacy, setSavingPrivacy] = useState(false)

  useEffect(() => {
    if (user?.social_privacy) {
      setPrivacyLevel(user.social_privacy as 'public' | 'friends' | 'private')
    }
  }, [user?.social_privacy])

  const handleSavePrivacy = async (levelToSave?: 'public' | 'friends' | 'private') => {
    const level = levelToSave || privacyLevel
    setSavingPrivacy(true)
    try {
      const res = await updatePrivacy({ privacy: level })
      const validPrivacy = (res.social_privacy === 'public' || res.social_privacy === 'friends' || res.social_privacy === 'private')
        ? res.social_privacy
        : level
      updateUser({ social_privacy: validPrivacy })
      setPrivacyLevel(validPrivacy)
      toast.success(t('profile.privacySaved'))
    } catch {
      toast.error(t('profile.privacySaveFailed'))
    } finally {
      setSavingPrivacy(false)
    }
  }

  // Die Sichtbarkeit regelt auch das Profil: bei „Privat" ist es für alle
  // anderen nicht erreichbar, Freunde eingeschlossen (Server: 404).
  const privacyOptions: DropdownOption[] = (['friends', 'public', 'private'] as const).map((value) => ({
    value,
    label: t(`social.visibility.options.${value}`),
  }))

  return (
    <div className="space-y-6">
      {/* Die freiwillige Info steht ganz oben: sie ist der Satz, den andere
          unter dem Namen sehen. */}
      {social && <InfoKarte />}

      <section className="msm-card p-6" aria-labelledby="profile-identity-title">
        <div className="flex items-center gap-2 mb-6">
          <User className="h-5 w-5 text-secondary" aria-hidden="true" />
          <h2 id="profile-identity-title" className="font-headline text-title-lg font-semibold text-on-surface">
            {t('profile.tabs.profile')}
          </h2>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
          <div className="relative group">
            <Avatar
              src={user?.avatar_url}
              name={user?.username}
              size="xl"
            />
            {uploadingAvatar && (
              <div className="absolute inset-0 rounded-full bg-black/60 flex items-center justify-center">
                <Loader2 className="w-6 h-6 text-primary animate-spin" />
              </div>
            )}
          </div>

          <div className="space-y-3 flex-1">
            <BenutzernameInline className="font-label-md text-base text-on-surface font-semibold" />

            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="sr-only"
                disabled={uploadingAvatar}
                onChange={(e) => void handleAvatarChange(e.target.files?.[0])}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={uploadingAvatar}
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5"
              >
                <Camera className="w-4 h-4 text-primary" aria-hidden="true" />
                {user?.avatar_url ? t('profile.changeAvatar') : t('profile.uploadAvatar')}
              </Button>

              {user?.avatar_url && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={uploadingAvatar}
                  onClick={() => void handleDeleteAvatar()}
                  className="flex items-center gap-1.5 text-status-destructive hover:bg-status-destructive/10"
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                  {t('profile.removeAvatar')}
                </Button>
              )}
            </div>
            <p className="text-xs text-on-surface-variant/70">
              {t('profile.avatarHint')}
            </p>
          </div>
        </div>
      </section>

      {social && (
        <section className="msm-card p-6" aria-labelledby="privacy-settings-title">
          <div className="flex items-center gap-2 mb-4">
            <Shield className="h-5 w-5 text-secondary" aria-hidden="true" />
            <h2 id="privacy-settings-title" className="font-headline text-title-lg font-semibold text-on-surface">
              {t('profile.privacyTitle')}
            </h2>
          </div>
          <p className="max-w-2xl font-body-md text-sm leading-6 text-on-surface-variant mb-4">
            {t('profile.privacyDescription')}
          </p>

          <div className="max-w-md space-y-4">
            <div>
              <label
                htmlFor="profile-privacy-dropdown"
                className="block font-label-md text-label-md text-on-surface-variant mb-1.5 uppercase tracking-wider"
              >
                {t('profile.privacyVisibility')}
              </label>
              <Dropdown
                id="profile-privacy-dropdown"
                value={privacyLevel}
                onChange={(val: string) => {
                  const next = val as 'public' | 'friends' | 'private'
                  setPrivacyLevel(next)
                  void handleSavePrivacy(next)
                }}
                options={privacyOptions}
                disabled={savingPrivacy}
                aria-label={t('profile.privacyVisibility')}
              />
            </div>
            <p className="text-xs text-on-surface-variant/70">
              {t(`social.visibility.hints.${privacyLevel}`)}
            </p>
            {/* Die Sichtbarkeit regelt Status und Profil, nie das Klingeln. Wer
                hier „Öffentlich" wählt, soll nicht vermuten müssen, dass er damit
                auch Fremden das Anrufen erlaubt. */}
            <p className="flex items-start gap-2 rounded-lg bg-surface-container-high/60 px-3 py-2 text-xs text-on-surface-variant">
              <Phone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
              <span>{t('profile.privacyCallsFriendsOnly')}</span>
            </p>
          </div>
        </section>
      )}
    </div>
  )
}
