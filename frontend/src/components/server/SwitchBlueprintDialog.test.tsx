import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as client from '@/api/client'
import type { Server, SwitchOptionsResponse } from '@/types'
import { SwitchBlueprintDialog } from './SwitchBlueprintDialog'

vi.mock('@/api/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/client')>()
  return { ...original, api: vi.fn() }
})

const server = {
  id: 101,
  name: 'MaickCraft Public',
  game_type: 'minecraft_forge',
  status: 'stopped',
} as unknown as Server

const fullModeOptions: SwitchOptionsResponse = {
  mode: 'full',
  current_game_type: 'minecraft_forge',
  switch_allowed: true,
  cooldown_hours: 0,
  cooldown_remaining_seconds: 0,
  max_per_30d: 0,
  switches_last_30d: 0,
  allow_higher_price_plan: true,
  current_plan_price_cents: null,
  options: [
    {
      id: 'minecraft_forge',
      name: 'Minecraft Forge',
      category: 'non_steam_game',
      platforms: ['pc'],
      is_current: true,
      selectable: false,
      blocked_reason: 'current',
    },
    {
      id: 'minecraft_vanilla',
      name: 'Minecraft Vanilla',
      category: 'non_steam_game',
      platforms: ['pc'],
      is_current: false,
      selectable: true,
      blocked_reason: null,
    },
  ],
}

const shopCustomerOptions: SwitchOptionsResponse = {
  mode: 'shop_customer',
  current_game_type: 'minecraft_forge',
  switch_allowed: true,
  cooldown_hours: 24,
  cooldown_remaining_seconds: 0,
  max_per_30d: 4,
  switches_last_30d: 1,
  allow_higher_price_plan: false,
  current_plan_price_cents: 1000,
  options: [
    {
      id: 'minecraft_forge',
      name: 'Minecraft Forge',
      category: 'non_steam_game',
      platforms: ['pc'],
      artwork_url: '/api/shop/artwork/minecraft_forge',
      min_ram_mb: 2048,
      min_cpu: 1,
      min_price_cents: 1000,
      is_current: true,
      selectable: false,
      blocked_reason: 'current',
    },
    {
      id: 'palworld',
      name: 'Palworld',
      tagline: 'Survival Monster Tamer',
      category: 'steam_game',
      platforms: ['pc'],
      artwork_url: '/api/shop/artwork/palworld',
      min_ram_mb: 4096,
      min_cpu: 2,
      min_price_cents: 1000,
      is_current: false,
      selectable: true,
      blocked_reason: null,
    },
    {
      id: 'ark_sa',
      name: 'ARK: Survival Ascended',
      category: 'steam_game',
      platforms: ['pc', 'crossplay'],
      artwork_url: '/api/shop/artwork/ark_sa',
      min_ram_mb: 16384,
      min_cpu: 4,
      min_price_cents: 2500,
      is_current: false,
      selectable: false,
      blocked_reason: 'higher_price_plan',
    },
  ],
}

function zeichnen(onClose: () => void = () => {}) {
  return render(
    <SwitchBlueprintDialog open onClose={onClose} server={server} onSwitched={() => {}} />,
  )
}

function auswahlKnopf() {
  return screen.getByTestId('switch-blueprint-select')
}

describe('SwitchBlueprintDialog', () => {
  beforeEach(() => {
    vi.mocked(client.api).mockReset()
  })

  it('füllt die Auswahl im Self-Hosting-Modus aus /switch-options', async () => {
    vi.mocked(client.api).mockResolvedValue(fullModeOptions)
    zeichnen()

    await waitFor(() => expect(auswahlKnopf()).toBeEnabled())
    fireEvent.click(auswahlKnopf())

    const optionen = await screen.findAllByRole('option')
    expect(optionen.map((o) => o.textContent)).toEqual([
      'Minecraft Forge (non_steam_game)',
      'Minecraft Vanilla (non_steam_game)',
    ])
  })

  it('wählt im Self-Hosting-Modus die erste wechselbare Option vor', async () => {
    vi.mocked(client.api).mockResolvedValue(fullModeOptions)
    zeichnen()

    await waitFor(() => {
      expect(auswahlKnopf()).toHaveTextContent('Minecraft Vanilla (non_steam_game)')
    })
  })

  it('bleibt bei einer leeren Liste bedienbar', async () => {
    vi.mocked(client.api).mockResolvedValue({ ...fullModeOptions, options: [] })
    zeichnen()

    await waitFor(() => expect(auswahlKnopf()).toBeInTheDocument())
    expect(auswahlKnopf()).toBeDisabled()
  })

  it('rendert im Kundenmodus Spiele-Karten inkl. Suche und gesperrter Tarife', async () => {
    vi.mocked(client.api).mockResolvedValue(shopCustomerOptions)
    zeichnen()

    const palworldCard = await screen.findByTestId('switch-game-card-palworld')
    const arkCard = screen.getByTestId('switch-game-card-ark_sa')

    expect(palworldCard).toBeEnabled()
    expect(arkCard).toBeDisabled()

    const searchInput = screen.getByTestId('switch-search-input')
    fireEvent.change(searchInput, { target: { value: 'Palworld' } })
    expect(screen.getByTestId('switch-game-card-palworld')).toBeInTheDocument()
    expect(screen.queryByTestId('switch-game-card-ark_sa')).not.toBeInTheDocument()
  })

  it('blockiert im Kundenmodus den Wechsel bei aktivem Cooldown', async () => {
    vi.mocked(client.api).mockResolvedValue({
      ...shopCustomerOptions,
      switch_allowed: false,
      cooldown_remaining_seconds: 3600,
      options: shopCustomerOptions.options.map((o) =>
        o.is_current ? o : { ...o, selectable: false, blocked_reason: 'cooldown' },
      ),
    })
    zeichnen()

    await screen.findByTestId('switch-game-card-palworld')
    expect(screen.getByTestId('switch-submit-btn')).toBeDisabled()
  })

  it('meldet sich als Dialog und schließt bei Escape', async () => {
    vi.mocked(client.api).mockResolvedValue(fullModeOptions)
    const schliessen = vi.fn()
    zeichnen(schliessen)

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')

    await waitFor(() => expect(auswahlKnopf()).toBeEnabled())
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(schliessen).toHaveBeenCalledTimes(1)
  })

  it('setzt den Fokus beim Öffnen auf Abbrechen und gibt ihn beim Schließen zurück', async () => {
    vi.mocked(client.api).mockResolvedValue(fullModeOptions)
    const ausloeser = document.createElement('button')
    document.body.appendChild(ausloeser)
    ausloeser.focus()

    const { rerender } = zeichnen()
    await waitFor(() => expect(screen.getByTestId('switch-cancel-btn')).toHaveFocus())

    rerender(
      <SwitchBlueprintDialog
        open={false}
        onClose={() => {}}
        server={server}
        onSwitched={() => {}}
      />,
    )
    expect(ausloeser).toHaveFocus()
    ausloeser.remove()
  })

  it('schließt nicht bei Escape, während der Wechsel läuft', async () => {
    vi.mocked(client.api).mockImplementation(((pfad: string) =>
      pfad.includes('/switch-options')
        ? Promise.resolve(fullModeOptions)
        : new Promise(() => {})) as typeof client.api)
    const schliessen = vi.fn()
    zeichnen(schliessen)

    await waitFor(() => expect(auswahlKnopf()).toBeEnabled())
    fireEvent.click(screen.getByTestId('switch-submit-btn'))
    await waitFor(() => expect(screen.getByTestId('switch-cancel-btn')).toBeDisabled())

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(schliessen).not.toHaveBeenCalled()
  })
})
