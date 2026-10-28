import { create } from 'zustand'
import type { PanelId } from '../leiste/module'

interface DrittanbieterHinweisState {
  ausstehend: PanelId | null
  oeffnen: (id: PanelId) => void
  schliessen: () => void
}

export const useDrittanbieterHinweisStore = create<DrittanbieterHinweisState>((set) => ({
  ausstehend: null,
  oeffnen: (id) => set({ ausstehend: id }),
  schliessen: () => set({ ausstehend: null }),
}))
