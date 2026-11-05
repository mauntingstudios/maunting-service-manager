import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { DocsSidebar } from './DocsSidebar'
import { useDocsStore } from './docsStore'
import type { DocsSession } from './useDocsSession'

vi.mock('./DocTree', () => ({
  DocTree: () => <div data-testid="baum" />,
}))

function medienAbfrage() {
  let matches = true
  const hoerer = new Set<() => void>()
  const frage = {
    get matches() {
      return matches
    },
    media: '(max-width: 767.98px)',
    addEventListener: (_art: string, hoeren: () => void) => hoerer.add(hoeren),
    removeEventListener: (_art: string, hoeren: () => void) => hoerer.delete(hoeren),
  }
  return {
    frage,
    setze(breit: boolean) {
      matches = breit
      act(() => {
        for (const hoeren of hoerer) hoeren()
      })
    },
  }
}

function sitzung(): DocsSession {
  return {
    teams: [],
    teamId: null,
    setTeamId: vi.fn(),
    folders: [],
    documents: [],
    folderUid: null,
    setFolderUid: vi.fn(),
    search: '',
    setSearch: vi.fn(),
    suchGrenze: null,
    trash: false,
    archived: false,
    setTrash: vi.fn(),
    setArchived: vi.fn(),
    loading: false,
    mehrDokumente: false,
    ladeMehrDokumente: false,
    weitereDokumenteLaden: vi.fn(async () => {}),
  } as unknown as DocsSession
}

describe('DocsSidebar', () => {
  beforeEach(() => {
    useDocsStore.getState().zuruecksetzen()
  })

  it('schließt das mobile Baum-Overlay, sobald das Fenster desktopbreit wird', () => {
    const abfrage = medienAbfrage()
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: () => abfrage.frage,
    })
    useDocsStore.setState({ treeOffen: true })

    render(
      <MemoryRouter>
        <DocsSidebar
          session={sitzung()}
          aktionen={{
            neueDokument: vi.fn(),
            neuerOrdner: vi.fn(),
            dokumentInPapierkorb: vi.fn(),
            dokumentWiederherstellen: vi.fn(),
            archivUmschalten: vi.fn(),
            ordnerUmbenennen: vi.fn(),
            ordnerLoeschen: vi.fn(),
            verschiebePerDrop: vi.fn(),
          }}
          selectedUid={null}
          canManageFolders={false}
        />
      </MemoryRouter>,
    )
    expect(useDocsStore.getState().treeOffen).toBe(true)
    const dialog = screen.getByRole('dialog', { name: i18n.t('docs.tree.open') }).firstElementChild as HTMLElement
    expect(dialog.className).toContain('pt-[var(--msm-oben-sicher)]')
    expect(dialog.className).toContain('pb-[var(--msm-unten-sicher)]')

    abfrage.setze(false)

    expect(useDocsStore.getState().treeOffen).toBe(false)
  })
})
