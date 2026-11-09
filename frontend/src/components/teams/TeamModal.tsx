import { useState, useEffect, useRef, type FormEvent } from 'react'
import { Check, Sparkles, Upload, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button, Dropdown, Input, type DropdownOption } from '@maunting/ui'
import {
  TEAM_CATEGORIES,
  TEAM_COVER_PRESETS,
  type TeamCategoryKey,
  type TeamMetadata,
} from './teamMeta'
import { bildAlsHintergrund } from '@/features/chatHintergrund/bild'
import { still } from '@/lib/still'

export interface TeamModalProps {
  isOpen: boolean
  mode: 'create' | 'edit'
  initialName?: string
  initialMeta?: TeamMetadata
  busy?: boolean
  onClose: () => void
  onSubmit: (payload: {
    name: string
    category: TeamCategoryKey
    description: string
    coverImage: string
  }) => Promise<void>
}

export function TeamModal({
  isOpen,
  mode,
  initialName = '',
  initialMeta,
  busy = false,
  onClose,
  onSubmit,
}: TeamModalProps) {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [name, setName] = useState(initialName)
  const [category, setCategory] = useState<TeamCategoryKey>(
    initialMeta?.category ?? 'projekt',
  )
  const [description, setDescription] = useState(
    initialMeta?.description ?? '',
  )
  const [coverImage, setCoverImage] = useState(
    initialMeta?.coverImage ?? TEAM_COVER_PRESETS[0].url,
  )
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [processingImage, setProcessingImage] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setName(initialName)
      setCategory(initialMeta?.category ?? 'projekt')
      setDescription(initialMeta?.description ?? '')
      setCoverImage(initialMeta?.coverImage ?? TEAM_COVER_PRESETS[0].url)
      setError(null)
    }
  }, [isOpen, initialName, initialMeta])

  if (!isOpen) return null

  const categoryOptions: DropdownOption[] = Object.values(TEAM_CATEGORIES).map(
    (cat) => {
      const IconComp = cat.icon
      return {
        value: cat.key,
        label: cat.label,
        icon: <IconComp className="h-4 w-4" />,
      }
    },
  )

  const handleCustomUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setProcessingImage(true)
    setError(null)
    try {
      const dataUrl = await bildAlsHintergrund(file)
      if (dataUrl) {
        setCoverImage(dataUrl)
      } else {
        setError(t('teams.imageTooLarge', 'Das Bild konnte nicht optimiert werden. Bitte wähle eine Bilddatei aus.'))
      }
    } catch (err) {
      still(err, 'teams.handleCustomUpload')
      setError(t('teams.imageProcessingError', 'Fehler beim Laden des Bildes.'))
    } finally {
      setProcessingImage(false)
    }
  }

  const isCustomCover =
    Boolean(coverImage) &&
    !TEAM_COVER_PRESETS.some((preset) => preset.url === coverImage)

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
        coverImage,
      })
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('common.error', 'Ein Fehler ist aufgetreten'))
    } finally {
      setSubmitting(false)
    }
  }

  const isEdit = mode === 'edit'
  const isBusy = busy || submitting || processingImage

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="team-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isBusy) onClose()
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
                ? t('teams.editTeamSubtitle', 'Passe Metadaten, Kategorie und Titelbild dieses Teams an.')
                : t('teams.createTeamSubtitle', 'Gib deinem Team einen Namen, wähle eine Kategorie und ein Cover.')}
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

        {/* Formular */}
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

          {/* Kategorie mit Design-DNA Dropdown (VERBOT NATIVEN HTML SELECTS) */}
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

          {/* Cover-Bild Auswahl & Upload */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-medium text-on-surface-variant">
                {t('teams.coverPresetLabel', 'Titelbild auswählen')}
              </label>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline focus:outline-none"
              >
                <Upload className="h-3.5 w-3.5" />
                <span>{isCustomCover ? t('teams.changeCustomCover', 'Eigenes Bild ändern') : t('teams.uploadCustomCover', 'Eigenes Bild hochladen')}</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleCustomUpload}
                className="hidden"
                aria-label={t('teams.uploadCustomCover', 'Eigenes Bild hochladen')}
              />
            </div>

            {/* Custom Cover Preview wenn aktiv */}
            {isCustomCover && (
              <div className="relative aspect-[16/6] w-full overflow-hidden rounded-xl border border-primary ring-2 ring-primary/40 shadow-md">
                <img
                  src={coverImage}
                  alt={t('teams.customCoverActive', 'Eigenes Titelbild')}
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                <span className="absolute bottom-2 left-3 text-xs font-semibold text-white drop-shadow">
                  {t('teams.customCoverActive', 'Eigenes Titelbild')}
                </span>
                <span className="absolute top-2 right-2 grid h-6 w-6 place-items-center rounded-full bg-primary text-on-primary shadow">
                  <Check className="h-3.5 w-3.5 stroke-[3]" />
                </span>
              </div>
            )}

            {/* 10 Kuratierte Presets */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {TEAM_COVER_PRESETS.map((preset) => {
                const isSelected = coverImage === preset.url
                return (
                  <button
                    key={preset.id}
                    type="button"
                    disabled={isBusy}
                    onClick={() => setCoverImage(preset.url)}
                    className={`group relative aspect-[4/3] overflow-hidden rounded-xl border text-left transition-all ${
                      isSelected
                        ? 'border-primary ring-2 ring-primary/40 scale-[1.02] shadow-md'
                        : 'border-outline-variant/30 opacity-80 hover:opacity-100 hover:border-outline-variant/70'
                    }`}
                  >
                    <img
                      src={preset.url}
                      alt={preset.title}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
                    <span className="absolute bottom-1.5 left-1.5 right-1.5 text-label-sm font-semibold leading-tight text-white drop-shadow truncate">
                      {preset.title}
                    </span>
                    {isSelected && (
                      <span className="absolute top-1.5 right-1.5 grid h-4 w-4 place-items-center rounded-full bg-primary text-on-primary shadow">
                        <Check className="h-2.5 w-2.5 stroke-[3]" />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Buttons */}
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
              {isEdit ? (
                <>
                  <Sparkles className="h-4 w-4" />
                  <span>{t('common.save', 'Speichern')}</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  <span>{t('teams.createAction', 'Erstellen')}</span>
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
