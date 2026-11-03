import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import i18n from '@/i18n'
import type { DocSummary } from '@/api/docs'
import { DocTree } from './DocTree'

const noop = () => {}

function renderBaum(
  props: {
    search?: string
    searchHinweis?: number | null
    documents?: DocSummary[]
    folders?: Array<{ uid: string; name: string; parent_uid: string | null; team_id: number; created_at: string }>
    onDuplicate?: (doc: DocSummary) => void
    onMoveToFolder?: (doc: DocSummary, folderUid: string | null) => void
    hasMoreDocuments?: boolean
    onLoadMoreDocuments?: () => void
  } = {},
) {
  return render(
    <DocTree
      teams={[]}
      teamId={null}
      onTeamChange={noop}
      folders={props.folders ?? []}
      documents={props.documents ?? []}
      folderUid={null}
      onFolderChange={noop}
      selectedUid={null}
      onSelect={noop}
      onMoveDocumentToFolder={props.onMoveToFolder ?? noop}
      search={props.search ?? ''}
      onSearch={noop}
      searchHinweis={props.searchHinweis ?? null}
      trash={false}
      archived={false}
      onTrashChange={noop}
      onArchiveChange={noop}
      onCreateDocument={noop}
      onCreateFolder={noop}
      onTrashDocument={noop}
      onRestoreDocument={noop}
      onMoveDocument={noop}
      onArchiveDocument={noop}
      onDuplicateDocument={props.onDuplicate ?? noop}
      canManageFolders={false}
      onRenameFolder={noop}
      onDeleteFolder={noop}
      loading={false}
      hasMoreDocuments={props.hasMoreDocuments}
      onLoadMoreDocuments={props.onLoadMoreDocuments}
    />,
  )
}

describe('DocTree Suchhinweis', () => {
  it('zeigt bei gekürzter Suche, wie viele Dokumente durchsucht wurden', async () => {
    await i18n.changeLanguage('de')
    renderBaum({ search: 'protokoll', searchHinweis: 200 })

    expect(screen.getByRole('note')).toHaveTextContent('200')
  })

  it('schweigt bei vollständiger Suche', async () => {
    await i18n.changeLanguage('de')
    renderBaum({ search: 'protokoll', searchHinweis: null })

    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })
})

describe('DocTree Filter', () => {
  it('kennzeichnet den aktiven Filter barrierefrei', async () => {
    await i18n.changeLanguage('de')
    renderBaum()

    expect(screen.getByRole('button', { name: i18n.t('docs.tree.all') })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: i18n.t('docs.tree.archive') })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })
})

describe('DocTree Duplizieren', () => {
  it('bietet die Aktion für bearbeitbare Dokumente an', async () => {
    await i18n.changeLanguage('de')
    const onDuplicate = vi.fn()
    const doc: DocSummary = {
      uid: 'doc-1',
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
      owner: null,
    }
    renderBaum({ documents: [doc], onDuplicate })

    fireEvent.click(
      screen.getByRole('button', {
        name: i18n.t('docs.tree.actionsFor', { name: doc.title }),
      }),
    )
    fireEvent.click(
      await screen.findByRole('menuitem', { name: i18n.t('docs.tree.duplicateAction') }),
    )

    expect(onDuplicate).toHaveBeenCalledWith(doc)
  })
})

describe('DocTree Ablegen und Nachladen', () => {
  const ordner = {
    uid: 'folder-1',
    name: 'Projekte',
    parent_uid: null,
    team_id: 1,
    created_at: '2026-11-03T10:00:00Z',
  }
  const doc: DocSummary = {
    uid: 'doc-drop',
    title: 'Protokoll',
    folder_uid: null,
    team_id: 1,
    team_name: null,
    role: 'editor',
    can_edit: true,
    can_comment: true,
    can_manage: true,
    rev: 1,
    archived: false,
    deleted: false,
    content_truncated: false,
    updated_at: '2026-11-03T10:00:00Z',
    last_edited_at: '2026-11-03T10:00:00Z',
    owner: null,
  }

  function datenuebergabe() {
    return {
      effectAllowed: '',
      getData: () => doc.uid,
      setData: vi.fn(),
    }
  }

  it('legt ein Dokument per Drag and Drop in einem Ordner ab', async () => {
    await i18n.changeLanguage('de')
    const onMoveToFolder = vi.fn()
    renderBaum({ documents: [doc], folders: [ordner], onMoveToFolder })

    const zeile = screen.getByText(doc.title).closest('[draggable="true"]')
    expect(zeile).not.toBeNull()
    fireEvent.dragStart(zeile!, { dataTransfer: datenuebergabe() })
    fireEvent.drop(screen.getByText(ordner.name), { dataTransfer: datenuebergabe() })

    expect(onMoveToFolder).toHaveBeenCalledWith(doc, ordner.uid)
  })

  it('lädt weitere Dokumente über die Schaltfläche', async () => {
    await i18n.changeLanguage('de')
    const onLoadMoreDocuments = vi.fn()
    renderBaum({ hasMoreDocuments: true, onLoadMoreDocuments })

    fireEvent.click(screen.getByRole('button', { name: i18n.t('docs.tree.loadMore') }))

    expect(onLoadMoreDocuments).toHaveBeenCalled()
  })
})
