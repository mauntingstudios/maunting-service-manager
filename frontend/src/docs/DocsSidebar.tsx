import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'

import { Button, Dialog, DialogContent, Kurzinfo } from '@maunting/ui'
import type { DocFolder, DocSummary } from '@/api/docs'
import { DocTree } from './DocTree'
import { useDocsStore } from './docsStore'
import type { DocsSession } from './useDocsSession'
import { useMedienabfrage } from '@/hooks/useMedienabfrage'

/** Listenhandlungen, die DocsApp als Komposition aus Sitzung, Detail und Routing stellt. */
export interface DocsSidebarAktionen {
  neueDokument: () => void
  neuerOrdner: () => void
  dokumentInPapierkorb: (docUid: string) => void
  dokumentWiederherstellen: (docUid: string) => void
  archivUmschalten: (doc: DocSummary) => void
  dokumentDuplizieren: (doc: DocSummary) => void
  ordnerUmbenennen: (ordner: DocFolder) => void
  ordnerLoeschen: (ordner: DocFolder) => void
  verschiebePerDrop: (doc: DocSummary, folderUid: string | null) => void
}

interface DocsSidebarProps {
  session: DocsSession
  aktionen: DocsSidebarAktionen
  selectedUid: string | null
  canManageFolders: boolean
}

/** Baum und Liste — auf dem Desktop angedockt, mobil als Dialog (Befund 21/31). */
export function DocsSidebar({ session, aktionen, selectedUid, canManageFolders }: DocsSidebarProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { treeOffen, setTreeOffen, setMoveDoc } = useDocsStore(
    useShallow((state) => ({
      treeOffen: state.treeOffen,
      setTreeOffen: state.setTreeOffen,
      setMoveDoc: state.setMoveDoc,
    })),
  )

  const schmal = useMedienabfrage('(max-width: 767.98px)')

  // Auf dem Desktop liegt der Baum fest; ein offenes Overlay aus der schmalen
  // Ansicht würde ihn ein zweites Mal in den DOM hängen.
  useEffect(() => {
    if (!schmal) setTreeOffen(false)
  }, [schmal, setTreeOffen])

  const baum = () => (
    <DocTree
      teams={session.teams}
      teamId={session.teamId}
      onTeamChange={(wert) => {
        session.setTeamId(wert)
        session.setFolderUid(null)
        setTreeOffen(false)
        if (selectedUid) navigate('/dokumente')
      }}
      folders={session.folders}
      documents={session.documents}
      folderUid={session.folderUid}
      onFolderChange={(wert) => {
        session.setFolderUid(wert)
        setTreeOffen(false)
      }}
      selectedUid={selectedUid}
      onMoveDocumentToFolder={(doc, ziel) => void aktionen.verschiebePerDrop(doc, ziel)}
      onSelect={(docUid) => {
        navigate(`/dokumente/${docUid}`)
        setTreeOffen(false)
      }}
      search={session.search}
      onSearch={session.setSearch}
      searchHinweis={session.suchGrenze}
      trash={session.trash}
      archived={session.archived}
      onTrashChange={session.setTrash}
      onArchiveChange={session.setArchived}
      onCreateDocument={() => void aktionen.neueDokument()}
      onCreateFolder={() => void aktionen.neuerOrdner()}
      onTrashDocument={(docUid) => void aktionen.dokumentInPapierkorb(docUid)}
      onRestoreDocument={(docUid) => void aktionen.dokumentWiederherstellen(docUid)}
      onMoveDocument={setMoveDoc}
      onArchiveDocument={(doc) => void aktionen.archivUmschalten(doc)}
      onDuplicateDocument={(doc) => void aktionen.dokumentDuplizieren(doc)}
      canManageFolders={canManageFolders}
      onRenameFolder={(ordner) => void aktionen.ordnerUmbenennen(ordner)}
      onDeleteFolder={(ordner) => void aktionen.ordnerLoeschen(ordner)}
      loading={session.loading}
      hasMoreDocuments={session.mehrDokumente && !session.search.trim()}
      loadingMoreDocuments={session.ladeMehrDokumente}
      onLoadMoreDocuments={() => void session.weitereDokumenteLaden()}
    />
  )

  return (
    <>
      <div className="hidden md:flex">{baum()}</div>
      <Dialog open={treeOffen} onOpenChange={setTreeOffen}>
        <DialogContent
          aria-label={t('docs.tree.open')}
          size="voll"
          showCloseButton={false}
          overlayClassName="!justify-start md:hidden"
          className="!mr-auto !w-[min(18rem,85vw)] !max-w-none !rounded-none p-0 pt-[var(--msm-oben-sicher)] pb-[var(--msm-unten-sicher)] pl-[var(--msm-links-sicher)]"
        >
          <div className="flex items-center justify-between border-b border-outline-variant/30 bg-surface-container px-3 py-2">
            <span className="truncate text-sm font-semibold text-on-surface">{t('docs.title')}</span>
            <Kurzinfo text={t('common.close')}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('common.close')}
                onClick={() => setTreeOffen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </Kurzinfo>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">{baum()}</div>
        </DialogContent>
      </Dialog>
    </>
  )
}
