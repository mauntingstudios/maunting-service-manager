import { useState, useEffect, type FormEvent } from 'react'
import { Check, Sparkles, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button, Dropdown, Input, type DropdownOption } from '@maunting/ui'
import {
  TEAM_CATEGORIES,
  TEAM_COVER_PRESETS,
  type TeamCategoryKey,
  type TeamMetadata,
} from './teamMeta'

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
  const isBusy = busy || submitting

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="team-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isBusy) onClose()
      }}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-3xl border border-outline-variant/40 bg-surface-container-high/95 p-6 shadow-2xl backdrop-blur-2xl transition-all duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-outline-variant/25 pb-4">
          <div className="min-w-0">
            <h2
              id="team-modal-title"
              className="font-headline text-xl font-bold tracking-tight text-on-surface"
            >
              {isEdit
                ? t('teams.editTeamTitle', 'Team bearbeiten')
                : t('teams.createTeamTitle', 'Neues Team erstellen')}
            </h2>
            <p className="mt-1 text-xs text-on-surface-variant">
              {isEdit
                ? t('teams.editTeamSubtitle', 'Passe Metadaten, Kategorie und Titelbild dieses Teams an.')
                : t('teams.createTeamSubtitle', 'Gib deinem Team einen passenden Namen, wähle eine Kategorie und ein Cover.')}
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
          <div className="space-y-1.5">
            <label
              htmlFor="team-name-input"
              className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant"
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
            />
          </div>

          {/* Kategorie mit Design-DNA Dropdown (VERBOT NATIVEN HTML SELECTS) */}
          <div className="space-y-1.5">
            <label
              id="team-category-label"
              className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant"
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
          <div className="space-y-1.5">
            <label
              htmlFor="team-desc-input"
              className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant"
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
            />
          </div>

          {/* Cover-Bild Auswahl */}
          <div className="space-y-2 pt-1">
            <label className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              {t('teams.coverPresetLabel', 'Titelbild auswählen')}
            </label>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
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
                        : 'border-outline-variant/30 opacity-75 hover:opacity-100 hover:border-outline-variant/70'
                    }`}
                  >
                    <img
                      src={preset.url}
                      alt={preset.title}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                    <span className="absolute bottom-1.5 left-2 right-2 text-label-sm font-semibold leading-tight text-white drop-shadow">
                      {preset.title}
                    </span>
                    {isSelected && (
                      <span className="absolute top-1.5 right-1.5 grid h-5 w-5 place-items-center rounded-full bg-primary text-on-primary shadow">
                        <Check className="h-3 w-3 stroke-[3]" />
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
