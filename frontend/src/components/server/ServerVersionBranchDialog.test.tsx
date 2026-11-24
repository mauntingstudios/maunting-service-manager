import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as client from '@/api/client'
import type { GameInfo, MinecraftVersionsResponse, Server } from '@/types'
import { ServerVersionBranchDialog } from './ServerVersionBranchDialog'

vi.mock('@/api/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/client')>()
  return { ...original, api: vi.fn() }
})

const mcServer = {
  id: 201,
  name: 'Paper Survival',
  game_type: 'minecraft_paper',
  status: 'stopped',
  is_hoster_managed: false,
} as unknown as Server

const steamServerAdmin = {
  id: 202,
  name: 'Palworld Cluster',
  game_type: 'palworld',
  status: 'stopped',
  steam_branch: 'public',
  has_branch_password: false,
  is_hoster_managed: false,
} as unknown as Server

const steamGameInfo: GameInfo = {
  id: 'palworld',
  name: 'Palworld',
  platform: 'linux',
  source_type: 'steam',
  supports_version_switch: false,
  steam_branches: [
    { id: 'public', label: 'Public', description: 'Standard branch', requires_password: false },
    { id: 'experimental', label: 'Experimental', description: 'Beta tests', requires_password: false },
    { id: 'closed_qa', label: 'Closed QA', description: 'Requires key', requires_password: true },
  ],
  mod_support: false,
  supports_steam_workshop: false,
}

const mcVersionsResponse: MinecraftVersionsResponse = {
  provider: 'papermc',
  env_key: 'VERSION',
  current_version: '1.21.4',
  supports_downgrade_warning: true,
  is_shop_customer: false,
  versions: [
    { version: 'LATEST', release_type: 'latest', relation: 'latest' },
    { version: '1.21.5', release_type: 'release', relation: 'upgrade' },
    { version: '1.21.4', release_type: 'release', relation: 'same' },
    { version: '1.20.4', release_type: 'release', relation: 'downgrade' },
  ],
  editions: [
    { id: 'minecraft_paper', name: 'Minecraft PaperMC', provider: 'papermc', is_current: true, selectable: false, blocked_reason: 'current' },
    { id: 'minecraft_purpur', name: 'Minecraft PurpurMC', provider: 'purpurmc', is_current: false, selectable: true, blocked_reason: null },
  ],
}

describe('ServerVersionBranchDialog', () => {
  beforeEach(() => {
    vi.mocked(client.api).mockReset()
  })

  it('zeigt Minecraft-Versionen und erzwingt Bestätigung oder Welt-Reset bei Downgrade', async () => {
    vi.mocked(client.api).mockResolvedValue(mcVersionsResponse)
    const onUpdated = vi.fn()
    render(
      <ServerVersionBranchDialog
        open
        onClose={() => {}}
        server={mcServer}
        isMinecraft
        isSteam={false}
        onUpdated={onUpdated}
      />,
    )

    const downgradeBtn = await screen.findByTestId('mc-version-item-1.20.4')
    fireEvent.click(downgradeBtn)

    const applyBtn = screen.getByTestId('version-branch-submit-btn')
    expect(applyBtn).toBeDisabled()

    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[1]) // confirmKeepWorld
    expect(applyBtn).toBeEnabled()

    fireEvent.click(applyBtn)
    await waitFor(() => {
      expect(vi.mocked(client.api)).toHaveBeenCalledWith(
        '/servers/201/minecraft/switch-version',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            target_version: '1.20.4',
            reset_world: false,
            confirm_downgrade_keep_world: true,
          }),
        }),
      )
    })
    expect(onUpdated).toHaveBeenCalledTimes(1)
  })

  it('wechselt in Minecraft zwischen Versions- und Editions-Tab', async () => {
    vi.mocked(client.api).mockResolvedValue(mcVersionsResponse)
    render(
      <ServerVersionBranchDialog
        open
        onClose={() => {}}
        server={mcServer}
        isMinecraft
        isSteam={false}
        onUpdated={() => {}}
      />,
    )

    await screen.findByTestId('mc-version-item-1.21.5')
    const tabs = screen.getAllByRole('tab')
    fireEvent.click(tabs[1])

    const purpurCard = await screen.findByTestId('mc-edition-item-minecraft_purpur')
    expect(purpurCard).toBeEnabled()
  })

  it('zeigt Steam-Branches an und sperrt Passwort-Branches für Shop-Kunden', async () => {
    vi.mocked(client.api).mockResolvedValue({ message: 'ok' })
    const customerSteam = { ...steamServerAdmin, is_hoster_managed: true } as unknown as Server

    render(
      <ServerVersionBranchDialog
        open
        onClose={() => {}}
        server={customerSteam}
        gameInfo={steamGameInfo}
        isMinecraft={false}
        isSteam
        onUpdated={() => {}}
      />,
    )

    expect(screen.getByTestId('steam-branch-card-public')).toBeEnabled()
    expect(screen.getByTestId('steam-branch-card-experimental')).toBeEnabled()
    expect(screen.getByTestId('steam-branch-card-closed_qa')).toBeDisabled()
    expect(screen.queryByPlaceholderText('public')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('steam-branch-card-experimental'))
    fireEvent.click(screen.getByTestId('version-branch-submit-btn'))

    await waitFor(() => {
      expect(vi.mocked(client.api)).toHaveBeenCalledWith(
        '/servers/202/switch-branch',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            branch: 'experimental',
            branch_password: null,
            clear_password: false,
          }),
        }),
      )
    })
  })
})
