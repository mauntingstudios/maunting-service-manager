import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { useAuthStore } from '@/stores/authStore'
import { NewsTab } from './NewsTab'

const { listAdminMock, createAdminMock, apiMock } = vi.hoisted(() => ({
  listAdminMock: vi.fn(),
  createAdminMock: vi.fn(),
  apiMock: vi.fn(),
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
      listAdmin: listAdminMock,
      createAdmin: createAdminMock,
    },
  }
})

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return {
    ...actual,
    api: apiMock,
  }
})

describe('NewsTab Editorial CMS', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de')
    useAuthStore.setState({ user: { id: 1, username: 'admin' } as never })
    listAdminMock.mockReset()
    createAdminMock.mockReset()
    apiMock.mockReset()
    apiMock.mockResolvedValue([{ id: 'palworld', name: 'Palworld' }])
  })

  it('listet Entwürfe, öffnet Editor mit Live-Vorschau und legt Beitrag samt Quellen an', async () => {
    listAdminMock.mockResolvedValue([
      {
        id: 1,
        slug: 'erster-entwurf',
        title: 'Erster Entwurf im CMS',
        summary: 'Kurztext',
        content_markdown: 'Hallo Welt',
        category: 'world_news',
        related_game_type: null,
        sources: [{ title: 'Patchlog', url: 'https://example.com/news' }],
        cover_url: null,
        cover_version: null,
        is_published: false,
        is_pinned: false,
        published_at: null,
        author_display_name: 'admin',
        created_at: '2026-11-24T10:00:00+00:00',
        updated_at: '2026-11-24T10:00:00+00:00',
      },
    ])
    createAdminMock.mockResolvedValue({
      id: 2,
      slug: 'palworld-server-patch',
      title: 'Palworld Server Patch',
      summary: 'Neue Speicher-Optimierung.',
      content_markdown: '**Wichtig:** Update ist da.',
      category: 'announcement',
      related_game_type: null,
      sources: [{ title: 'Pocketpair', url: 'https://example.org/palworld' }],
      cover_url: null,
      cover_version: null,
      is_published: false,
      is_pinned: false,
      published_at: null,
      author_display_name: 'admin',
      created_at: '2026-11-24T11:00:00+00:00',
      updated_at: '2026-11-24T11:00:00+00:00',
    })

    render(
      <MemoryRouter>
        <NewsTab />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Erster Entwurf im CMS')).toBeInTheDocument()
    expect(screen.getByText('KI-Redaktion & Welt-News-Kuration')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Neuer Beitrag' }))

    fireEvent.change(screen.getByLabelText(/^Überschrift \*/i), {
      target: { value: 'Palworld Server Patch' },
    })
    fireEvent.change(screen.getByLabelText(/Kurzfassung/i), {
      target: { value: 'Neue Speicher-Optimierung.' },
    })
    fireEvent.change(screen.getByPlaceholderText(/Schreibe den Artikel/i), {
      target: { value: '**Wichtig:** Update ist da.' },
    })

    // Live-Vorschau pruefen
    fireEvent.click(screen.getByRole('button', { name: 'Live-Vorschau' }))
    expect(await screen.findByText('Wichtig:')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Schreiben' }))

    // Quelle hinzufuegen
    fireEvent.click(screen.getByRole('button', { name: 'Quelle hinzufügen' }))
    fireEvent.change(screen.getByLabelText('Quellentitel'), {
      target: { value: 'Pocketpair' },
    })
    fireEvent.change(screen.getByLabelText('Quellen-URL (https://)'), {
      target: { value: 'https://example.org/palworld' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(createAdminMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Palworld Server Patch',
          slug: 'palworld-server-patch',
          summary: 'Neue Speicher-Optimierung.',
          content_markdown: '**Wichtig:** Update ist da.',
          sources: [{ title: 'Pocketpair', url: 'https://example.org/palworld' }],
        }),
      )
    })
  })
})
