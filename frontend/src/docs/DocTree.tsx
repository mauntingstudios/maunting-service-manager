import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Archive, ArchiveRestore, FileText, Folder, FolderInput, FolderPlus, Pencil, Plus, Search, Settings2, Trash2 } from 'lucide-react'
import { ActionMenu, Button, Dropdown, Input, Kurzinfo } from '@/Singra/UI'
import type { DocFolder, DocSummary } from '@/api/docs'
import type { Team } from '@/api/teams'
import { cx } from '@/utils/classNames'

interface DocTreeProps {
  teams: Team[]
  teamId: number | null
  onTeamChange: (teamId: number | null) => void
  folders: DocFolder[]
  documents: DocSummary[]
  folderUid: string | null
  onFolderChange: (folderUid: string | null) => void
  selectedUid: string | null
  onSelect: (uid: string) => void
  onMoveDocumentToFolder: (doc: DocSummary, folderUid: string | null) => void
  search: string
  onSearch: (wert: string) => void
  trash: boolean
  archived: boolean
  onTrashChange: (wert: boolean) => void
  onArchiveChange: (wert: boolean) => void
  onCreateDocument: () => void
  onCreateFolder: () => void
  onTrashDocument: (uid: string) => void
  onRestoreDocument: (uid: string) => void
  onMoveDocument: (doc: DocSummary) => void
  onArchiveDocument: (doc: DocSummary) => void
  canManageFolders: boolean
  onRenameFolder: (folder: DocFolder) => void
  onDeleteFolder: (folder: DocFolder) => void
  loading: boolean
}

function ordnerTiefe(folders: DocFolder[]): Map<string, number> {
  const byUid = new Map(folders.map((ordner) => [ordner.uid, ordner]))
  const tiefen = new Map<string, number>()
  for (const ordner of folders) {
    let tiefe = 0
    let aktuell: DocFolder | undefined = ordner
    const gesehen = new Set<string>()
    while (aktuell?.parent_uid && !gesehen.has(aktuell.uid)) {
      gesehen.add(aktuell.uid)
      tiefe += 1
      aktuell = byUid.get(aktuell.parent_uid)
    }
    tiefen.set(ordner.uid, tiefe)
  }
  return tiefen
}

