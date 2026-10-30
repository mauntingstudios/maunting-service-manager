import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { fireEvent, within } from '@testing-library/react'
import { fingerprintText } from '@msm/docs-schema/structure'
import { describe, expect, it, vi } from 'vitest'

import type { DocPendingView } from '@/api/docs'
import {
  createPendingEdits,
  PENDING_REFRESH_META,
  type PendingHandles,
} from './PendingEdits'

function editorMit(handles: PendingHandles, inhalt = '<p>Alter Block</p>') {
  const editor = new Editor({
    extensions: [StarterKit, createPendingEdits({ current: handles })],
    content: inhalt,
  })
  return editor
}

function handles(
  vorschlag: DocPendingView | null,
  onApply = vi.fn(),
  onReject = vi.fn(),
): PendingHandles {
  return {
    get: () => vorschlag,
    busy: () => false,
    onApply,
    onReject,
    labels: {
      title: 'Singra schlägt vor',
      apply: 'Übernehmen',
      reject: 'Verwerfen',
      applying: 'Läuft',
      batchTitle: '{count} Änderungen',
      editStale: 'Nicht mehr auffindbar',
    },
  }
}

function vorschlag(overrides: Partial<DocPendingView> = {}): DocPendingView {
  return {
    uid: 'v-1',
    operation: 'replace_block',
    status: 'pending',
    summary: 'Kurz',
    anchor_quote: 'Alter Block',
    created_at: '2026-10-30T00:00:00Z',
    expires_at: '2026-10-31T00:00:00Z',
    html: '<p>Neuer <strong>Text</strong></p>',
    target_block: 'Alter Block',
    target_index: 0,
    ...overrides,
  }
}

