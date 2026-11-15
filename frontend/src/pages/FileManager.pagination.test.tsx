import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { FileManager } from './FileManager'
import * as client from '@/api/client'
import i18n from '@/i18n'
import { usePermissionsStore } from '@/stores/permissionsStore'
import type { BrowseResponse } from '@/components/server/fileWorkspaceTypes'

vi.mock('@/components/server/FileEditorWorkspace', () => ({
  FileEditorWorkspace: () => null,
}))

vi.mock('@/api/client', () => ({
  api: vi.fn(),
  SanitizedApiError: class SanitizedApiError extends Error {},
}))

const mockApi = vi.mocked(client.api)

function createDirectoryListing(count: number): BrowseResponse {
  return {
    path: '',
    exists: true,
    entries: Array.from({ length: count }, (_, idx) => {
      const padded = String(idx + 1).padStart(2, '0')
      return {
        name: `file-${padded}.txt`,
        is_dir: false,
        size: 100 + idx,
        modified: 0,
        mode: null,
        owner: null,
        group: null,
      }
    }),
  }
}

describe('FileManager: Tabellen-Begrenzung, Pagination und Zeilen-Menü', () => {
  beforeEach(async () => {
    mockApi.mockReset()
    mockApi.mockImplementation(async () => createDirectoryListing(55) as never)
    await i18n.changeLanguage('en')
    usePermissionsStore.setState({
      me: { is_owner: true, role_id: null, role_name: null, global_keys: [], server_keys: {} },
      isLoading: false,
      error: null,
    })
  })

  it('begrenzt lange Dateilisten per Pagination auf 40 Einträge pro Seite und rendert Icons im Zeilenmenü', async () => {
    render(<FileManager serverId={7} />)

    expect(await screen.findByText('file-01.txt')).toBeInTheDocument()
    expect(screen.getByText('file-40.txt')).toBeInTheDocument()
    expect(screen.queryByText('file-41.txt')).not.toBeInTheDocument()

    // Begrenzter Scroll-Container gemäß responsive-table
    const tableWrapper = screen.getByRole('region', { name: i18n.t('files.serverFiles') })
    expect(tableWrapper).toHaveAttribute('tabindex', '0')
    expect(tableWrapper.className).toContain('overflow-auto')
    expect(tableWrapper.className).toContain('max-h-[min(520px,62dvh)]')

    // Zeilen-ActionMenu-Buttons enthalten sichtbare SVG-Icons (MoreHorizontal)
    const rowMenus = within(tableWrapper).getAllByRole('button', { name: /^More:/i })
    expect(rowMenus.length).toBe(40)
    expect(rowMenus[0].querySelector('svg')).not.toBeNull()

    // Pagination zeigt 1–40 of 55 und wechselt auf Seite 2 (41–55 of 55)
    expect(screen.getByText('1–40 of 55')).toBeInTheDocument()
    const navs = screen.getAllByRole('navigation')
    const paginationNav = navs.find((nav) => nav.textContent?.includes('1–40 of 55'))
    expect(paginationNav).toBeDefined()

    const [prevBtn, nextBtn] = within(paginationNav!).getAllByRole('button')
    expect(prevBtn).toBeDisabled()
    expect(nextBtn).not.toBeDisabled()

    fireEvent.click(nextBtn)

    expect(screen.getByText('41–55 of 55')).toBeInTheDocument()
    expect(screen.getByText('file-41.txt')).toBeInTheDocument()
    expect(screen.getByText('file-55.txt')).toBeInTheDocument()
    expect(screen.queryByText('file-01.txt')).not.toBeInTheDocument()
    expect(prevBtn).not.toBeDisabled()
    expect(nextBtn).toBeDisabled()
  })
})
