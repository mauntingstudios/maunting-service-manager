import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, KeyRound, RefreshCw, Shield } from 'lucide-react'

import { Button, PasswordInput } from '@maunting/ui'
import { toast } from '@/stores/toastStore'
import type { User } from '@/types'
import { MauntingCard } from './MauntingCardView'
import { useVaultStore } from './vaultStore'

interface Props {
  /** Das frisch benannte Konto; es steht noch nicht im Sitzungsspeicher. */
  user: User
  onFertig: () => void
}

/**
 * Erster Blick auf die Maunting Card nach der Namenswahl.
 *
 * Das Master-Passwort ist freiwillig: Wer seinen Tresor schon auf einem
 * anderen Gerät eingerichtet hat, gibt es hier einmal ein und schaltet dieses
 * Gerät damit für die Karte frei. Wer keinen Tresor hat oder später möchte,
 * geht ohne Eingabe weiter.
 */
export function Kartenbegruessung({ user, onFertig }: Props) {
  const { t } = useTranslation()
  const isInitialized = useVaultStore((s) => s.isInitialized)
  const isDeviceAuthorized = useVaultStore((s) => s.isDeviceAuthorized)
  const isUnlocking = useVaultStore((s) => s.isUnlocking)
  const fetchVaultSalt = useVaultStore((s) => s.fetchVaultSalt)
  const authorizeDevice = useVaultStore((s) => s.authorizeDevice)

  const [passwort, setPasswort] = useState('')
  const [fehler, setFehler] = useState<string | null>(null)
  /** Erst nach der Serverauskunft steht fest, ob es ein Passwort zu geben gibt. */
  const [geprueft, setGeprueft] = useState(false)

  useEffect(() => {
    // Ob das Konto überhaupt einen Tresor hat, weiß der Server. Ohne diese
    // Frage wäre „noch nicht eingerichtet“ nur eine Annahme des Geräts.
    let aktiv = true
    void fetchVaultSalt().finally(() => {
      if (aktiv) setGeprueft(true)
    })
    return () => {
      aktiv = false
    }
  }, [fetchVaultSalt])

  async function freischalten(e: FormEvent) {
    e.preventDefault()
    if (!passwort.trim() || isUnlocking) return
    setFehler(null)
    const erfolg = await authorizeDevice(passwort)
    if (!erfolg) {
      setFehler(useVaultStore.getState().unlockError || t('mss.vault.falschesPasswort'))
      return
    }
    setPasswort('')
    toast.success(t('mss.card.authorizedErfolg'))
    onFertig()
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Shield className="h-5 w-5" aria-hidden="true" />
        </div>
        <h2 className="font-headline text-headline-sm text-on-surface">{t('mss.card.welcomeTitle')}</h2>
        <p className="mt-2 text-sm leading-6 text-on-surface-variant">
          {!geprueft
            ? t('mss.card.welcomeChecking')
            : isInitialized
              ? t('mss.card.welcomeIntro')
              : t('mss.card.welcomeNotSetUp')}
        </p>
      </div>

      <div className="flex justify-center">
        <MauntingCard userOverride={user} />
      </div>

      {!geprueft ? null : isDeviceAuthorized ? (
        <div className="space-y-4">
          <p role="status" className="flex items-center justify-center gap-2 text-sm font-medium text-status-success">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            {t('mss.card.welcomeAuthorized')}
          </p>
          <Button className="w-full" onClick={onFertig}>
            {t('mss.card.welcomeContinue')}
          </Button>
        </div>
      ) : isInitialized ? (
        <form onSubmit={freischalten} className="mx-auto max-w-md space-y-4">
          <div className="space-y-1.5">
            <PasswordInput
              id="karte-master-passwort"
              label={t('mss.card.welcomePasswordLabel')}
              value={passwort}
              onChange={(e) => setPasswort(e.target.value)}
              placeholder={t('mss.card.passwordPlaceholder')}
              autoComplete="current-password"
              disabled={isUnlocking}
            />
            <p className="text-xs leading-5 text-on-surface-variant/80 pl-0.5">
              {t('mss.card.passwordHelp')}
            </p>
          </div>

          {fehler && (
            <p role="alert" className="text-sm text-status-destructive">
              {fehler}
            </p>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="submit" className="flex-1" disabled={!passwort.trim() || isUnlocking}>
              {isUnlocking ? (
                <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <KeyRound className="h-4 w-4" aria-hidden="true" />
              )}
              {t('mss.card.authorizeSubmit')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              onClick={onFertig}
              disabled={isUnlocking}
            >
              {t('mss.card.welcomeSkip')}
            </Button>
          </div>
        </form>
      ) : (
        <Button className="w-full" onClick={onFertig}>
          {t('mss.card.welcomeContinue')}
        </Button>
      )}
    </div>
  )
}
