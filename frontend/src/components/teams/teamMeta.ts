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

const STORAGE_KEY = 'msm_teams_metadata_v1'

function getInitialStore(): Record<number, TeamMetadata> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch (err) {
    still(err, 'teams.getInitialStore')
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
  teamName?: string,
): TeamMetadata {
  const teamId = typeof teamIdOrTeam === 'number' ? teamIdOrTeam : teamIdOrTeam.id
  const resolvedName = typeof teamIdOrTeam === 'number' ? (teamName ?? '') : teamIdOrTeam.name
  const backendTeam = typeof teamIdOrTeam === 'number' ? null : teamIdOrTeam
  const store = getInitialStore()
  const local = store[teamId]

  const defaultCat: TeamCategoryKey = (() => {
    const raw = backendTeam?.category
    if (raw && raw in TEAM_CATEGORIES) return raw as TeamCategoryKey
    if (local?.category && local.category in TEAM_CATEGORIES) return local.category
    const lower = resolvedName.toLowerCase()
    if (lower.includes('msm') || lower.includes('entwickl')) return 'entwicklung'
    if (lower.includes('server') || lower.includes('infra')) return 'infrastruktur'
    if (lower.includes('privat') || lower.includes('intern')) return 'intern'
    return 'projekt'
  })()

  const defaultDesc = (() => {
    if (backendTeam?.description !== undefined && backendTeam?.description !== null) {
      return backendTeam.description
    }
    if (local?.description) return local.description
    const lower = resolvedName.toLowerCase()
    if (lower.includes('echofall')) return 'Community, Server und Entwicklung.'
    if (lower.includes('msm') || lower.includes('entwickl')) return 'Maunting Service Manager & System-Tools.'
    if (lower.includes('server') || lower.includes('infra')) return 'Game-Server, Wartung und Monitoring.'
    if (lower.includes('privat') || lower.includes('intern')) return 'Notizen, Planung und gemeinsame Ideen.'
    return 'Gemeinsame Projekte, Server und Wissensaustausch.'
  })()

  const avatarUrl =
    backendTeam?.avatar_source === 'custom' && backendTeam.avatar_url
      ? `${backendTeam.avatar_url}${backendTeam.avatar_version ? `?v=${backendTeam.avatar_version}` : ''}`
      : (presetUrlForId(backendTeam?.avatar_preset) ?? local?.coverImage ?? TEAM_COVER_PRESETS[0].url)

  const bannerUrl =
    backendTeam?.banner_source === 'custom' && backendTeam.banner_url
      ? `${backendTeam.banner_url}${backendTeam.banner_version ? `?v=${backendTeam.banner_version}` : ''}`
      : presetUrlForId(backendTeam?.banner_preset)

  return {
    category: defaultCat,
    description: defaultDesc,
    coverImage: avatarUrl,
    avatarPreset: backendTeam?.avatar_preset ?? null,
    bannerPreset: backendTeam?.banner_preset ?? null,
    bannerImage: bannerUrl,
    archived: local?.archived,
  }
}

export function setTeamMetadata(teamId: number, meta: Partial<TeamMetadata>): TeamMetadata {
  const store = getInitialStore()
  const existing = store[teamId] ?? {
    category: 'projekt' as TeamCategoryKey,
    description: '',
    coverImage: '/assets/teams/team-cover-holiday.jpg',
  }
  const updated: TeamMetadata = { ...existing, ...meta }
  store[teamId] = updated
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch (err) {
    still(err, 'teams.setTeamMetadata')
  }
  return updated
}

export function toggleTeamArchived(teamId: number, teamName: string): boolean {
  const meta = getTeamMetadata(teamId, teamName)
  const nextArchived = !meta.archived
  setTeamMetadata(teamId, { archived: nextArchived })
  return nextArchived
}
