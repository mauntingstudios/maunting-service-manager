import { create } from 'zustand'

export interface ShopPingMessung {
  ms: number | null
  direkt: boolean
}

interface ShopStandortState {
  ausgewaehlteNodeId: number | null
  pingMsByNodeId: Record<number, ShopPingMessung>
  setAusgewaehlteNodeId: (nodeId: number | null) => void
  setPingWerte: (werte: Record<number, ShopPingMessung>) => void
  reset: () => void
}

export const useShopStandortStore = create<ShopStandortState>((set) => ({
  ausgewaehlteNodeId: null,
  pingMsByNodeId: {},
  setAusgewaehlteNodeId: (nodeId) => set({ ausgewaehlteNodeId: nodeId }),
  setPingWerte: (werte) => set({ pingMsByNodeId: werte }),
  reset: () => set({ ausgewaehlteNodeId: null, pingMsByNodeId: {} }),
}))
