import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { useAuthStore } from '@/stores/authStore'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'
import { teamsApi } from '@/api/teams'
import { DocsEmbedded } from './DocsEmbedded'

vi.mock('@/api/docs', async (importOriginal) => {
  const echt = await importOriginal<typeof import('@/api/docs')>()
  return {
    ...echt,
    getDocsStatus: vi.fn(async () => ({
      enabled: true,
      sidecar_ok: true,
      sidecar_version: '1.0.0',
      limits: {},
    })),
    listDocuments: vi.fn(async () => []),
    listFolders: vi.fn(async () => []),
    getDocument: vi.fn(),
  }
})

describe('DocsEmbedded', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({
      user: { id: 7, username: 'tester', email: 't@test.de', is_owner: false } as never,
      isAuthenticated: true,
    })
    usePublicSettingsStore.setState({ docs_enabled: true })
    vi.spyOn(teamsApi, 'list').mockResolvedValue([])
  })

  it('rendert fehlerfrei innerhalb eines bestehenden MemoryRouters (Pontis/MSS-Umgebung)', () => {
    expect(() => {
      render(
        <MemoryRouter initialEntries={['/dokumente']}>
          <DocsEmbedded />
        </MemoryRouter>,
      )
    }).not.toThrow()
  })

  it('rendert den Dokumente-Inhalt ohne Router-Kollision', async () => {
    render(
      <MemoryRouter initialEntries={['/dokumente']}>
        <DocsEmbedded />
      </MemoryRouter>,
    )
    await waitFor(() =>
      expect(screen.getByText(i18n.t('docs.list.emptyTitle'))).toBeInTheDocument(),
    )
    expect(
      screen.getAllByRole('button', { name: new RegExp(i18n.t('docs.new')) }).length,
    ).toBeGreaterThan(0)
  })
})
