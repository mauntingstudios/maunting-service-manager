import { api } from './client'
import { apiUrl } from '@/config/api'

export type NewsCategory =
  | 'announcement'
  | 'game_update'
  | 'infrastructure'
  | 'maintenance'
  | 'promo'
  | 'world_news'

export const NEWS_CATEGORIES: readonly NewsCategory[] = [
  'announcement',
  'game_update',
  'infrastructure',
  'maintenance',
  'promo',
  'world_news',
]

export interface NewsSourceItem {
  title: string
  url: string
}

export interface NewsPostPublic {
  slug: string
  title: string
  summary: string
  content_markdown: string
  category: NewsCategory
  related_game_type: string | null
  sources: NewsSourceItem[]
  cover_url: string | null
  is_pinned: boolean
  published_at: string | null
  author_display_name: string | null
  created_at: string
  updated_at: string
}

export interface NewsPostAdmin extends NewsPostPublic {
  id: number
  is_published: boolean
  cover_version: string | null
}

export interface NewsListPublicResponse {
  items: NewsPostPublic[]
  total: number
}

export interface NewsSummaryResponse {
  published_count: number
  latest_published_at: string | null
}

export interface NewsPostCreateInput {
  title: string
  slug?: string | null
  summary?: string
  content_markdown: string
  category: NewsCategory
  related_game_type?: string | null
  sources?: NewsSourceItem[]
  is_published?: boolean
  is_pinned?: boolean
  published_at?: string | null
  author_display_name?: string | null
}

export interface NewsPostUpdateInput {
  title?: string
  slug?: string | null
  summary?: string
  content_markdown?: string
  category?: NewsCategory
  related_game_type?: string | null
  sources?: NewsSourceItem[]
  is_published?: boolean
  is_pinned?: boolean
  published_at?: string | null
  author_display_name?: string | null
}

export function newsCoverSrc(coverUrl: string | null | undefined): string | null {
  if (!coverUrl) return null
  if (/^https?:\/\//i.test(coverUrl)) return coverUrl
  return apiUrl(coverUrl)
}

export function readingTimeMinutes(markdown: string): number {
  const words = (markdown || '').trim().split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.ceil(words / 200))
}

export function autoSlugFromTitle(text: string): string {
  return (text || '')
    .trim()
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
}

export function isValidHttpsUrl(raw: string): boolean {
  try {
    const parsed = new URL((raw || '').trim())
    return parsed.protocol === 'https:' && Boolean(parsed.host)
  } catch {
    return false
  }
}

export const newsApi = {
  listPublic: (params?: {
    category?: NewsCategory
    game_type?: string
    q?: string
    limit?: number
    offset?: number
  }): Promise<NewsListPublicResponse> => {
    const query = new URLSearchParams()
    if (params?.category) query.set('category', params.category)
    if (params?.game_type) query.set('game_type', params.game_type)
    if (params?.q) query.set('q', params.q)
    if (params?.limit !== undefined) query.set('limit', String(params.limit))
    if (params?.offset !== undefined) query.set('offset', String(params.offset))
    const suffix = query.toString() ? `?${query.toString()}` : ''
    return api<NewsListPublicResponse>(`/news${suffix}`)
  },

  getSummary: (): Promise<NewsSummaryResponse> => api<NewsSummaryResponse>('/news/summary'),

  getPublicBySlug: (slug: string): Promise<NewsPostPublic> =>
    api<NewsPostPublic>(`/news/${encodeURIComponent(slug)}`),

  listAdmin: (): Promise<NewsPostAdmin[]> => api<NewsPostAdmin[]>('/news/admin/list'),

  createAdmin: (input: NewsPostCreateInput): Promise<NewsPostAdmin> =>
    api<NewsPostAdmin>('/news/admin', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateAdmin: (postId: number, input: NewsPostUpdateInput): Promise<NewsPostAdmin> =>
    api<NewsPostAdmin>(`/news/admin/${postId}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  deleteAdmin: (postId: number): Promise<void> =>
    api<void>(`/news/admin/${postId}`, { method: 'DELETE' }),

  uploadCover: (postId: number, file: File): Promise<NewsPostAdmin> => {
    const formData = new FormData()
    formData.append('file', file)
    return api<NewsPostAdmin>(`/news/admin/${postId}/cover`, {
      method: 'POST',
      body: formData,
    })
  },

  deleteCover: (postId: number): Promise<NewsPostAdmin> =>
    api<NewsPostAdmin>(`/news/admin/${postId}/cover`, { method: 'DELETE' }),
}
