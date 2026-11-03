import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import { Button, Zustandsflaeche, confirm, prompt } from '@/Singra/UI'
import { toast } from '@/stores/toastStore'
import { useAuthStore } from '@/stores/authStore'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'
import { useIsOnline } from '@/hooks/useIsOnline'
import {
  createDocument,
  createFolder,
  deleteDocumentPermanent,
  deleteFolder,
  duplicateDocument,
  getDocument,
  grenzenAusStatus,
  listComments,
  listRevisions,
  restoreDocument,
  trashDocument,
  updateDocument,
  updateFolder,
  type DocComment,
  type DocDetail,
  type DocFolder,
  type DocRevision,
  type DocSummary,
} from '@/api/docs'
import { docsFehlerInfo, docsFehlermeldung, type DocsFehlerInfo, type DocsFehlerKontext } from './docsFehler'
import { useDocsStore } from './docsStore'
import { useDocsSession } from './useDocsSession'
import { usePendingEdits } from './usePendingEdits'
import { useDokumentVerschieben } from './useDokumentVerschieben'
import { DocsDialogs } from './DocsDialogs'
import { DocsBetaBanner } from './DocsBetaBanner'
import { DocsMain } from './DocsMain'
import { DocsPanels } from './DocsPanels'
import { DocsSidebar, type DocsSidebarAktionen } from './DocsSidebar'
import type { OutlineEntry } from './editor/Outline'
import {
  cacheDocument,
  forgetDocument,
  loadCachedDocuments,
} from './docsOffline'

/**
 * Nur Komposition und Routing (Befund 21): Die Sitzung (Liste, Ordner,
 * Status) liefert `useDocsSession`, UI-Zustand der Store, Vorschläge
 * `usePendingEdits`. Diese Komponente hält das offene Dokument, die
 * listenübergreifenden Handlungen und die globalen Aktualisierungen.
 */
