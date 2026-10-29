import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Badge,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Dropdown,
} from '@/Singra/UI'
import { toast } from '@/stores/toastStore'
import {
  deleteMember,
  listMembers,
  putMember,
  updateDocument,
  type DocDetail,
  type DocMemberRow,
  type DocRole,
} from '@/api/docs'

interface MembersDialogProps {
  detail: DocDetail
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged?: () => void
}

export function MembersDialog({ detail, open, onOpenChange, onChanged }: MembersDialogProps) {
  const { t } = useTranslation()
  const [rows, setRows] = useState<DocMemberRow[]>([])
  const [laden, setLaden] = useState(false)
  const [defaultRolle, setDefaultRolle] = useState<DocRole>(detail.default_role)

  const neuLaden = useCallback(async () => {
    setLaden(true)
    try {
      setRows(await listMembers(detail.uid))
    } catch {
      toast.error(t('docs.errors.DOCS_FORBIDDEN'))
    } finally {
      setLaden(false)
    }
  }, [detail.uid, t])

  useEffect(() => {
    if (open) {
      setDefaultRolle(detail.default_role)
      void neuLaden()
    }
  }, [open, neuLaden, detail.default_role])

  const standardRolleAendern = async (wert: string) => {
    try {
      await updateDocument(detail.uid, { default_role: wert as DocRole })
      setDefaultRolle(wert as DocRole)
      onChanged?.()
    } catch {
      toast.error(t('docs.errors.DOCS_FORBIDDEN'))
    }
  }

  const aendern = async (row: DocMemberRow, wert: string) => {
    try {
      if (wert === 'default') await deleteMember(detail.uid, row.user_id)
      else await putMember(detail.uid, row.user_id, wert as DocRole)
      await neuLaden()
    } catch {
      toast.error(t('docs.errors.DOC_INVALID_TARGET'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('docs.members.title')}</DialogTitle>
          <DialogDescription>{t('docs.members.description')}</DialogDescription>
        </DialogHeader>

        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-outline-variant/40 p-2">
          <span className="text-xs text-on-surface-variant">{t('docs.members.defaultRole')}</span>
          <Dropdown
            aria-label={t('docs.members.defaultRole')}
            value={defaultRolle}
            onChange={(wert) => void standardRolleAendern(wert)}
            options={[
              { value: 'viewer', label: t('docs.roles.viewer') },
              { value: 'commenter', label: t('docs.roles.commenter') },
              { value: 'editor', label: t('docs.roles.editor') },
            ]}
            buttonClassName="min-w-[10rem]"
          />
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {laden && <p className="py-4 text-center text-xs text-on-surface-variant">{t('docs.members.loading')}</p>}
          {!laden && rows.length === 0 && (
            <p className="py-4 text-center text-xs text-on-surface-variant">{t('docs.members.empty')}</p>
          )}
          {rows.map((row) => (
            <div
              key={row.user_id}
              className="flex flex-wrap items-center gap-2 border-b border-outline-variant/30 py-2 last:border-0"
            >
              <span className="min-w-0 flex-1 truncate text-sm text-on-surface">{row.username}</span>
              {row.is_team_owner && <Badge variant="info">{t('docs.members.teamOwner')}</Badge>}
              {row.is_doc_owner && <Badge variant="success">{t('docs.members.docOwner')}</Badge>}
              {row.is_team_owner ? (
                <Badge variant="info">{t('docs.roles.editor')}</Badge>
              ) : (
                <Dropdown
                  aria-label={t('docs.members.roleFor', { name: row.username })}
                  value={row.role ?? 'default'}
                  onChange={(wert) => void aendern(row, wert)}
                  options={[
                    { value: 'default', label: t('docs.members.teamDefault', { role: t(`docs.roles.${detail.default_role}`) }) },
                    { value: 'viewer', label: t('docs.roles.viewer') },
                    { value: 'commenter', label: t('docs.roles.commenter') },
                    { value: 'editor', label: t('docs.roles.editor') },
                  ]}
                  buttonClassName="min-w-[12rem]"
                />
              )}
            </div>
          ))}
        </div>
        <p className="text-xs text-on-surface-variant">{t('docs.members.boundary')}</p>
      </DialogContent>
    </Dialog>
  )
}
