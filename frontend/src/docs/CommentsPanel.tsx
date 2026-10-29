import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, MessageSquare, RotateCcw, Trash2 } from 'lucide-react'
import { Badge, Button, Kurzinfo, Textarea } from '@/Singra/UI'
import { toast } from '@/stores/toastStore'
import {
  createComment,
  deleteComment,
  updateComment,
  type DocComment,
} from '@/api/docs'

interface CommentsPanelProps {
  uid: string
  comments: DocComment[]
  canComment: boolean
  canManage: boolean
  userId: number
  onChanged: () => void
}

export function CommentsPanel({
  uid,
  comments,
  canComment,
  canManage,
  userId,
  onChanged,
}: CommentsPanelProps) {
  const { t } = useTranslation()
  const [neu, setNeu] = useState('')
  const [antwort, setAntwort] = useState<Record<string, string>>({})
  const [laeuft, setLaeuft] = useState(false)

  const threads = useMemo(() => {
    const eltern = comments.filter((eintrag) => !eintrag.parent_uid)
    return eltern.map((eintrag) => ({
      ...eintrag,
      antworten: comments.filter((kind) => kind.parent_uid === eintrag.uid),
    }))
  }, [comments])

  const senden = async (body: string, parentUid: string | null) => {
    if (!body.trim()) return
    setLaeuft(true)
    try {
      await createComment(uid, body.trim(), parentUid)
      if (parentUid) setAntwort((alt) => ({ ...alt, [parentUid]: '' }))
      else setNeu('')
      onChanged()
    } catch {
      toast.error(t('docs.errors.COMMENT_NOT_FOUND'))
    } finally {
      setLaeuft(false)
    }
  }

  const statusAendern = async (commentUid: string, status: 'open' | 'resolved') => {
    try {
      await updateComment(uid, commentUid, { status })
      onChanged()
    } catch {
      toast.error(t('docs.errors.COMMENT_NOT_FOUND'))
    }
  }

  const loeschen = async (commentUid: string) => {
    try {
      await deleteComment(uid, commentUid)
      onChanged()
    } catch {
      toast.error(t('docs.errors.COMMENT_NOT_FOUND'))
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-outline-variant/40 px-3 py-2">
        <h2 className="text-sm font-semibold text-on-surface">{t('docs.comments.title')}</h2>
        <Badge variant="default">{comments.filter((eintrag) => eintrag.status === 'open').length}</Badge>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {threads.length === 0 && (
          <p className="py-6 text-center text-xs text-on-surface-variant">{t('docs.comments.empty')}</p>
        )}
        {threads.map((thread) => (
          <article
            key={thread.uid}
            className="mb-3 rounded-xl border border-outline-variant/40 bg-surface-container p-3"
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="truncate text-xs font-semibold text-on-surface">
                {thread.author ?? t('docs.comments.unknownAuthor')}
              </span>
              <Badge variant={thread.status === 'resolved' ? 'success' : 'default'}>
                {thread.status === 'resolved' ? t('docs.comments.resolved') : t('docs.comments.open')}
              </Badge>
            </div>
            {thread.anchor?.quote && (
              <blockquote className="mb-2 border-l-2 border-primary/40 pl-2 text-xs italic text-on-surface-variant">
                {thread.anchor.quote}
              </blockquote>
            )}
            <p className="whitespace-pre-wrap text-sm text-on-surface">{thread.body}</p>
            <div className="mt-2 flex items-center gap-1">
              {canComment && thread.status === 'open' && (
                <Kurzinfo text={t('docs.comments.reply')}>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('docs.comments.reply')}
                    onClick={() => setAntwort((alt) => ({ ...alt, [thread.uid]: alt[thread.uid] ? '' : ' ' }))}
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                  </Button>
                </Kurzinfo>
              )}
              {(thread.author_user_id === userId || canManage) && (
                <>
                  <Kurzinfo text={thread.status === 'resolved' ? t('docs.comments.reopen') : t('docs.comments.resolve')}>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={thread.status === 'resolved' ? t('docs.comments.reopen') : t('docs.comments.resolve')}
                      onClick={() =>
                        void statusAendern(thread.uid, thread.status === 'resolved' ? 'open' : 'resolved')
                      }
                    >
                      {thread.status === 'resolved' ? (
                        <RotateCcw className="h-3.5 w-3.5" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </Kurzinfo>
                  <Kurzinfo text={t('docs.comments.delete')}>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t('docs.comments.delete')}
                      onClick={() => void loeschen(thread.uid)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </Kurzinfo>
                </>
              )}
            </div>

            {thread.antworten.length > 0 && (
              <div className="mt-2 space-y-2 border-l border-outline-variant/50 pl-3">
                {thread.antworten.map((kind) => (
                  <div key={kind.uid}>
                    <p className="text-label-sm font-semibold text-on-surface-variant">
                      {kind.author ?? t('docs.comments.unknownAuthor')}
                    </p>
                    <p className="whitespace-pre-wrap text-xs text-on-surface">{kind.body}</p>
                  </div>
                ))}
              </div>
            )}

            {antwort[thread.uid] !== undefined && antwort[thread.uid] !== '' && (
              <div className="mt-2 flex gap-2">
                <Textarea
                  aria-label={t('docs.comments.reply')}
                  value={antwort[thread.uid].trim()}
                  onChange={(event) =>
                    setAntwort((alt) => ({ ...alt, [thread.uid]: event.target.value }))
                  }
                  rows={2}
                  className="text-xs"
                />
                <Button
                  size="sm"
                  disabled={laeuft}
                  onClick={() => void senden(antwort[thread.uid], thread.uid)}
                >
                  {t('docs.comments.send')}
                </Button>
              </div>
            )}
          </article>
        ))}
      </div>

      {canComment && (
        <div className="border-t border-outline-variant/40 p-3">
          <Textarea
            aria-label={t('docs.comments.new')}
            placeholder={t('docs.comments.placeholder')}
            value={neu}
            onChange={(event) => setNeu(event.target.value)}
            rows={3}
          />
          <Button
            className="mt-2 w-full"
            size="sm"
            disabled={laeuft || !neu.trim()}
            onClick={() => void senden(neu, null)}
          >
            {t('docs.comments.send')}
          </Button>
        </div>
      )}
    </div>
  )
}
