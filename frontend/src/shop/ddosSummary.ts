import type { ShopPublicNodeStatusDto } from '@/api/shop'

export const PLATTFORM_LABELS: Record<string, string> = {
  pc: 'PC',
  ps5: 'PS5',
  xbox: 'Xbox',
  crossplay: 'Crossplay',
}

export type DdosCoverage = 'none' | 'uniform' | 'mixed' | 'partial'

export interface ShopDdosSummary {
  coverage: DdosCoverage
  allGameAware: boolean
  anyGameAware: boolean
  providers: string[]
  profiles: string[]
  protectedNodeCount: number
  onlineNodeCount: number
}

export function extractSupportedPlatforms(platforms?: string[] | null): string[] {
  return (platforms ?? []).filter((p) => p in PLATTFORM_LABELS)
}

/**
 * Aggregiert DDoS-Schutz ausschließlich aus öffentlichen, online gemeldeten Nodes.
 * Private (`shop_enabled = false`) und Offline-Nodes fließen nie in Shop-Zusagen ein.
 */
export function berechneDdosSummary(nodeStatuses: ShopPublicNodeStatusDto[]): ShopDdosSummary {
  const onlineNodes = nodeStatuses.filter((n) => (n.status || '').toLowerCase() === 'online')
  const providers = new Set<string>()
  const profiles = new Set<string>()
  let protectedNodeCount = 0
  let gameAwareCount = 0

  for (const node of onlineNodes) {
    const provider = (node.ddos_provider || '').trim()
    const profile = (node.ddos_profile || '').trim()
    const gameAware = Boolean(node.ddos_game_aware)
    if (provider) providers.add(provider)
    if (profile) profiles.add(profile)
    if (gameAware) gameAwareCount += 1
    if (gameAware || provider) protectedNodeCount += 1
  }

  const onlineNodeCount = onlineNodes.length
  const providerList = [...providers]
  const profileList = [...profiles]

  let coverage: DdosCoverage = 'none'
  if (onlineNodeCount > 0 && protectedNodeCount > 0) {
    if (protectedNodeCount < onlineNodeCount) {
      coverage = 'partial'
    } else if (providerList.length > 1) {
      coverage = 'mixed'
    } else {
      coverage = 'uniform'
    }
  }

  return {
    coverage,
    allGameAware: onlineNodeCount > 0 && gameAwareCount === onlineNodeCount,
    anyGameAware: gameAwareCount > 0,
    providers: providerList,
    profiles: profileList,
    protectedNodeCount,
    onlineNodeCount,
  }
}
