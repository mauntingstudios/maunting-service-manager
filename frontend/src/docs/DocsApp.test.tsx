import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { useAuthStore } from '@/stores/authStore'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'
import { teamsApi } from '@/api/teams'
import * as docsApi from '@/api/docs'
import { SanitizedApiError } from '@/api/client'
import { DocsApp } from './DocsApp'
import { useDocsStore } from './docsStore'

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

function zusammenfassung(index: number) {
  return {
    uid: `doc-${index}`,
    title: `Dokument ${index}`,
    folder_uid: null,
    team_id: 7,
    team_name: null,
    role: 'editor' as const,
    can_edit: true,
    can_comment: true,
    can_manage: true,
    rev: 1,
    archived: false,
    deleted: false,
    content_truncated: false,
    updated_at: '2026-11-03T00:00:00Z',
    last_edited_at: '2026-11-03T00:00:00Z',
    owner: 'tester',
  }
}

describe('DocsApp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useDocsStore.getState().zuruecksetzen()
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
    expect(docsApi.getDocsStatus).not.toHaveBeenCalled()
    expect(docsApi.listDocuments).not.toHaveBeenCalled()
  })

  it('schließt den mobilen Dokumentbaum mit Escape', async () => {
    zeigen()
    const ausloeser = await screen.findByRole('button', { name: i18n.t('docs.tree.open') })
    fireEvent.click(ausloeser)

    expect(screen.getByRole('dialog', { name: i18n.t('docs.tree.open') })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: i18n.t('docs.tree.open') })).not.toBeInTheDocument()
  })

  it('schließt den Dokumentbaum mit der Zurück-Taste', async () => {
    await waitFor(() => expect(window.history.state?.msmTiefe ?? 0).toBe(0))
    zeigen()
    const ausloeser = await screen.findByRole('button', { name: i18n.t('docs.tree.open') })
    fireEvent.click(ausloeser)
    await waitFor(() => expect(window.history.state?.msmTiefe).toBe(1))
    act(() => window.history.back())
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: i18n.t('docs.tree.open') })).not.toBeInTheDocument(),
    )
  })

  it('gibt den Fokus nach dem Schließen an den Baum-Auslöser zurück', async () => {
    await waitFor(() => expect(window.history.state?.msmTiefe ?? 0).toBe(0))
    zeigen()
    const ausloeser = await screen.findByRole('button', { name: i18n.t('docs.tree.open') })
    ausloeser.focus()
    fireEvent.click(ausloeser)
    expect(screen.getByRole('dialog', { name: i18n.t('docs.tree.open') })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: i18n.t('docs.tree.open') })).not.toBeInTheDocument(),
    )
    expect(document.activeElement).toBe(ausloeser)
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

  it('zeigt bei netzartigem Listenfehler den Kontexttext (Befund 28)', async () => {
    vi.mocked(docsApi.listDocuments).mockRejectedValueOnce(new Error('netz weg'))
    zeigen()
    await waitFor(() =>
      expect(screen.getByText(i18n.t('docs.fehler.list'))).toBeInTheDocument(),
    )
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

  // Rendert drei Seiten mit je 100 Zeilen; unter Vollast braucht das mehr als 5 s.
  it('lädt weitere Dokumentseiten und speichert sie im Offline-Katalog', async () => {
    vi.mocked(docsApi.listDocuments).mockImplementation(async (params) => {
      const start = params?.cursor ?? 0
      return Array.from({ length: Math.min(101, 201 - start) }, (_, index) =>
        zusammenfassung(start + index),
      )
    })
    zeigen()

    await waitFor(() =>
      expect(screen.getByRole('button', { name: i18n.t('docs.tree.loadMore') })).toBeInTheDocument(),
    )
    expect(docsApi.listDocuments).toHaveBeenLastCalledWith({
      teamId: null,
      archived: false,
      trash: false,
      limit: 101,
    })

    screen.getByRole('button', { name: i18n.t('docs.tree.loadMore') }).click()

    await waitFor(() =>
      expect(screen.getByText('Dokument 199')).toBeInTheDocument(),
    )
    expect(docsApi.listDocuments).toHaveBeenLastCalledWith({
      teamId: null,
      archived: false,
      trash: false,
      limit: 101,
      cursor: 100,
    })
    screen.getByRole('button', { name: i18n.t('docs.tree.loadMore') }).click()
    await waitFor(() =>
      expect(screen.getByText('Dokument 200')).toBeInTheDocument(),
    )
    expect(
      screen.queryByRole('button', { name: i18n.t('docs.tree.loadMore') }),
    ).not.toBeInTheDocument()
    const cache = JSON.parse(localStorage.getItem('msm_docs_meta:7') || '[]')
    expect(cache).toHaveLength(201)
    expect(cache.at(-1).uid).toBe('doc-200')
  }, 20000)

  it('ignoriert eine verspätete Seite nach dem Wechsel der Dokumentansicht', async () => {
    let resolveSeite!: (docs: ReturnType<typeof zusammenfassung>[]) => void
    vi.mocked(docsApi.listDocuments).mockImplementation(async (params) => {
      if (params?.archived) return []
      if (params?.cursor === 100) {
        return new Promise((resolve) => {
          resolveSeite = resolve
        })
      }
      return Array.from({ length: 101 }, (_, index) => zusammenfassung(index))
    })
    zeigen()

    await waitFor(() =>
      expect(screen.getByRole('button', { name: i18n.t('docs.tree.loadMore') })).toBeInTheDocument(),
    )
    screen.getByRole('button', { name: i18n.t('docs.tree.loadMore') }).click()
    await waitFor(() => expect(resolveSeite).toBeTypeOf('function'))

    screen.getByRole('button', { name: i18n.t('docs.tree.archive') }).click()
    await waitFor(() =>
      expect(docsApi.listDocuments).toHaveBeenLastCalledWith({
        teamId: null,
        archived: true,
        trash: false,
        limit: 101,
      }),
    )
    await act(async () => {
      resolveSeite(Array.from({ length: 101 }, (_, index) => zusammenfassung(100 + index)))
    })

    await waitFor(() =>
      expect(screen.queryByText('Dokument 100')).not.toBeInTheDocument(),
    )
  }, 20000)
})
