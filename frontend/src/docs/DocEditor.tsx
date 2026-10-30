import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { createMappablePosition } from '@tiptap/extension-collaboration'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { IndexeddbPersistence } from 'y-indexeddb'
import * as Y from 'yjs'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  History,
  MessageSquare,
  MessageSquarePlus,
  RotateCcw,
  Share2,
  Sparkles,
  Users,
  WifiOff,
} from 'lucide-react'
import { Badge, Button, Kurzinfo, confirm, prompt } from '@/Singra/UI'
import { toast } from '@/stores/toastStore'
import {
  assetUrl,
  createComment,
  getCollabToken,
  undoAiEdit,
  uploadAsset,
  type DocDetail,
  type DocPendingView,
} from '@/api/docs'
import { docsCollabUrl } from '@/config/api'
import { createDocsExtensions, farbeFuerBenutzer } from './editor/extensions'
import {
  createPendingEdits,
  PENDING_REFRESH_META,
  type PendingHandles,
} from './editor/PendingEdits'
import { Toolbar } from './editor/Toolbar'
import { MobileToolbar } from './editor/MobileToolbar'
import { SlashMenu } from './editor/SlashMenu'
import { useOutlineEntries, type OutlineEntry } from './editor/Outline'
import { ExportMenu } from './ExportMenu'
import { docDatabaseName } from './docsOffline'

type Panel = 'comments' | 'history' | 'outline' | 'singra' | null

interface DocEditorProps {
  detail: DocDetail
  userId: number
  userName: string
  online: boolean
  activePanel: Panel
  onOpenPanel: (panel: Panel) => void
  onOpenShare: () => void
  onOpenMembers: () => void
  onCommentsChanged: () => void
  onTitleChanged: (title: string) => Promise<void>
  onSelectionChange?: (selection: { quote: string } | null) => void
  onOutlineChange?: (entries: OutlineEntry[]) => void
  outlineJumpRef?: MutableRefObject<((pos: number) => void) | null>
  vorschlag?: DocPendingView | null
  vorschlagBusy?: boolean
  onApplyVorschlag?: () => void
  onRejectVorschlag?: () => void
}

type Verbindung = 'verbinden' | 'verbunden' | 'getrennt' | 'fehler'

