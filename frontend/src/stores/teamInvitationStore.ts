import { create } from 'zustand'

import { teamsApi } from '@/api/teams'

interface TeamInvitationState {
  count: number
  laden: () => Promise<void>
  zuruecksetzen: () => void
}

let laufend: Promise<void> | null = null

/**
 * Offene Teameinladungen — zentral, weil Sidebar, Navigation und spaeter
 * weitere Hüllen denselben Zähler brauchen. Kein Ton: eine Einladung ist
 * keine Nachricht, sie darf warten.
 */
export const useTeamInvitationStore = create<TeamInvitationState>((set) => ({
  count: 0,
  laden: () => {
    if (laufend) return laufend
    laufend = teamsApi
      .invitations()
      .then((liste) => set({ count: liste.length }))
      .catch(() => set({ count: 0 }))
      .finally(() => {
        laufend = null
      })
    return laufend
  },
  zuruecksetzen: () => set({ count: 0 }),
}))
