import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  File,
  FileCode,
  FileText,
  Folder,
  HardDrive,
  Image as ImageIcon,
  Paperclip,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import { aiApi, type AiAttachment } from '@/api/ai'
import { SanitizedApiError } from '@/api/client'
import { Button, Input, Spinner } from '@maunting/ui'
import { anhangArt, lesbareGroesse } from '@/lib/aiAnhangTypen'
import { confirm } from '@/stores/confirmStore'
import { toast } from '@/stores/toastStore'

type FilterKind = 'all' | 'image' | 'document' | 'text'

interface SingraFilesViewProps {
  activeConversationId?: string | null
  onUseFileInChat?: (attachment: AiAttachment) => void
}

export function SingraFilesView({
  activeConversationId,
  onUseFileInChat,
}: SingraFilesViewProps) {
  const [attachments, setAttachments] = useState<AiAttachment[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FilterKind>('all')

  const loadFiles = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await aiApi.listAttachments(
        undefined,
        activeConversationId ?? undefined,
      )
      setAttachments(rows)
    } catch (err: unknown) {
      toast.error(
        err instanceof SanitizedApiError
          ? err.message
          : 'Dateien konnten nicht geladen werden.',
      )
    } finally {
      setLoading(false)
    }
  }, [activeConversationId])

  useEffect(() => {
    void loadFiles()
  }, [loadFiles])

  const totalBytes = useMemo(
    () => attachments.reduce((sum, item) => sum + (item.size_bytes || 0), 0),
    [attachments],
  )

  const filtered = useMemo(() => {
    return attachments.filter((item) => {
      const kind = anhangArt(item.media_type, item.original_name)
      if (filter !== 'all' && kind !== filter) return false
      if (query.trim()) {
        const needle = query.trim().toLowerCase()
        if (!(item.original_name || '').toLowerCase().includes(needle)) {
          return false
        }
      }
      return true
    })
  }, [attachments, filter, query])

  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || uploading) return
    setUploading(true)
    try {
      const uploaded: AiAttachment[] = []
      for (const file of Array.from(fileList)) {
        const saved = await aiApi.uploadAttachment(
          file,
          undefined,
          activeConversationId ?? undefined,
        )
        uploaded.push(saved)
      }
      setAttachments((prev) => [...uploaded, ...prev])
      toast.success(
        uploaded.length === 1
          ? 'Datei hochgeladen.'
          : `${uploaded.length} Dateien hochgeladen.`,
      )
    } catch (err: unknown) {
      toast.error(
        err instanceof SanitizedApiError
          ? err.message
          : 'Upload fehlgeschlagen.',
      )
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (item: AiAttachment) => {
    const ok = await confirm({
      title: 'Datei entfernen',
      message: `Möchtest du „${item.original_name}“ aus dem Singra-Speicher löschen?`,
      confirmText: 'Löschen',
      danger: true,
    })
    if (!ok) return
    try {
      await aiApi.deleteAttachment(item.id)
      setAttachments((prev) => prev.filter((a) => a.id !== item.id))
      toast.success('Datei gelöscht.')
    } catch (err: unknown) {
      toast.error(
        err instanceof SanitizedApiError
          ? err.message
          : 'Datei konnte nicht gelöscht werden.',
      )
    }
  }

  if (loading) {
    return (
      <div className="flex h-full flex-1 items-center justify-center">
        <Spinner size="lg" className="text-primary" />
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-surface px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-outline-variant/30 bg-surface-container-low/45 p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Folder className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="font-headline text-lg font-semibold text-on-surface">
                KI-Speicher
              </h2>
              <p className="text-xs text-on-surface-variant">
                {attachments.length} Dateien gespeichert • Belegter Speicher:{' '}
                <strong className="text-on-surface">{lesbareGroesse(totalBytes)}</strong>
              </p>
            </div>
          </div>

          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-medium text-on-primary shadow-sm hover:bg-primary/90 transition-colors">
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>{uploading ? 'Lädt hoch…' : 'Dateien hochladen'}</span>
            <input
              type="file"
              multiple
              disabled={uploading}
              className="sr-only"
              onChange={(e) => {
                void handleUpload(e.target.files)
                e.target.value = ''
              }}
            />
          </label>
        </div>

        {/* Filter & Search Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 overflow-x-auto">
            {(
              [
                { id: 'all', label: 'Alle Dateien' },
                { id: 'image', label: 'Bilder' },
                { id: 'document', label: 'Dokumente' },
                { id: 'text', label: 'Code & Text' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={[
                  'rounded-xl px-3 py-1.5 text-xs font-medium transition-colors',
                  filter === tab.id
                    ? 'bg-primary/15 text-primary border border-primary/30'
                    : 'bg-surface-container-low/50 text-on-surface-variant hover:text-on-surface border border-outline-variant/25',
                ].join(' ')}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-on-surface-variant" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Dateiname suchen …"
              className="pl-8 text-xs h-9"
              aria-label="Dateiname suchen"
            />
          </div>
        </div>

        {/* File List */}
        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-low/30 p-10 text-center">
            <HardDrive className="mx-auto h-8 w-8 text-on-surface-variant/60 mb-3" />
            <p className="text-sm font-medium text-on-surface">
              Keine Dateien in dieser Ansicht
            </p>
            <p className="mt-1 text-xs text-on-surface-variant">
              Lade Dokumente, Bilder, Log-Dateien oder Quellcode hoch, um sie in deinen Unterhaltungen mit Singra zu nutzen.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((item) => {
              const kind = anhangArt(item.media_type, item.original_name)
              const Icon =
                kind === 'image'
                  ? ImageIcon
                  : kind === 'document'
                    ? FileText
                    : kind === 'text'
                      ? FileCode
                      : File
              return (
                <div
                  key={item.id}
                  className="flex flex-col justify-between rounded-xl border border-outline-variant/30 bg-surface-container-low/40 p-3.5 hover:border-primary/35 transition-colors"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    {kind === 'image' ? (
                      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-outline-variant/30 bg-black/20">
                        <img
                          src={aiApi.attachmentContentUrl(item.id)}
                          alt={item.original_name}
                          className="h-full w-full object-cover"
                          loading="lazy"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none'
                          }}
                        />
                      </div>
                    ) : (
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div
                        className="truncate text-sm font-medium text-on-surface"
                        title={item.original_name}
                      >
                        {item.original_name}
                      </div>
                      <div className="mt-0.5 text-xs text-on-surface-variant">
                        {lesbareGroesse(item.size_bytes)} •{' '}
                        {new Date(item.created_at).toLocaleDateString()}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-end gap-1.5 border-t border-outline-variant/20 pt-2.5">
                    {onUseFileInChat && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2.5 text-xs flex items-center gap-1.5"
                        onClick={() => onUseFileInChat(item)}
                      >
                        <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                        An Chat anhängen
                      </Button>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleDelete(item)}
                      className="rounded-lg p-1.5 text-on-surface-variant hover:bg-status-destructive/15 hover:text-status-destructive transition-colors"
                      aria-label={`Datei ${item.original_name} löschen`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
