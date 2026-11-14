import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ModManager } from './ModManager'

const mockApi = vi.fn()
const mockOeffneBrowser = vi.fn()

vi.mock('@/api/client', () => ({
  api: (...args: unknown[]) => mockApi(...args),
}))

vi.mock('@/desktop/tauri', () => ({
  oeffneBrowser: (...args: unknown[]) => mockOeffneBrowser(...args),
}))

vi.mock('@/stores/toastStore', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

vi.mock('@/stores/confirmStore', () => ({
  confirm: vi.fn().mockResolvedValue(true),
}))

const mockT = (key: string, opts?: Record<string, unknown>) => {
  if (opts && 'count' in opts) return `${key}:${String(opts.count)}`
  return (opts?.defaultValue as string) || key
}

const mockTranslationReturn = { t: mockT }

vi.mock('react-i18next', () => ({
  useTranslation: () => mockTranslationReturn,
}))

describe('ModManager Collections & CurseForge Bundles', () => {
  beforeEach(() => {
    mockApi.mockReset()
    mockOeffneBrowser.mockReset().mockResolvedValue(undefined)
  })

  it('switches to Steam Collections, opens preview dialog, and installs selected mods in batch', async () => {
    mockApi.mockImplementation(async (path: string, options?: { method?: string }) => {
      if (path === '/mods/10') {
        return [
          {
            id: 1,
            server_id: 10,
            workshop_id: '101',
            name: 'Already Installed Mod',
            last_updated: null,
            installed_version: null,
            load_order: 0,
            enabled: true,
            dependencies_json: null,
            install_status: 'installed',
            install_action: null,
            install_progress: 100,
            install_eta_seconds: null,
            install_started_at: null,
            install_completed_at: null,
            install_error: null,
            update_status: 'up_to_date',
            update_reason: null,
            update_checked_at: null,
          },
        ]
      }
      if (path.startsWith('/steam/workshop/popular') && path.includes('content_type=collections')) {
        return [
          {
            publishedfileid: '9001',
            title: 'Cluster Mega Collection',
            description: 'All essential mods',
            creator: 'Host',
            file_size_mb: 0,
            subscriptions: 1200,
            favorites: 300,
            preview_url: null,
            direct_url: 'https://steamcommunity.com/sharedfiles/filedetails/?id=9001',
            item_type: 'collection',
            children_count: 2,
          },
        ]
      }
      if (path.startsWith('/steam/workshop/popular')) {
        return []
      }
      if (path === '/steam/workshop/collection/9001?server_id=10') {
        return {
          collection: {
            publishedfileid: '9001',
            title: 'Cluster Mega Collection',
            creator: 'Host',
            direct_url: 'https://steamcommunity.com/sharedfiles/filedetails/?id=9001',
          },
          items: [
            {
              publishedfileid: '101',
              title: 'Already Installed Mod',
              file_size_mb: 12,
              preview_url: null,
              direct_url: 'https://steamcommunity.com/sharedfiles/filedetails/?id=101',
            },
            {
              publishedfileid: '202',
              title: 'New Utility Mod',
              file_size_mb: 24,
              preview_url: null,
              direct_url: 'https://steamcommunity.com/sharedfiles/filedetails/?id=202',
            },
          ],
          unavailable_ids: [],
        }
      }
      if (path === '/mods/10/batch' && options?.method === 'POST') {
        return { ok: true, queued: 1, skipped: 0 }
      }
      return []
    })

    render(
      <ModManager
        serverId={10}
        gameInfo={{
          id: 'conan_exiles_ue5',
          name: 'Conan Exiles',
          mod_support: true,
          supports_steam_workshop: true,
          mod_provider: 'steam',
        }}
      />,
    )

    const collectionsTab = await screen.findByRole('button', { name: 'mods.tabCollections' })
    fireEvent.click(collectionsTab)

    const openBtn = await screen.findByRole('button', { name: 'mods.inspectCollection' })
    fireEvent.click(openBtn)

    expect(await screen.findByText('New Utility Mod')).toBeInTheDocument()
    const modLink = screen.getByRole('link', { name: 'New Utility Mod' })
    expect(modLink).toHaveAttribute('href', 'https://steamcommunity.com/sharedfiles/filedetails/?id=202')
    expect(modLink).toHaveAttribute('target', '_blank')
    fireEvent.click(modLink)
    expect(mockOeffneBrowser).toHaveBeenCalledWith('https://steamcommunity.com/sharedfiles/filedetails/?id=202')
    expect(screen.getByText('mods.alreadyInstalled')).toBeInTheDocument()

    // Only missing mod ('202') is pre-selected -> count = 1
    const installBtn = screen.getByRole('button', { name: 'mods.installCollection:1' })
    fireEvent.click(installBtn)

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        '/mods/10/batch',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            items: [{ workshop_id: '202', name: 'New Utility Mod' }],
            skip_existing: true,
          }),
        }),
      )
    })
  })

  it('loads dynamic CurseForge game classes and shows manifest import button', async () => {
    mockApi.mockImplementation(async (path: string) => {
      if (path === '/curseforge/classes?server_id=20') {
        return [
          { id: 6, name: 'Mods', slug: 'mc-mods', kind: 'mods' },
          { id: 4471, name: 'Modpacks', slug: 'modpacks', kind: 'modpacks' },
        ]
      }
      return []
    })

    render(
      <ModManager
        serverId={20}
        gameInfo={{
          id: 'minecraft_forge',
          name: 'Minecraft Forge',
          mod_support: true,
          supports_curseforge: true,
          mod_provider: 'curseforge',
          curseforge_game_id: '432',
          curseforge_class_id: '6',
          supports_modpacks: true,
        }}
      />,
    )

    expect(await screen.findByRole('button', { name: 'Modpacks' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'mods.importManifest' })).toBeInTheDocument()
  })
})

