import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { useAuthStore } from '@/stores/authStore'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'
import { teamsApi } from '@/api/teams'
import * as docsApi from '@/api/docs'
import { SanitizedApiError } from '@/api/client'
import { DocsApp } from './DocsApp'

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

function zeigen() {
  return render(
    <MemoryRouter initialEntries={['/dokumente']}>
      <Routes>
        <Route path="/dokumente" element={<DocsApp />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('DocsApp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({
      user: { id: 7, username: 'tester', email: 't@test.de', is_owner: false } as never,
      isAuthenticated: true,
    })
    usePublicSettingsStore.setState({ docs_enabled: true })
    vi.spyOn(teamsApi, 'list').mockResolvedValue([])
  })

  it('zeigt den leeren Zustand mit Anlegen-Aktion', async () => {
    zeigen()
    await waitFor(() =>
      expect(screen.getByText(i18n.t('docs.list.emptyTitle'))).toBeInTheDocument(),
    )
    expect(
      screen.getAllByRole('button', { name: new RegExp(i18n.t('docs.new')) }).length,
    ).toBeGreaterThan(0)
    expect(docsApi.getDocsStatus).toHaveBeenCalled()
    expect(docsApi.listDocuments).toHaveBeenCalled()
  })

  it('zeigt den Modul-aus-Zustand statt des Editors', async () => {
    usePublicSettingsStore.setState({ docs_enabled: false })
    zeigen()
    expect(screen.getByText(i18n.t('docs.moduleOff.title'))).toBeInTheDocument()
    expect(screen.queryByText(i18n.t('docs.list.emptyTitle'))).not.toBeInTheDocument()
  })

  it('zeigt einen Ladefehler mit Wiederholen statt einer leeren Liste', async () => {
    vi.mocked(docsApi.listDocuments).mockRejectedValueOnce(
      new SanitizedApiError('kaputt', { code: 'DOCS_STORE_FAILED' }),
    )
    zeigen()
    await waitFor(() =>
      expect(screen.getByText(i18n.t('docs.list.errorTitle'))).toBeInTheDocument(),
    )
    expect(screen.getByText(i18n.t('docs.errors.DOCS_STORE_FAILED'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: i18n.t('common.retry') })).toBeInTheDocument()
  })

  it('warnt, wenn der Sidecar nicht erreichbar ist', async () => {
    vi.mocked(docsApi.getDocsStatus).mockResolvedValueOnce({
      enabled: true,
      sidecar_ok: false,
      sidecar_version: null,
      limits: {},
    })
    zeigen()
    await waitFor(() =>
      expect(screen.getByText(i18n.t('docs.status.sidecarDown'))).toBeInTheDocument(),
    )
  })
})
