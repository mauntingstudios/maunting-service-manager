import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { History, RotateCcw, Save } from 'lucide-react'
import { Badge, Button, confirm, prompt } from '@/Singra/UI'
import { toast } from '@/stores/toastStore'
import { createRevision, restoreRevision, type DocRevision } from '@/api/docs'

interface HistoryPanelProps {
  uid: string
  revisions: DocRevision[]
  canEdit: boolean
  onChanged: () => void
}

const GRUENDE: Record<string, string> = {
  initial: 'initial',
  autosave: 'autosave',
  checkpoint: 'checkpoint',
  ai_pre_edit: 'aiPreEdit',
  ai_edit: 'aiEdit',
  ai_undo: 'aiUndo',
  before_restore: 'beforeRestore',
  restore: 'restore',
  import: 'import',
}

export function HistoryPanel({ uid, revisions, canEdit, onChanged }: HistoryPanelProps) {
  const { t } = useTranslation()
  const [laeuft, setLaeuft] = useState(false)

  const checkpoint = async () => {
    const label = await prompt({
      title: t('docs.history.checkpoint'),
      message: t('docs.history.checkpointPrompt'),
      placeholder: t('docs.history.labelPlaceholder'),
    })
    if (label === null) return
    setLaeuft(true)
    try {
      await createRevision(uid, label.trim() || undefined)
      onChanged()
      toast.success(t('docs.history.checkpointCreated'))
    } catch {
      toast.error(t('docs.errors.DOCS_STORE_FAILED'))
    } finally {
      setLaeuft(false)
    }
  }

  const wiederherstellen = async (rev: number) => {
    const sicher = await confirm({
      title: t('docs.history.restore'),
      message: t('docs.history.restoreConfirm', { rev }),
      confirmText: t('docs.history.restore'),
      danger: true,
    })
    if (!sicher) return
    setLaeuft(true)
    try {
      await restoreRevision(uid, rev)
      onChanged()
      toast.success(t('docs.history.restored'))
    } catch {
      toast.error(t('docs.errors.DOC_RESTORE_CONFLICT'))
    } finally {
      setLaeuft(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-outline-variant/40 px-3 py-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-on-surface">
          <History className="h-4 w-4" />
          {t('docs.history.title')}
        </h2>
        {canEdit && (
          <Button variant="ghost" size="sm" disabled={laeuft} onClick={() => void checkpoint()}>
            <Save className="mr-1 h-3.5 w-3.5" />
            {t('docs.history.checkpoint')}
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {revisions.length === 0 && (
          <p className="py-6 text-center text-xs text-on-surface-variant">{t('docs.history.empty')}</p>
        )}
        {revisions.map((revision) => (
          <article key={revision.rev} className="mb-2 rounded-xl border border-outline-variant/40 bg-surface-container p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-on-surface">
                Rev {revision.rev} · {new Date(revision.created_at).toLocaleString()}
              </span>
              <Badge variant={revision.author_kind === 'ai' ? 'info' : 'default'}>
                {t(`docs.history.reasons.${GRUENDE[revision.reason] ?? 'autosave'}`)}
              </Badge>
            </div>
            <p className="mt-1 text-label-sm text-on-surface-variant">
              {revision.author ?? t('docs.history.systemAuthor')} · {Math.max(1, Math.round(revision.size_bytes / 1024))} KiB
            </p>
            {revision.label && <p className="mt-1 text-xs text-on-surface">{revision.label}</p>}
            {revision.preview && (
              <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-on-surface-variant">{revision.preview}</p>
            )}
            {canEdit && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                disabled={laeuft}
                onClick={() => void wiederherstellen(revision.rev)}
              >
                <RotateCcw className="mr-1 h-3.5 w-3.5" />
                {t('docs.history.restore')}
              </Button>
            )}
          </article>
        ))}
      </div>
    </div>
  )
}