describe('ModManager Dependency Confirmation Dialog (Steam & CurseForge)', () => {
  beforeEach(() => {
    mockApi.mockReset()
    mockOeffneBrowser.mockReset().mockResolvedValue(undefined)
  })

  it('prompts on Steam mod dependencies with images, links, single-dep install, mod-only, and install-all', async () => {
    const installedMods: Array<Record<string, unknown>> = []
    mockApi.mockImplementation(async (path: string, options?: { method?: string }) => {
      if (path === '/mods/30' && (!options?.method || options.method === 'GET')) {
        return [...installedMods]
      }
      if (path.startsWith('/steam/workshop/popular')) {
        return [
          {
            publishedfileid: '1001',
            title: 'Extended Base Building',
            description: 'Needs core framework',
            creator: 'Builder',
            file_size_mb: 18,
            subscriptions: 4200,
            favorites: 310,
            preview_url: 'https://steam.example/1001.jpg',
            direct_url: 'https://steamcommunity.com/sharedfiles/filedetails/?id=1001',
            item_type: 'mod',
            children_count: 1,
            dependencies_count: 1,
          },
        ]
      }
      if (path === '/steam/workshop/mod/1001/dependencies?server_id=30') {
        return {
          mod: {
            publishedfileid: '1001',
            title: 'Extended Base Building',
            creator: 'Builder',
            preview_url: 'https://steam.example/1001.jpg',
            direct_url: 'https://steamcommunity.com/sharedfiles/filedetails/?id=1001',
          },
          dependencies: [
            {
              publishedfileid: '2001',
              title: 'Core Framework Library',
              description: 'Required base library',
              creator: 'CoreDev',
              file_size_mb: 5.5,
              subscriptions: 9000,
              favorites: 800,
              preview_url: 'https://steam.example/2001.jpg',
              direct_url: 'https://steamcommunity.com/sharedfiles/filedetails/?id=2001',
            },
          ],
          unavailable_ids: [],
        }
      }
      if (path.startsWith('/mods/30?workshop_id=2001') && options?.method === 'POST') {
        installedMods.push({
          id: 99,
          server_id: 30,
          workshop_id: '2001',
          name: 'Core Framework Library',
          last_updated: null,
          installed_version: null,
          load_order: 0,
          enabled: true,
          dependencies_json: null,
          install_status: 'installed',
          install_action: null,
          install_progress: 100,
          install_eta_seconds: null,
          install_started_at: null,
          install_completed_at: null,
          install_error: null,
          update_status: 'up_to_date',
          update_reason: null,
          update_checked_at: null,
        })
        return installedMods[0]
      }
      if (path === '/mods/30/batch' && options?.method === 'POST') {
        return { ok: true, queued: 2, skipped: 0 }
      }
      return []
    })

    render(
      <ModManager
        serverId={30}
        gameInfo={{
          id: 'conan_exiles_ue5',
          name: 'Conan Exiles',
          mod_support: true,
          supports_steam_workshop: true,
          mod_provider: 'steam',
        }}
      />,
    )

    const addBtn = await screen.findByRole('button', { name: 'common.add' })
    fireEvent.click(addBtn)

    // Dialog opens with dependency info, image & clickable inspect link
    expect(await screen.findByText('mods.dependenciesTitle')).toBeInTheDocument()
    expect(await screen.findByText('Core Framework Library')).toBeInTheDocument()
    const depImg = screen.getByRole('img', { name: 'Core Framework Library' })
    expect(depImg).toHaveAttribute('src', 'https://steam.example/2001.jpg')
    const inspectLink = screen.getByRole('link', { name: 'mods.dependencyInspect' })
    expect(inspectLink).toHaveAttribute('href', 'https://steamcommunity.com/sharedfiles/filedetails/?id=2001')

    // Click "Install all" (1 dep + 1 main = 2) -> batch with dep BEFORE target mod
    const installAllBtn = screen.getByRole('button', { name: 'mods.installAllWithDependencies:2' })
    fireEvent.click(installAllBtn)

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        '/mods/30/batch',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            items: [
              { workshop_id: '2001', name: 'Core Framework Library' },
              { workshop_id: '1001', name: 'Extended Base Building' },
            ],
            skip_existing: true,
          }),
        }),
      )
    })

    // Re-open and test installing single dependency individually + mod-only button
    fireEvent.click(addBtn)
    expect(await screen.findByText('Core Framework Library')).toBeInTheDocument()
    const singleDepBtn = screen.getByRole('button', { name: 'mods.installSingleDependency' })
    fireEvent.click(singleDepBtn)

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        expect.stringContaining('/mods/30?workshop_id=2001'),
        expect.objectContaining({ method: 'POST' }),
      )
    })

    // Dialog stays open, now "only current mod" button installs target 1001 alone
    const modOnlyBtn = screen.getByRole('button', { name: 'mods.installModOnly' })
    fireEvent.click(modOnlyBtn)
    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        expect.stringContaining('/mods/30?workshop_id=1001'),
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })

  it('checks CurseForge mod dependencies and skips dialog when dependency is already installed', async () => {
    const installedMods: Array<Record<string, unknown>> = []
    mockApi.mockImplementation(async (path: string, options?: { method?: string }) => {
      if (path === '/mods/40' && (!options?.method || options.method === 'GET')) {
        return [...installedMods]
      }
      if (path === '/curseforge/classes?server_id=40') {
        return [{ id: 6, name: 'Mods', slug: 'mc-mods', kind: 'mods' }]
      }
      if (path.startsWith('/curseforge/popular')) {
        return [
          {
            publishedfileid: '7001',
            title: 'JEI Plus',
            description: 'Recipe viewer addon',
            creator: 'Mezz',
            file_size_mb: 3,
            subscriptions: 5000,
            favorites: 0,
            preview_url: 'https://cf.example/7001.png',
            direct_url: 'https://www.curseforge.com/minecraft/mc-mods/jei-plus',
            item_type: 'mod',
            is_modpack: false,
            dependencies_count: 1,
          },
        ]
      }
      if (path === '/curseforge/mod/7001/dependencies?server_id=40') {
        return {
          mod: {
            publishedfileid: '7001',
            title: 'JEI Plus',
            creator: 'Mezz',
            preview_url: 'https://cf.example/7001.png',
            direct_url: 'https://www.curseforge.com/minecraft/mc-mods/jei-plus',
          },
          dependencies: [
            {
              publishedfileid: '8001',
              title: 'Architectury API',
              description: 'Cross-loader API',
              creator: 'shedaniel',
              file_size_mb: 1.2,
              subscriptions: 10000,
              favorites: 0,
              preview_url: 'https://cf.example/8001.png',
              direct_url: 'https://www.curseforge.com/minecraft/mc-mods/architectury-api',
            },
          ],
          unavailable_ids: [],
        }
      }
      if (path === '/mods/40/batch' && options?.method === 'POST') {
        return { ok: true, queued: 2, skipped: 0 }
      }
      if (path.startsWith('/mods/40?workshop_id=7001') && options?.method === 'POST') {
        return { id: 2, server_id: 40, workshop_id: '7001' }
      }
      return []
    })

    render(
      <ModManager
        serverId={40}
        gameInfo={{
          id: 'minecraft_fabric',
          name: 'Minecraft Fabric',
          mod_support: true,
          supports_curseforge: true,
          mod_provider: 'curseforge',
          curseforge_game_id: '432',
          curseforge_class_id: '6',
          supports_modpacks: false,
        }}
      />,
    )

    const addBtn = await screen.findByRole('button', { name: 'common.add' })
    fireEvent.click(addBtn)

    // Opens CurseForge dependency prompt with image + CurseForge link
    expect(await screen.findByText('Architectury API')).toBeInTheDocument()
    const depLink = screen.getByRole('link', { name: 'mods.dependencyInspect' })
    expect(depLink).toHaveAttribute(
      'href',
      'https://www.curseforge.com/minecraft/mc-mods/architectury-api',
    )

    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))

    // If Architectury API is now already installed, clicking Add installs 7001 directly without dialog
    installedMods.push({
      id: 1,
      server_id: 40,
      workshop_id: '8001',
      name: 'Architectury API',
      last_updated: null,
      installed_version: null,
      load_order: 0,
      enabled: true,
      dependencies_json: null,
      install_status: 'installed',
      install_action: null,
      install_progress: 100,
      install_eta_seconds: null,
      install_started_at: null,
      install_completed_at: null,
      install_error: null,
      update_status: 'up_to_date',
      update_reason: null,
      update_checked_at: null,
    })

    cleanup()
    render(
      <ModManager
        serverId={40}
        gameInfo={{
          id: 'minecraft_fabric',
          name: 'Minecraft Fabric',
          mod_support: true,
          supports_curseforge: true,
          mod_provider: 'curseforge',
          curseforge_game_id: '432',
          curseforge_class_id: '6',
          supports_modpacks: false,
        }}
      />,
    )

    expect(await screen.findByText('Architectury API')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'common.add' }))

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        expect.stringContaining('/mods/40?workshop_id=7001'),
        expect.objectContaining({ method: 'POST' }),
      )
    })
    expect(screen.queryByText('mods.dependenciesTitle')).not.toBeInTheDocument()
  })
})

