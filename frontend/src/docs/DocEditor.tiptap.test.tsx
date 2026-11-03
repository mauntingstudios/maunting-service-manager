import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import type { DocDetail } from '@/api/docs'
import { DocEditor } from './DocEditor'

const editorRef = vi.hoisted(() => ({ current: null as null | Record<string, any> }))

vi.mock('@hocuspocus/provider', () => ({
  HocuspocusProvider: class {
    localState: Record<string, unknown> = {}
    awareness = {
      clientID: 1,
      on: vi.fn(),
      off: vi.fn(),
      getStates: () => new Map(),
      states: new Map(),
      getLocalState: () => this.localState,
      setLocalState: (wert: Record<string, unknown>) => {
        this.localState = wert
      },
      setLocalStateField: vi.fn(),
    }
    destroy = vi.fn()
  },
}))

vi.mock('y-indexeddb', () => ({
  IndexeddbPersistence: class {
    destroy = vi.fn(async () => {})
  },
}))

vi.mock('@/api/docs', async (importOriginal) => {
  const echt = await importOriginal<typeof import('@/api/docs')>()
  return {
    ...echt,
    getCollabToken: vi.fn(async () => ({ token: 'collab-token' })),
    uploadAsset: vi.fn(),
    undoAiEdit: vi.fn(),
    createComment: vi.fn(),
  }
})

// Nur die Instanz merken; useEditor und EditorContent bleiben echt.
vi.mock('@tiptap/react', async (importOriginal) => {
  const echt = await importOriginal<typeof import('@tiptap/react')>()
  return {
    ...echt,
    useEditor: (...args: Parameters<typeof echt.useEditor>) => {
      const editor = echt.useEditor(...args) as unknown as Record<string, any> | null
      editorRef.current = editor
      return editor
    },
  }
})

function detail(over: Partial<DocDetail> = {}): DocDetail {
  return {
    uid: 'doc-tiptap',
    title: 'Protokoll',
    folder_uid: null,
    team_id: 1,
    team_name: null,
    role: 'editor',
    can_edit: true,
    can_comment: true,
    can_manage: false,
    rev: 1,
    archived: false,
    deleted: false,
    content_truncated: false,
    updated_at: '2026-11-03T10:00:00Z',
    last_edited_at: '2026-11-03T10:00:00Z',
    owner: 'Ada',
    default_role: 'viewer',
    schema_version: 1,
    shared: false,
    share_role: null,
    share_expires_at: null,
    ...over,
  } as DocDetail
}

function zeigen(onSelectionChange = vi.fn()) {
  return {
    onSelectionChange,
    ...render(
      <DocEditor
        detail={detail()}
        userId={7}
        userName="Ada"
        online
        activePanel={null}
        onOpenPanel={vi.fn()}
        onOpenShare={vi.fn()}
        onOpenMembers={vi.fn()}
        onCommentsChanged={vi.fn()}
        onTitleChanged={vi.fn(async () => {})}
        onSelectionChange={onSelectionChange}
      />,
    ),
  }
}

describe('DocEditor mit echtem TipTap', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de')
    editorRef.current = null
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({
        matches: false,
        media: '',
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    })
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: () => [],
    })
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, bottom: 0, right: 0 }),
    })
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as never
  })

  it('tippt in das Dokument und meldet die Auswahl an das KI-Panel', async () => {
    const { onSelectionChange } = zeigen()

    await waitFor(() => expect(editorRef.current).not.toBeNull())
    await waitFor(() => expect(document.querySelector('.ProseMirror')).not.toBeNull())

    act(() => {
      editorRef.current!.commands.insertContent('Hallo Welt')
    })
    expect(document.querySelector('.ProseMirror')?.textContent).toContain('Hallo Welt')

    act(() => {
      editorRef.current!.commands.selectAll()
    })
    await waitFor(() =>
      expect(onSelectionChange).toHaveBeenCalledWith({ quote: expect.stringContaining('Hallo Welt') }),
    )
  })
})
