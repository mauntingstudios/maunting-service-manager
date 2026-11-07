import { useTranslation } from 'react-i18next'
import { Ban, FileText, X } from 'lucide-react'
import { Button, ChatComposerBanner } from '@maunting/ui'
import { formatBytes } from '@/lib/format'
import type { FileAttachment, ImageAttachment } from '@/components/social/ChatMediaAttachments'

/** Das angehängte Foto über der Eingabe, noch nicht gesendet. */
export function StagedImageBar({ bild, onEntfernen }: { bild: ImageAttachment; onEntfernen: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="relative px-4 py-2 border-t border-outline-variant/20 bg-surface-container flex items-center gap-3">
      <div className="relative">
        <img
          src={bild.dataUrl}
          alt="Vorschau"
          className="w-12 h-12 object-cover rounded-lg border border-outline-variant/40"
        />
        <button
          type="button"
          onClick={onEntfernen}
          className="absolute -top-1 -right-1 p-0.5 rounded-full bg-surface-container-highest text-on-surface"
          aria-label={t('messenger.removeImage')}
        >
          <X className="w-3 h-3" />
        </button>
      </div>
      <span className="text-xs text-on-surface-variant truncate">
        Foto angehängt: {bild.name || 'image.png'}
      </span>
    </div>
  )
}

/** Die angehängte Datei über der Eingabe, noch nicht gesendet. */
export function StagedFileBar({ datei, onEntfernen }: { datei: FileAttachment; onEntfernen: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="relative px-4 py-2 border-t border-outline-variant/20 bg-surface-container flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        <div className="p-1.5 rounded-lg bg-primary/10 text-primary shrink-0">
          <FileText className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-primary truncate">{datei.name}</p>
          <p className="text-label-sm text-on-surface-variant">{formatBytes(datei.sizeBytes)}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onEntfernen}
        className="p-1 rounded-full hover:bg-surface-container-highest text-on-surface-variant"
        aria-label={t('messenger.removeFile')}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

/** Der Hinweis, dass gerade eine gesendete Nachricht bearbeitet wird. */
export function EditingBanner({ text, onAbbrechen }: { text: string; onAbbrechen: () => void }) {
  const { t } = useTranslation()
  return (
    <ChatComposerBanner
      mode="edit"
      title={t('messenger.editMessage')}
      text={text}
      onCancel={onAbbrechen}
      cancelLabel={t('messenger.cancelEdit')}
      className="mx-auto max-w-3xl xl:max-w-4xl rounded-t-2xl border border-b-0 border-outline-variant/30"
    />
  )
}

/** Steht statt der Eingabe, solange der Kontakt blockiert ist. */
export function BlockedNotice({ onAufheben }: { onAufheben: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 rounded-xl bg-status-destructive/10 border border-status-destructive/30 text-xs text-status-destructive">
      <div className="flex items-center gap-2">
        <Ban className="w-4 h-4 shrink-0" />
        <span>{t('messenger.contactBlocked')}</span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onAufheben}
        className="h-7 text-xs px-3 border border-status-destructive/30 hover:bg-status-destructive/20 text-status-destructive font-medium"
      >
        {t('messenger.unblock')}
      </Button>
    </div>
  )
}