describe('ModManager Reorder, Multi-Select & Bulk Operations', () => {
  beforeEach(() => {
    mockApi.mockReset()
    mockOeffneBrowser.mockReset().mockResolvedValue(undefined)
  })

  const makeMod = (id: number, name: string, loadOrder: number) => ({
    id,
    server_id: 50,
    workshop_id: String(1000 + id),
    name,
    last_updated: null,
    installed_version: null,
    load_order: loadOrder,
    enabled: true,
    dependencies_json: null,
    install_status: 'installed',
    install_action: null,
    install_progress: 100,
    install_eta_seconds: null,
    install_started_at: null,
    install_completed_at: null,
    install_error: null,
    update_status: 'up_to_date',
    update_reason: null,
    update_checked_at: null,
  })

  it('reorders mods via Up/Down buttons and pointer-event drag-and-drop (Tauri-compatible)', async () => {
    let currentMods = [makeMod(1, 'Alpha Mod', 0), makeMod(2, 'Beta Mod', 1), makeMod(3, 'Gamma Mod', 2)]

    mockApi.mockImplementation(async (path: string, options?: { method?: string; body?: string }) => {
      if (path === '/mods/50') {
        return currentMods
      }
      if (path === '/mods/50/reorder' && options?.method === 'POST') {
        const order = JSON.parse(options.body || '[]') as number[]
        currentMods = order.map((id, idx) => {
          const found = currentMods.find((m) => m.id === id)!
          return { ...found, load_order: idx }
        })
        return currentMods
      }
      if (path.startsWith('/steam/workshop/popular')) {
        return []
      }
      return []
    })

    const { container } = render(
      <ModManager
        serverId={50}
        gameInfo={{
          id: 'conan_exiles',
          name: 'Conan Exiles',
          mod_support: true,
        }}
      />,
    )

    expect(await screen.findByText('Alpha Mod')).toBeInTheDocument()

    // 1. Move Beta Mod up via row overflow menu -> order becomes [2, 1, 3]
    const rowActionTriggers = screen.getAllByRole('button', { name: 'mods.modActions' })
    expect(rowActionTriggers).toHaveLength(3)
    fireEvent.click(rowActionTriggers[1])
    const moveUpItem = await screen.findByRole('menuitem', { name: 'mods.moveUp' })
    fireEvent.click(moveUpItem)

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        '/mods/50/reorder',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify([2, 1, 3]),
        }),
      )
    })

    // 2. Pointer drag from first row handle (mod 2) onto row 3 -> visual drag states + order [1, 3, 2]
    const dragHandles = screen.getAllByLabelText('mods.dragHandleHint')
    const listEl = container.querySelector('.msm-mod-list') as HTMLElement
    const rowTwo = container.querySelector('[data-mod-row-id="2"]') as HTMLElement
    const rowThree = container.querySelector('[data-mod-row-id="3"]') as HTMLElement
    expect(rowThree).not.toBeNull()

    fireEvent.pointerDown(dragHandles[0], { button: 0, pointerType: 'mouse', pointerId: 1, clientX: 50, clientY: 20 })
    expect(listEl.getAttribute('data-dragging')).toBe('true')
    expect(rowTwo.classList.contains('msm-mod-row-dragging')).toBe(true)

    fireEvent.pointerMove(rowThree, { pointerId: 1, clientX: 50, clientY: 120 })
    expect(screen.getByText('#1 → #3')).toBeInTheDocument()

    fireEvent.pointerUp(rowThree, { pointerId: 1 })
    expect(listEl.getAttribute('data-dragging')).toBeNull()

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        '/mods/50/reorder',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify([1, 3, 2]),
        }),
      )
    })

    // Settle highlight fades in on the newly dropped card
    expect(container.querySelector('[data-mod-row-id="2"]')?.classList.contains('msm-mod-row-settle')).toBe(true)

    // 3. Escape cancels an active drag without triggering /reorder
    const reorderCountBeforeEsc = mockApi.mock.calls.filter(([p]) => p === '/mods/50/reorder').length
    const handlesAfterDrop = screen.getAllByLabelText('mods.dragHandleHint')
    fireEvent.pointerDown(handlesAfterDrop[0], { button: 0, pointerType: 'mouse', pointerId: 2, clientX: 40, clientY: 20 })
    fireEvent.pointerMove(container.querySelector('[data-mod-row-id="2"]') as HTMLElement, { pointerId: 2, clientX: 40, clientY: 140 })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(listEl.getAttribute('data-dragging')).toBeNull()
    expect(mockApi.mock.calls.filter(([p]) => p === '/mods/50/reorder').length).toBe(reorderCountBeforeEsc)
  })

  it('supports multi-select bulk update, bulk reinstall, bulk delete, and delete all', async () => {
    let currentMods = [makeMod(1, 'Mod A', 0), makeMod(2, 'Mod B', 1), makeMod(3, 'Mod C', 2)]

    mockApi.mockImplementation(async (path: string, options?: { method?: string; body?: string }) => {
      if (path === '/mods/50') {
        return currentMods
      }
      if (path === '/mods/50/bulk-action' && options?.method === 'POST') {
        const body = JSON.parse(options.body || '{}') as { mod_ids: number[]; action: string }
        currentMods = currentMods.map((m) =>
          body.mod_ids.includes(m.id) ? { ...m, install_status: 'installed', install_action: body.action } : m,
        )
        return currentMods
      }
      if (path === '/mods/50/bulk-delete' && options?.method === 'POST') {
        const body = JSON.parse(options.body || '{}') as { mod_ids: number[]; delete_all: boolean }
        if (body.delete_all) {
          const count = currentMods.length
          currentMods = []
          return { message: 'removed', deleted_count: count, mods: [] }
        }
        currentMods = currentMods.filter((m) => !body.mod_ids.includes(m.id))
        return { message: 'removed', deleted_count: body.mod_ids.length, mods: currentMods }
      }
      if (path.startsWith('/steam/workshop/popular')) {
        return []
      }
      return []
    })

    render(
      <ModManager
        serverId={50}
        gameInfo={{
          id: 'conan_exiles',
          name: 'Conan Exiles',
          mod_support: true,
        }}
      />,
    )

    expect(await screen.findByText('Mod A')).toBeInTheDocument()

    // Select Mod A and Mod B via checkboxes
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(3)
    fireEvent.click(checkboxes[0])
    fireEvent.click(checkboxes[1])

    expect(await screen.findByText('mods.selectedCount:2')).toBeInTheDocument()

    // Bulk Update selected
    fireEvent.click(screen.getByRole('button', { name: 'mods.updateSelected' }))
    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        '/mods/50/bulk-action',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ mod_ids: [1, 2], action: 'update' }),
        }),
      )
    })

    // Re-select Mod A & B and Reinstall selected
    const checkboxesAfterUpdate = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxesAfterUpdate[0])
    fireEvent.click(checkboxesAfterUpdate[1])
    fireEvent.click(await screen.findByRole('button', { name: 'mods.reinstallSelected' }))
    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        '/mods/50/bulk-action',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ mod_ids: [1, 2], action: 'reinstall' }),
        }),
      )
    })

    // Re-select Mod A & B and Delete selected
    const checkboxesAfterReinstall = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxesAfterReinstall[0])
    fireEvent.click(checkboxesAfterReinstall[1])
    fireEvent.click(await screen.findByRole('button', { name: 'mods.deleteSelected' }))
    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        '/mods/50/bulk-delete',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ mod_ids: [1, 2], delete_all: false }),
        }),
      )
    })

    await waitFor(() => {
      expect(screen.queryByText('Mod A')).not.toBeInTheDocument()
      expect(screen.queryByText('Mod B')).not.toBeInTheDocument()
      expect(screen.getByText('Mod C')).toBeInTheDocument()
    })

    // Test Select All / Deselect All toggle and Delete All via header overflow menu
    fireEvent.click(screen.getByRole('button', { name: 'mods.moreActions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'mods.selectAll' }))
    expect(await screen.findByText('mods.selectedCount:1')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'mods.deselectAll' }).length).toBeGreaterThanOrEqual(1)

    fireEvent.click(screen.getByRole('button', { name: 'mods.moreActions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'mods.deleteAll' }))
    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        '/mods/50/bulk-delete',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ mod_ids: [], delete_all: true }),
        }),
      )
    })
    expect(await screen.findByText('mods.noMods')).toBeInTheDocument()
  })

  it('filters library by status pills, game tags/sort, switches list view, toggles switches, and renders bottom live install bar', async () => {
    const modsList = [
      {
        ...makeMod(1, 'Outdated Core Mod', 0),
        workshop_id: '1001',
        update_status: 'outdated',
        install_status: 'installing',
        install_action: 'update',
        install_progress: 64,
      },
      {
        ...makeMod(2, 'Second Queued Mod', 1),
        workshop_id: '1002',
        install_status: 'pending',
        install_action: 'install',
        install_progress: 0,
      },
    ]

    mockApi.mockImplementation(async (path: string, options?: { method?: string }) => {
      if (path === '/mods/50') {
        return modsList
      }
      if (path === '/mods/50/metadata') {
        return {
          '1001': {
            preview_url: 'https://steam.example/1001.jpg',
            description: 'Core vehicle expansion description',
            file_size_mb: 12.5,
            tags: ['Vehicles'],
            title: 'Outdated Core Mod',
          },
          '1002': {
            preview_url: 'https://steam.example/1002.jpg',
            description: 'Second queued description',
            file_size_mb: 4.2,
            tags: ['UI'],
            title: 'Second Queued Mod',
          },
        }
      }
      if (path === '/steam/workshop/filters?server_id=50') {
        return {
          appid: '108600',
          source: 'steam_community',
          tags: [
            { id: 'Vehicles', name: 'Vehicles' },
            { id: 'UI', name: 'UI' },
          ],
        }
      }
      if (path.startsWith('/steam/workshop/popular')) {
        return [
          {
            publishedfileid: '1001',
            title: 'Outdated Core Mod',
            description: 'Already installed mod',
            creator: 'Author',
            file_size_mb: 12.5,
            subscriptions: 5000,
            favorites: 400,
            tags: ['Vehicles'],
            preview_url: 'https://steam.example/1001.jpg',
            direct_url: 'https://steamcommunity.com/sharedfiles/filedetails/?id=1001',
          },
          {
            publishedfileid: '3003',
            title: 'Brand New Mod',
            description: 'Not yet installed',
            creator: 'Creator',
            file_size_mb: 8.1,
            subscriptions: 900,
            favorites: 70,
            tags: ['UI'],
            preview_url: 'https://steam.example/3003.jpg',
            direct_url: 'https://steamcommunity.com/sharedfiles/filedetails/?id=3003',
          },
        ]
      }
      if (path === '/mods/50/1' && options?.method === 'PATCH') {
        return { ...modsList[0], enabled: false }
      }
      return []
    })

    render(
      <ModManager
        serverId={50}
        gameInfo={{
          id: 'project_zomboid',
          name: 'Project Zomboid',
          mod_support: true,
        }}
      />,
    )

    // Installed metadata thumbnail, description & size appear in Aktive Mods + Bottom live install bar renders
    expect((await screen.findAllByText('12.5 MB')).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Core vehicle expansion description')).toBeInTheDocument()
    const liveStatusBar = screen.getByRole('status')
    expect(liveStatusBar).toHaveTextContent('Outdated Core Mod')
    expect(liveStatusBar).toHaveTextContent('64%')

    // Expand queued mods list in live bar
    fireEvent.click(screen.getByRole('button', { name: 'mods.installBarShowAll:2' }))
    expect(screen.getAllByText('Second Queued Mod').length).toBeGreaterThanOrEqual(2)

    // Filter pill: Nicht installiert hides 1001 and keeps 3003
    expect(screen.getByText('Brand New Mod')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /mods\.filterNotInstalled/ }))
    expect(screen.getByText('Brand New Mod')).toBeInTheDocument()

    // Switch back to Installed pill & Updates pill
    fireEvent.click(screen.getByRole('button', { name: /mods\.filterUpdates/ }))
    expect(screen.getByRole('button', { name: 'mods.updateAvailable' })).toBeInTheDocument()

    // Select dynamic game tag filter -> sends tags=Vehicles to Steam API
    fireEvent.click(screen.getByRole('button', { name: /mods\.filterAll/ }))
    const tagTrigger = await screen.findByRole('button', { name: 'mods.gameFilterPlaceholder' })
    fireEvent.click(tagTrigger)
    fireEvent.click(await screen.findByRole('option', { name: 'Vehicles' }))

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(expect.stringContaining('tags=Vehicles'))
    })

    // Toggle Switch on first active mod
    const switches = screen.getAllByRole('switch')
    expect(switches).toHaveLength(2)
    fireEvent.click(switches[0])
    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        '/mods/50/1?enabled=false',
        expect.objectContaining({ method: 'PATCH' }),
      )
    })
  })
})
