import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import type { DocDetail } from '@/api/docs'
import * as docsApi from '@/api/docs'
import { DocEditor } from './DocEditor'

const hocus = vi.hoisted(() => ({ instanzen: [] as Array<Record<string, unknown>> }))

vi.mock('@hocuspocus/provider', () => ({
  HocuspocusProvider: class {
    options: Record<string, unknown>
    awareness = { on: vi.fn(), off: vi.fn(), getStates: () => new Map() }
    destroy = vi.fn()
    constructor(options: Record<string, unknown>) {
      this.options = options
      hocus.instanzen.push(this as unknown as Record<string, unknown>)
    }
  },
}))

vi.mock('y-indexeddb', () => ({
  IndexeddbPersistence: class {
    destroy = vi.fn(async () => {})
  },
}))

const fakeEditor = vi.hoisted(() => ({
  setEditable: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  chain: vi.fn(() => {
    const kette: Record<string, unknown> = {}
    const weiter = () => kette
    Object.assign(kette, {
      focus: weiter,
      undo: weiter,
      redo: weiter,
      toggleBold: weiter,
      toggleItalic: weiter,
      toggleUnderline: weiter,
      toggleStrike: weiter,
      toggleCode: weiter,
      toggleHighlight: weiter,
      toggleBulletList: weiter,
      toggleOrderedList: weiter,
      toggleTaskList: weiter,
      toggleBlockquote: weiter,
      toggleCodeBlock: weiter,
      setHorizontalRule: weiter,
      insertTable: weiter,
      setMark: weiter,
      insertContent: weiter,
      run: vi.fn(() => true),
    })
    return kette
  }),
  isActive: vi.fn(() => false),
  getAttributes: vi.fn(() => ({})),
  storage: { characterCount: { words: () => 12, characters: () => 60 } },
  getText: vi.fn(() => 'Lokale Fassung'),
  state: {
    selection: { from: 0, to: 0, $from: { parent: { isTextblock: false } } },
    doc: { textBetween: () => '' },
  },
}))

vi.mock('@tiptap/react', () => ({
  useEditor: () => fakeEditor,
  EditorContent: () => <div data-testid="editor-content" />,
}))

vi.mock('./editor/extensions', () => ({
  createDocsExtensions: () => [],
  farbeFuerBenutzer: () => 'hsl(0 0% 0%)',
}))

vi.mock('./editor/Toolbar', () => ({
  Toolbar: ({ disabled }: { disabled?: boolean }) => (
    <div data-testid="toolbar" data-disabled={String(Boolean(disabled))} />
  ),
}))

vi.mock('./editor/MobileToolbar', () => ({
  MobileToolbar: ({ disabled }: { disabled?: boolean }) => (
    <div data-testid="mobile-toolbar" data-disabled={String(Boolean(disabled))} />
  ),
}))

vi.mock('./editor/Outline', () => ({ Outline: () => null }))
vi.mock('./editor/SlashMenu', () => ({ SlashMenu: () => null }))

vi.mock('@/api/docs', async (importOriginal) => {
  const echt = await importOriginal<typeof import('@/api/docs')>()
  return {
    ...echt,
    getCollabToken: vi.fn(async () => ({
      url: 'ws://collab',
      token: 'collab-token',
      expires_at: '2026-10-01T11:00:00Z',
      readonly: false,
      role: 'editor' as const,
      rev: 2,
    })),
  }
})

const detail = (over: Partial<DocDetail> = {}): DocDetail => ({
  uid: 'doc-1',
  title: 'Protokoll',
  folder_uid: null,
  team_id: 1,
  team_name: 'Team',
  role: 'editor',
  can_edit: true,
  can_comment: true,
  can_manage: false,
  rev: 2,
  archived: false,
  deleted: false,
  content_truncated: false,
  updated_at: '2026-10-01T10:00:00Z',
  last_edited_at: '2026-10-01T10:00:00Z',
  owner: 'Ada',
  default_role: 'viewer',
  schema_version: 1,
  shared: false,
  share_role: null,
  share_expires_at: null,
  ...over,
})

