import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Menu, Plus, X } from 'lucide-react'
import { Button, Kurzinfo, Zustandsflaeche, confirm, prompt } from '@/Singra/UI'
import { toast } from '@/stores/toastStore'
import { useAuthStore } from '@/stores/authStore'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'
import { useIsOnline } from '@/hooks/useIsOnline'
import { teamsApi, type Team } from '@/api/teams'
import {
  createDocument,
  createFolder,
  deleteFolder,
  updateFolder,
  applyPendingEdit,
  deleteDocumentPermanent,
  docsErrorCode,
  getDocsStatus,
  getDocument,
  listComments,
  listDocuments,
  listFolders,
  listPendingEdits,
  listRevisions,
  previewPendingEdit,
  rejectPendingEdit,
  restoreDocument,
  trashDocument,
  updateDocument,
  type DocComment,
  type DocDetail,
  type DocFolder,
  type DocPendingView,
  type DocRevision,
  type DocSummary,
  type DocsStatus,
} from '@/api/docs'
import { AI_ZUSTELLUNG_EVENT } from '@/lib/aiZustellung'
import { DocTree } from './DocTree'
import { DocEditor } from './DocEditor'
import { CommentsPanel } from './CommentsPanel'
import { HistoryPanel } from './HistoryPanel'
import { ShareDialog } from './ShareDialog'
import { MembersDialog } from './MembersDialog'
import { MoveDialog } from './MoveDialog'
import { DocsChatPanel } from './DocsChatPanel'
import { useBreiteZiehen } from '@/hooks/useBreiteZiehen'
import {
  cacheDocument,
  forgetDocument,
  hasLocalCopy,
  loadCachedDocuments,
  saveCachedDocuments,
} from './docsOffline'

type Panel = 'comments' | 'history' | 'singra' | null

