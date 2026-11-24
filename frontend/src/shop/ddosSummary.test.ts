import { describe, expect, it } from 'vitest'
import type { ShopPublicNodeStatusDto } from '@/api/shop'
import { berechneDdosSummary } from './ddosSummary'

function node(overrides: Partial<ShopPublicNodeStatusDto>): ShopPublicNodeStatusDto {
  return {
    id: 1,
    name: 'node-1',
    location_label: 'Frankfurt',
    status: 'online',
    cpu_model: null,
    ram_type: null,
    storage_type: null,
    ram_free_percent: 80,
    load_level: 'low',
    accepting_orders: true,
    ...overrides,
  }
}

describe('berechneDdosSummary', () => {
  it('liefert coverage=none ohne geschuetzte Online-Nodes und ignoriert Offline-Nodes', () => {
    const out = berechneDdosSummary([
      node({ id: 1, status: 'offline', ddos_provider: 'GhostGuard', ddos_game_aware: true }),
      node({ id: 2, status: 'online', ddos_provider: null, ddos_game_aware: false }),
    ])
    expect(out.coverage).toBe('none')
    expect(out.providers).toEqual([])
    expect(out.onlineNodeCount).toBe(1)
    expect(out.protectedNodeCount).toBe(0)
  })

  it('liefert coverage=partial wenn nur ein Teil der 5 Nodes geschuetzt ist', () => {
    const out = berechneDdosSummary([
      node({ id: 1, ddos_provider: 'Path.net', ddos_game_aware: true }),
      node({ id: 2, ddos_provider: null, ddos_game_aware: false }),
      node({ id: 3, ddos_provider: null, ddos_game_aware: false }),
    ])
    expect(out.coverage).toBe('partial')
    expect(out.protectedNodeCount).toBe(1)
    expect(out.onlineNodeCount).toBe(3)
    expect(out.providers).toEqual(['Path.net'])
  })

  it('liefert coverage=mixed bei 5 geschuetzten Nodes mit unterschiedlichen Anbietern', () => {
    const out = berechneDdosSummary([
      node({ id: 1, ddos_provider: 'Path.net', ddos_game_aware: true }),
      node({ id: 2, ddos_provider: 'Path.net', ddos_game_aware: true }),
      node({ id: 3, ddos_provider: 'Path.net', ddos_game_aware: true }),
      node({ id: 4, ddos_provider: 'Path.net', ddos_game_aware: true }),
      node({ id: 5, ddos_provider: 'Voxility', ddos_game_aware: false }),
    ])
    expect(out.coverage).toBe('mixed')
    expect(out.allGameAware).toBe(false)
    expect(out.providers).toEqual(['Path.net', 'Voxility'])
  })

  it('liefert coverage=uniform mit allGameAware=true nur wenn alle Nodes identisch geschuetzt sind', () => {
    const out = berechneDdosSummary([
      node({ id: 1, ddos_provider: 'Famesystems', ddos_game_aware: true }),
      node({ id: 2, ddos_provider: 'Famesystems', ddos_game_aware: true }),
    ])
    expect(out.coverage).toBe('uniform')
    expect(out.allGameAware).toBe(true)
    expect(out.providers).toEqual(['Famesystems'])
  })
})
