import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { KeyRound, Mail, RefreshCw, RotateCcw } from 'lucide-react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  PasswordInput,
} from '@maunting/ui'
import { useZweitfaktor, ZweitfaktorFeld } from '@/components/auth/ZweitfaktorNachweis'
import { useAuthStore } from '@/stores/authStore'
import { toast } from '@/stores/toastStore'
import type { TeamVaultRotationNachweis } from './teamVaultStore'

export interface VaultHintModalProps {
  isOpen: boolean
  onClose: () => Promise<void> | void
  activeHasHint: boolean | null
  editHintInput: string
  onEditHintInputChange: (val: string) => void
  isSavingHint: boolean
  onSavingHintChange: (saving: boolean) => void
  isRequestingHint: boolean
  onRequestHint: () => Promise<void>
  onSaveHint: (hint: string) => Promise<void>
  onSavedSuccess: () => void
}

/** Dialog zum Anlegen/Aktualisieren des Passwort-Hinweises. */
export function VaultHintModal({
  isOpen,
  onClose,
  activeHasHint,
  editHintInput,
  onEditHintInputChange,
  isSavingHint,
  onSavingHintChange,
  isRequestingHint,
  onRequestHint,
  onSaveHint,
  onSavedSuccess,
}: VaultHintModalProps) {
  const { t } = useTranslation()

  return (
    <Dialog open={isOpen} onOpenChange={(offen) => !offen && void onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader className="px-5 py-4 pr-14">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <KeyRound className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle className="text-sm">{t('mss.vault.hinweisTitel')}</DialogTitle>
              <p className="text-label-sm text-on-surface-variant">
                {activeHasHint ? t('mss.vault.hinweisVorhanden') : t('mss.vault.hinweisFehlt')}
              </p>
            </div>
          </div>
        </DialogHeader>

        <form
          onSubmit={async (e) => {
            e.preventDefault()
            if (!editHintInput.trim() || isSavingHint) return
            onSavingHintChange(true)
            try {
              await onSaveHint(editHintInput.trim())
              toast.success(t('mss.vault.hinweisGespeichert'))
              onSavedSuccess()
            } catch {
              toast.error(t('mss.vault.hinweisSpeichernFehlgeschlagen'))
            } finally {
              onSavingHintChange(false)
            }
          }}
        >
          <div className="space-y-1 p-5">
            <Input
              id="tresor-hinweis"
              label={activeHasHint ? t('mss.vault.hinweisAktualisieren') : t('mss.vault.hinweisAnlegen')}
              type="text"
              value={editHintInput}
              onChange={(e) => onEditHintInputChange(e.target.value)}
              placeholder={t('mss.vault.hinweisPlatzhalterLang')}
              autoFocus
            />
            <p className="text-label-sm text-on-surface-variant/80 leading-relaxed">
              {t('mss.vault.hinweisErklaerungLang')}
            </p>
          </div>

          <DialogFooter className="flex-wrap justify-between">
            {activeHasHint ? (
              <Button
                fingerziel
                type="button"
                variant="secondary"
                size="sm"
                disabled={isRequestingHint}
                onClick={() => void onRequestHint()}
              >
                <Mail className="h-3.5 w-3.5" />
                <span>{isRequestingHint ? t('mss.vault.sendeMail') : t('mss.vault.perMailTesten')}</span>
              </Button>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-1.5">
              <Button type="button" variant="ghost" onClick={() => void onClose()}>
                {t('common.close')}
              </Button>
              <Button type="submit" disabled={!editHintInput.trim() || isSavingHint}>
                {isSavingHint ? t('common.saving') : t('common.save')}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export interface VaultTeamRotationModalProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  rotBusy: boolean
  onRotate: (nachweis: TeamVaultRotationNachweis) => Promise<void>
}

/** Dialog zur Bestätigung einer Team-Schlüsselrotation mit frischem Kontonachweis (M3). */
export function VaultTeamRotationModal({
  isOpen,
  onOpenChange,
  rotBusy,
  onRotate,
}: VaultTeamRotationModalProps) {
  const { t } = useTranslation()
  const user = useAuthStore((s) => s.user)
  const brauchtPasswort = user?.has_password !== false
  const faktor = useZweitfaktor()
  const [passwort, setPasswort] = useState('')
  const [fehler, setFehler] = useState('')

  const absenden = async (e: React.FormEvent) => {
    e.preventDefault()
    setFehler('')
    try {
      // Passkey-Abfrage nah am Klick (Browser-Anforderung).
      const zweiter = await faktor.nachweis('vault_rotation')
      await onRotate({ password: brauchtPasswort ? passwort : null, ...zweiter })
      setPasswort('')
    } catch (err) {
      setFehler(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          setPasswort('')
          setFehler('')
        }
        onOpenChange(open)
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader className="px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-status-warning/20 text-status-warning">
              <RotateCcw className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle className="text-sm font-semibold">{t('teams.vaultRotationTitle')}</DialogTitle>
              <p className="text-xs text-on-surface-variant">{t('teams.vaultRotationNotice')}</p>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={absenden} className="space-y-4 p-5">
          <p className="text-xs text-on-surface-variant leading-relaxed">
            {t('teams.vaultRotationConfirmDesc')}
          </p>

          {brauchtPasswort && (
            <PasswordInput
              id="team-rotation-passwort"
              label={t('mss.vault.zuruecksetzen.passwortLabel')}
              value={passwort}
              onChange={(e) => setPasswort(e.target.value)}
              autoComplete="current-password"
              required
              disabled={rotBusy}
            />
          )}

          <ZweitfaktorFeld
            faktor={faktor}
            id="team-rotation-otp"
            label={t('mss.vault.zuruecksetzen.otpLabel')}
            disabled={rotBusy}
          />

          {fehler && (
            <div role="alert" className="rounded-xl border border-status-destructive/30 bg-status-destructive/15 p-2.5 text-xs text-status-destructive">
              {fehler}
            </div>
          )}

          <DialogFooter className="flex-wrap justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={rotBusy}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={rotBusy || !faktor.bereit || (brauchtPasswort && !passwort)}
            >
              {rotBusy ? <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-1.5" />}
              {t('teams.vaultRotateBtn')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