export function DocsApp() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { uid } = useParams<{ uid: string }>()
  const user = useAuthStore((state) => state.user)
  const docsEnabled = usePublicSettingsStore((state) => state.docs_enabled)
  const online = useIsOnline()

  const [teams, setTeams] = useState<Team[]>([])
  const [teamId, setTeamId] = useState<number | null>(null)
  const [folders, setFolders] = useState<DocFolder[]>([])
  const [documents, setDocuments] = useState<DocSummary[]>([])
  const [folderUid, setFolderUid] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [trash, setTrash] = useState(false)
  const [archived, setArchived] = useState(false)
  const [loading, setLoading] = useState(true)
  const [fehler, setFehler] = useState<string | null>(null)
  const [status, setStatus] = useState<DocsStatus | null>(null)
  const [modulAus, setModulAus] = useState(false)
  const [detail, setDetail] = useState<DocDetail | null>(null)
  const [detailFehler, setDetailFehler] = useState<string | null>(null)
  const [panel, setPanel] = useState<Panel>(null)
  const [comments, setComments] = useState<DocComment[]>([])
  const [revisions, setRevisions] = useState<DocRevision[]>([])
  const [shareOpen, setShareOpen] = useState(false)
  const [membersOpen, setMembersOpen] = useState(false)
  const [selection, setSelection] = useState<{ quote: string } | null>(null)
  const [vorschlag, setVorschlag] = useState<DocPendingView | null>(null)
  const [vorschlagBusy, setVorschlagBusy] = useState(false)
  const [moveDoc, setMoveDoc] = useState<DocSummary | null>(null)
  const [treeOffen, setTreeOffen] = useState(false)
  const [panelBreite, setPanelBreite] = useState(() => {
    try {
      const gespeichert = Number(localStorage.getItem(`docs.chat.breite:${user?.id ?? 'anonym'}`))
      return Number.isFinite(gespeichert) && gespeichert > 0 ? Math.max(320, Math.min(720, gespeichert)) : 380
    } catch {
      return 380
    }
  })
  const searchRef = useRef<number | null>(null)

  const meldung = useCallback(
    (error: unknown, fallback: string) => {
      const code = docsErrorCode(error)
      if (code) return t(`docs.errors.${code}`, { defaultValue: fallback })
      return fallback
    },
    [t],
  )

  const listeLaden = useCallback(async () => {
    setLoading(true)
    setFehler(null)
    try {
      const [ordner, docs] = await Promise.all([
        listFolders(teamId),
        listDocuments({
          teamId,
          search: search.trim() || undefined,
          archived,
          trash,
          limit: 200,
        }),
      ])
      setFolders(ordner)
      setDocuments(docs)
      // Nur die ungefilterte Aktivliste ersetzt den Offline-Katalog. Eine
      // Suchtrefferliste oder der Papierkorb wuerde sonst die lokale Kopie
      // aller anderen Dokumente ueberschreiben.
      if (user && !search.trim() && !trash && !archived) {
        saveCachedDocuments(user.id, docs)
      }
    } catch (error) {
      setFehler(meldung(error, t('docs.errors.DOCUMENT_NOT_FOUND')))
    } finally {
      setLoading(false)
    }
  }, [archived, meldung, search, t, teamId, trash, user])

  useEffect(() => {
    void teamsApi.list().then(setTeams).catch(() => setTeams([]))
    const statusLaden = () => {
      void getDocsStatus()
        .then((daten) => {
          setStatus(daten)
          setModulAus(false)
        })
        .catch((error) => {
          setStatus(null)
          if (docsErrorCode(error) === 'DOCS_DISABLED') setModulAus(true)
        })
    }
    statusLaden()
    // Der Sidecar kann waehrend einer Sitzung neu starten. Ein Banner, das
    // nur beim Oeffnen entsteht, bliebe sonst fuer immer stehen.
    const timer = window.setInterval(statusLaden, 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (searchRef.current) window.clearTimeout(searchRef.current)
    searchRef.current = window.setTimeout(() => {
      void listeLaden()
    }, search ? 300 : 0)
    return () => {
      if (searchRef.current) window.clearTimeout(searchRef.current)
    }
  }, [listeLaden, search])

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
            default_role: 'editor',
            schema_version: 1,
            shared: false,
            share_role: null,
            share_expires_at: null,
          })
          return
        }
        setDetail(null)
        setDetailFehler(meldung(error, t('docs.errors.DOCUMENT_NOT_FOUND')))
      }
    },
    [meldung, online, t, user],
  )

  const vorschlagLaden = useCallback(async (docUid: string) => {
    try {
      const { pending_edits } = await listPendingEdits(docUid)
      const erster =
        pending_edits.find((eintrag) => eintrag.status !== 'stale') ?? pending_edits[0]
      if (!erster) {
        setVorschlag(null)
        return
      }
      try {
        const vorschau = await previewPendingEdit(docUid, erster.uid)
        setVorschlag({ ...erster, ...vorschau })
      } catch (error) {
        // 409 heisst: Der Anker ist nicht mehr eindeutig oder der Vorschlag
        // wurde in einem anderen Tab entschieden. Der Geist verschwindet, der
        // Statuschip bietet noch das Verwerfen an.
        const code = docsErrorCode(error)
        if (
          code === 'DOC_AI_PENDING_NOT_FOUND' ||
          code === 'DOCS_FORBIDDEN' ||
          code === 'DOCUMENT_NOT_FOUND'
        ) {
          setVorschlag(null)
        } else {
          // Auch ein voruebergehend nicht erreichbarer Sidecar soll den
          // Vorschlag nicht aus der Oberflaeche tilgen: Verwerfen bleibt
          // moeglich, Uebernehmen wird beim naechsten Versuch erneut geprueft.
          setVorschlag({ ...erster, stale: true, html: '', target_block: null, target_index: null })
        }
      }
    } catch {
      setVorschlag(null)
    }
  }, [])

  useEffect(() => {
    setSelection(null)
    if (uid) {
      void detailLaden(uid)
      void vorschlagLaden(uid)
    } else {
      setDetail(null)
      setVorschlag(null)
    }
  }, [detailLaden, uid, vorschlagLaden])

  // Nach einem Reconnect die Rolle neu holen. Wurde sie inzwischen gesenkt,
  // wird der Editor dadurch read-only, bevor die naechste Aenderung entsteht.
  useEffect(() => {
    if (online && uid) void detailLaden(uid)
  }, [online, uid, detailLaden])

  const panelDatenLaden = useCallback(async () => {
    if (!uid) return
    try {
      if (panel === 'comments') setComments(await listComments(uid))
      if (panel === 'history') setRevisions(await listRevisions(uid))
    } catch {
      /* Panel bleibt leer; der Editor traegt die Hauptinformation. */
    }
  }, [panel, uid])

  useEffect(() => {
    void panelDatenLaden()
  }, [panelDatenLaden])

  useEffect(() => {
    const handler = (event: Event) => {
      const daten = (event as CustomEvent<{ entity?: string; id?: string } | undefined>).detail
      if (!daten || daten.entity === 'docs') {
        void listeLaden()
        if (uid) {
          void detailLaden(uid)
          void vorschlagLaden(uid)
        }
        void panelDatenLaden()
      }
    }
    const kiFertig = () => {
      if (uid) void vorschlagLaden(uid)
    }
    window.addEventListener('msm:docs-updated', handler)
    window.addEventListener(AI_ZUSTELLUNG_EVENT, kiFertig)
    return () => {
      window.removeEventListener('msm:docs-updated', handler)
      window.removeEventListener(AI_ZUSTELLUNG_EVENT, kiFertig)
    }
  }, [detailLaden, listeLaden, panelDatenLaden, uid, vorschlagLaden])

  const vorschlagAnwenden = useCallback(async () => {
    if (!uid || !vorschlag || vorschlagBusy) return
    setVorschlagBusy(true)
    try {
      await applyPendingEdit(uid, vorschlag.uid)
      toast.success(t('docs.pending.applied'))
      await detailLaden(uid)
      await vorschlagLaden(uid)
      await panelDatenLaden()
    } catch (error) {
      toast.error(meldung(error, t('docs.pending.applyFailed')))
      await vorschlagLaden(uid)
    } finally {
      setVorschlagBusy(false)
    }
  }, [detailLaden, meldung, panelDatenLaden, t, uid, vorschlag, vorschlagBusy, vorschlagLaden])

  const vorschlagVerwerfen = useCallback(async () => {
    if (!uid || !vorschlag || vorschlagBusy) return
    setVorschlagBusy(true)
    try {
      await rejectPendingEdit(uid, vorschlag.uid)
      toast.success(t('docs.pending.rejected'))
      await vorschlagLaden(uid)
    } catch (error) {
      toast.error(meldung(error, t('docs.pending.rejectFailed')))
    } finally {
      setVorschlagBusy(false)
    }
  }, [meldung, t, uid, vorschlag, vorschlagBusy, vorschlagLaden])

  const panelZiehen = useBreiteZiehen({
    breite: panelBreite,
    min: 320,
    max: 720,
    setzen: (breite) => {
      setPanelBreite(breite)
      try {
        localStorage.setItem(`docs.chat.breite:${user?.id ?? 'anonym'}`, String(breite))
      } catch {
        /* Lokaler Speicher gesperrt — die Breite gilt nur für diese Sitzung. */
      }
    },
  })

  const verschiebePerDrop = async (doc: DocSummary, folderUid: string | null) => {
    if (!doc.can_manage) return
    try {
      await updateDocument(doc.uid, { folder_uid: folderUid })
      await listeLaden()
      toast.success(t('docs.move.moved'))
    } catch (error) {
      toast.error(meldung(error, t('docs.errors.DOCS_FORBIDDEN')))
    }
  }

  const neueDokument = async () => {
    try {
      const neu = await createDocument({ teamId, folderUid })
      setDocuments((alt) => [neu, ...alt])
      navigate(`/dokumente/${neu.uid}`)
    } catch (error) {
      toast.error(meldung(error, t('docs.errors.DOC_QUOTA_EXCEEDED')))
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
      const ordner = await createFolder({ teamId, parentUid: folderUid, name: name.trim() })
      setFolders((alt) => [...alt, ordner])
    } catch (error) {
      toast.error(meldung(error, t('docs.errors.DOC_NAME_CONFLICT')))
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
      void listeLaden()
    } catch (error) {
      toast.error(meldung(error, t('docs.errors.DOC_NAME_CONFLICT')))
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
      if (folderUid === ordner.uid) setFolderUid(null)
      void listeLaden()
    } catch (error) {
      toast.error(meldung(error, t('docs.errors.DOCS_FORBIDDEN')))
    }
  }

  const dokumentInPapierkorb = async (docUid: string) => {    const sicher = await confirm({
      title: t('docs.tree.trashAction'),
      message: t('docs.tree.trashConfirm'),
      confirmText: t('docs.tree.trashAction'),
      danger: true,
    })
    if (!sicher) return
    try {
      await trashDocument(docUid)
      if (user) forgetDocument(user.id, docUid)
      setDocuments((alt) => alt.filter((eintrag) => eintrag.uid !== docUid))
      if (uid === docUid) navigate('/dokumente')
    } catch (error) {
      toast.error(meldung(error, t('docs.errors.DOCS_FORBIDDEN')))
    }
  }

  const archivUmschalten = async (doc: DocSummary) => {
    try {
      await updateDocument(doc.uid, { archived: !doc.archived })
      toast.success(doc.archived ? t('docs.tree.restored') : t('docs.tree.archived'))
      void listeLaden()
      if (uid === doc.uid) void detailLaden(doc.uid)
    } catch (error) {
      toast.error(meldung(error, t('docs.errors.DOCS_FORBIDDEN')))
    }
  }

  const dokumentWiederherstellen = async (docUid: string) => {    try {
      const wieder = await restoreDocument(docUid)
      setDocuments((alt) => alt.filter((eintrag) => eintrag.uid !== docUid))
      toast.success(t('docs.tree.restored'))
      if (uid === docUid) setDetail(wieder)
      void listeLaden()
    } catch (error) {
      toast.error(meldung(error, t('docs.errors.DOCUMENT_NOT_FOUND')))
    }
  }

  const titelAendern = async (titel: string) => {
    if (!detail) return
    try {
      const neu = await updateDocument(detail.uid, { title: titel })
      setDetail(neu)
      setDocuments((alt) => alt.map((eintrag) => (eintrag.uid === neu.uid ? { ...eintrag, title: neu.title } : eintrag)))
      if (user) cacheDocument(user.id, neu)
    } catch (error) {
      toast.error(meldung(error, t('docs.errors.DOCS_READ_ONLY')))
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
      void listeLaden()
    } catch (error) {
      toast.error(meldung(error, t('docs.errors.DOCS_FORBIDDEN')))
    }
  }

  const moduleAus = status && !status.enabled
  const sidecarAus = status && status.enabled && !status.sidecar_ok
  const offlineOhneKopie = !online && uid && user && !hasLocalCopy(user.id, uid)
  const aktuellesTeam = teams.find((team) => team.id === teamId)
  const canManageFolders =
    Boolean(user?.is_owner) || teamId === null || Boolean(aktuellesTeam?.is_owner)

  const panelTitel = useMemo(() => {
    if (panel === 'comments') return t('docs.comments.title')
    if (panel === 'history') return t('docs.history.title')
    if (panel === 'singra') return t('docs.singra.title')
    return ''
  }, [panel, t])

  if (!user) return null

  if (!docsEnabled || modulAus || moduleAus) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Zustandsflaeche art="leer" titel={t('docs.moduleOff.title')} text={t('docs.moduleOff.text')} />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-outline-variant/40 bg-surface-container px-3 py-2 md:hidden">
        <Button variant="ghost" size="sm" onClick={() => setTreeOffen(true)} aria-label={t('docs.tree.open')}>
          <Menu className="h-4 w-4" />
        </Button>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-on-surface">
          {detail?.title ?? t('docs.title')}
        </span>
        <Button variant="primary" size="sm" onClick={() => void neueDokument()}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {sidecarAus && (
        <div role="alert" className="flex items-center gap-2 border-b border-status-warning/40 bg-status-warning/10 px-4 py-2 text-xs text-status-warning">
          <AlertTriangle className="h-4 w-4" />
          {t('docs.status.sidecarDown')}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className={`${treeOffen ? 'fixed inset-0 z-40 flex bg-background/70 md:static md:z-auto md:bg-transparent' : 'hidden md:flex'}`}>
          <div className="relative flex h-full w-72 max-w-[85vw] flex-col">
            {treeOffen && (
              <button
                type="button"
                aria-label={t('common.close')}
                className="absolute right-2 top-2 z-10 rounded-full bg-surface-container-high p-1 text-on-surface md:hidden"
                onClick={() => setTreeOffen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            )}
            <DocTree
              teams={teams}
              teamId={teamId}
              onTeamChange={(wert) => {
                setTeamId(wert)
                setFolderUid(null)
                setTreeOffen(false)
                if (uid) navigate('/dokumente')
              }}
              folders={folders}
              documents={documents}
              folderUid={folderUid}
              onFolderChange={(wert) => {
                setFolderUid(wert)
                setTreeOffen(false)
              }}
              selectedUid={uid ?? null}
              onMoveDocumentToFolder={(doc, folderUid) => void verschiebePerDrop(doc, folderUid)}
              onSelect={(docUid) => {
                navigate(`/dokumente/${docUid}`)
                setTreeOffen(false)
              }}
              search={search}
              onSearch={setSearch}
              trash={trash}
              archived={archived}
              onTrashChange={setTrash}
              onArchiveChange={setArchived}
              onCreateDocument={() => void neueDokument()}
              onCreateFolder={() => void neuerOrdner()}
              onTrashDocument={(docUid) => void dokumentInPapierkorb(docUid)}
              onRestoreDocument={(docUid) => void dokumentWiederherstellen(docUid)}
              onMoveDocument={setMoveDoc}
              onArchiveDocument={(doc) => void archivUmschalten(doc)}
              canManageFolders={canManageFolders}
              onRenameFolder={(ordner) => void ordnerUmbenennen(ordner)}
              onDeleteFolder={(ordner) => void ordnerLoeschen(ordner)}
              loading={loading}
            />
          </div>
        </div>

        <main className="flex min-w-0 flex-1 flex-col">
          {fehler && (
            <div className="p-4">
              <Zustandsflaeche art="fehler" titel={t('docs.list.errorTitle')} text={fehler} erneutLabel={t('common.retry')} onErneut={() => void listeLaden()} />
            </div>
          )}
          {!fehler && !uid && (
            <div className="flex flex-1 items-center justify-center p-6">
              <Zustandsflaeche
                art="leer"
                titel={t('docs.list.emptyTitle')}
                text={t('docs.list.emptyText')}
              >
                <Button onClick={() => void neueDokument()}>
                  <Plus className="mr-1 h-4 w-4" />
                  {t('docs.new')}
                </Button>
              </Zustandsflaeche>
            </div>
          )}
          {uid && detailFehler && (
            <div className="flex flex-1 items-center justify-center p-6">
              <Zustandsflaeche
                art={offlineOhneKopie ? 'offline' : 'fehler'}
                titel={offlineOhneKopie ? t('docs.offline.noCopyTitle') : t('docs.errors.DOCUMENT_NOT_FOUND')}
                text={offlineOhneKopie ? t('docs.offline.noCopyText') : detailFehler}
                erneutLabel={t('common.retry')}
                onErneut={() => void detailLaden(uid)}
              />
            </div>
          )}
          {uid && detail && (
            <DocEditor
              key={detail.uid}
              detail={detail}
              userId={user.id}
              userName={user.username}
              online={online}
              activePanel={panel}
              onOpenPanel={setPanel}
              onOpenShare={() => setShareOpen(true)}
              onOpenMembers={() => setMembersOpen(true)}
              onCommentsChanged={() => void panelDatenLaden()}
              onTitleChanged={titelAendern}
              onSelectionChange={setSelection}
              vorschlag={vorschlag}
              vorschlagBusy={vorschlagBusy}
              onApplyVorschlag={() => void vorschlagAnwenden()}
              onRejectVorschlag={() => void vorschlagVerwerfen()}
            />
          )}
        </main>

        {uid && detail && panel && (
          <div className="fixed inset-0 z-40 flex justify-end bg-background/70 lg:static lg:z-auto lg:bg-transparent">
            <aside
              className="relative flex h-full max-w-[92vw] shrink-0 flex-col overflow-hidden border-l border-outline-variant/40 bg-surface-container"
              style={{ width: `min(${panelBreite}px, 92vw)` }}
            >
              <div
                role="separator"
                tabIndex={0}
                aria-orientation="vertical"
                aria-valuenow={panelBreite}
                aria-valuemin={320}
                aria-valuemax={720}
                aria-label={t('docs.chat.resize')}
                className="group/griff absolute inset-y-0 left-0 z-10 flex w-2 cursor-col-resize touch-none items-center justify-center outline-none hover:bg-primary/10 focus-visible:bg-primary/10 active:bg-primary/15"
                {...panelZiehen}
              >
                <span aria-hidden="true" className="h-10 w-1 rounded-full bg-outline transition-colors group-hover/griff:bg-primary group-focus-visible/griff:bg-primary group-active/griff:bg-primary" />
              </div>
              <div className="flex items-center justify-between border-b border-outline-variant/40 px-3 py-2">
                <span className="text-sm font-semibold text-on-surface">{panelTitel}</span>
                <Kurzinfo text={t('common.close')}>
                  <Button variant="ghost" size="sm" aria-label={t('common.close')} onClick={() => setPanel(null)}>
                    <X className="h-4 w-4" />
                  </Button>
                </Kurzinfo>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                {panel === 'comments' && (
                  <CommentsPanel
                    uid={detail.uid}
                    comments={comments}
                    canComment={detail.can_comment}
                    canManage={detail.can_manage}
                    userId={user.id}
                    onChanged={() => void panelDatenLaden()}
                  />
                )}
                {panel === 'history' && (
                  <HistoryPanel
                    uid={detail.uid}
                    revisions={revisions}
                    canEdit={detail.can_edit}
                    onChanged={() => {
                      void panelDatenLaden()
                      void detailLaden(detail.uid)
                    }}
                  />
                )}
                {panel === 'singra' && (
                  <DocsChatPanel
                    uid={detail.uid}
                    selection={selection}
                    onChanged={() => {
                      void detailLaden(detail.uid)
                      void vorschlagLaden(detail.uid)
                    }}
                  />
                )}
              </div>
            </aside>
          </div>
        )}
      </div>

      {detail && (
        <>
          <ShareDialog
            detail={detail}
            open={shareOpen}
            onOpenChange={setShareOpen}
            onChanged={() => void detailLaden(detail.uid)}
          />
          <MembersDialog
            detail={detail}
            open={membersOpen}
            onOpenChange={setMembersOpen}
            onChanged={() => void detailLaden(detail.uid)}
          />
          <MoveDialog
            document={moveDoc}
            folders={folders}
            teams={teams}
            open={moveDoc !== null}
            onOpenChange={(offen) => {
              if (!offen) setMoveDoc(null)
            }}
            onMoved={() => {
              void listeLaden()
              const gleichesTeam = moveDoc?.team_id === teamId
              if (uid) {
                if (gleichesTeam) void detailLaden(uid)
                else {
                  setDetail(null)
                  navigate('/dokumente')
                }
              }
            }}
          />
        </>
      )}

      {trash && detail?.deleted && (
        <div className="border-t border-outline-variant/40 p-2">
          <Button variant="destructive" size="sm" onClick={() => void endgueltigLoeschen()}>
            {t('docs.tree.deletePermanent')}
          </Button>
        </div>
      )}
    </div>
  )
}