export function DocsApp() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { uid } = useParams<{ uid: string }>()
  const user = useAuthStore((state) => state.user)
  const docsEnabled = usePublicSettingsStore((state) => state.docs_enabled)
  const online = useIsOnline()

  const session = useDocsSession({ userId: user?.id, docsEnabled })
  const panel = useDocsStore((state) => state.panel)
  const selection = useDocsStore((state) => state.selection)
  const setPanel = useDocsStore((state) => state.setPanel)
  const setSelection = useDocsStore((state) => state.setSelection)

  const [detail, setDetail] = useState<DocDetail | null>(null)
  const [detailFehler, setDetailFehler] = useState<DocsFehlerInfo | null>(null)
  const [comments, setComments] = useState<DocComment[]>([])
  const [revisions, setRevisions] = useState<DocRevision[]>([])
  const [outlineEntries, setOutlineEntries] = useState<OutlineEntry[]>([])
  const outlineJumpRef = useRef<((pos: number) => void) | null>(null)

  const meldung = useCallback(
    (error: unknown, kontext: DocsFehlerKontext) => docsFehlermeldung(t, error, kontext),
    [t],
  )

  const detailLaden = useCallback(
    async (docUid: string) => {
      setDetailFehler(null)
      setDetail((alt) => (alt?.uid === docUid ? alt : null))
      try {
        const daten = await getDocument(docUid)
        setDetail(daten)
        if (user) cacheDocument(user.id, daten)
      } catch (error) {
        const gecacht = user ? loadCachedDocuments(user.id).find((eintrag) => eintrag.uid === docUid) : undefined
        if (!online && gecacht) {
          setDetail({
            ...gecacht,
            default_role: gecacht.role,
            schema_version: 1,
            shared: false,
            share_role: null,
            share_expires_at: null,
          })
          return
        }
        setDetail(null)
        setDetailFehler(docsFehlerInfo(t, error, 'list'))
      }
    },
    [online, t, user],
  )

  const panelDatenLaden = useCallback(async () => {
    if (!uid) return
    try {
      if (panel === 'comments') setComments(await listComments(uid))
      if (panel === 'history') setRevisions(await listRevisions(uid))
    } catch {
      /* Panel bleibt leer; der Editor traegt die Hauptinformation. */
    }
  }, [panel, uid])

  const pending = usePendingEdits({ uid, detailLaden, panelDatenLaden })

  useEffect(() => {
    setSelection(null)
    setOutlineEntries([])
    if (uid) {
      void detailLaden(uid)
      void pending.vorschlagLaden(uid)
    } else {
      setDetail(null)
      useDocsStore.getState().setVorschlag(null)
    }
  }, [detailLaden, pending.vorschlagLaden, setSelection, uid])

  // Nach einem Reconnect die Rolle neu holen. Wurde sie inzwischen gesenkt,
  // wird der Editor dadurch read-only, bevor die naechste Aenderung entsteht.
  useEffect(() => {
    if (online && uid) void detailLaden(uid)
  }, [online, uid, detailLaden])

  useEffect(() => {
    void panelDatenLaden()
  }, [panelDatenLaden])

  useEffect(() => {
    const handler = (event: Event) => {
      const daten = (event as CustomEvent<{ entity?: string; id?: string } | undefined>).detail
      if (!daten || daten.entity === 'docs') {
        void session.listeLaden()
        if (uid) {
          void detailLaden(uid)
          void pending.vorschlagLaden(uid)
        }
        void panelDatenLaden()
      }
    }
    window.addEventListener('msm:docs-updated', handler)
    return () => {
      window.removeEventListener('msm:docs-updated', handler)
    }
  }, [detailLaden, panelDatenLaden, pending.vorschlagLaden, session.listeLaden, uid])

  const dokumentVerschoben = useCallback(() => {
    void session.listeLaden()
  }, [session.listeLaden])
  const { verschieben } = useDokumentVerschieben(dokumentVerschoben)

  const verschiebePerDrop = async (doc: DocSummary, folderUid: string | null) => {
    if (!doc.can_manage) return
    try {
      await verschieben(doc.uid, { teamId: doc.team_id, folderUid })
      toast.success(t('docs.move.moved'))
    } catch (error) {
      toast.error(meldung(error, 'update'))
    }
  }

  const neueDokument = async () => {
    try {
      const neu = await createDocument({ teamId: session.teamId, folderUid: session.folderUid })
      session.setDocuments((alt) => [neu, ...alt])
      navigate(`/dokumente/${neu.uid}`)
    } catch (error) {
      toast.error(meldung(error, 'create'))
    }
  }

  const neuerOrdner = async () => {
    const name = await prompt({
      title: t('docs.tree.newFolder'),
      message: t('docs.tree.folderName'),
      placeholder: t('docs.tree.folderNamePlaceholder'),
    })
    if (!name?.trim()) return
    try {
      const ordner = await createFolder({ teamId: session.teamId, parentUid: session.folderUid, name: name.trim() })
      session.setFolders((alt) => [...alt, ordner])
    } catch (error) {
      toast.error(meldung(error, 'create'))
    }
  }

  const ordnerUmbenennen = async (ordner: DocFolder) => {
    const name = await prompt({
      title: t('docs.tree.renameFolder'),
      message: t('docs.tree.folderName'),
      defaultValue: ordner.name,
    })
    if (!name?.trim() || name.trim() === ordner.name) return
    try {
      await updateFolder(ordner.uid, { name: name.trim() })
      void session.listeLaden()
    } catch (error) {
      toast.error(meldung(error, 'update'))
    }
  }

  const ordnerLoeschen = async (ordner: DocFolder) => {
    const sicher = await confirm({
      title: t('docs.tree.deleteFolder'),
      message: t('docs.tree.deleteFolderConfirm', { name: ordner.name }),
      confirmText: t('docs.tree.deleteFolder'),
      danger: true,
    })
    if (!sicher) return
    try {
      await deleteFolder(ordner.uid)
      if (session.folderUid === ordner.uid) session.setFolderUid(null)
      void session.listeLaden()
    } catch (error) {
      toast.error(meldung(error, 'update'))
    }
  }

  const dokumentInPapierkorb = async (docUid: string) => {
    const sicher = await confirm({
      title: t('docs.tree.trashAction'),
      message: t('docs.tree.trashConfirm'),
      confirmText: t('docs.tree.trashAction'),
      danger: true,
    })
    if (!sicher) return
    try {
      await trashDocument(docUid)
      if (user) forgetDocument(user.id, docUid)
      session.setDocuments((alt) => (alt ?? []).filter((eintrag) => eintrag.uid !== docUid))
      if (uid === docUid) navigate('/dokumente')
    } catch (error) {
      toast.error(meldung(error, 'update'))
    }
  }

  const archivUmschalten = async (doc: DocSummary) => {
    try {
      await updateDocument(doc.uid, { archived: !doc.archived })
      toast.success(doc.archived ? t('docs.tree.restored') : t('docs.tree.archived'))
      void session.listeLaden()
      if (uid === doc.uid) void detailLaden(doc.uid)
    } catch (error) {
      toast.error(meldung(error, 'update'))
    }
  }

  const dokumentDuplizieren = async (doc: DocSummary) => {
    try {
      const kopie = await duplicateDocument(doc.uid)
      await session.listeLaden()
      toast.success(t('docs.tree.duplicated'))
      navigate(`/dokumente/${kopie.uid}`)
    } catch (error) {
      toast.error(meldung(error, 'create'))
    }
  }

  const dokumentWiederherstellen = async (docUid: string) => {
    try {
      const wieder = await restoreDocument(docUid)
      session.setDocuments((alt) => (alt ?? []).filter((eintrag) => eintrag.uid !== docUid))
      toast.success(t('docs.tree.restored'))
      if (uid === docUid) setDetail(wieder)
      void session.listeLaden()
    } catch (error) {
      toast.error(meldung(error, 'update'))
    }
  }

  const titelAendern = async (titel: string) => {
    if (!detail) return
    try {
      const neu = await updateDocument(detail.uid, { title: titel })
      setDetail(neu)
      session.setDocuments((alt) => alt.map((eintrag) => (eintrag.uid === neu.uid ? { ...eintrag, title: neu.title } : eintrag)))
      if (user) cacheDocument(user.id, neu)
    } catch (error) {
      toast.error(meldung(error, 'update'))
    }
  }

  const endgueltigLoeschen = async () => {
    if (!detail) return
    const sicher = await confirm({
      title: t('docs.tree.deletePermanent'),
      message: t('docs.tree.deletePermanentConfirm'),
      confirmText: t('docs.tree.deletePermanent'),
      danger: true,
    })
    if (!sicher) return
    try {
      await deleteDocumentPermanent(detail.uid)
      if (user) forgetDocument(user.id, detail.uid)
      navigate('/dokumente')
      setDetail(null)
      void session.listeLaden()
    } catch (error) {
      toast.error(meldung(error, 'update'))
    }
  }

  const aktionen: DocsSidebarAktionen = {
    neueDokument: () => void neueDokument(),
    neuerOrdner: () => void neuerOrdner(),
    dokumentInPapierkorb: (docUid) => void dokumentInPapierkorb(docUid),
    dokumentWiederherstellen: (docUid) => void dokumentWiederherstellen(docUid),
    archivUmschalten: (doc) => void archivUmschalten(doc),
    dokumentDuplizieren: (doc) => void dokumentDuplizieren(doc),
    ordnerUmbenennen: (ordner) => void ordnerUmbenennen(ordner),
    ordnerLoeschen: (ordner) => void ordnerLoeschen(ordner),
    verschiebePerDrop: (doc, folderUid) => void verschiebePerDrop(doc, folderUid),
  }

  const lokaleDokumente = useMemo(
    () => new Set(user ? loadCachedDocuments(user.id).map((eintrag) => eintrag.uid) : []),
    [user?.id, session.documents, detail?.uid],
  )
  const offlineOhneKopie = !online && uid && user && !lokaleDokumente.has(uid)
  const aktuellesTeam = session.teams.find((team) => team.id === session.teamId)
  const canManageFolders =
    Boolean(user?.is_owner) || session.teamId === null || Boolean(aktuellesTeam?.is_owner)

  if (!user) return null

  if (!docsEnabled || session.modulAus) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Zustandsflaeche art="leer" titel={t('docs.moduleOff.title')} text={t('docs.moduleOff.text')} />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <DocsBetaBanner />
      {session.sidecarAus && (
        <div role="alert" className="flex items-center gap-2 border-b border-status-warning/40 bg-status-warning/10 px-4 py-2 text-xs text-status-warning">
          <AlertTriangle className="h-4 w-4" />
          {t('docs.status.sidecarDown')}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <DocsSidebar
          session={session}
          aktionen={aktionen}
          selectedUid={uid ?? null}
          canManageFolders={canManageFolders}
        />

        <DocsMain
          uid={uid}
          detail={detail}
          detailFehler={detailFehler}
          fehler={session.fehler}
          online={online}
          userId={user.id}
          userName={user.username}
          offlineOhneKopie={Boolean(offlineOhneKopie)}
          grenzen={session.status ? grenzenAusStatus(session.status) : undefined}
          outlineJumpRef={outlineJumpRef}
          pending={pending}
          listeLaden={() => void session.listeLaden()}
          detailLaden={(docUid) => void detailLaden(docUid)}
          panelDatenLaden={() => void panelDatenLaden()}
          titelAendern={titelAendern}
          neueDokument={() => void neueDokument()}
          onOutlineChange={setOutlineEntries}
        />

        {uid && detail && panel && (
          <DocsPanels
            detail={detail}
            panel={panel}
            comments={comments}
            revisions={revisions}
            outlineEntries={outlineEntries}
            outlineJumpRef={outlineJumpRef}
            selection={selection}
            userId={user.id}
            onClose={() => setPanel(null)}
            onCommentsChanged={() => void panelDatenLaden()}
            onHistoryChanged={() => {
              void panelDatenLaden()
              void detailLaden(detail.uid)
            }}
            onAssistantChanged={() => {
              void detailLaden(detail.uid)
              void pending.vorschlagLaden(detail.uid)
            }}
          />
        )}
      </div>

      {detail && (
        <DocsDialogs
          detail={detail}
          folders={session.folders}
          teams={session.teams}
          teamId={session.teamId}
          uid={uid}
          listeLaden={() => void session.listeLaden()}
          detailLaden={(docUid) => void detailLaden(docUid)}
          onDetailEntfernt={() => {
            setDetail(null)
            navigate('/dokumente')
          }}
        />
      )}

      {session.trash && detail?.deleted && (
        <div className="border-t border-outline-variant/40 p-2">
          <Button variant="destructive" size="sm" onClick={() => void endgueltigLoeschen()}>
            {t('docs.tree.deletePermanent')}
          </Button>
        </div>
      )}
    </div>
  )
}
