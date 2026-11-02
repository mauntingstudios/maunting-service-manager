/**
 * Tresor-Sperre und biometrischer Schnelleinstieg.
 *
 * Stand bis 09/2026 als zwei Karten unter „Konto", zwischen Profilbild und
 * Zeitzone. Dorthin gehörte es nie: im Konto-Reiter steht, wer man ist, hier
 * steht, wie der Tresor auf diesem Rechner zugeht. Seit der Messenger einen
 * eigenen Reiter für dasselbe hat, bekommt der Tresor auch einen.
 *
 * Die Mechanik der Sperre teilen sich beide (`services/autoSperre`), die Zahlen
 * nicht: wer seinen Tresor nach fünf Minuten zumacht, will den Messenger
 * deshalb noch lange nicht zumachen.
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Fingerprint, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react'
import { TresorZuruecksetzen } from './TresorZuruecksetzen'

import { sperrfristOptionen } from '@/services/autoSperre'
import { Button, Dialog, DialogContent, Dropdown, type DropdownOption, PasswordInput, Switch } from '@/Singra/UI'
import { useZweitfaktor, ZweitfaktorFeld } from '@/components/auth/ZweitfaktorNachweis'
import { useAuthStore } from '@/stores/authStore'
import { toast } from '@/stores/toastStore'

import { useShallow } from 'zustand/react/shallow'
import { useVaultStore } from './vaultStore'
import { leakCheckGewaehlt, setLeakCheckEnabled } from './leakChecker'
import { kiSpiegelungAktiv, setKiSpiegelungAktiv } from './kiAnhangSpiegelung'
import { fehlerText } from './tresorFehler'
import { KameraSicherungKarte } from './KameraSicherungKarte'

const istAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)

export function TresorSicherheitTab({ offline = false }: { offline?: boolean }) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const {
    isInitialized,
    isUnlocked,
    autoLockMinutes,
    lockOnWindowBlur,
    isBiometricsSupported,
    isBiometricsEnabled,
    setAutoLockMinutes,
    setLockOnWindowBlur,
    enableBiometrics,
    disableBiometrics,
    checkBiometricsSupport,
    rotatePassword,
    rotationState,
    abortRotation,
    rollbackRotation,
  } = useVaultStore(
    // Nur diese Felder: `lastActivityTime` ändert sich bei jeder Mausbewegung.
    useShallow((s) => ({ isInitialized: s.isInitialized, isUnlocked: s.isUnlocked, autoLockMinutes: s.autoLockMinutes, lockOnWindowBlur: s.lockOnWindowBlur, isBiometricsSupported: s.isBiometricsSupported, isBiometricsEnabled: s.isBiometricsEnabled, setAutoLockMinutes: s.setAutoLockMinutes, setLockOnWindowBlur: s.setLockOnWindowBlur, enableBiometrics: s.enableBiometrics, disableBiometrics: s.disableBiometrics, checkBiometricsSupport: s.checkBiometricsSupport, rotatePassword: s.rotatePassword, rotationState: s.rotationState, abortRotation: s.abortRotation, rollbackRotation: s.rollbackRotation })),
  )

  const [rotationOpen, setRotationOpen] = useState(false)
  const [rotAktuell, setRotAktuell] = useState('')
  const [rotNeu, setRotNeu] = useState('')
  const [rotWiederholung, setRotWiederholung] = useState('')
  const [rotKontoPasswort, setRotKontoPasswort] = useState('')
  const [rotBusy, setRotBusy] = useState(false)
  // Frischer Kontonachweis: das Master-Passwort kennt der Server nicht, also
  // belegt das Konto-Passwort oder der zweite Faktor, wer rotieren darf.
  const benutzer = useAuthStore((s) => s.user)
  const rotFaktor = useZweitfaktor()
  const rotBrauchtPasswort = benutzer?.has_password !== false
  const rotHatNachweis = rotBrauchtPasswort || rotFaktor.methoden.length > 0

  const handleRotation = async (e: React.FormEvent) => {
    e.preventDefault()
    if (rotNeu.length < 12 || rotNeu !== rotWiederholung) return
    setRotBusy(true)
    try {
      const zweiter = await rotFaktor.nachweis('vault_rotation')
      const ok = await rotatePassword(rotAktuell, rotNeu, {
        password: rotBrauchtPasswort ? rotKontoPasswort : null,
        ...zweiter,
      })
      if (ok) {
        toast.success(t('mss.vault.rotationErfolg'))
        setRotationOpen(false)
        setRotAktuell('')
        setRotNeu('')
        setRotWiederholung('')
        setRotKontoPasswort('')
      } else {
        toast.error(t('mss.vault.rotationFehler'))
      }
    } finally {
      setRotBusy(false)
    }
  }

  const [biometricsModalOpen, setBiometricsModalOpen] = useState(false)
  const [resetModalOpen, setResetModalOpen] = useState(false)
  const [masterPasswordInput, setMasterPasswordInput] = useState('')
  const [biometricsLoading, setBiometricsLoading] = useState(false)
  const [leckPruefung, setLeckPruefung] = useState(leakCheckGewaehlt)
  const [kiSpiegelung, setKiSpiegelung] = useState(kiSpiegelungAktiv)

  useEffect(() => {
    void checkBiometricsSupport()
  }, [checkBiometricsSupport])

  // Dieselbe Auswahl wie im Messenger-Reiter, aus derselben Quelle. Vorher
  // standen hier sechs eigene Einträge mit eigener Grammatik („5 Minuten
  // Inaktivität" gegen „Nach 5 Minuten" drüben) und einer falschen: die `0`
  // hieß „Sofort beim Verlassen" und bedeutet „nie".
  const autoLockOptions: DropdownOption[] = sperrfristOptionen(t)

  const handleBiometricsToggle = async (checked: boolean) => {
    if (!checked) {
      await disableBiometrics()
      toast.success(t('mss.vault.biometrieAusToast'))
      return
    }
    setMasterPasswordInput('')
    setBiometricsModalOpen(true)
  }

  const handleConfirmBiometrics = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!masterPasswordInput) return
    setBiometricsLoading(true)
    try {
      const ok = await enableBiometrics(masterPasswordInput)
      if (ok) {
        toast.success(t('mss.vault.biometrieAn'))
        setBiometricsModalOpen(false)
        setMasterPasswordInput('')
      } else {
        toast.error(t('mss.vault.biometrieFehler'))
      }
    } catch (err: unknown) {
      const msg = fehlerText(err, t('mss.vault.biometrieFehler'))
      toast.error(msg)
    } finally {
      setBiometricsLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Automatische Sperre */}
      <div className="msm-card p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-on-surface">{t('mss.vault.titel')}</h2>
            <p className="text-label-sm text-on-surface-variant">
              {t('mss.vault.konsolidiertHinweis', 'Zentrale Sicherheitseinstellungen für deinen persönlichen Tresor und alle Team-Tresore.')}
            </p>
          </div>
        </div>

        <div className="space-y-4 pt-2 border-t border-outline-variant/30">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <label className="text-xs font-medium text-on-surface">{t('mss.vault.autoSperre')}</label>
              <p className="text-label-sm text-on-surface-variant">
                {t('mss.vault.autoSperreHinweis', 'Sperrt nach Inaktivität automatisch alle privaten und Team-Tresore.')}
              </p>
            </div>
            <div className="w-full sm:w-56">
              <Dropdown
                options={autoLockOptions}
                value={String(autoLockMinutes)}
                onChange={(val) => setAutoLockMinutes(Number(val))}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 pt-2 border-t border-outline-variant/20">
            <div>
              <span id="tresor-fensterwechsel" className="text-xs font-medium text-on-surface">{t('mss.vault.beiFensterwechsel')}</span>
              <p className="text-label-sm text-on-surface-variant">
                {t('mss.vault.beiFensterwechselHinweis')}
              </p>
            </div>
            <Switch
              aria-labelledby="tresor-fensterwechsel"
              checked={lockOnWindowBlur}
              onCheckedChange={setLockOnWindowBlur}
            />
          </div>

          <div className="flex items-center justify-between gap-4 pt-2 border-t border-outline-variant/20">
            <div>
              <span id="tresor-leckpruefung" className="text-xs font-medium text-on-surface">{t('mss.vault.leckPruefung')}</span>
              <p className="text-label-sm text-on-surface-variant">{t('mss.vault.leckPruefungHinweis')}</p>
            </div>
            <Switch
              aria-labelledby="tresor-leckpruefung"
              checked={leckPruefung}
              onCheckedChange={(an) => {
                setLeakCheckEnabled(an)
                setLeckPruefung(an)
              }}
            />
          </div>

          <div className="flex items-center justify-between gap-4 pt-2 border-t border-outline-variant/20">
            <div>
              <div className="flex items-center gap-2">
                <span id="tresor-ki-spiegelung" className="text-xs font-medium text-on-surface">{t('mss.vault.kiSpiegelung')}</span>
                <span className="px-1.5 py-0.5 rounded text-label-sm font-semibold bg-primary/10 text-primary border border-primary/20">
                  {t('mss.vault.nurPrivat', 'Privater Tresor')}
                </span>
              </div>
              <p className="text-label-sm text-on-surface-variant">{t('mss.vault.kiSpiegelungHinweis')}</p>
            </div>
            <Switch
              aria-labelledby="tresor-ki-spiegelung"
              checked={kiSpiegelung}
              onCheckedChange={(an) => {
                setKiSpiegelungAktiv(an)
                setKiSpiegelung(an)
              }}
            />
          </div>
        </div>
      </div>

      {/* Biometrischer Schnelleinstieg */}
      <div className="msm-card p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Fingerprint className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-on-surface">{t('mss.vault.biometrieTitel')}</h2>
          </div>
        </div>

        <div className="pt-2 border-t border-outline-variant/30 space-y-3">
          {!isInitialized ? (
            <div className="p-2.5 rounded-xl bg-surface-container-high border border-outline-variant/30 text-xs text-on-surface-variant">
              {t('mss.vault.nichtEingerichtet')}
            </div>
          ) : !isUnlocked ? (
            <div className="flex flex-col items-start gap-2 p-2.5 rounded-xl bg-surface-container-high border border-outline-variant/30 text-xs text-on-surface-variant sm:flex-row sm:items-center sm:gap-3">
              <span className="flex-1">{t('mss.vault.gesperrt')}</span>
              <Button variant="secondary" size="sm" type="button" onClick={() => navigate('/tresor')}>
                {t('profile.dataExport.vaultUnlock')}
              </Button>
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-4">
            <div>
              <span id="tresor-biometrie" className="text-xs font-medium text-on-surface">
                {t('mss.vault.biometrieSchalter')}
              </span>
              <p className="text-label-sm text-on-surface-variant">
                {t('mss.vault.biometrieHinweis')}
              </p>
            </div>
            <Switch
              aria-labelledby="tresor-biometrie"
              checked={isBiometricsEnabled && isBiometricsSupported}
              onCheckedChange={(checked: boolean) => void handleBiometricsToggle(checked)}
              disabled={!isBiometricsSupported || !isInitialized || !isUnlocked}
            />
          </div>

          {!isBiometricsSupported && (
            <div className="p-2.5 rounded-xl bg-surface-container-high border border-outline-variant/30 text-xs text-on-surface-variant">
              {t('mss.vault.biometrieNichtMoeglich')}
            </div>
          )}
        </div>
      </div>

      {/* Master-Passwort rotieren (Zwei-Phasen, mit verschlüsseltem Vorab-Backup) */}
      <div className="msm-card p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <RotateCcw className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-on-surface">{t('mss.vault.rotationTitel')}</h2>
            <p className="text-label-sm text-on-surface-variant">{t('mss.vault.rotationHinweis')}</p>
          </div>
        </div>
        <div className="pt-2 border-t border-outline-variant/30 flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" disabled={!isInitialized || !isUnlocked} onClick={() => setRotationOpen(true)}>
            <RotateCcw className="h-4 w-4 mr-1.5" />
            {t('mss.vault.rotationStarten')}
          </Button>
          {rotationState === 'prepared' && (
            <Button type="button" size="sm" variant="ghost" onClick={() => void abortRotation()}>
              {t('mss.vault.rotationAbbrechen')}
            </Button>
          )}
          {rotationState === 'committed' && (
            <Button type="button" size="sm" variant="ghost" onClick={() => void rollbackRotation()}>
              {t('mss.vault.rotationRollback')}
            </Button>
          )}
        </div>
      </div>

      <Dialog open={rotationOpen} onOpenChange={setRotationOpen}>
        <DialogContent className="max-w-sm p-5 space-y-4">
          <h3 className="text-sm font-semibold text-on-surface">{t('mss.vault.rotationTitel')}</h3>
          <p className="text-xs text-on-surface-variant">{t('mss.vault.rotationBackupHinweis')}</p>
          <form onSubmit={handleRotation} className="space-y-3">
            <PasswordInput value={rotAktuell} onChange={(e) => setRotAktuell(e.target.value)} placeholder={t('mss.vault.rotationAktuellesPasswort')} autoFocus required disabled={rotBusy} />
            <PasswordInput value={rotNeu} onChange={(e) => setRotNeu(e.target.value)} placeholder={t('mss.vault.rotationNeuesPasswort')} required disabled={rotBusy} />
            <PasswordInput value={rotWiederholung} onChange={(e) => setRotWiederholung(e.target.value)} placeholder={t('mss.vault.rotationPasswortWiederholen')} required disabled={rotBusy} />
            <div className="space-y-3 border-t border-outline-variant/30 pt-3">
              <div>
                <h4 className="text-xs font-semibold text-on-surface">{t('mss.vault.rotationNachweisTitel')}</h4>
                <p className="text-label-sm text-on-surface-variant">{t('mss.vault.rotationNachweisHinweis')}</p>
              </div>
              {rotHatNachweis ? (
                <>
                  {rotBrauchtPasswort && (
                    <PasswordInput
                      value={rotKontoPasswort}
                      onChange={(e) => setRotKontoPasswort(e.target.value)}
                      label={t('mss.vault.rotationKontoPasswort')}
                      autoComplete="current-password"
                      required
                      disabled={rotBusy}
                    />
                  )}
                  <ZweitfaktorFeld faktor={rotFaktor} id="rotation-otp" disabled={rotBusy} />
                </>
              ) : (
                <p className="text-xs text-status-warning">{t('mss.vault.rotationKeinNachweis')}</p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setRotationOpen(false)} disabled={rotBusy}>{t('common.cancel')}</Button>
              <Button type="submit" disabled={rotBusy || !rotHatNachweis || !rotFaktor.bereit || (rotBrauchtPasswort && !rotKontoPasswort) || !rotAktuell || rotNeu.length < 12 || rotNeu !== rotWiederholung}>
                {rotBusy ? t('mss.vault.rotationLaeuft') : t('mss.vault.rotationStarten')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {istAndroid && <KameraSicherungKarte offline={offline} />}

      {/* Biometrie Aktivierungs-Modal */}
      <Dialog
        open={biometricsModalOpen}
        onOpenChange={(open) => {
          setBiometricsModalOpen(open)
          if (!open) {
            setMasterPasswordInput('')
          }
        }}
      >
        <DialogContent
          className="max-w-sm p-5 space-y-4"
          aria-labelledby="biometrie-einrichten-titel"
          aria-describedby="biometrie-einrichten-beschr"
        >
          <div className="flex items-center gap-3 pr-8">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Fingerprint className="h-4 w-4" />
            </div>
            <h3 id="biometrie-einrichten-titel" className="text-sm font-semibold text-on-surface">
              {t('mss.vault.biometrieEinrichten')}
            </h3>
          </div>
          <p id="biometrie-einrichten-beschr" className="text-xs text-on-surface-variant">
            {t('mss.vault.biometrieBestaetigen')}
          </p>
          <form onSubmit={handleConfirmBiometrics} className="space-y-3">
            <PasswordInput
              value={masterPasswordInput}
              onChange={(e) => setMasterPasswordInput(e.target.value)}
              placeholder={t('mss.vault.masterPasswort')}
              autoFocus
              required
              disabled={biometricsLoading}
            />
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setBiometricsModalOpen(false)
                  setMasterPasswordInput('')
                }}
                disabled={biometricsLoading}
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="submit"
                disabled={biometricsLoading || !masterPasswordInput}
              >
                {biometricsLoading ? t('mss.vault.biometriePruefe') : t('mss.vault.biometrieAktivieren')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Tresor zurücksetzen (Notfall-Reset) */}
      <div className="msm-card p-5 space-y-4 border border-status-destructive/20 bg-status-destructive/5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-status-destructive/10 text-status-destructive">
            <Trash2 className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-on-surface">{t('mss.vault.zuruecksetzen.titel', 'Tresor zurücksetzen')}</h2>
            <p className="text-label-sm text-on-surface-variant">
              {t('mss.vault.zuruecksetzen.tabHinweis', 'Master-Passwort vergessen oder Notfall-Reset? Leert den persönlichen Tresor und setzt die Maunting Card zurück.')}
            </p>
          </div>
        </div>
        <div className="pt-2 border-t border-outline-variant/20 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-status-destructive font-medium">
            {t('mss.vault.zuruecksetzen.warnungKurz', 'Achtung: Unwiderruflicher Schritt. Nicht synchronisierte Einträge gehen verloren.')}
          </p>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={!isInitialized}
            onClick={() => setResetModalOpen(true)}
          >
            <Trash2 className="h-4 w-4 mr-1.5" />
            {t('mss.vault.zuruecksetzen.link', 'Tresor zurücksetzen')}
          </Button>
        </div>
      </div>

      <Dialog open={resetModalOpen} onOpenChange={setResetModalOpen}>
        <DialogContent className="max-w-md p-5 space-y-4">
          <TresorZuruecksetzen
            isTeam={false}
            onAbbrechen={() => setResetModalOpen(false)}
            onFertig={() => {
              setResetModalOpen(false)
              toast.success(t('mss.vault.zurueckgesetztErfolg', 'Tresor wurde erfolgreich zurückgesetzt'))
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}

