import { useEffect, useState, type FormEvent } from 'react'
import { ImagePlus, Sparkles, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button, Dropdown, Input, type DropdownOption } from '@maunting/ui'
import type { Team, TeamMediaKind } from '@/api/teams'
import {
  TEAM_CATEGORIES,
  TEAM_COVER_PRESETS,
  getTeamMetadata,
  presetUrlForId,
  type TeamCategoryKey,
  type TeamMetadata,
} from './teamMeta'
import { TeamMediaDialog, TeamMediaImage } from './TeamMediaDialog'

export interface TeamModalSubmitPayload {
  name: string
  category: TeamCategoryKey
  description: string
  avatarPreset: string | null
  bannerPreset: string | null
  stagedAvatarFile?: File | null
  stagedBannerFile?: File | null
}

export interface TeamModalProps {
  isOpen: boolean
  mode: 'create' | 'edit'
  team?: Team | null
  initialName?: string
  initialMeta?: TeamMetadata
  busy?: boolean
  onClose: () => void
  onMediaChanged?: () => Promise<void> | void
  onSubmit: (payload: TeamModalSubmitPayload) => Promise<void>
}

export function TeamModal({
  isOpen,
  mode,
  team = null,
  initialName = '',
  initialMeta,
  busy = false,
  onClose,
  onMediaChanged,
  onSubmit,
}: TeamModalProps) {
  const { t } = useTranslation()

  const resolvedMeta = team ? getTeamMetadata(team) : initialMeta

  const [name, setName] = useState(initialName)
  const [category, setCategory] = useState<TeamCategoryKey>(
    resolvedMeta?.category ?? 'projekt',
  )
  const [description, setDescription] = useState(
    resolvedMeta?.description ?? '',
  )
  const [avatarPreset, setAvatarPreset] = useState<string | null>(
    team?.avatar_preset ?? TEAM_COVER_PRESETS[0].id,
  )
  const [bannerPreset, setBannerPreset] = useState<string | null>(
    team?.banner_preset ?? null,
  )
  const [stagedAvatarFile, setStagedAvatarFile] = useState<File | null>(null)
  const [stagedBannerFile, setStagedBannerFile] = useState<File | null>(null)
  const [stagedAvatarPreview, setStagedAvatarPreview] = useState<string | null>(null)
  const [stagedBannerPreview, setStagedBannerPreview] = useState<string | null>(null)
  const [mediaDialogKind, setMediaDialogKind] = useState<TeamMediaKind | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    const nextMeta = team ? getTeamMetadata(team) : initialMeta
    setName(team?.name ?? initialName)
    setCategory(nextMeta?.category ?? 'projekt')
    setDescription(nextMeta?.description ?? '')
    setAvatarPreset(team?.avatar_preset ?? (mode === 'create' ? TEAM_COVER_PRESETS[0].id : null))
    setBannerPreset(team?.banner_preset ?? null)
    setStagedAvatarFile(null)
    setStagedBannerFile(null)
    setStagedAvatarPreview(null)
    setStagedBannerPreview(null)
    setMediaDialogKind(null)
    setError(null)
  }, [isOpen, team, initialName, initialMeta, mode])

  useEffect(() => {
    return () => {
      if (stagedAvatarPreview) URL.revokeObjectURL(stagedAvatarPreview)
    }
  }, [stagedAvatarPreview])

  useEffect(() => {
    return () => {
      if (stagedBannerPreview) URL.revokeObjectURL(stagedBannerPreview)
    }
  }, [stagedBannerPreview])

  if (!isOpen) return null

  const categoryOptions: DropdownOption[] = Object.values(TEAM_CATEGORIES).map((cat) => {
    const IconComp = cat.icon
    return {
      value: cat.key,
      label: cat.label,
      icon: <IconComp className="h-4 w-4" />,
    }
  })

  const avatarPreviewSrc = (() => {
    if (stagedAvatarPreview) return stagedAvatarPreview
    if (team?.avatar_source === 'custom' && team.avatar_url) {
      return `${team.avatar_url}${team.avatar_version ? `?v=${team.avatar_version}` : ''}`
    }
    return presetUrlForId(avatarPreset) ?? resolvedMeta?.coverImage ?? TEAM_COVER_PRESETS[0].url
  })()

  const bannerPreviewSrc = (() => {
    if (stagedBannerPreview) return stagedBannerPreview
    if (team?.banner_source === 'custom' && team.banner_url) {
      return `${team.banner_url}${team.banner_version ? `?v=${team.banner_version}` : ''}`
    }
    return presetUrlForId(bannerPreset) ?? resolvedMeta?.bannerImage ?? null
  })()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (trimmed.length < 2) {
      setError(t('teams.nameTooShort', 'Der Teamname muss mindestens 2 Zeichen lang sein.'))
      return
    }
    if (trimmed.length > 64) {
      setError(t('teams.nameTooLong', 'Der Teamname darf maximal 64 Zeichen lang sein.'))
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      await onSubmit({
        name: trimmed,
        category,
        description: description.trim(),
        avatarPreset,
        bannerPreset,
        stagedAvatarFile,
        stagedBannerFile,
      })
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('common.error', 'Ein Fehler ist aufgetreten'))
    } finally {
      setSubmitting(false)
    }
  }

  const isEdit = mode === 'edit'
  const isBusy = busy || submitting
  const canEditAvatar = !isEdit || Boolean(team?.is_owner || team?.can_manage_avatar)
  const canEditBanner = !isEdit || Boolean(team?.is_owner || team?.can_manage_banner)

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="team-modal-title"
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fade-in"
        onClick={(e) => {
          if (e.target === e.currentTarget && !isBusy && !mediaDialogKind) onClose()
        }}
      >
        <div
          className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-3xl border border-outline-variant/30 bg-surface-container-high/95 p-6 shadow-2xl backdrop-blur-2xl transition-all duration-300 text-on-surface"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-4 border-b border-outline-variant/25 pb-4">
            <div className="min-w-0">
              <h2
                id="team-modal-title"
                className="font-headline text-lg sm:text-xl font-bold tracking-tight text-on-surface"
              >
                {isEdit
                  ? t('teams.editTeamTitle', 'Team bearbeiten')
                  : t('teams.createTeamTitle', 'Neues Team erstellen')}
              </h2>
              <p className="mt-1 text-xs text-on-surface-variant">
                {isEdit
                  ? t('teams.editTeamSubtitle', 'Passe Metadaten, Kategorie, Profilbild und Banner dieses Teams an.')
                  : t('teams.createTeamSubtitle', 'Gib deinem Team einen Namen, wähle eine Kategorie sowie Profilbild und Banner.')}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={isBusy}
              aria-label={t('common.close', 'Schließen')}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-outline-variant/30 bg-surface-container/60 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest transition-colors active:scale-95"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            {error && (
              <div className="rounded-xl border border-status-destructive/30 bg-status-destructive/10 p-3 text-xs text-status-destructive">
                {error}
              </div>
            )}

            {/* Name */}
            <div>
              <label
                htmlFor="team-name-input"
                className="block text-xs font-medium text-on-surface-variant mb-1.5"
              >
                {t('teams.nameLabel', 'Teamname')} *
              </label>
              <Input
                id="team-name-input"
                type="text"
                required
                autoFocus
                disabled={isBusy}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('teams.namePlaceholder', 'z. B. EchoFall oder Entwicklung')}
                className="w-full"
              />
            </div>

            {/* Kategorie */}
            <div>
              <label
                id="team-category-label"
                className="block text-xs font-medium text-on-surface-variant mb-1.5"
              >
                {t('teams.categoryLabel', 'Kategorie')}
              </label>
              <Dropdown
                value={category}
                onChange={(val) => setCategory(val as TeamCategoryKey)}
                options={categoryOptions}
                disabled={isBusy}
                aria-label={t('teams.categoryLabel', 'Kategorie')}
              />
            </div>

            {/* Beschreibung */}
            <div>
              <label
                htmlFor="team-desc-input"
                className="block text-xs font-medium text-on-surface-variant mb-1.5"
              >
                {t('teams.descLabel', 'Beschreibung')}
              </label>
              <Input
                id="team-desc-input"
                type="text"
                disabled={isBusy}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('teams.descPlaceholder', 'Worum geht es in diesem Team?')}
                className="w-full"
              />
            </div>

            {/* Profilbild & Hintergrundbanner über gemeinsamen Galerie-Dialog */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div className="rounded-2xl border border-outline-variant/30 bg-surface-container/50 p-3 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-on-surface">
                    {t('teams.media.avatarLabel', 'Profilbild')}
                  </span>
                  {canEditAvatar && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={isBusy}
                      onClick={() => setMediaDialogKind('avatar')}
                      className="h-7 px-2.5 text-xs gap-1"
                    >
                      <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{t('teams.media.selectOrUpload', 'Bild wählen')}</span>
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-outline-variant/40 bg-surface-container-high shadow-sm">
                    <TeamMediaImage src={avatarPreviewSrc} alt={name || 'Team-Profilbild'} />
                  </div>
                  <p className="text-xs text-on-surface-variant leading-snug">
                    {team?.avatar_source === 'custom' || stagedAvatarFile
                      ? t('teams.customCoverActive', 'Eigenes Profilbild aktiv')
                      : t('teams.media.presetHint', 'Vorlage oder eigener Upload über Galerie')}
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-outline-variant/30 bg-surface-container/50 p-3 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-on-surface">
                    {t('teams.media.bannerLabel', 'Hintergrundbanner')}
                  </span>
                  {canEditBanner && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={isBusy}
                      onClick={() => setMediaDialogKind('banner')}
                      className="h-7 px-2.5 text-xs gap-1"
                    >
                      <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{t('teams.media.selectOrUpload', 'Bild wählen')}</span>
                    </Button>
                  )}
                </div>
                <div className="h-16 w-full overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container-high shadow-sm">
                  {bannerPreviewSrc ? (
                    <TeamMediaImage src={bannerPreviewSrc} alt="" ariaHidden />
                  ) : (
                    <div className="grid h-full w-full place-items-center text-xs text-on-surface-variant/75">
                      {t('teams.media.defaultPanorama', 'Standard-Atmosphäre')}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Aktionen */}
            <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-outline-variant/25">
              <Button
                type="button"
                variant="ghost"
                disabled={isBusy}
                onClick={onClose}
              >
                {t('common.cancel', 'Abbrechen')}
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={isBusy}
                className="gap-2"
              >
                <Sparkles className="h-4 w-4" />
                <span>
                  {isEdit ? t('common.save', 'Speichern') : t('teams.createAction', 'Erstellen')}
                </span>
              </Button>
            </div>
          </form>
        </div>
      </div>

      {mediaDialogKind && (
        <TeamMediaDialog
          open={true}
          onClose={() => setMediaDialogKind(null)}
          teamId={isEdit ? team?.id ?? null : null}
          kind={mediaDialogKind}
          activePreset={mediaDialogKind === 'avatar' ? avatarPreset : bannerPreset}
          hasCustomMedia={
            isEdit
              ? (mediaDialogKind === 'avatar'
                  ? team?.avatar_source === 'custom'
                  : team?.banner_source === 'custom')
              : Boolean(mediaDialogKind === 'avatar' ? stagedAvatarFile : stagedBannerFile)
          }
          onChanged={async () => {
            await onMediaChanged?.()
          }}
          onSelectStaged={({ presetId, customFile }) => {
            if (mediaDialogKind === 'avatar') {
              if (customFile) {
                setStagedAvatarFile(customFile)
                setStagedAvatarPreview(URL.createObjectURL(customFile))
                setAvatarPreset(null)
              } else {
                setStagedAvatarFile(null)
                setStagedAvatarPreview(null)
                setAvatarPreset(presetId ?? null)
              }
            } else {
              if (customFile) {
                setStagedBannerFile(customFile)
                setStagedBannerPreview(URL.createObjectURL(customFile))
                setBannerPreset(null)
              } else {
                setStagedBannerFile(null)
                setStagedBannerPreview(null)
                setBannerPreset(presetId ?? null)
              }
            }
          }}
        />
      )}
    </>
  )
}
