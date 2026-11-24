import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'
import { NewsDetail } from './NewsDetail'

const { getBySlugMock } = vi.hoisted(() => ({
  getBySlugMock: vi.fn(),
}))

vi.mock('@/api/news', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/news')>()
  return {
    ...actual,
    newsApi: {
      ...actual.newsApi,
      getPublicBySlug: getBySlugMock,
    },
  }
})

describe('NewsDetail', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de')
    usePublicSettingsStore.setState({ shop_enabled: true })
    getBySlugMock.mockReset()
  })

  it('rendert Markdown-Inhalt, sichere HTTPS-Quellen und CTA zum verknüpften Shop-Spiel', async () => {
    getBySlugMock.mockResolvedValue({
      slug: 'minecraft-tricky-trials',
      title: 'Minecraft 1.21 Update live',
      summary: 'Neue Prüfungen und bessere Tick-Leistung.',
      content_markdown: '## Änderungen\n**Neue Blöcke** und optimierter Server-Kern.',
      category: 'game_update',
      related_game_type: 'minecraft',
      sources: [
        { title: 'Minecraft Changelog', url: 'https://www.minecraft.net/changelog' },
        { title: 'Ungültig HTTP', url: 'http://insecure.example.com' },
      ],
      cover_url: '/api/news/minecraft-tricky-trials/cover?v=abc123',
      is_pinned: false,
      published_at: '2026-11-24T12:00:00+00:00',
      author_display_name: 'Redaktion',
      created_at: '2026-11-24T12:00:00+00:00',
      updated_at: '2026-11-24T12:00:00+00:00',
    })

    render(
      <MemoryRouter initialEntries={['/news/minecraft-tricky-trials']}>
        <Routes>
          <Route path="/news/:slug" element={<NewsDetail />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Minecraft 1.21 Update live')).toBeInTheDocument()
    expect(screen.getByText('Neue Blöcke')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Minecraft Changelog' })).toHaveAttribute(
      'href',
      'https://www.minecraft.net/changelog',
    )
    expect(screen.queryByRole('link', { name: 'Ungültig HTTP' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Server konfigurieren/i })).toHaveAttribute(
      'href',
      '/shop/minecraft',
    )
  })

  it('zeigt Fehlerzustand bei fehlendem Beitrag', async () => {
    getBySlugMock.mockRejectedValue(new Error('404'))

    render(
      <MemoryRouter initialEntries={['/news/gibts-nicht']}>
        <Routes>
          <Route path="/news/:slug" element={<NewsDetail />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Beitrag nicht gefunden')).toBeInTheDocument()
  })
})
