import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'
import { NewsOverview } from './NewsOverview'

const { listPublicMock } = vi.hoisted(() => ({
  listPublicMock: vi.fn(),
}))

vi.mock('@/hooks/useHasPermission', () => ({
  useHasPermission: () => true,
}))

vi.mock('@/api/news', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/news')>()
  return {
    ...actual,
    newsApi: {
      ...actual.newsApi,
      listPublic: listPublicMock,
    },
  }
})

const POST_LEAD = {
  slug: 'palworld-crossplay-update',
  title: 'Palworld bekommt Crossplay-Server',
  summary: 'Alle Server unterstützen ab sofort Crossplay.',
  content_markdown: '## Details\nDas Update ist sofort verfügbar.',
  category: 'game_update' as const,
  related_game_type: 'palworld',
  sources: [{ title: 'Patchnotes', url: 'https://example.com/patch' }],
  cover_url: null,
  is_pinned: true,
  published_at: '2026-11-24T10:00:00+00:00',
  author_display_name: 'Redaktion',
  created_at: '2026-11-24T10:00:00+00:00',
  updated_at: '2026-11-24T10:00:00+00:00',
}

const POST_SECOND = {
  slug: 'wartung-frankfurt-dc',
  title: 'Netzwerk-Wartung in Frankfurt',
  summary: 'Kurzes Wartungsfenster am Sonntagmorgen.',
  content_markdown: 'Zwischen 04:00 und 04:30 Uhr.',
  category: 'maintenance' as const,
  related_game_type: null,
  sources: [],
  cover_url: null,
  is_pinned: false,
  published_at: '2026-11-23T08:00:00+00:00',
  author_display_name: 'Betrieb',
  created_at: '2026-11-23T08:00:00+00:00',
  updated_at: '2026-11-23T08:00:00+00:00',
}

describe('NewsOverview', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de')
    usePublicSettingsStore.setState({ shop_enabled: true })
    listPublicMock.mockReset()
  })

  it('rendert Lead-Artikel, Karten-Grid und filtert nach Kategorie', async () => {
    listPublicMock
      .mockResolvedValueOnce({ items: [POST_LEAD, POST_SECOND], total: 2 })
      .mockResolvedValueOnce({ items: [POST_LEAD], total: 1 })

    render(
      <MemoryRouter>
        <NewsOverview />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Palworld bekommt Crossplay-Server')).toBeInTheDocument()
    expect(screen.getByText('Netzwerk-Wartung in Frankfurt')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Neuigkeiten verwalten/i })).toHaveAttribute(
      'href',
      '/settings?tab=news',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Spiel-Update' }))

    await waitFor(() => {
      expect(listPublicMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ category: 'game_update' }),
      )
    })
  })

  it('zeigt einen sauberen Leerzustand ohne Beiträge', async () => {
    listPublicMock.mockResolvedValue({ items: [], total: 0 })

    render(
      <MemoryRouter>
        <NewsOverview />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Noch keine Beiträge veröffentlicht')).toBeInTheDocument()
  })
})