describe('PendingEdits', () => {
  it('zeigt den Vorschlag als Geist, ohne das Dokument zu ändern', () => {
    const onApply = vi.fn()
    const editor = editorMit(handles(vorschlag(), onApply))
    const vorher = editor.getHTML()

    const geist = editor.view.dom.querySelector('.docs-ai-vorschlag')
    expect(geist).not.toBeNull()
    expect(geist?.textContent).toContain('Neuer')
    expect(editor.view.dom.querySelector('.docs-ai-vorschlag-ziel')).not.toBeNull()
    expect(editor.getHTML()).toBe(vorher)

    fireEvent.click(within(editor.view.dom).getByRole('button', { name: 'Übernehmen' }))
    expect(onApply).toHaveBeenCalledOnce()

    editor.destroy()
  })

  it('zeigt nichts, wenn der Anker nicht mehr gefunden wird', () => {
    const editor = editorMit(
      handles(vorschlag({ target_block: 'Gibt es nicht', anchor_quote: 'Gibt es nicht' })),
    )
    expect(editor.view.dom.querySelector('.docs-ai-vorschlag')).toBeNull()
    editor.destroy()
  })

  it('zeigt nichts für einen veralteten Vorschlag', () => {
    const editor = editorMit(handles(vorschlag({ stale: true })))
    expect(editor.view.dom.querySelector('.docs-ai-vorschlag')).toBeNull()
    editor.destroy()
  })

  it('baut die Dekoration nach einem Refresh-Meta neu', () => {
    const leere = handles(null)
    const editor = editorMit(leere)
    expect(editor.view.dom.querySelector('.docs-ai-vorschlag')).toBeNull()

    leere.get = () => vorschlag()
    editor.view.dispatch(editor.state.tr.setMeta(PENDING_REFRESH_META, Date.now()))

    expect(editor.view.dom.querySelector('.docs-ai-vorschlag')).not.toBeNull()
    editor.destroy()
  })

  it('zeigt mehrere Ziele und genau ein Aktionspaar', () => {
    const onApply = vi.fn()
    const vorschlagBatch = vorschlag({
      operation: 'batch',
      edits: [
        {
          op: 'insert_after',
          summary: 'Neu nach Eins',
          target: { index: 0, fingerprint: fingerprintText('Eins') },
        },
        {
          op: 'replace_block',
          summary: 'Drei ersetzen',
          target: { index: 2, fingerprint: fingerprintText('Drei') },
        },
      ],
      previews: [
        {
          index: 0,
          op: 'insert_after',
          html: '<p>Neu</p>',
          target_index: 1,
          target_fingerprint: fingerprintText('Eins'),
        },
        {
          index: 1,
          op: 'replace_block',
          html: '<p>Drei neu</p>',
          target_index: 2,
          target_fingerprint: fingerprintText('Drei'),
        },
      ],
      html: '<p>Neu</p><p>Drei neu</p>',
    })
    const editor = editorMit(
      handles(vorschlagBatch, onApply),
      '<p>Eins</p><p>Zwei</p><p>Drei</p>',
    )

    expect(editor.view.dom.querySelectorAll('.docs-ai-vorschlag-anker')).toHaveLength(1)
    expect(editor.view.dom.querySelectorAll('.docs-ai-vorschlag-ziel')).toHaveLength(1)
    const geist = editor.view.dom.querySelectorAll('.docs-ai-vorschlag')
    expect(geist).toHaveLength(1)
    expect(geist[0].textContent).toContain('2 Änderungen')
    expect(geist[0].textContent).toContain('Neu nach Eins')

    fireEvent.click(within(geist[0] as HTMLElement).getByRole('button', { name: 'Übernehmen' }))
    expect(onApply).toHaveBeenCalledOnce()
    editor.destroy()
  })

  it('findet ein verschobenes Ziel ueber den Fingerabdruck', () => {
    const editor = editorMit(
      handles(
        vorschlag({
          operation: 'batch',
          edits: [
            {
              op: 'replace_block',
              summary: 'Zwei ersetzen',
              // Absichtlich falscher Index: der Fingerabdruck entscheidet.
              target: { index: 0, fingerprint: fingerprintText('Zwei') },
            },
          ],
          previews: [
            {
              index: 0,
              op: 'replace_block',
              html: '<p>Zwei neu</p>',
              target_index: 1,
              target_fingerprint: fingerprintText('Zwei'),
            },
          ],
          html: '<p>Zwei neu</p>',
        }),
      ),
      '<p>Eins</p><p>Zwei</p>',
    )

    const absaetze = editor.view.dom.querySelectorAll('p')
    expect(absaetze[0].classList.contains('docs-ai-vorschlag-ziel')).toBe(false)
    expect(absaetze[1].classList.contains('docs-ai-vorschlag-ziel')).toBe(true)
    editor.destroy()
  })

  it('sperrt Uebernehmen, wenn ein Ziel fehlt', () => {
    const editor = editorMit(
      handles(
        vorschlag({
          operation: 'batch',
          edits: [
            {
              op: 'replace_block',
              summary: 'Weg',
              target: { index: 0, fingerprint: '000000000000' },
            },
          ],
          previews: [
            {
              index: 0,
              op: 'replace_block',
              html: '<p>Weg</p>',
              target_index: 0,
              target_fingerprint: '000000000000',
            },
          ],
          html: '<p>Weg</p>',
        }),
      ),
    )

    const geist = editor.view.dom.querySelector('.docs-ai-vorschlag')
    expect(geist?.textContent).toContain('Nicht mehr auffindbar')
    expect(
      (within(geist as HTMLElement).getByRole('button', { name: 'Übernehmen' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    editor.destroy()
  })

  it('entfernt unsichere Tags aus der Vorschau', () => {
    const editor = editorMit(
      handles(vorschlag({
        html: '<p>Text</p><script>alert(1)</script><img src="https://evil.test/x.png">',
      })),
    )
    const geist = editor.view.dom.querySelector('.docs-ai-vorschlag')
    expect(geist?.innerHTML).not.toContain('<script')
    expect(geist?.innerHTML).not.toContain('evil.test')
    editor.destroy()
  })
})
