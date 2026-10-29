import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import * as docsApi from '@/api/docs'
import type { DocComment } from '@/api/docs'
import { CommentsPanel } from './CommentsPanel'

vi.mock('@/api/docs', async (importOriginal) => {
  const echt = await importOriginal<typeof import('@/api/docs')>()
  return {
    ...echt,
    createComment: vi.fn(async () => ({ uid: 'neu' })),
    updateComment: vi.fn(async () => ({ ok: true })),
    deleteComment: vi.fn(async () => ({ ok: true })),
  }
})

const kommentar = (over: Partial<DocComment>): DocComment => ({
  uid: 'c-1',
  parent_uid: null,
  body: 'Bitte prüfen',
  anchor: { quote: 'Stelle im Text' },
  status: 'open',
  author: 'Ada',
  author_user_id: 2,
  created_at: '2026-10-01T10:00:00Z',
  updated_at: '2026-10-01T10:00:00Z',
  ...over,
})

function zeigen(comments: DocComment[], opts: { canComment?: boolean; canManage?: boolean; userId?: number } = {}) {
  const onChanged = vi.fn()
  render(
    <CommentsPanel
      uid="doc-1"
      comments={comments}
      canComment={opts.canComment ?? false}
      canManage={opts.canManage ?? false}
      userId={opts.userId ?? 1}
      onChanged={onChanged}
    />,
  )
  return { onChanged }
}

beforeEach(() => vi.clearAllMocks())

describe('CommentsPanel', () => {
  it('zeigt im leeren Dokument einen Hinweis statt einer leeren Fläche', () => {
    zeigen([])
    expect(screen.getByText(i18n.t('docs.comments.empty'))).toBeInTheDocument()
  })

  it('lässt Viewer lesen, aber nicht kommentieren oder moderieren', () => {
    zeigen([kommentar({})], { userId: 1 })
    expect(screen.getByText('Bitte prüfen')).toBeInTheDocument()
    expect(screen.getByText('Stelle im Text')).toBeInTheDocument()
    expect(screen.queryByLabelText(i18n.t('docs.comments.new'))).not.toBeInTheDocument()
    expect(screen.queryByLabelText(i18n.t('docs.comments.reply'))).not.toBeInTheDocument()
    expect(screen.queryByLabelText(i18n.t('docs.comments.resolve'))).not.toBeInTheDocument()
  })

  it('legt als Kommentator einen neuen Thread an und meldet die Änderung', async () => {
    const { onChanged } = zeigen([], { canComment: true })
    fireEvent.change(screen.getByLabelText(i18n.t('docs.comments.new')), {
      target: { value: '  Neue Anmerkung  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: i18n.t('docs.comments.send') }))
    await waitFor(() =>
      expect(docsApi.createComment).toHaveBeenCalledWith('doc-1', 'Neue Anmerkung', null),
    )
    expect(onChanged).toHaveBeenCalled()
  })

  it('antwortet auf einen offenen Thread', async () => {
    zeigen([kommentar({})], { canComment: true, userId: 2 })
    fireEvent.click(screen.getByLabelText(i18n.t('docs.comments.reply')))
    const feld = await screen.findByRole('textbox', { name: i18n.t('docs.comments.reply') })
    fireEvent.change(feld, { target: { value: 'Erledigt' } })
    const thread = screen.getByText('Bitte prüfen').closest('article') as HTMLElement
    fireEvent.click(within(thread).getByRole('button', { name: i18n.t('docs.comments.send') }))
    await waitFor(() =>
      expect(docsApi.createComment).toHaveBeenCalledWith('doc-1', 'Erledigt', 'c-1'),
    )
  })

  it('erledigt und löscht nur eigene Threads ohne Moderationsrecht', async () => {
    const { onChanged } = zeigen([kommentar({ author_user_id: 1 })], { canComment: true, userId: 1 })
    fireEvent.click(screen.getByLabelText(i18n.t('docs.comments.resolve')))
    await waitFor(() =>
      expect(docsApi.updateComment).toHaveBeenCalledWith('doc-1', 'c-1', { status: 'resolved' }),
    )

    fireEvent.click(screen.getByLabelText(i18n.t('docs.comments.delete')))
    await waitFor(() => expect(docsApi.deleteComment).toHaveBeenCalledWith('doc-1', 'c-1'))
    expect(onChanged).toHaveBeenCalledTimes(2)
  })

  it('zeigt Antworten unter ihrem Thread und zählt offene Kommentare', () => {
    zeigen(
      [
        kommentar({}),
        kommentar({ uid: 'c-2', parent_uid: 'c-1', body: 'Antwort', author: 'Bob' }),
        kommentar({ uid: 'c-3', body: 'Alt', status: 'resolved' }),
      ],
      { canComment: true, userId: 2 },
    )
    expect(screen.getByText('Antwort')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })
})
