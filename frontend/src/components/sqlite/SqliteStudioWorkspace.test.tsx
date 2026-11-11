import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SqliteStudioWorkspace } from './SqliteStudioWorkspace'
import i18n from '@/i18n'

const mockApi = vi.fn(async (pfad: string) => {
  if (pfad.includes('/sqlite/overview')) {
    return {
      kind: 'shared' as const,
      server: { version_num: 3045000, version: 'SQLite 3.45.0 (WAL)', role: 'user', database: 'game.db', size_bytes: 40960 },
      schemas: [{ name: 'main', owner: 'sqlite', can_create: false, table_count: 2 }],
      permissions: { read: true, write: true, admin: true },
      relations: [
        { schema: 'main', name: 'players', kind: 'table', estimated_rows: 42, size_bytes: 8192 },
        { schema: 'main', name: 'items', kind: 'table', estimated_rows: 150, size_bytes: 16384 },
      ],
    }
  }
  if (pfad.includes('/sqlite/table')) {
    return {
      schema: 'main',
      name: 'players',
      kind: 'table',
      columns: [
        { name: 'id', position: 1, type: 'INTEGER', nullable: false, default_value: null, is_primary_key: true, identity: null },
        { name: 'username', position: 2, type: 'TEXT', nullable: false, default_value: null, is_primary_key: false, identity: null },
      ],
      primary_key: ['id'],
      foreign_keys: [],
      indexes: [{ name: 'sqlite_autoindex_players_1', columns: ['id'], is_unique: true, is_primary: true }],
      constraints: [],
      triggers: [],
      estimated_rows: 42,
      size_bytes: 8192,
      comment: null,
    }
  }
  if (pfad.includes('/sqlite/rows')) {
    return {
      columns: ['id', 'username'],
      types: ['integer', 'text'],
      rows: [
        [1, 'survivor1'],
        [2, 'survivor2'],
      ],
      total: 2,
      total_is_estimate: false,
      key: ['id'],
      editable: true,
    }
  }
  return null
})

vi.mock('@/api/client', () => ({
  api: (pfad: string, opts?: any) => mockApi(pfad),
}))

describe('SqliteStudioWorkspace', () => {
  beforeEach(async () => {
    mockApi.mockClear()
    await i18n.changeLanguage('de')
  })

  it('rendert Datenbankübersicht, Badge und Tabellenliste', async () => {
    render(<SqliteStudioWorkspace serverId={1} path="saves/game.db" canWrite={true} />)

    expect(await screen.findByText('game.db')).toBeInTheDocument()
    expect(screen.getByText('SQLite')).toBeInTheDocument()
    expect(screen.getByText('WAL')).toBeInTheDocument()

    const sidebar = screen.getByTestId('sqlite-tables-sidebar')
    expect(within(sidebar).getByText('players')).toBeInTheDocument()
    expect(within(sidebar).getByText('items')).toBeInTheDocument()
  })

  it('filtert Tabellen über die Suchleiste', async () => {
    render(<SqliteStudioWorkspace serverId={1} path="saves/game.db" canWrite={true} />)

    await screen.findByText('game.db')
    const sidebar = screen.getByTestId('sqlite-tables-sidebar')
    expect(within(sidebar).getByText('players')).toBeInTheDocument()

    const searchInput = screen.getByPlaceholderText(i18n.t('sqliteStudio.searchTables'))
    fireEvent.change(searchInput, { target: { value: 'item' } })

    expect(within(sidebar).queryByText('players')).toBeNull()
    expect(within(sidebar).getByText('items')).toBeInTheDocument()
  })

  it('wechselt zwischen Daten- und Strukturansicht', async () => {
    render(<SqliteStudioWorkspace serverId={1} path="saves/game.db" canWrite={true} />)

    await screen.findByText('players')

    const structureBtn = screen.getByRole('button', { name: i18n.t('sqliteStudio.viewStructure') })
    fireEvent.click(structureBtn)

    // In Strukturansicht sollte Spaltenüberschrift oder Typ sichtbar sein
    await waitFor(() => {
      expect(screen.getByText('INTEGER')).toBeInTheDocument()
    })

    const dataBtn = screen.getByRole('button', { name: i18n.t('sqliteStudio.viewData') })
    fireEvent.click(dataBtn)

    await waitFor(() => {
      expect(screen.getByText('survivor1')).toBeInTheDocument()
    })
  })

  it('wechselt in den SQL-Konsolen-Reiter', async () => {
    render(<SqliteStudioWorkspace serverId={1} path="saves/game.db" canWrite={true} />)

    await screen.findByText('game.db')

    const sqlTab = screen.getByRole('tab', { name: i18n.t('sqliteStudio.tabs.sql') })
    fireEvent.click(sqlTab)

    expect(await screen.findByRole('button', { name: i18n.t('postgresStudio.sql.run') })).toBeInTheDocument()
  })

  it('schaltet in den Vollbildmodus und reagiert auf Escape oder Beenden-Button', async () => {
    render(<SqliteStudioWorkspace serverId={1} path="saves/game.db" canWrite={true} />)
    await screen.findByText('game.db')

    expect(screen.queryByRole('dialog')).toBeNull()

    const fullscreenBtn = screen.getByTestId('enter-fullscreen-button')
    fireEvent.click(fullscreenBtn)

    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByTestId('exit-fullscreen-button')).toBeInTheDocument()

    // Beenden per Escape
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('klappt die Desktop-Seitenleiste ein und aus', async () => {
    render(<SqliteStudioWorkspace serverId={1} path="saves/game.db" canWrite={true} />)
    await screen.findByText('game.db')

    const sidebar = screen.getByTestId('sqlite-tables-sidebar')
    expect(sidebar).toHaveClass('md:flex')

    const toggleBtn = screen.getByTitle(i18n.t('sqliteStudio.toggleSidebar'))
    fireEvent.click(toggleBtn)
    expect(sidebar).toHaveClass('md:hidden')
  })
})
