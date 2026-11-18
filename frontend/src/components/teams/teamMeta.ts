import type { LucideIcon } from 'lucide-react'
import {
  Code2,
  FolderKanban,
  Gamepad2,
  Globe,
  Lock,
  Server,
} from 'lucide-react'
import { still } from '@/lib/still'

export type TeamCategoryKey =
  | 'projekt'
  | 'entwicklung'
  | 'infrastruktur'
  | 'intern'
  | 'community'
  | 'gaming'

export interface TeamCategoryDef {
  key: TeamCategoryKey
  label: string
  icon: LucideIcon
  colorHex: string
  bgHex: string
  borderHex: string
  glowShadow: string
}

export const TEAM_CATEGORIES: Record<TeamCategoryKey, TeamCategoryDef> = {
  projekt: {
    key: 'projekt',
    label: 'Projekt',
    icon: FolderKanban,
    colorHex: '#22d3ee',
    bgHex: 'rgba(6, 182, 212, 0.12)',
    borderHex: 'rgba(6, 182, 212, 0.35)',
    glowShadow: '0 0 20px -3px rgba(6, 182, 212, 0.18)',
  },
  entwicklung: {
    key: 'entwicklung',
    label: 'Entwicklung',
    icon: Code2,
    colorHex: '#c084fc',
    bgHex: 'rgba(168, 85, 247, 0.12)',
    borderHex: 'rgba(168, 85, 247, 0.35)',
    glowShadow: '0 0 20px -3px rgba(168, 85, 247, 0.18)',
  },
  infrastruktur: {
    key: 'infrastruktur',
    label: 'Infrastruktur',
    icon: Server,
    colorHex: '#34d399',
    bgHex: 'rgba(16, 185, 129, 0.12)',
    borderHex: 'rgba(16, 185, 129, 0.35)',
    glowShadow: '0 0 20px -3px rgba(16, 185, 129, 0.18)',
  },
  intern: {
    key: 'intern',
    label: 'Intern',
    icon: Lock,
    colorHex: '#fbbf24',
    bgHex: 'rgba(245, 158, 11, 0.12)',
    borderHex: 'rgba(245, 158, 11, 0.35)',
    glowShadow: '0 0 20px -3px rgba(245, 158, 11, 0.18)',
  },
  community: {
    key: 'community',
    label: 'Community',
    icon: Globe,
    colorHex: '#60a5fa',
    bgHex: 'rgba(59, 130, 246, 0.12)',
    borderHex: 'rgba(59, 130, 246, 0.35)',
    glowShadow: '0 0 20px -3px rgba(59, 130, 246, 0.18)',
  },
  gaming: {
    key: 'gaming',
    label: 'Gaming',
    icon: Gamepad2,
    colorHex: '#fb7185',
    bgHex: 'rgba(244, 63, 94, 0.12)',
    borderHex: 'rgba(244, 63, 94, 0.35)',
    glowShadow: '0 0 20px -3px rgba(244, 63, 94, 0.18)',
  },
}

export interface TeamCoverPreset {
  id: string
  title: string
  url: string
}

export const TEAM_COVER_PRESETS: TeamCoverPreset[] = [
  { id: 'holiday', title: 'Urlaub & Reisen', url: '/assets/teams/team-cover-holiday.jpg' },
  { id: 'privat', title: 'Gemütliche Blockhütte & Persönliches', url: '/assets/teams/team-cover-privat.jpg' },
  { id: 'msm', title: 'Entwickler-Setup & PC', url: '/assets/teams/team-cover-msm.jpg' },
  { id: 'gaming', title: 'Gaming & Spieleabend', url: '/assets/teams/team-cover-gaming.jpg' },
  { id: 'server', title: 'Server & Infrastruktur', url: '/assets/teams/team-cover-server.jpg' },
  { id: 'echofall', title: 'Projekt & Planung', url: '/assets/teams/team-cover-echofall.jpg' },
  { id: 'dokumente', title: 'Akten & Dokumente', url: '/tresor-kategorien/dokumente.webp' },
  { id: 'arbeit', title: 'Büro & Organisation', url: '/tresor-kategorien/arbeit.webp' },
  { id: 'studio', title: 'Studio & Notizen', url: '/tresor-kategorien/studio.webp' },
  { id: 'medien', title: 'Medien & Design', url: '/tresor-kategorien/medien.webp' },
]

