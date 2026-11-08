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
  archived?: boolean
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

export function getTeamMetadata(teamId: number, teamName: string): TeamMetadata {
  const store = getInitialStore()
  if (store[teamId]) {
    return store[teamId]
  }

  const lower = teamName.toLowerCase()
  if (lower.includes('echofall')) {
    return {
      category: 'projekt',
      description: 'Community, Server und Entwicklung.',
      coverImage: '/assets/teams/team-cover-holiday.jpg',
    }
  }
  if (lower.includes('msm') || lower.includes('entwickl')) {
    return {
      category: 'entwicklung',
      description: 'Maunting Service Manager & System-Tools.',
      coverImage: '/assets/teams/team-cover-msm.jpg',
    }
  }
  if (lower.includes('server') || lower.includes('infra')) {
    return {
      category: 'infrastruktur',
      description: 'Game-Server, Wartung und Monitoring.',
      coverImage: '/assets/teams/team-cover-server.jpg',
    }
  }
  if (lower.includes('privat') || lower.includes('intern')) {
    return {
      category: 'intern',
      description: 'Notizen, Planung und gemeinsame Ideen.',
      coverImage: '/assets/teams/team-cover-privat.jpg',
    }
  }

  return {
    category: 'projekt',
    description: 'Gemeinsame Projekte, Server und Wissensaustausch.',
    coverImage: '/assets/teams/team-cover-holiday.jpg',
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