function zeigen(over: Partial<DocDetail> = {}, online = true) {
  const props = {
    detail: detail(over),
    userId: 7,
    userName: 'Ada',
    online,
    activePanel: null,
    onOpenPanel: vi.fn(),
    onOpenShare: vi.fn(),
    onOpenMembers: vi.fn(),
    onCommentsChanged: vi.fn(),
    onTitleChanged: vi.fn(async () => {}),
  }
  const ergebnis = render(<DocEditor {...props} />)
  return { ...ergebnis, props }
}

beforeEach(() => {
  vi.clearAllMocks()
  hocus.instanzen.length = 0
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  })
})

describe('DocEditor', () => {
  it('zeigt Viewern den Text ohne Werkzeugleiste und mit gesperrtem Titel', () => {
    zeigen({ role: 'viewer', can_edit: false, can_comment: false })
    expect(screen.getByText(i18n.t('docs.editor.readOnly'))).toBeInTheDocument()
    expect(screen.queryByTestId('toolbar')).not.toBeInTheDocument()
    expect(screen.getByLabelText(i18n.t('docs.editor.titleLabel'))).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: i18n.t('docs.toolbar.comment') }),
    ).not.toBeInTheDocument()
  })

  it('lässt Kommentatoren kommentieren, aber nicht formatieren', () => {
    zeigen({ role: 'commenter', can_edit: false })
    expect(screen.getByText(i18n.t('docs.editor.readOnly'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: i18n.t('docs.toolbar.comment') })).toBeInTheDocument()
    expect(screen.queryByTestId('toolbar')).not.toBeInTheDocument()
  })

  it('zeigt Editoren online erst nach dem Sync eine aktive Werkzeugleiste', async () => {
    zeigen()
    expect(screen.getByText(i18n.t('docs.status.waitingSync'))).toBeInTheDocument()
    expect(screen.getByTestId('toolbar')).toHaveAttribute('data-disabled', 'true')

    const provider = hocus.instanzen[0] as { options: { onStatus: (arg: { status: string }) => void } }
    act(() => provider.options.onStatus({ status: 'connected' }))

    await waitFor(() =>
      expect(screen.getByTestId('toolbar')).toHaveAttribute('data-disabled', 'false'),
    )
    expect(screen.queryByText(i18n.t('docs.status.waitingSync'))).not.toBeInTheDocument()
    expect(screen.getByText(i18n.t('docs.status.connected'))).toBeInTheDocument()
  })

  it('bleibt offline editierbar und zeigt den lokalen Hinweis', () => {
    zeigen({}, false)
    expect(screen.getByText(i18n.t('docs.offline.banner'))).toBeInTheDocument()
    expect(screen.getByTestId('toolbar')).toHaveAttribute('data-disabled', 'false')
    expect(screen.getByText(i18n.t('docs.offline.localChanges'))).toBeInTheDocument()
  })

  it('holt das Collab-Token erst beim Verbinden über den API-Client', async () => {
    zeigen()
    const provider = hocus.instanzen[0] as { options: { token: () => Promise<string> } }
    await expect(provider.options.token()).resolves.toBe('collab-token')
    expect(docsApi.getCollabToken).toHaveBeenCalledWith('doc-1')
  })

  it('warnt nach einer Rollen-Senkung vor nicht übernommenen lokalen Änderungen', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } })
    const { rerender, props } = zeigen({}, false)
    const update = fakeEditor.on.mock.calls.find(([ereignis]) => ereignis === 'update')?.[1] as
      | (() => void)
      | undefined
    expect(update).toBeDefined()
    act(() => update?.())

    rerender(
      <DocEditor {...props} detail={detail({ role: 'viewer', can_edit: false })} online />,
    )
    const warnung = screen.getByRole('alert')
    expect(warnung).toHaveTextContent(i18n.t('docs.editor.downgraded'))
    fireEvent.click(
      screen.getByRole('button', { name: i18n.t('docs.editor.copyLocal') }),
    )
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Lokale Fassung'),
    )
  })

  it('räumt Provider und lokale Datenbank beim Wechsel des Dokuments auf', async () => {
    const { unmount } = zeigen()
    const provider = hocus.instanzen[0] as { destroy: ReturnType<typeof vi.fn> }
    unmount()
    expect(provider.destroy).toHaveBeenCalled()
  })
})
