import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Dropdown,
} from '@/Singra/UI'
import { toast } from '@/stores/toastStore'
import { updateDocument, type DocFolder, type DocSummary } from '@/api/docs'

interface MoveDialogProps {
  document: DocSummary | null
  folders: DocFolder[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onMoved: () => void
}

export function MoveDialog({ document, folders, open, onOpenChange, onMoved }: MoveDialogProps) {
  const { t } = useTranslation()
  const [ziel, setZiel] = useState('root')
  const [laeuft, setLaeuft] = useState(false)

  useEffect(() => {
    if (open) setZiel(document?.folder_uid ?? 'root')
  }, [document, open])

  if (!document) return null

  const verschieben = async () => {
    setLaeuft(true)
    try {
      await updateDocument(document.uid, { folder_uid: ziel === 'root' ? null : ziel })
      onMoved()
      onOpenChange(false)
      toast.success(t('docs.move.moved'))
    } catch {
      toast.error(t('docs.errors.DOCS_FORBIDDEN'))
    } finally {
      setLaeuft(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('docs.move.title')}</DialogTitle>
          <DialogDescription>
            {t('docs.move.description', { title: document.title })}
          </DialogDescription>
        </DialogHeader>
        <Dropdown
          aria-label={t('docs.move.target')}
          value={ziel}
          onChange={setZiel}
          options={[
            { value: 'root', label: t('docs.tree.root') },
            ...folders.map((ordner) => ({ value: ordner.uid, label: ordner.name })),
          ]}
          buttonClassName="w-full"
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button disabled={laeuft} onClick={() => void verschieben()}>
            {t('docs.move.action')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
