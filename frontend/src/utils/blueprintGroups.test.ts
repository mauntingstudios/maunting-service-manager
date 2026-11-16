import { describe, expect, it } from 'vitest'
import {
  groupByGame,
  resolveBlueprintEditionLabel,
  resolveGameGroupName,
  toGameGroupKey,
} from './blueprintGroups'

describe('blueprintGroups', () => {
  it('prefers explicit meta.game and falls back cleanly for legacy prefixes', () => {
    expect(resolveGameGroupName({ id: 'ark_ascended', name: 'ARK: Survival Ascended (ASA)', game: 'ARK' })).toBe('ARK')
    expect(resolveGameGroupName({ id: 'minecraft_paper', name: 'Minecraft (Paper)' })).toBe('Minecraft')
    expect(resolveGameGroupName({ id: 'farming_simulator_25', name: 'Farming Simulator 25' })).toBe('Farming Simulator')
    expect(resolveGameGroupName({ id: 'valheim', name: 'Valheim' })).toBe('Valheim')
  })

  it('derives readable edition labels within a game group', () => {
    expect(
      resolveBlueprintEditionLabel({ id: 'minecraft_paper', name: 'Minecraft (Paper)', edition: 'Paper' }, 'Minecraft'),
    ).toBe('Paper')
    expect(
      resolveBlueprintEditionLabel({ id: 'minecraft_paper', name: 'Minecraft (Paper)' }, 'Minecraft'),
    ).toBe('Paper')
    expect(
      resolveBlueprintEditionLabel({ id: 'ark_ascended', name: 'ARK: Survival Ascended (ASA)' }, 'ARK'),
    ).toBe('Survival Ascended (ASA)')
    expect(
      resolveBlueprintEditionLabel({ id: 'farming_simulator_22', name: 'Farming Simulator 22' }, 'Farming Simulator'),
    ).toBe('22')
  })

  it('groups blueprints alphabetically and creates stable keys', () => {
    const groups = groupByGame([
      { id: 'valheim', name: 'Valheim' },
      { id: 'minecraft_vanilla', name: 'Minecraft (Vanilla)', game: 'Minecraft', edition: 'Vanilla' },
      { id: 'minecraft_paper', name: 'Minecraft (Paper)', game: 'Minecraft', edition: 'Paper' },
      { id: 'farming_simulator_22', name: 'Farming Simulator 22', game: 'Farming Simulator', edition: '2022' },
    ])

    expect(groups.map((g) => g.name)).toEqual(['Farming Simulator', 'Minecraft', 'Valheim'])
    expect(groups[1].key).toBe(toGameGroupKey('Minecraft'))
    expect(groups[1].items.map((item) => item.id)).toEqual(['minecraft_paper', 'minecraft_vanilla'])
  })
})