export function DocEditor({
  detail,
  userId,
  userName,
  online,
  activePanel,
  onOpenPanel,
  onOpenShare,
  onOpenMembers,
  onCommentsChanged,
  onTitleChanged,
  onSelectionChange,
  onOutlineChange,
  outlineJumpRef,
  vorschlag = null,
  vorschlagBusy = false,
  onApplyVorschlag,
  onRejectVorschlag,
}: DocEditorProps) {
  const { t } = useTranslation()
  const darfSchreiben = detail.can_edit && !detail.deleted
  const [titel, setTitel] = useState(detail.title)
  const [synced, setSynced] = useState(false)
  const editable = darfSchreiben && (!online || synced)
  const [verbindung, setVerbindung] = useState<Verbindung>('verbinden')
  const [peers, setPeers] = useState(0)
  const [slashQuery, setSlashQuery] = useState<string | null>(null)
  const [lokalGeaendert, setLokalGeaendert] = useState(false)
  const bildRef = useRef<HTMLInputElement>(null)

  const ydoc = useMemo(() => new Y.Doc(), [detail.uid])
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null)

  useEffect(() => {
    setTitel(detail.title)
  }, [detail.uid, detail.title])

  useEffect(() => {
    let abgebrochen = false
    const lokale = new IndexeddbPersistence(docDatabaseName(userId, detail.uid), ydoc)
    const p = new HocuspocusProvider({
      url: docsCollabUrl(),
      name: detail.uid,
      document: ydoc,
      token: async () => (await getCollabToken(detail.uid)).token,
      onStatus: ({ status }) => {
        if (abgebrochen) return
        setVerbindung(
          status === 'connected'
            ? 'verbunden'
            : status === 'disconnected'
              ? 'getrennt'
              : status === 'connecting'
                ? 'verbinden'
                : 'fehler',
        )
        if (status === 'connected') setSynced(true)
      },
      onSynced: () => {
        if (!abgebrochen) setSynced(true)
      },
      onAuthenticationFailed: () => {
        if (!abgebrochen) setVerbindung('fehler')
      },
    })
    setProvider(p)

    const awarenessAktualisieren = () => {
      const anzahl = p.awareness ? p.awareness.getStates().size : 0
      setPeers(anzahl)
    }
    p.awareness?.on('change', awarenessAktualisieren)

    return () => {
      abgebrochen = true
      p.awareness?.off('change', awarenessAktualisieren)
      p.destroy()
      void lokale.destroy()
      ydoc.destroy()
      setProvider(null)
      setSynced(false)
    }
  }, [detail.uid, userId, ydoc])

  const user = useMemo(
    () => ({ id: userId, name: userName, color: farbeFuerBenutzer(userId) }),
    [userId, userName],
  )

  // Die Extension wird einmal gebaut. Aktuelle Werte liest sie ueber diesen
  // Ref, sonst muesste der Editor bei jedem Tastendruck neu entstehen.
  const pendingHandles = useRef<PendingHandles>({
    get: () => null,
    busy: () => false,
    onApply: () => {},
    onReject: () => {},
    labels: {
      title: '',
      apply: '',
      reject: '',
      applying: '',
      batchTitle: '',
      editStale: '',
    },
  })
  pendingHandles.current = {
    get: () => vorschlag,
    busy: () => vorschlagBusy,
    onApply: () => onApplyVorschlag?.(),
    onReject: () => onRejectVorschlag?.(),
    labels: {
      title: t('docs.pending.title'),
      apply: t('docs.pending.apply'),
      reject: t('docs.pending.reject'),
      applying: t('docs.pending.applying'),
      batchTitle: t('docs.pending.batchTitle'),
      editStale: t('docs.pending.editStale'),
    },
  }

  const extensions = useMemo(
    () => [
      ...createDocsExtensions({ ydoc, provider, user, docUid: detail.uid }),
      createPendingEdits(pendingHandles),
    ],
    [provider, ydoc, user, detail.uid],
  )

  const editor = useEditor(
    {
      extensions,
      editable,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class: 'docs-prose focus:outline-none min-h-[60vh] px-6 py-5 md:px-10 md:py-8',
          'aria-label': t('docs.editor.contentLabel'),
        },
      },
    },
    [provider],
  )

  const outlineEntries = useOutlineEntries(editor)

  useEffect(() => {
    onOutlineChange?.(outlineEntries)
  }, [onOutlineChange, outlineEntries])

  useEffect(() => {
    if (!outlineJumpRef) return
    outlineJumpRef.current = editor
      ? (pos) => {
          editor.chain().focus().setTextSelection(pos + 1).scrollIntoView().run()
        }
      : null
    return () => {
      outlineJumpRef.current = null
    }
  }, [editor, outlineJumpRef])

  useEffect(() => {
    editor?.setEditable(editable)
  }, [editor, editable])

  // Dekorationen haengen an der Ansicht, nicht am Dokument. Ohne diesen
  // Anstoss bliebe der Geisterblock stehen, wenn der Vorschlag in einem
  // anderen Tab bestaetigt oder verworfen wurde.
  useEffect(() => {
    if (!editor?.view) return
    editor.view.dispatch(
      editor.state.tr.setMeta(PENDING_REFRESH_META, Date.now()),
    )
  }, [editor, vorschlag, vorschlagBusy, t])

  useEffect(() => {
    if (!editor || !onSelectionChange) return
    const melden = () => {
      const { from, to } = editor.state.selection
      if (from === to) {
        onSelectionChange(null)
        return
      }
      const quote = editor.state.doc.textBetween(from, to, ' ').slice(0, 4_000)
      onSelectionChange(quote ? { quote } : null)
    }
    editor.on('selectionUpdate', melden)
    return () => {
      editor.off('selectionUpdate', melden)
    }
  }, [editor, onSelectionChange])

  useEffect(() => {
    if (!editor) return
    const aktualisieren = () => {
      if (!darfSchreiben) {
        setSlashQuery(null)
        return
      }
      if (!online) setLokalGeaendert(true)
      const { $from } = editor.state.selection
      if (!$from.parent.isTextblock) {
        setSlashQuery(null)
        return
      }
      const text = $from.parent.textContent
      const offset = $from.parentOffset
      const vor = text.slice(0, offset)
      if (vor.startsWith('/') && !vor.includes(' ')) {
        setSlashQuery(vor.slice(1))
      } else {
        setSlashQuery(null)
      }
    }
    editor.on('update', aktualisieren)
    editor.on('selectionUpdate', aktualisieren)
    return () => {
      editor.off('update', aktualisieren)
      editor.off('selectionUpdate', aktualisieren)
    }
  }, [editor, darfSchreiben, online])

  useEffect(() => {
    if (online && synced && darfSchreiben) setLokalGeaendert(false)
  }, [online, synced, darfSchreiben])

  const bildWaehlen = useCallback(() => {
    bildRef.current?.click()
  }, [])

  const bildHochladen = async (datei: File) => {
    try {
      const asset = await uploadAsset(detail.uid, datei)
      editor
        ?.chain()
        .focus()
        .insertContent({
          type: 'image',
          attrs: {
            src: assetUrl(asset.signed_url),
            alt: datei.name,
            assetUid: asset.asset_uid,
          },
        })
        .run()
    } catch {
      toast.error(t('docs.errors.DOC_ASSET_TOO_LARGE'))
    }
  }

  const kommentarAnlegen = async () => {
    if (!editor) return
    const { from, to } = editor.state.selection
    if (from === to) {
      toast.error(t('docs.comments.selectionRequired'))
      return
    }
    const quote = editor.state.doc.textBetween(from, to, ' ').slice(0, 400)
    const text = await prompt({
      title: t('docs.comments.new'),
      message: t('docs.comments.promptMessage'),
      placeholder: t('docs.comments.placeholder'),
    })
    if (!text) return
    try {
      // Mappable Positions binden den Anker an den Yjs-Zustand; die Quote
      // bleibt als lesbarer Rueckfall, wenn die Stelle spaeter verschwindet.
      const von = createMappablePosition(from, editor.state).toJSON()
      const bis = createMappablePosition(to, editor.state).toJSON()
      const { uid } = await createComment(detail.uid, text, null, { quote, from: von, to: bis })
      if (darfSchreiben) {
        editor.chain().focus().setMark('comment', { commentId: uid }).run()
      }
      onCommentsChanged()
      onOpenPanel('comments')
    } catch {
      toast.error(t('docs.errors.COMMENT_NOT_FOUND'))
    }
  }

  const lokaleKopie = async () => {
    try {
      await navigator.clipboard.writeText(editor?.getText() ?? '')
      toast.success(t('docs.editor.localCopied'))
    } catch {
      toast.error(t('docs.editor.copyFailed'))
    }
  }

  const kiRueckgaengig = async () => {
    const sicher = await confirm({
      title: t('docs.singra.undoTitle'),
      message: t('docs.singra.undoConfirm'),
      confirmText: t('docs.singra.undo'),
    })
    if (!sicher) return
    try {
      await undoAiEdit(detail.uid)
      toast.success(t('docs.singra.undone'))
    } catch {
      toast.error(t('docs.errors.AI_UNDO_EMPTY'))
    }
  }

  const zeichenzaehlung = editor?.storage.characterCount as
    | { words?: () => number; characters?: () => number }
    | undefined
  const woerter = zeichenzaehlung?.words?.() ?? 0
  const zeichen = zeichenzaehlung?.characters?.() ?? 0
  const statusText =
    verbindung === 'verbunden'
      ? t('docs.status.connected')
      : verbindung === 'getrennt'
        ? t('docs.status.disconnected')
        : verbindung === 'fehler'
          ? t('docs.status.failed')
          : t('docs.status.connecting')

  return (
    <section className="flex h-full min-h-0 flex-col bg-surface-container-lowest">
      <header className="flex flex-wrap items-center gap-2 border-b border-outline-variant/40 px-3 py-2">
        <input
          aria-label={t('docs.editor.titleLabel')}
          value={titel}
          disabled={!darfSchreiben}
          onChange={(event) => setTitel(event.target.value)}
          onBlur={() => {
            const neu = titel.trim()
            if (neu && neu !== detail.title) void onTitleChanged(neu)
            else setTitel(detail.title)
          }}
          className="min-w-[10rem] flex-1 bg-transparent font-headline text-lg font-semibold text-on-surface outline-none disabled:opacity-80"
        />
        <Badge variant="default">{t(`docs.roles.${detail.role}`)}</Badge>
        <span className="hidden text-xs text-on-surface-variant sm:inline">Rev {detail.rev}</span>
        {peers > 1 && (
          <Kurzinfo text={t('docs.editor.peers', { count: peers })}>
            <span className="rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">{peers}</span>
          </Kurzinfo>
        )}
        {detail.can_manage && (
          <>
            <Kurzinfo text={t('docs.members.open')}>
              <Button variant="ghost" size="sm" onClick={onOpenMembers} aria-label={t('docs.members.open')}>
                <Users className="h-4 w-4" />
              </Button>
            </Kurzinfo>
            <Kurzinfo text={t('docs.share.open')}>
              <Button variant="ghost" size="sm" onClick={onOpenShare} aria-label={t('docs.share.open')}>
                <Share2 className="h-4 w-4" />
              </Button>
            </Kurzinfo>
          </>
        )}
        <Kurzinfo text={t('docs.outline.label')}>
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={activePanel === 'outline'}
            onClick={() => onOpenPanel(activePanel === 'outline' ? null : 'outline')}
            aria-label={t('docs.outline.label')}
          >
            {t('docs.outline.short')}
          </Button>
        </Kurzinfo>
        {!darfSchreiben && detail.can_comment && (
          <Kurzinfo text={t('docs.toolbar.comment')}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void kommentarAnlegen()}
              aria-label={t('docs.toolbar.comment')}
            >
              <MessageSquarePlus className="h-4 w-4" />
            </Button>
          </Kurzinfo>
        )}
        <Kurzinfo text={t('docs.history.open')}>
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={activePanel === 'history'}
            onClick={() => onOpenPanel(activePanel === 'history' ? null : 'history')}
            aria-label={t('docs.history.open')}
          >
            <History className="h-4 w-4" />
          </Button>
        </Kurzinfo>
        <Kurzinfo text={t('docs.comments.open')}>
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={activePanel === 'comments'}
            onClick={() => onOpenPanel(activePanel === 'comments' ? null : 'comments')}
            aria-label={t('docs.comments.open')}
          >
            <MessageSquare className="h-4 w-4" />
          </Button>
        </Kurzinfo>
        <Kurzinfo text={t('docs.singra.open')}>
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={activePanel === 'singra'}
            onClick={() => onOpenPanel(activePanel === 'singra' ? null : 'singra')}
            aria-label={t('docs.singra.open')}
          >
            <Sparkles className="h-4 w-4" />
          </Button>
        </Kurzinfo>
        {darfSchreiben && (
          <Kurzinfo text={t('docs.singra.undo')}>
            <Button variant="ghost" size="sm" onClick={() => void kiRueckgaengig()} aria-label={t('docs.singra.undo')}>
              <RotateCcw className="h-4 w-4" />
            </Button>
          </Kurzinfo>
        )}
        {vorschlag && !vorschlag.stale && (
          <Badge variant="warning">{t('docs.pending.badge')}</Badge>
        )}
        {vorschlag?.stale && (
          <Kurzinfo text={t('docs.pending.staleHint')}>
            <Button
              variant="ghost"
              size="sm"
              disabled={vorschlagBusy}
              onClick={onRejectVorschlag}
              aria-label={t('docs.pending.rejectStale')}
              className="text-status-warning"
            >
              <AlertTriangle className="h-4 w-4" />
              <span className="hidden sm:inline">{t('docs.pending.staleShort')}</span>
            </Button>
          </Kurzinfo>
        )}
        <ExportMenu uid={detail.uid} rev={detail.rev} disabled={!synced && !online} />
      </header>

      {(!online || !synced) && (
        <div
          role="status"
          className="flex items-center gap-2 border-b border-outline-variant/40 bg-surface-container px-4 py-1.5 text-xs text-on-surface-variant"
        >
          <WifiOff className="h-3.5 w-3.5" />
          {online ? t('docs.status.waitingSync') : t('docs.offline.banner')}
        </div>
      )}

      {darfSchreiben ? (
        <>
          <div className="hidden md:block">
            <Toolbar
              editor={editor}
              disabled={online && !synced}
              onImage={bildWaehlen}
              onComment={() => void kommentarAnlegen()}
            />
          </div>
          <div className="md:hidden">
            <MobileToolbar
              editor={editor}
              disabled={online && !synced}
              onImage={bildWaehlen}
              onComment={() => void kommentarAnlegen()}
            />
          </div>
        </>
      ) : (
        <div role="status" className="border-b border-outline-variant/40 bg-primary/5 px-4 py-1.5 text-xs text-primary">
          {t('docs.editor.readOnly')}
        </div>
      )}

      {!darfSchreiben && lokalGeaendert && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 border-b border-status-warning/40 bg-status-warning/10 px-4 py-1.5 text-xs text-status-warning"
        >
          <span className="flex-1">{t('docs.editor.downgraded')}</span>
          <Button variant="ghost" size="sm" onClick={() => void lokaleKopie()}>
            {t('docs.editor.copyLocal')}
          </Button>
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <EditorContent editor={editor} />
          {!synced && !online && (
            <p className="px-6 pb-4 text-xs text-on-surface-variant">{t('docs.offline.localChanges')}</p>
          )}
        </div>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-outline-variant/40 px-4 py-1.5 text-xs text-on-surface-variant">
        <span>
          {t('docs.status.words', { count: woerter })} · {t('docs.status.characters', { count: zeichen })}
        </span>
        <span className="flex items-center gap-3">
          <span>{statusText}</span>
          <span>Rev {detail.rev}</span>
        </span>
      </footer>

      {slashQuery !== null && editor && (
        <SlashMenu
          editor={editor}
          query={slashQuery}
          onClose={() => setSlashQuery(null)}
          onImage={() => {
            setSlashQuery(null)
            bildWaehlen()
          }}
        />
      )}

      <input
        ref={bildRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
        className="hidden"
        onChange={(event) => {
          const datei = event.target.files?.[0]
          event.target.value = ''
          if (datei) void bildHochladen(datei)
        }}
      />
    </section>
  )
}
