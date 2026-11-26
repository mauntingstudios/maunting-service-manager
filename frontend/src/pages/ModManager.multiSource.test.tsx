import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ModManager } from './ModManager'

const apiMock = vi.fn()

vi.mock('@/api/client', () => ({
  api: (...args: unknown[]) => apiMock(...args),
  getRateLimitRemainingMs: () => 0,
}))

vi.mock('@/desktop/tauri', () => ({
  oeffneBrowser: vi.fn(),
}))

vi.mock('@/stores/toastStore', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

vi.mock('@/stores/confirmStore', () => ({
  confirm: vi.fn(async () => true),
}))

const stableT = (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: stableT,
  }),
}))

describe('ModManager multi-source provider switcher', () => {
  beforeEach(() => {
    apiMock.mockReset()
    apiMock.mockImplementation(async (url: string) => {
      if (url === '/mods/1') return []
      if (url.startsWith('/curseforge/classes')) return []
      if (url.startsWith('/curseforge/categories')) return []
      if (url.startsWith('/curseforge/popular')) {
        return [
          {
            publishedfileid: '238222',
            title: 'JEI',
            description: 'Just Enough Items',
            creator: 'mezz',
            file_size_mb: 1.2,
            subscriptions: 1000,
            favorites: 10,
            preview_url: null,
            direct_url: 'https://www.curseforge.com/minecraft/mc-mods/jei',
          },
        ]
      }
      if (url.startsWith('/modrinth/servers/1/search')) {
        return {
          mods: [
            {
              publishedfileid: 'modrinth:AANobbMI',
              title: 'Sodium',
              description: 'Fast Minecraft renderer',
              creator: 'jellysquid3',
              file_size_mb: 0,
              subscriptions: 50000,
              favorites: 500,
              preview_url: null,
              direct_url: 'https://modrinth.com/mod/sodium',
            },
          ],
          total: 1,
        }
      }
      if (url.startsWith('/thunderstore/servers/2/search')) {
        return {
          mods: [
            {
              publishedfileid: 'thunderstore:denikson-BepInExPack_Valheim',
              title: 'BepInExPack_Valheim',
              description: 'BepInEx for Valheim',
              creator: 'denikson',
              file_size_mb: 2.0,
              subscriptions: 99999,
              favorites: 500,
              preview_url: null,
              direct_url: 'https://thunderstore.io/c/valheim/p/denikson/BepInExPack_Valheim/',
            },
          ],
          total: 1,
        }
      }
      if (url === '/mods/2') return []
      return []
    })
  })

  it('shows CurseForge and Modrinth tabs and switches catalog endpoint', async () => {
    render(
      <ModManager
        serverId={1}
        gameInfo={{
          id: 'minecraft_fabric',
          name: 'Minecraft (Fabric)',
          mod_support: true,
          supports_curseforge: true,
          supports_modrinth: true,
          mod_providers: ['curseforge', 'modrinth'],
          mod_provider: 'curseforge',
          modrinth_project_types: ['mod', 'modpack', 'datapack'],
        }}
      />,
    )

    const cfTab = await screen.findByRole('tab', { name: 'CurseForge' })
    const mrTab = screen.getByRole('tab', { name: 'Modrinth' })
    expect(cfTab).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('JEI')).toBeInTheDocument()

    fireEvent.click(mrTab)

    await waitFor(() => {
      expect(mrTab).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByText('Sodium')).toBeInTheDocument()
    })
    expect(apiMock).toHaveBeenCalledWith(expect.stringContaining('/modrinth/servers/1/search'))
  })

  it('hides source switcher when only Thunderstore is configured', async () => {
    render(
      <ModManager
        serverId={2}
        gameInfo={{
          id: 'valheim',
          name: 'Valheim',
          mod_support: true,
          supports_thunderstore: true,
          mod_providers: ['thunderstore'],
          mod_provider: 'thunderstore',
          thunderstore_community: 'valheim',
        }}
      />,
    )

    expect(await screen.findByText('BepInExPack_Valheim')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Thunderstore' })).not.toBeInTheDocument()
    expect(apiMock).toHaveBeenCalledWith(expect.stringContaining('/thunderstore/servers/2/search'))
  })
})
