import { useRef, useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import type { DocDetail } from '@/api/docs'
import { DocsPanels, type DocsPanel } from './DocsPanels'

function mobilAnsicht() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  })
}

function detail(): DocDetail {
  return {
    uid: 'doc-1',
    title: 'Dokument',
    folder_uid: null,
    team_id: 7,
    team_name: null,
    role: 'editor',
    can_edit: true,
    can_comment: true,
    can_manage: true,
    rev: 3,
    archived: false,
    deleted: false,
    content_truncated: false,
    updated_at: '2026-11-03T00:00:00Z',
    last_edited_at: '2026-11-03T00:00:00Z',
    owner: 'tester',
    default_role: 'editor',
    schema_version: 1,
    shared: false,
    share_role: null,
    share_expires_at: null,
  }
}

function Aufbau({ start = null }: { start?: DocsPanel | null }) {
  const [panel, setPanel] = useState<DocsPanel | null>(start)
  const outlineJumpRef = useRef<((pos: number) => void) | null>(null)
  return (
    <>
      <button type="button" onClick={() => setPanel('comments')}>
        öffnen
      </button>
      {panel && (
        <DocsPanels
          detail={detail()}
          panel={panel}
          comments={[]}
          revisions={[]}
          outlineEntries={[]}
          outlineJumpRef={outlineJumpRef}
          selection={null}
          userId={7}
          onClose={() => setPanel(null)}
          onCommentsChanged={() => {}}
          onHistoryChanged={() => {}}
          onAssistantChanged={() => {}}
        />
      )}
    </>
  )
}

describe('DocsPanels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mobilAnsicht()
  })

  it('zeigt das mobile Panel als benannten Dialog', async () => {
    await waitFor(() => expect(window.history.state?.msmTiefe ?? 0).toBe(0))
    render(<Aufbau start="comments" />)
    const overlay = screen.getByRole('dialog', { name: i18n.t('docs.comments.title') })
    expect(overlay).toBeInTheDocument()
    const karte = overlay.firstElementChild as HTMLElement
    expect(karte.className).toContain('pt-[var(--msm-oben-sicher)]')
    expect(karte.className).toContain('pb-[var(--msm-unten-sicher)]')
  })

  it('schließt mit Escape und gibt den Fokus an den Auslöser zurück', async () => {
    await waitFor(() => expect(window.history.state?.msmTiefe ?? 0).toBe(0))
    render(<Aufbau />)
    const knopf = screen.getByText('öffnen')
    knopf.focus()
    fireEvent.click(knopf)
    expect(
      screen.getByRole('dialog', { name: i18n.t('docs.comments.title') }),
    ).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: i18n.t('docs.comments.title') })).not.toBeInTheDocument(),
    )
    expect(document.activeElement).toBe(knopf)
  })

  it('schließt mit der Zurück-Taste', async () => {
    await waitFor(() => expect(window.history.state?.msmTiefe ?? 0).toBe(0))
    render(<Aufbau start="comments" />)
    await waitFor(() => expect(window.history.state?.msmTiefe).toBe(1))
    act(() => window.history.back())
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: i18n.t('docs.comments.title') })).not.toBeInTheDocument(),
    )
  })
})
