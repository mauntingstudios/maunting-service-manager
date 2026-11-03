import { useState, type MutableRefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'

import { Button, Dialog, DialogContent, Kurzinfo } from '@/Singra/UI'
import type { DocComment, DocDetail, DocRevision } from '@/api/docs'
import { useBreiteZiehen } from '@/hooks/useBreiteZiehen'
import { useMedienabfrage } from '@/hooks/useMedienabfrage'
import { CommentsPanel } from './CommentsPanel'
import { DocsChatPanel } from './DocsChatPanel'
import { HistoryPanel } from './HistoryPanel'
import { OutlineList, type OutlineEntry } from './editor/Outline'

export type DocsPanel = 'comments' | 'history' | 'outline' | 'singra'

/** Unterhalb von `lg` liegt das Panel als Overlay; darüber ist es angedockt. */

interface DocsPanelsProps {
  detail: DocDetail
  panel: DocsPanel
  comments: DocComment[]
  revisions: DocRevision[]
  outlineEntries: OutlineEntry[]
  outlineJumpRef: MutableRefObject<((pos: number) => void) | null>
  selection: { quote: string } | null
  userId: number
  onClose: () => void
  onCommentsChanged: () => void
  onHistoryChanged: () => void
  onAssistantChanged: () => void
}

export function DocsPanels({
  detail,
  panel,
  comments,
  revisions,
  outlineEntries,
  outlineJumpRef,
  selection,
  userId,
  onClose,
  onCommentsChanged,
  onHistoryChanged,
  onAssistantChanged,
}: DocsPanelsProps) {
  const { t } = useTranslation()
  const mobil = useMedienabfrage('(max-width: 1023.98px)')
  const title =
    panel === 'comments'
      ? t('docs.comments.title')
      : panel === 'history'
        ? t('docs.history.title')
        : panel === 'outline'
          ? t('docs.outline.label')
          : t('docs.singra.title')
  const [breite, setBreite] = useState(() => {
    try {
      const gespeichert = Number(localStorage.getItem(`docs.chat.breite:${userId}`))
      return Number.isFinite(gespeichert) && gespeichert > 0 ? Math.max(340, Math.min(860, gespeichert)) : 440
    } catch {
      return 440
    }
  })
  const ziehen = useBreiteZiehen({
    breite,
    min: 320,
    max: 720,
    setzen: (wert) => {
      setBreite(wert)
      try {
        localStorage.setItem(`docs.chat.breite:${userId}`, String(wert))
      } catch {
        /* Lokaler Speicher gesperrt — die Breite gilt nur für diese Sitzung. */
      }
    },
  })

  const seite = (
    <aside
      className="relative flex h-full w-full max-w-[92vw] shrink-0 flex-col overflow-hidden border-l border-outline-variant/40 bg-surface-container"
      style={{ width: `min(${breite}px, 92vw)` }}
    >
      <div
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-valuenow={breite}
        aria-valuemin={340}
        aria-valuemax={860}
        aria-label={t('docs.chat.resize')}
        className="group/griff absolute inset-y-0 left-0 z-10 flex w-2 cursor-col-resize touch-none items-center justify-center outline-none hover:bg-primary/10 focus-visible:bg-primary/10 active:bg-primary/15"
        {...ziehen}
      >
        <span
          aria-hidden="true"
          className="h-10 w-1 rounded-full bg-outline transition-colors group-hover/griff:bg-primary group-focus-visible/griff:bg-primary group-active/griff:bg-primary"
        />
      </div>
      <div className="flex items-center justify-between border-b border-outline-variant/40 px-3 py-2">
        <span className="text-sm font-semibold text-on-surface">{title}</span>
        <Kurzinfo text={t('common.close')}>
          <Button variant="ghost" size="sm" aria-label={t('common.close')} onClick={onClose}>
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
            userId={userId}
            onChanged={onCommentsChanged}
          />
        )}
        {panel === 'history' && (
          <HistoryPanel
            uid={detail.uid}
            revisions={revisions}
            canEdit={detail.can_edit}
            onChanged={onHistoryChanged}
          />
        )}
        {panel === 'outline' && (
          <div className="h-full overflow-y-auto">
            <OutlineList
              entries={outlineEntries}
              onJump={(pos) => outlineJumpRef.current?.(pos)}
            />
          </div>
        )}
        {panel === 'singra' && (
          <DocsChatPanel uid={detail.uid} selection={selection} onChanged={onAssistantChanged} />
        )}
      </div>
    </aside>
  )

  // Das Overlay ist ein Dialog (Rolle, Fokusfang, Escape, Zurück); die
  // angedockte Seite bleibt ein einfaches Aside. Einmal gemountet, nie doppelt.
  if (mobil) {
    return (
      <Dialog open onOpenChange={(offen) => { if (!offen) onClose() }}>
        <DialogContent
          aria-label={title}
          size="voll"
          showCloseButton={false}
          overlayClassName="!justify-end lg:hidden"
          className="!ml-auto !w-auto !max-w-[92vw] p-0"
        >
          {seite}
        </DialogContent>
      </Dialog>
    )
  }
  return <div className="flex min-h-0">{seite}</div>
}
