import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Link2, Trash2 } from 'lucide-react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Dropdown,
  Input,
} from '@/Singra/UI'
import { toast } from '@/stores/toastStore'
import { createShare, deleteShare, type DocDetail, type ShareRole } from '@/api/docs'

interface ShareDialogProps {
  detail: DocDetail
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged: () => void
}

export function ShareDialog({ detail, open, onOpenChange, onChanged }: ShareDialogProps) {
  const { t } = useTranslation()
  const [role, setRole] = useState<ShareRole>(detail.share_role ?? 'viewer')
  const [tage, setTage] = useState('7')
  const [url, setUrl] = useState('')
  const [laeuft, setLaeuft] = useState(false)

  useEffect(() => {
    if (open) {
      setRole(detail.share_role ?? 'viewer')
      setUrl('')
    }
  }, [open, detail.share_role])

  const anlegen = async () => {
    setLaeuft(true)
    try {
      const ergebnis = await createShare(detail.uid, role, Number(tage) || 7)
      setUrl(`${window.location.origin}${ergebnis.url}`)
      onChanged()
      toast.success(t('docs.share.created'))
    } catch {
      toast.error(t('docs.errors.DOCS_FORBIDDEN'))
    } finally {
      setLaeuft(false)
    }
  }

  const abschalten = async () => {
    setLaeuft(true)
    try {
      await deleteShare(detail.uid)
      setUrl('')
      onChanged()
      toast.success(t('docs.share.disabled'))
    } catch {
      toast.error(t('docs.errors.DOCS_FORBIDDEN'))
    } finally {
      setLaeuft(false)
    }
  }

  const kopieren = async () => {
    try {
      await navigator.clipboard.writeText(url)
      toast.success(t('docs.share.copied'))
    } catch {
      toast.error(t('docs.share.copyFailed'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('docs.share.title')}</DialogTitle>
          <DialogDescription>{t('docs.share.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-on-surface-variant">
              {t('docs.share.role')}
              <Dropdown
                aria-label={t('docs.share.role')}
                value={role}
                onChange={(wert) => setRole(wert === 'commenter' ? 'commenter' : 'viewer')}
                options={[
                  { value: 'viewer', label: t('docs.roles.viewer') },
                  { value: 'commenter', label: t('docs.roles.commenter') },
                ]}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-on-surface-variant">
              {t('docs.share.expires')}
              <Input
                type="number"
                min={1}
                max={30}
                value={tage}
                onChange={(event) => setTage(event.target.value)}
              />
            </label>
          </div>

          <p className="text-xs text-on-surface-variant">{t('docs.share.boundary')}</p>

          {detail.shared && (
            <div className="rounded-lg border border-outline-variant/40 p-3 text-xs text-on-surface-variant">
              <p className="flex items-center gap-2 text-on-surface">
                <Link2 className="h-4 w-4" />
                {t('docs.share.active', {
                  role: t(`docs.roles.${detail.share_role ?? 'viewer'}`),
                  date: detail.share_expires_at ? new Date(detail.share_expires_at).toLocaleString() : '—',
                })}
              </p>
            </div>
          )}

          {url && (
            <div className="flex items-center gap-2">
              <Input readOnly value={url} aria-label={t('docs.share.link')} onFocus={(event) => event.target.select()} />
              <Button variant="secondary" size="sm" onClick={() => void kopieren()} aria-label={t('docs.share.copy')}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        <DialogFooter>
          {detail.shared && (
            <Button variant="destructive" disabled={laeuft} onClick={() => void abschalten()}>
              <Trash2 className="mr-1 h-4 w-4" />
              {t('docs.share.disable')}
            </Button>
          )}
          <Button disabled={laeuft} onClick={() => void anlegen()}>
            {detail.shared ? t('docs.share.replace') : t('docs.share.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
