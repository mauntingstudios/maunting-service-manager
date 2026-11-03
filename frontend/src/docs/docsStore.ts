import { create } from 'zustand'

import type { DocPendingView, DocSummary } from '@/api/docs'
import type { DocsPanel } from './DocsPanels'
import { beiKontowechsel } from '@/lib/angemeldetesKonto'

/**
 * UI-Zustand des Dokumente-Moduls: Auswahl, offene Panels und
 * Pending-Edits (Befund 21). Jede Komponente abonniert nur ihre Felder
 * (Einzelselektoren oder `useShallow`), nie den ganzen Store.
 */
interface DocsUiState {
  panel: DocsPanel | null
  treeOffen: boolean
  shareOpen: boolean
  membersOpen: boolean
  moveDoc: DocSummary | null
  selection: { quote: string } | null
  vorschlag: DocPendingView | null
  vorschlagBusy: boolean
  setPanel: (panel: DocsPanel | null) => void
  setTreeOffen: (offen: boolean) => void
  setShareOpen: (offen: boolean) => void
  setMembersOpen: (offen: boolean) => void
  setMoveDoc: (doc: DocSummary | null) => void
  setSelection: (selection: { quote: string } | null) => void
  setVorschlag: (vorschlag: DocPendingView | null) => void
  setVorschlagBusy: (busy: boolean) => void
  /** Setzt alle UI-Zustände zurück (Tests, Kontowechsel). */
  zuruecksetzen: () => void
}

const ANFANG = {
  panel: null,
  treeOffen: false,
  shareOpen: false,
  membersOpen: false,
  moveDoc: null,
  selection: null,
  vorschlag: null,
  vorschlagBusy: false,
} satisfies Pick<
  DocsUiState,
  | 'panel'
  | 'treeOffen'
  | 'shareOpen'
  | 'membersOpen'
  | 'moveDoc'
  | 'selection'
  | 'vorschlag'
  | 'vorschlagBusy'
>

export const useDocsStore = create<DocsUiState>()((set) => ({
  ...ANFANG,
  setPanel: (panel) => set({ panel }),
  setTreeOffen: (treeOffen) => set({ treeOffen }),
  setShareOpen: (shareOpen) => set({ shareOpen }),
  setMembersOpen: (membersOpen) => set({ membersOpen }),
  setMoveDoc: (moveDoc) => set({ moveDoc }),
  setSelection: (selection) => set({ selection }),
  setVorschlag: (vorschlag) => set({ vorschlag }),
  setVorschlagBusy: (vorschlagBusy) => set({ vorschlagBusy }),
  zuruecksetzen: () => set({ ...ANFANG }),
}))

// Ein Kontowechsel ohne Abmelden (abgelaufene Sitzung, neue Anmeldung) darf
// die offene Auswahl des vorigen Kontos nicht mitnehmen.
beiKontowechsel(() => {
  useDocsStore.getState().zuruecksetzen()
})
