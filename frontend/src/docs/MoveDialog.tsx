import { useEffect, useMemo, useState } from 'react'
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
import { listFolders, type DocFolder, type DocSummary } from '@/api/docs'
import type { Team } from '@/api/teams'
import { useDokumentVerschieben } from './useDokumentVerschieben'

interface MoveDialogProps {
  document: DocSummary | null
  folders: DocFolder[]
  teams: Team[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onMoved: () => void
}

export function MoveDialog({
  document,
  folders,
  teams,
  open,
  onOpenChange,
  onMoved,
}: MoveDialogProps) {
  const { t } = useTranslation()
  const [teamId, setTeamId] = useState<number | null>(null)
  const [ziel, setZiel] = useState('root')
  const [zielOrdner, setZielOrdner] = useState<DocFolder[]>([])
  const [ordnerLaden, setOrdnerLaden] = useState(false)
  const { laeuft, verschieben } = useDokumentVerschieben(onMoved)

  useEffect(() => {
    if (!open || !document) return
    setTeamId(document.team_id)
    setZiel(document.folder_uid ?? 'root')
  }, [open, document])

  useEffect(() => {
    if (!open || teamId === null) return
    if (document && teamId === document.team_id) {
      setZielOrdner(folders)
      return
    }
    let aktiv = true
    setOrdnerLaden(true)
    void listFolders(teamId)
      .then((liste) => {
        if (aktiv) setZielOrdner(liste)
      })
      .catch(() => {
        if (aktiv) setZielOrdner([])
      })
      .finally(() => {
        if (aktiv) setOrdnerLaden(false)
      })
    return () => {
      aktiv = false
    }
  }, [document, folders, open, teamId])

  const teamWechsel = teamId !== null && document !== null && teamId !== document.team_id
  const geaendert =
    document !== null &&
    (teamWechsel || (ziel === 'root' ? document.folder_uid !== null : document.folder_uid !== ziel))

  const teamOptionen = useMemo(
    () => teams.map((team) => ({ value: String(team.id), label: team.name })),
    [teams],
  )

  if (!document) return null

  const speichern = async () => {
    try {
      await verschieben(document.uid, {
        ...(teamWechsel && teamId !== null ? { teamId } : {}),
        folderUid: ziel === 'root' ? null : ziel,
      })
      onOpenChange(false)
      toast.success(t('docs.move.moved'))
    } catch {
      toast.error(t('docs.errors.DOCS_FORBIDDEN'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('docs.move.title')}</DialogTitle>
          <DialogDescription>
            {t('docs.move.description', { title: document.title })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5 p-6 pt-0">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-xs text-on-surface-variant">
              {t('docs.move.team')}
              <Dropdown
                aria-label={t('docs.move.team')}
                value={teamId === null ? null : String(teamId)}
                onChange={(wert) => {
                  setTeamId(Number(wert))
                  setZiel('root')
                }}
                options={teamOptionen}
                buttonClassName="w-full"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-on-surface-variant">
              {t('docs.move.target')}
              <Dropdown
                aria-label={t('docs.move.target')}
                value={ziel}
                onChange={setZiel}
                disabled={ordnerLaden}
                options={[
                  { value: 'root', label: t('docs.tree.root') },
                  ...zielOrdner.map((ordner) => ({ value: ordner.uid, label: ordner.name })),
                ]}
                buttonClassName="w-full"
              />
            </label>
          </div>
          {teamWechsel && (
            <p className="rounded-lg border border-status-warning/40 bg-status-warning/10 p-3 text-xs leading-5 text-status-warning">
              {t('docs.move.teamWarning')}
            </p>
          )}
        </div>
        <DialogFooter variant="plain">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button disabled={laeuft || !geaendert} onClick={() => void speichern()}>
            {t('docs.move.action')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