export interface TeamMetadata {
  category: TeamCategoryKey
  description: string
  coverImage: string
  avatarPreset?: string | null
  bannerPreset?: string | null
  bannerImage?: string | null
  archived?: boolean
}

export function presetUrlForId(presetId: string | null | undefined): string | null {
  if (!presetId) return null
  return TEAM_COVER_PRESETS.find((p) => p.id === presetId)?.url ?? null
}

const STORAGE_KEY = 'msm_teams_archive_v1'
const LEGACY_STORAGE_KEY = 'msm_teams_metadata_v1'

function getArchiveStore(): Record<number, boolean> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (legacy) {
      const parsed = JSON.parse(legacy) as Record<string, { archived?: boolean }>
      const migrated: Record<number, boolean> = {}
      for (const [id, entry] of Object.entries(parsed)) {
        if (entry?.archived) migrated[Number(id)] = true
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated))
      localStorage.removeItem(LEGACY_STORAGE_KEY)
      return migrated
    }
  } catch (err) {
    still(err, 'teams.getArchiveStore')
  }
  return {}
}

export function getTeamMetadata(
  teamIdOrTeam: number | {
    id: number
    name: string
    category?: string | null
    description?: string | null
    avatar_source?: string | null
    avatar_preset?: string | null
    avatar_url?: string | null
    avatar_version?: string | null
    banner_source?: string | null
    banner_preset?: string | null
    banner_url?: string | null
    banner_version?: string | null
  },
  _teamName?: string,
): TeamMetadata {
  const teamId = typeof teamIdOrTeam === 'number' ? teamIdOrTeam : teamIdOrTeam.id
  const backendTeam = typeof teamIdOrTeam === 'number' ? null : teamIdOrTeam
  const archivedMap = getArchiveStore()

  const category: TeamCategoryKey =
    backendTeam?.category && backendTeam.category in TEAM_CATEGORIES
      ? (backendTeam.category as TeamCategoryKey)
      : 'projekt'

  const description = backendTeam?.description ?? ''

  const avatarUrl =
    backendTeam?.avatar_source === 'custom' && backendTeam.avatar_url
      ? `${backendTeam.avatar_url}${backendTeam.avatar_version ? `?v=${backendTeam.avatar_version}` : ''}`
      : (presetUrlForId(backendTeam?.avatar_preset) ?? TEAM_COVER_PRESETS[0].url)

  const bannerUrl =
    backendTeam?.banner_source === 'custom' && backendTeam.banner_url
      ? `${backendTeam.banner_url}${backendTeam.banner_version ? `?v=${backendTeam.banner_version}` : ''}`
      : presetUrlForId(backendTeam?.banner_preset)

  return {
    category,
    description,
    coverImage: avatarUrl,
    avatarPreset: backendTeam?.avatar_preset ?? null,
    bannerPreset: backendTeam?.banner_preset ?? null,
    bannerImage: bannerUrl,
    archived: Boolean(archivedMap[teamId]),
  }
}

export function toggleTeamArchived(teamId: number, _teamName?: string): boolean {
  const archivedMap = getArchiveStore()
  const nextArchived = !archivedMap[teamId]
  if (nextArchived) {
    archivedMap[teamId] = true
  } else {
    delete archivedMap[teamId]
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(archivedMap))
  } catch (err) {
    still(err, 'teams.toggleTeamArchived')
  }
  return nextArchived
}
