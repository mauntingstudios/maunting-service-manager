import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@maunting/ui'
import { Input } from '@maunting/ui'
import { PasswordInput } from '@maunting/ui'
import { formatBytes } from '@/lib/format'
import { Spinner } from '@maunting/ui'
import { useZweitfaktor, ZweitfaktorFeld } from '@/components/auth/ZweitfaktorNachweis'
import { useAuthStore } from '@/stores/authStore'
import { toast } from '@/stores/toastStore'
import { useVaultStore } from './vaultStore'
import { useTeamVaultStore } from './teamVaultStore'
import { speicherAbfragen, type TresorSpeicher } from './tresorBlobApi'

interface Props {
  onAbbrechen: () => void
  /** Danach ist kein Tresor mehr eingerichtet; die Ansicht wechselt ins Einrichten. */
  onFertig: () => void
  isTeam?: boolean
  teamId?: number
}

/**
 * „Master-Passwort vergessen?": der Ausweg, den es bis 09/2026 nur über die
 * Datenbank gab. Dieselben Nachweise wie beim Löschen des Kontos, jeder für
 * sich: das Konto-Passwort, wenn eins hinterlegt ist; bei 2FA zusätzlich ein
 * Faktor, gleich welcher; immer das Wort „delete", nicht einfügbar. Ein
 * reines Social-Konto ohne 2FA braucht nur das Wort.
 */
export function TresorZuruecksetzen({ onAbbrechen, onFertig, isTeam, teamId }: Props) {
  const { t } = useTranslation()
  const user = useAuthStore((s) => s.user)
  const resetVault = useVaultStore((s) => s.resetVault)
  const faktor = useZweitfaktor()
  const brauchtPasswort = user?.has_password !== false

  const [passwort, setPasswort] = useState('')
  const [wort, setWort] = useState('')
  const [laeuft, setLaeuft] = useState(false)
  const [fehler, setFehler] = useState('')
  // Die Dateien gehen mit: das braucht der Nutzer vorher. Der Server kennt nur Zahl und Größe.
  const [speicher, setSpeicher] = useState<TresorSpeicher | null>(null)
  useEffect(() => {
    if (!isTeam) {
      speicherAbfragen().then(setSpeicher, () => setSpeicher(null))
    }
  }, [isTeam])

  const absenden = async (e: React.FormEvent) => {
    e.preventDefault()
    setFehler('')
    setLaeuft(true)
    try {
      // Der Passkey zuerst: der Browser verlangt die Abfrage nah am Klick.
      const zweiter = await faktor.nachweis('vault_reset')
      const payload = { password: brauchtPasswort ? passwort : null, ...zweiter }
      if (isTeam && teamId) {
        await useTeamVaultStore.getState().resetVault(teamId, payload, wort)
      } else {
        await resetVault(payload, wort)
      }
      toast.success(t('mss.vault.zuruecksetzen.fertig'))
      onFertig()
    } catch (err) {
      setFehler(err instanceof Error ? err.message : String(err))
      setLaeuft(false)
    }
  }

  return (
    <form onSubmit={absenden} className="space-y-3.5">
      <h2 className="text-center text-base font-bold text-on-surface">
        {isTeam ? 'Team-Tresor zurücksetzen' : t('mss.vault.zuruecksetzen.titel')}
      </h2>

      <div className="rounded-xl border border-status-destructive/30 bg-status-destructive/10 p-3">
        <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-status-destructive">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t('mss.vault.zuruecksetzen.warnungTitel')}
        </p>
        <p className="text-xs text-on-surface-variant">
          {isTeam
            ? 'Dadurch werden alle Einträge dieses Team-Tresors unwiderruflich gelöscht. Der Eigentümer kann danach ein neues Master-Passwort festlegen.'
            : t('mss.vault.zuruecksetzen.warnungText')}
        </p>
        {speicher && speicher.blobs > 0 && (
          <p className="mt-2 text-xs text-on-surface-variant">
            {/* Ohne Anzahl: frühere Fassungen sind auch Blobs, `blobs / 3` zählte sie als Dateien. */}
            {t('mss.vault.zuruecksetzen.dateien', { groesse: formatBytes(Math.max(0, speicher.belegt - speicher.in_loeschung)) })}
          </p>
        )}
      </div>

      {brauchtPasswort && (
        <PasswordInput
          id="vault-reset-passwort"
          label={t('mss.vault.zuruecksetzen.passwortLabel')}
          value={passwort}
          onChange={(e) => setPasswort(e.target.value)}
          autoComplete="current-password"
          required
          disabled={laeuft}
        />
      )}
      <ZweitfaktorFeld
        faktor={faktor}
        id="vault-reset-otp"
        label={t('mss.vault.zuruecksetzen.otpLabel')}
        disabled={laeuft}
      />

      <Input
        id="vault-reset-wort"
        type="text"
        label={t('mss.vault.zuruecksetzen.wortLabel')}
        value={wort}
        onChange={(e) => setWort(e.target.value)}
        onPaste={(e) => e.preventDefault()}
        className="font-mono"
        placeholder="delete"
        required
        disabled={laeuft}
        autoComplete="off"
        spellCheck={false}
      />

      {fehler && (
        <div role="alert" className="rounded-xl border border-status-destructive/30 bg-status-destructive/15 p-2.5 text-xs text-status-destructive">
          {fehler}
        </div>
      )}

      <Button
        type="submit"
        variant="destructive"
        disabled={laeuft || !faktor.bereit || wort.trim().toLowerCase() !== 'delete'}
        className="flex w-full items-center justify-center gap-1.5 text-xs"
      >
        {laeuft ? <Spinner /> : null}
        {laeuft ? t('mss.vault.zuruecksetzen.laeuft') : t('mss.vault.zuruecksetzen.knopf')}
      </Button>
      <Button type="button" variant="ghost" onClick={onAbbrechen} disabled={laeuft} className="w-full text-xs">
        {t('common.cancel')}
      </Button>
    </form>
  )
}
