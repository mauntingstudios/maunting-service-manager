import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { FileManager } from './FileManager'
import * as client from '@/api/client'
import i18n from '@/i18n'
import { usePermissionsStore } from '@/stores/permissionsStore'
import type { BrowseResponse, ReadResponse } from '@/components/server/fileWorkspaceTypes'

vi.mock('@/components/server/FileEditorWorkspace', () => ({
  FileEditorWorkspace: () => null,
}))

vi.mock('@/api/client', () => ({
  api: vi.fn(),
  SanitizedApiError: class SanitizedApiError extends Error {},
}))

const mockApi = vi.mocked(client.api)

const LISTE: BrowseResponse = {
  path: '',
  exists: true,
  entries: [{ name: 'eula.txt', is_dir: false, size: 0, modified: 0, mode: null, owner: null, group: null }],
}

const DATEI: ReadResponse = {
  path: 'eula.txt',
  name: 'eula.txt',
  content: 'eula=false',
  revision: 'r1',
  size: 10,
  modified: 0,
  mode: null,
  owner: null,
  group: null,
}

describe('FileManager: Details der offenen Datei', () => {
  beforeEach(async () => {
    mockApi.mockReset()
    mockApi.mockImplementation(async (pfad: string) => (pfad.includes('/read?') ? DATEI : pfad.includes('/versions') ? { versions: [] } : LISTE) as never)
    await i18n.changeLanguage('en')
    usePermissionsStore.setState({
      me: { is_owner: true, role_id: null, role_name: null, global_keys: [], server_keys: {} },
      isLoading: false,
      error: null,
    })
  })

  it('nennt eine unbekannte Änderungszeit in der Sprache der App', async () => {
    // Bis 02.10.2026 stand hier fest „Nicht verfügbar“, auch in der englischen App.
    render(<FileManager serverId={7} />)
    fireEvent.click(await screen.findByText('eula.txt'))
    const geaendert = (await screen.findByText(i18n.t('files.modified'))).nextElementSibling
    expect(geaendert).toHaveTextContent(i18n.t('files.notAvailable'))
    expect(screen.queryByText('Nicht verfügbar')).not.toBeInTheDocument()
  })

  it('heftet den Dateibaum am Desktop an den Editor an und ragt nicht per fixed hinter die Sidebar', async () => {
    const vorherBreite = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true })
    mockApi.mockImplementation(async (pfad: string) => {
      if (pfad.includes('/read?')) return DATEI as never
      if (pfad.includes('/versions')) return { versions: [] } as never
      return {
        path: '',
        exists: true,
        entries: [
          { name: 'eula.txt', is_dir: false, size: 10, modified: 0, mode: null, owner: null, group: null },
          { name: 'server.properties', is_dir: false, size: 20, modified: 0, mode: null, owner: null, group: null },
        ],
      } as never
    })

    try {
      render(<FileManager serverId={7} />)
      fireEvent.click(await screen.findByText('eula.txt'))

      const dateienKnopf = await screen.findByRole('button', { name: i18n.t('files.showTree') })
      fireEvent.click(dateienKnopf)

      const schublade = screen.getByLabelText(i18n.t('files.filesDrawer'))
      expect(schublade.className).not.toContain('fixed')
      expect(schublade.className).not.toContain('inset-x-3')
      expect(schublade.className).toContain('lg:static')
      expect(schublade.parentElement?.className).toContain('lg:grid-cols-[290px_minmax(0,1fr)]')

      // Auf Desktop bleibt der angeheftete Dateibaum beim Wechsel auf eine andere Datei offen.
      fireEvent.click(screen.getByText('server.properties'))
      expect(screen.getByLabelText(i18n.t('files.filesDrawer')).className).toContain('lg:static')

      // Details-Schublade bleibt ebenfalls im Container statt fixed über die Sidebar zu ragen.
      const detailsKnopf = screen.getByRole('button', { name: i18n.t('files.showInspector') })
      fireEvent.click(detailsKnopf)
      const detailsSchublade = screen.getByLabelText(i18n.t('files.detailsDrawer'))
      expect(detailsSchublade.className).not.toContain('fixed')
      expect(detailsSchublade.className).toContain('absolute')
    } finally {
      Object.defineProperty(window, 'innerWidth', { value: vorherBreite, configurable: true })
    }
  })
})
