import { useCallback, useEffect, useState } from 'react'
import { aiApi, type AiAttachment } from '@/api/ai'
import { SanitizedApiError } from '@/api/client'
import {
  AiSpeicherInhalt,
  entferneAnhangAusTresor,
} from '@/components/ai/anhaenge/AiSpeicherDrawer'
import { Spinner } from '@maunting/ui'
import { toast } from '@/stores/toastStore'

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

  const loadFiles = useCallback(async () => {
    setLoading(true)
    try {
      // Im globalen Reiter „Dateien“ den gesamten KI-Speicher laden, nicht nur einen einzelnen Chat.
      const rows = await aiApi.listAttachments()
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
  }, [])

  useEffect(() => {
    void loadFiles()
  }, [loadFiles])

  const handleUploadFiles = async (fileList: File[]) => {
    if (fileList.length === 0 || uploading) return
    setUploading(true)
    try {
      const uploaded: AiAttachment[] = []
      for (const file of fileList) {
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

  const handleDelete = async (item: AiAttachment, auchAusTresor: boolean) => {
    try {
      await aiApi.deleteAttachment(item.id)
      if (auchAusTresor) {
        await entferneAnhangAusTresor(item.original_name)
      }
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

  const tresorSpiegelungAktiv =
    typeof window !== 'undefined' &&
    window.localStorage.getItem('msm_vault_mirror_chat_attachments') === 'true'

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-surface px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <AiSpeicherInhalt
          anhaenge={attachments}
          onLoeschen={handleDelete}
          onInPromptEinfuegen={onUseFileInChat}
          onUploadFiles={handleUploadFiles}
          uploading={uploading}
          tresorSpiegelungAktiv={tresorSpiegelungAktiv}
        />
      </div>
    </div>
  )
}
