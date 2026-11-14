import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ModManager } from './ModManager'

const mockApi = vi.fn()

vi.mock('@/api/client', () => ({
  api: (...args: unknown[]) => mockApi(...args),
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
