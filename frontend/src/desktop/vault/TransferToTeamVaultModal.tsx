/**
 * Modal zum Übertragen von Tresor-Einträgen aus dem persönlichen Tresor in einen Team-Tresor.
 *
 * Unterstützt Verschieben (Löschen im persönlichen Tresor) und Kopieren (Behalten).
 * Zero-Knowledge: Entschlüsselung erfolgt rein im Client, Neu-Verschlüsselung mit dem
 * Team-Schlüssel ebenfalls rein im Client.
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRightLeft, Lock, RefreshCw, ShieldCheck } from 'lucide-react'

import { teamsApi, type Team } from '@/api/teams'
import { Button, Dialog, DialogContent, Dropdown, DropdownOption } from '@maunting/ui'
import { toast } from '@/stores/toastStore'
import { useVaultStore } from './vaultStore'
import { useTeamVaultStore } from './teamVaultStore'
import type { VaultItem } from './vaultEintrag'

interface TransferToTeamVaultModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  item: VaultItem | null
}

type TransferModus = 'kopieren' | 'verschieben'

export function TransferToTeamVaultModal({ open, onOpenChange, item }: TransferToTeamVaultModalProps) {
  const { t } = useTranslation()
  const [teams, setTeams] = useState<Team[]>([])
  const [zielTeamId, setZielTeamId] = useState<string>('')
  const [modus, setModus] = useState<TransferModus>('kopieren')
  const [needsUnlock, setNeedsUnlock] = useState(false)
  const [busy, setBusy] = useState(false)

  const teamUnlocked = useTeamVaultStore((s) => s.isUnlocked)
  const currentTeamId = useTeamVaultStore((s) => s.teamId)
  const unlockTeam = useTeamVaultStore((s) => s.unlock)
  const deletePersonalItem = useVaultStore((s) => s.deleteItem)

  useEffect(() => {
    if (!open) return
    void teamsApi.list().then((alle) => {
      const echte = alle.filter((t) => !t.is_personal)
      setTeams(echte)
      if (echte.length > 0) {
        setZielTeamId(String(echte[0].id))
      }
    })
  }, [open])

  useEffect(() => {
    if (!zielTeamId) {
      setNeedsUnlock(false)
      return
    }
    const tid = Number(zielTeamId)
    setNeedsUnlock(!teamUnlocked || currentTeamId !== tid)
  }, [zielTeamId, teamUnlocked, currentTeamId])

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!item || !zielTeamId) return
    const tid = Number(zielTeamId)
    setBusy(true)

    try {
      // Falls Team-Tresor noch gesperrt ist, erst mit der Karte entsperren.
      // Der private Tresor ist offen (daher kommt der Eintrag), also braucht
      // es kein weiteres Passwort — nur die Freischaltung durch den Gründer.
      if (needsUnlock) {
        const ok = await unlockTeam(tid)
        if (!ok) {
          const { needsSlot, error } = useTeamVaultStore.getState()
          toast.error(
            needsSlot ? t('teams.vaultWartetAufFreischaltung') : error || t('common.error'),
          )
          setBusy(false)
          return
        }
      }

      const zielTeam = teams.find((t) => t.id === tid)
      const teamName = zielTeam?.name || 'Team'
      const transferLabel = modus === 'verschieben' ? 'Verschoben' : 'Kopiert'

      // Eintrag im Team-Tresor anlegen (Zero-Knowledge Re-Encryption)
      const saveItem = useTeamVaultStore.getState().saveItem
      await saveItem({
        service: item.service,
        category: item.category,
        username: item.username,
        password: item.password,
        url: item.url,
        notes: item.notes,
        totpSecret: item.totpSecret,
        extra: item.extra,
        transferredAt: Date.now(),
        transferredLabel: transferLabel,
      })

      // Bei Verschieben aus persönlichem Tresor entfernen; bei Kopieren Eintrag markieren
      if (modus === 'verschieben') {
        await deletePersonalItem(item.id)
      } else {
        const savePersonalItem = useVaultStore.getState().saveItem
        await savePersonalItem({
          id: item.id,
          service: item.service,
          category: item.category,
          username: item.username,
          password: item.password,
          url: item.url,
          notes: item.notes,
          totpSecret: item.totpSecret,
          extra: item.extra,
          transferredAt: Date.now(),
          transferredLabel: `In Team "${teamName}" kopiert`,
        })
      }

      toast.success(t('teams.transferSuccess'))
      onOpenChange(false)
    } catch {
      toast.error(t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  const teamOptionen: DropdownOption[] = teams.map((t) => ({
    value: String(t.id),
    label: t.name,
  }))

  const modusOptionen: DropdownOption[] = [
    { value: 'kopieren', label: t('teams.transferCopy') },
    { value: 'verschieben', label: t('teams.transferMove') },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ArrowRightLeft className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-on-surface">{t('teams.transferToTeam')}</h3>
            <p className="text-xs text-on-surface-variant truncate max-w-[280px]">{item?.service}</p>
          </div>
        </div>

        {teams.length === 0 ? (
          <div className="p-4 rounded-xl bg-surface-container-high border border-outline-variant/30 text-xs text-on-surface-variant text-center">
            {t('teams.noTeams')}
          </div>
        ) : (
          <form onSubmit={handleTransfer} className="space-y-3.5">
            <div className="space-y-1">
              <label className="text-xs font-medium text-on-surface">{t('teams.transferSelectTeam')}</label>
              <Dropdown options={teamOptionen} value={zielTeamId} onChange={setZielTeamId} />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-on-surface">{t('teams.transferMode')}</label>
              <Dropdown
                options={modusOptionen}
                value={modus}
                onChange={(val) => setModus(val as TransferModus)}
              />
            </div>

            {needsUnlock && (
              <div className="flex items-center gap-1.5 pt-2 border-t border-outline-variant/20 text-xs text-on-surface-variant">
                <Lock className="h-3.5 w-3.5 shrink-0" />
                <span>{t('teams.vaultWirdMitKarteEntsperrt')}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-outline-variant/20">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={busy || !zielTeamId}>
                {busy ? <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-1.5" />}
                {t('teams.transferToTeam')}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