export function DocTree({
  teams,
  teamId,
  onTeamChange,
  folders,
  documents,
  folderUid,
  onFolderChange,
  selectedUid,
  onSelect,
  onMoveDocumentToFolder,
  search,
  onSearch,
  trash,
  archived,
  onTrashChange,
  onArchiveChange,
  onCreateDocument,
  onCreateFolder,
  onTrashDocument,
  onRestoreDocument,
  onMoveDocument,
  onArchiveDocument,
  canManageFolders,
  onRenameFolder,
  onDeleteFolder,
  loading,
}: DocTreeProps) {
  const { t } = useTranslation()
  const [dropZiel, setDropZiel] = useState<string | null>(null)
  const ablegen = (event: React.DragEvent, ziel: string | null) => {
    event.preventDefault()
    const doc = documents.find((eintrag) => eintrag.uid === event.dataTransfer.getData('text/plain'))
    setDropZiel(null)
    if (!doc || !doc.can_manage || trash) return
    onMoveDocumentToFolder(doc, ziel)
  }
  const tiefen = useMemo(() => ordnerTiefe(folders), [folders])
  const sichtbar = useMemo(() => {
    if (search.trim()) return documents
    return documents.filter((doc) =>
      folderUid ? doc.folder_uid === folderUid : !doc.folder_uid,
    )
  }, [documents, folderUid, search])

  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-r border-outline-variant/40 bg-surface-container md:w-72 md:shrink-0">
      <div className="flex flex-col gap-2 border-b border-outline-variant/40 p-3">
        <Dropdown
          aria-label={t('docs.tree.team')}
          value={teamId === null ? 'personal' : String(teamId)}
          onChange={(wert) => onTeamChange(wert === 'personal' ? null : Number(wert))}
          options={[
            { value: 'personal', label: t('docs.tree.personal') },
            ...teams
              .filter((team) => !team.is_personal)
              .map((team) => ({ value: String(team.id), label: team.name })),
          ]}
          buttonClassName="w-full"
        />
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant" />
          <Input
            aria-label={t('docs.tree.search')}
            placeholder={t('docs.tree.search')}
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1">
          <Button variant="primary" size="sm" className="flex-1" onClick={onCreateDocument}>
            <Plus className="mr-1 h-4 w-4" />
            {t('docs.new')}
          </Button>
          <Kurzinfo text={t('docs.tree.newFolder')}>
            <Button variant="ghost" size="sm" onClick={onCreateFolder} aria-label={t('docs.tree.newFolder')}>
              <FolderPlus className="h-4 w-4" />
            </Button>
          </Kurzinfo>
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => {
              onTrashChange(false)
              onArchiveChange(false)
            }}
            className={cx(
              'flex-1 rounded-lg px-2 py-1.5 text-xs',
              !trash && !archived ? 'bg-primary/15 text-primary' : 'text-on-surface-variant hover:bg-surface-container-high',
            )}
          >
            {t('docs.tree.all')}
          </button>
          <button
            type="button"
            onClick={() => {
              onArchiveChange(!archived)
              onTrashChange(false)
            }}
            className={cx(
              'flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs',
              archived ? 'bg-primary/15 text-primary' : 'text-on-surface-variant hover:bg-surface-container-high',
            )}
          >
            <Archive className="h-3.5 w-3.5" />
            {t('docs.tree.archive')}
          </button>
          <button
            type="button"
            onClick={() => {
              onTrashChange(!trash)
              onArchiveChange(false)
            }}
            className={cx(
              'flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs',
              trash ? 'bg-primary/15 text-primary' : 'text-on-surface-variant hover:bg-surface-container-high',
            )}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t('docs.tree.trash')}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {!search.trim() && (
          <>
            <button
              type="button"
              onClick={() => onFolderChange(null)}
              onDragOver={(event) => {
                if (!trash) {
                  event.preventDefault()
                  setDropZiel('root')
                }
              }}
              onDragLeave={() => setDropZiel(null)}
              onDrop={(event) => ablegen(event, null)}
              className={cx(
                'mb-0.5 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm',
                dropZiel === 'root'
                  ? 'bg-primary/15 text-primary ring-2 ring-primary/40'
                  : folderUid === null
                    ? 'bg-surface-container-high text-on-surface'
                    : 'text-on-surface-variant hover:bg-surface-container-high',
              )}
            >
              <Folder className="h-4 w-4" />
              {t('docs.tree.root')}
            </button>
            {folders.map((ordner) => (
              <div key={ordner.uid} className="group mb-0.5 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onFolderChange(ordner.uid)}
                  onDragOver={(event) => {
                    if (!trash) {
                      event.preventDefault()
                      setDropZiel(ordner.uid)
                    }
                  }}
                  onDragLeave={() => setDropZiel(null)}
                  onDrop={(event) => ablegen(event, ordner.uid)}
                  className={cx(
                    'flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm',
                    dropZiel === ordner.uid
                      ? 'bg-primary/15 text-primary ring-2 ring-primary/40'
                      : folderUid === ordner.uid
                        ? 'bg-surface-container-high text-on-surface'
                        : 'text-on-surface-variant hover:bg-surface-container-high',
                  )}
                  style={{ paddingLeft: `${8 + (tiefen.get(ordner.uid) ?? 0) * 12}px` }}
                >
                  <Folder className="h-4 w-4 shrink-0" />
                  <span className="truncate">{ordner.name}</span>
                </button>
                {canManageFolders && (
                  <ActionMenu
                    label={t('docs.tree.actionsFor', { name: ordner.name })}
                    ariaLabel={t('docs.tree.actionsFor', { name: ordner.name })}
                    icon={<Settings2 className="h-5 w-5" />}
                    iconOnly
                    variant="ghost"
                    compact
                    surface="dna"
                    align="end"
                    items={[
                      {
                        key: 'rename',
                        label: t('docs.tree.renameFolder'),
                        icon: <Pencil className="h-4 w-4" />,
                        onSelect: () => onRenameFolder(ordner),
                      },
                      {
                        key: 'delete',
                        label: t('docs.tree.deleteFolder'),
                        icon: <Trash2 className="h-4 w-4" />,
                        destructive: true,
                        onSelect: () => onDeleteFolder(ordner),
                      },
                    ]}
                  />
                )}
              </div>
            ))}
            <div className="my-2 h-px bg-outline-variant/40" />
          </>
        )}

        {loading && <p className="px-2 py-3 text-xs text-on-surface-variant">{t('docs.tree.loading')}</p>}
        {!loading && sichtbar.length === 0 && (
          <p className="px-2 py-3 text-xs text-on-surface-variant">
            {trash ? t('docs.tree.trashEmpty') : archived ? t('docs.tree.archiveEmpty') : t('docs.tree.empty')}
          </p>
        )}
        {sichtbar.map((doc) => (
          <div
            key={doc.uid}
            draggable={doc.can_manage && !trash}
            onDragStart={(event) => {
              if (!doc.can_manage || trash) {
                event.preventDefault()
                return
              }
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', doc.uid)
            }}
            className={cx(
              'group mb-0.5 flex items-center gap-1 rounded-lg',
              selectedUid === doc.uid ? 'bg-primary/10' : 'hover:bg-surface-container-high',
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(doc.uid)}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-left"
            >
              {doc.icon ? (
                <span className="w-4 shrink-0 text-center text-base leading-none" aria-hidden>
                  {doc.icon}
                </span>
              ) : (
                <FileText className={cx('h-4 w-4 shrink-0', selectedUid === doc.uid ? 'text-primary' : 'text-on-surface-variant')} />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-on-surface">{doc.title}</span>
                <span className="block truncate text-label-sm text-on-surface-variant">
                  {new Date(doc.updated_at).toLocaleDateString()} · {t(`docs.roles.${doc.role}`)}
                </span>
              </span>
            </button>
            {(doc.can_edit || doc.can_manage) && (
              <ActionMenu
                label={t('docs.tree.actionsFor', { name: doc.title })}
                ariaLabel={t('docs.tree.actionsFor', { name: doc.title })}
                icon={<Settings2 className="h-5 w-5" />}
                iconOnly
                variant="ghost"
                compact
                surface="dna"
                align="end"
                items={
                  trash
                    ? [
                        {
                          key: 'restore',
                          label: t('docs.tree.restore'),
                          icon: <ArchiveRestore className="h-4 w-4" />,
                          onSelect: () => onRestoreDocument(doc.uid),
                        },
                      ]
                    : [
                        ...(doc.can_edit
                          ? [
                              {
                                key: 'archive',
                                label: doc.archived
                                  ? t('docs.tree.unarchiveAction')
                                  : t('docs.tree.archiveAction'),
                                icon: <Archive className="h-4 w-4" />,
                                onSelect: () => onArchiveDocument(doc),
                              },
                            ]
                          : []),
                        ...(doc.can_manage
                          ? [
                              {
                                key: 'move',
                                label: t('docs.move.action'),
                                icon: <FolderInput className="h-4 w-4" />,
                                onSelect: () => onMoveDocument(doc),
                              },
                              {
                                key: 'trash',
                                label: t('docs.tree.trashAction'),
                                icon: <Trash2 className="h-4 w-4" />,
                                destructive: true,
                                onSelect: () => onTrashDocument(doc.uid),
                              },
                            ]
                          : []),
                      ]
                }
              />
            )}
          </div>
        ))}
      </div>
    </aside>
  )
}
