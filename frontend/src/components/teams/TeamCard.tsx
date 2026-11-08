import {
  ArrowRight,
  ChevronRight,
  MoreHorizontal,
  Pencil,
  Trash2,
  LogOut,
  Archive,
  ArchiveRestore,
  Users,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ActionMenu, type ActionMenuItem } from '@maunting/ui'
import { AvatarGroup, type AvatarGroupItem } from './AvatarGroup'
import {
  TEAM_CATEGORIES,
  getTeamMetadata,
  type TeamMetadata,
} from './teamMeta'
import type { Team, TeamMember } from '@/api/teams'

export interface TeamCardProps {
  team: Team
  members?: TeamMember[]
  onOpen: (teamId: number) => void
  onEdit?: (team: Team, meta: TeamMetadata) => void
  onArchiveToggle?: (team: Team) => void
  onDelete?: (team: Team) => void
  onLeave?: (team: Team) => void
  viewMode?: 'grid' | 'list'
  className?: string
}

/**
 * Präsentationskarte für ein Team im Dashboard-Raster oder in der Listenansicht.
 */
export function TeamCard({
  team,
  members = [],
  onOpen,
  onEdit,
  onArchiveToggle,
  onDelete,
  onLeave,
  viewMode = 'grid',
  className = '',
}: TeamCardProps) {
  const { t } = useTranslation()
  const meta = getTeamMetadata(team.id, team.name)
  const categoryDef = TEAM_CATEGORIES[meta.category] ?? TEAM_CATEGORIES.projekt
  const CategoryIcon = categoryDef.icon

  const avatarItems: AvatarGroupItem[] = members.map((m) => ({
    id: m.user_id,
    name: m.username,
    src: m.avatar_url,
  }))

  const displayedAvatars: AvatarGroupItem[] =
    avatarItems.length > 0
      ? avatarItems
      : Array.from({ length: Math.min(team.member_count, 6) }, (_, i) => ({
          id: `placeholder-${team.id}-${i}`,
          name: i === 0 ? 'Admin' : `Mitglied ${i + 1}`,
        }))

  const menuItems: ActionMenuItem[] = [
    {
      key: 'open',
      label: t('teams.open', 'Öffnen'),
      icon: <ArrowRight className="h-4 w-4" />,
      onSelect: () => onOpen(team.id),
    },
    ...(onEdit
      ? [
          {
            key: 'edit',
            label: t('common.edit', 'Bearbeiten'),
            icon: <Pencil className="h-4 w-4" />,
            onSelect: () => onEdit(team, meta),
          },
        ]
      : []),
    ...(onArchiveToggle
      ? [
          {
            key: 'archive',
            label: meta.archived
              ? t('teams.unarchive', 'Wiederherstellen')
              : t('teams.archive', 'Archivieren'),
            icon: meta.archived ? (
              <ArchiveRestore className="h-4 w-4" />
            ) : (
              <Archive className="h-4 w-4" />
            ),
            onSelect: () => onArchiveToggle(team),
          },
        ]
      : []),
    ...(team.is_owner && onDelete
      ? [
          {
            key: 'delete',
            label: t('common.delete', 'Löschen'),
            icon: <Trash2 className="h-4 w-4" />,
            destructive: true,
            onSelect: () => onDelete(team),
          },
        ]
      : []),
    ...(!team.is_owner && onLeave
      ? [
          {
            key: 'leave',
            label: t('teams.leave', 'Verlassen'),
            icon: <LogOut className="h-4 w-4" />,
            destructive: true,
            onSelect: () => onLeave(team),
          },
        ]
      : []),
  ]

  // Listenansicht
  if (viewMode === 'list') {
    return (
      <article
        onClick={() => onOpen(team.id)}
        style={{
          borderLeftWidth: '4px',
          borderLeftColor: categoryDef.colorHex,
          boxShadow: categoryDef.glowShadow,
        }}
        className={`group relative flex cursor-pointer items-center justify-between gap-3 sm:gap-4 rounded-2xl border border-outline-variant/30 bg-surface-container-high/65 p-3 sm:p-4 backdrop-blur-xl transition-all duration-200 hover:border-outline-variant/60 hover:bg-surface-container-high/85 ${className}`}
      >
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <div className="relative h-14 w-14 sm:h-16 sm:w-16 shrink-0 overflow-hidden rounded-xl border border-outline-variant/30">
            <img
              src={meta.coverImage}
              alt=""
              aria-hidden="true"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          </div>

          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-headline text-base sm:text-lg font-bold tracking-tight text-on-surface truncate">
                {team.name}
              </h3>
              <span
                style={{
                  backgroundColor: categoryDef.bgHex,
                  borderColor: categoryDef.borderHex,
                  borderWidth: '1px',
                  color: categoryDef.colorHex,
                }}
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-label-sm font-semibold"
              >
                <CategoryIcon className="h-3 w-3" aria-hidden="true" />
                <span>{categoryDef.label}</span>
              </span>
            </div>
            <p className="text-xs text-on-surface-variant truncate max-w-md hidden sm:block">
              {meta.description}
            </p>
            <div className="flex items-center gap-1.5 text-xs text-on-surface-variant">
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{team.member_count} {t('teams.membersCount', 'Mitglieder')}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
          <div className="hidden md:block">
            <AvatarGroup items={displayedAvatars} max={3} size="xs" />
          </div>
          <ActionMenu
            label={t('teams.actions', 'Aktionen')}
            iconOnly
            icon={<MoreHorizontal className="h-4 w-4" />}
            variant="ghost"
            align="end"
            items={menuItems}
          />
          <button
            type="button"
            onClick={() => onOpen(team.id)}
            aria-label={`${team.name} öffnen`}
            className="grid h-9 w-9 place-items-center rounded-full border border-outline-variant/30 bg-surface-container-high/60 text-on-surface-variant hover:text-primary hover:bg-primary/10 transition-colors"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </article>
    )
  }

  // Rasteransicht (2-spaltig oder responsive 1-spaltig)
  return (
    <article
      style={{
        borderLeftWidth: '4px',
        borderLeftColor: categoryDef.colorHex,
        boxShadow: categoryDef.glowShadow,
      }}
      className={`group relative flex flex-col justify-between overflow-hidden rounded-2xl sm:rounded-3xl border border-outline-variant/30 bg-surface-container-high/65 p-4 sm:p-5 backdrop-blur-xl transition-all duration-300 hover:border-outline-variant/60 hover:bg-surface-container-high/85 hover:-translate-y-0.5 ${className}`}
    >
      <div className="flex gap-4">
        {/* Cover-Bild links */}
        <div className="relative h-28 w-24 sm:h-32 sm:w-28 shrink-0 overflow-hidden rounded-2xl border border-outline-variant/30 shadow-md">
          <img
            src={meta.coverImage}
            alt=""
            aria-hidden="true"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent pointer-events-none" />
        </div>

        {/* Content rechts */}
        <div className="min-w-0 flex-1 flex flex-col justify-between">
          <div>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex items-center gap-1.5">
                <Users className="h-4 w-4 shrink-0 text-on-surface-variant/80" aria-hidden="true" />
                <h3 className="font-headline text-base sm:text-lg font-bold tracking-tight text-on-surface truncate">
                  {team.name}
                </h3>
              </div>

              <div onClick={(e) => e.stopPropagation()}>
                <ActionMenu
                  label={t('teams.actions', 'Aktionen')}
                  iconOnly
                  icon={<MoreHorizontal className="h-4 w-4" />}
                  variant="ghost"
                  align="end"
                  items={menuItems}
                />
              </div>
            </div>

            {/* Kategorie Badge */}
            <div className="mt-1.5">
              <span
                style={{
                  backgroundColor: categoryDef.bgHex,
                  borderColor: categoryDef.borderHex,
                  borderWidth: '1px',
                  color: categoryDef.colorHex,
                }}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-label-sm font-semibold tracking-wide"
              >
                <CategoryIcon className="h-3 w-3" aria-hidden="true" />
                <span>{categoryDef.label}</span>
              </span>
            </div>

            {/* Beschreibung */}
            <p className="mt-2 text-xs text-on-surface-variant line-clamp-2 leading-relaxed">
              {meta.description}
            </p>
          </div>
        </div>
      </div>

      {/* Fußzeile mit Avataren und Öffnen-Aktion */}
      <div className="mt-4 flex items-center justify-between border-t border-outline-variant/25 pt-3.5">
        <AvatarGroup items={displayedAvatars} max={3} size="sm" />

        <button
          type="button"
          onClick={() => onOpen(team.id)}
          className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant/30 bg-surface-container-high/80 px-3.5 py-1.5 text-xs font-semibold text-on-surface hover:border-primary/40 hover:bg-primary/10 hover:text-primary transition-all active:scale-95"
        >
          <span>{t('teams.open', 'Öffnen')}</span>
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </article>
  )
}
