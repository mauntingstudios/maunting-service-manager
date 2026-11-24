import { shopCatalogApi, type ShopPublicNodeStatusDto } from '@/api/shop'
import { still } from '@/lib/still'
import type { ShopPingMessung } from './shopStandortStore'

export async function messeNodePings(
  nodes: ShopPublicNodeStatusDto[],
  tag = 'shop',
): Promise<Record<number, ShopPingMessung>> {
  const onlineNodes = nodes.filter((n) => n.status === 'online')
  const gemessen: Record<number, ShopPingMessung> = {}
  await Promise.all(
    onlineNodes.map(async (node) => {
      if (node.public_ping_url) {
        const start = performance.now()
        try {
          await fetch(node.public_ping_url, { mode: 'no-cors', cache: 'no-store' })
          const ms = Math.max(1, Math.round(performance.now() - start))
          gemessen[node.id] = { ms, direkt: true }
          return
        } catch (err) {
          still(err, `${tag}.pingPublicUrl`)
        }
      }
      if (shopCatalogApi.pingNode) {
        const start = performance.now()
        try {
          const res = await shopCatalogApi.pingNode(node.id)
          const elapsed = Math.max(1, Math.round(performance.now() - start))
          const ms =
            res.server_agent_rtt_ms != null && res.server_agent_rtt_ms > 0
              ? Math.round(res.server_agent_rtt_ms)
              : elapsed
          gemessen[node.id] = { ms, direkt: false }
          return
        } catch (err) {
          still(err, `${tag}.pingNode`)
        }
      }
      gemessen[node.id] = { ms: null, direkt: false }
    }),
  )
  return gemessen
}
