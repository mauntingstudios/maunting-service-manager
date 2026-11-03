import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import i18n from '@/i18n'
import { DocTree } from './DocTree'

const noop = () => {}

function renderBaum(props: { search?: string; searchHinweis?: number | null } = {}) {
  return render(
    <DocTree
      teams={[]}
      teamId={null}
      onTeamChange={noop}
      folders={[]}
      documents={[]}
      folderUid={null}
      onFolderChange={noop}
      selectedUid={null}
      onSelect={noop}
      onMoveDocumentToFolder={noop}
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
      canManageFolders={false}
      onRenameFolder={noop}
      onDeleteFolder={noop}
      loading={false}
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
