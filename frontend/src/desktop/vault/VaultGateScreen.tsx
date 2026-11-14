import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Check,
  Fingerprint,
  HelpCircle,
  KeyRound,
  Lock,
  QrCode,
  RefreshCw,
  RotateCcw,
  Shield,
  ShieldCheck,
  Unlock,
} from 'lucide-react'
import type { TeamDetail } from '@/api/teams'
import { Button, Checkbox, Input, PasswordInput } from '@maunting/ui'
import { toast } from '@/stores/toastStore'
import { MASTER_PASSWORT_MINDESTLAENGE } from './vaultCrypto'
import { TresorZuruecksetzen } from './TresorZuruecksetzen'
import { MauntingCard } from './MauntingCardView'
import { TageszeitKulisse } from '@/components/layout/TageszeitKulisse'

const isAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)

export interface VaultGateScreenProps {
  isTeam: boolean
  team?: TeamDetail
  hasVaultAccess: boolean
  isInitialized: boolean
  isOwner: boolean
  isUnlocked: boolean
  isUnlocking: boolean
  isSetupMode: boolean
  onSetupModeChange: (val: boolean) => void
  unlockError: string | null
  teamBusy: boolean
  onTeamBusyChange: (busy: boolean) => void
  personalUnlocked: boolean
  personalUnlock: (pw: string) => Promise<boolean>
  personalUnlockError: string | null
  personalInitializeVault: (pw: string) => Promise<boolean>
  personalSaveHint: (hint: string) => Promise<unknown>
  personalUnlockWithBiometrics: () => Promise<boolean>
  teamUnlock: (teamId: number) => Promise<boolean>
  teamLoadStatus: (teamId: number) => Promise<unknown>
  teamNeedsSlot: boolean
  isBiometricsEnabled: boolean
  isBiometricsSupported: boolean
  isDeviceAuthorized: boolean
  activeUnlock: (pw: string) => Promise<boolean>
  activeHasHint: boolean | null
  isRequestingHint: boolean
  onRequestHint: () => Promise<void>
  onSetupRetry: () => void
}

/** Zugriffs-, Einrichtungs- und Entsperransichten des Tresors (vor dem Hauptinhalt). */
export function VaultGateScreen({
  isTeam,
  team,
  hasVaultAccess,
  isInitialized,
  isOwner,
  isUnlocked,
  isUnlocking,
  isSetupMode,
  onSetupModeChange,
  unlockError,
  teamBusy,
  onTeamBusyChange,
  personalUnlocked,
  personalUnlock,
  personalUnlockError,
  personalInitializeVault,
  personalSaveHint,
  personalUnlockWithBiometrics,
  teamUnlock,
  teamLoadStatus,
  teamNeedsSlot,
  isBiometricsEnabled,
  isBiometricsSupported,
  isDeviceAuthorized,
  activeUnlock,
  activeHasHint,
  isRequestingHint,
  onRequestHint,
  onSetupRetry,
}: VaultGateScreenProps) {
  const { t } = useTranslation()
  const [cardUnlockTrigger, setCardUnlockTrigger] = useState(false)
  const [cardAuthorizeTrigger, setCardAuthorizeTrigger] = useState(false)
  const [skipHintSetup, setSkipHintSetup] = useState(false)
  const [zuruecksetzen, setZuruecksetzen] = useState(false)
  const [masterPasswordInput, setMasterPasswordInput] = useState('')
  const [confirmPasswordInput, setConfirmPasswordInput] = useState('')
  const [hintInput, setHintInput] = useState('')

  const handleKarteStecken = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!team?.id) return
    onTeamBusyChange(true)
    try {
      // Nur die Karte stecken: Sobald der private Tresor offen ist, richtet
      // der Effekt oben den Team-Tresor von selbst ein.
      const okPersoenlich = await personalUnlock(masterPasswordInput)
      if (!okPersoenlich) {
        toast.error(personalUnlockError || t('mss.vault.falschesPasswort'))
        return
      }
      setMasterPasswordInput('')
    } finally {
      onTeamBusyChange(false)
    }
  }

  // ── 0. TEAM-TRESOR: ZUTRITT VERWEHRT (Schranke bei fehlender Berechtigung) ──
  if (isTeam && !hasVaultAccess) {
    return (
      <div className="flex h-full w-full overflow-y-auto p-4">
        <div className="my-auto mx-auto w-full max-w-sm p-6 space-y-4 rounded-2xl bg-surface-container border border-status-destructive/30 shadow-xl text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-status-destructive/10 text-status-destructive border border-status-destructive/30">
            <Lock className="h-7 w-7" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-base font-bold text-on-surface">{t('teams.vaultAccessDenied')}</h2>
            <p className="text-xs text-on-surface-variant leading-relaxed">
              {t('teams.vaultAccessDeniedDesc')}
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ── 0. TEAM-TRESOR: SETUP & ENTSPERREN ──
  if (isTeam && !isInitialized) {
    if (!isOwner) {
      return (
        <div className="flex h-full w-full overflow-y-auto p-4">
          <div className="my-auto mx-auto msm-card p-8 text-center space-y-3 max-w-md">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary mx-auto">
              <Lock className="h-6 w-6" />
            </div>
            <h2 className="text-base font-semibold text-on-surface">{t('teams.vaultNotSetup')}</h2>
            <p className="text-sm text-on-surface-variant max-w-md mx-auto">{t('teams.vaultNotSetupDesc')}</p>
          </div>
        </div>
      )
    }

    // Kein Team-Passwort mehr: Der Schlüssel ist Zufall und liegt pro Mitglied
    // verpackt auf dem Server. Der Gründer klickt nichts — sobald die Karte
    // steckt, läuft die Einrichtung von selbst; hier bleibt nur Warten,
    // Karte-Stecken oder (bei Fehlschlag) Wiederholen.
    const karteSteckt = personalUnlocked
    return (
      <div className="flex h-full w-full overflow-y-auto p-4">
        <div className="my-auto mx-auto w-full max-w-sm p-6 space-y-5 rounded-2xl bg-surface-container border border-outline-variant/30 shadow-xl">
          <div className="text-center space-y-1.5">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <h2 className="text-base font-bold text-on-surface">{t('teams.vaultSetup')}</h2>
            <p className="text-xs text-on-surface-variant">{t('teams.vaultSetupDesc')}</p>
          </div>

          {unlockError ? (
            <div className="space-y-3.5">
              <div className="rounded-xl bg-status-destructive/15 border border-status-destructive/30 p-2.5 text-xs text-status-destructive">
                {unlockError}
              </div>
              <Button
                type="button"
                onClick={onSetupRetry}
                disabled={teamBusy}
                className="w-full"
              >
                {teamBusy ? (
                  <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4 mr-1.5" />
                )}
                {t('common.retry')}
              </Button>
            </div>
          ) : !karteSteckt ? (
            <form onSubmit={handleKarteStecken} className="space-y-3.5">
              <div className="space-y-1.5">
                <p className="text-xs text-on-surface-variant">{t('teams.vaultSetupBrauchtKarte')}</p>
                <PasswordInput
                  id="tresor-team-karte-master"
                  label={t('mss.vault.masterPasswort')}
                  value={masterPasswordInput}
                  onChange={(e) => setMasterPasswordInput(e.target.value)}
                  placeholder={t('mss.vault.masterPasswort')}
                  autoComplete="current-password"
                  autoFocus
                  required
                />
              </div>

              <Button
                type="submit"
                disabled={teamBusy || !masterPasswordInput}
                className="w-full"
              >
                {teamBusy ? (
                  <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Unlock className="h-4 w-4 mr-1.5" />
                )}
                {t('mss.vault.entsperren')}
              </Button>
            </form>
          ) : (
            <div role="status" className="flex flex-col items-center gap-2 py-2">
              <RefreshCw className="h-5 w-5 animate-spin text-primary" />
              <p className="text-xs text-on-surface-variant">{t('mss.vault.richteEin')}</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── 1. ERSTEINRICHTUNG (NUR wenn Ersteinrichtungs-Modus aktiv) ──
  if (!isUnlocked && isSetupMode) {
    const canSubmitSetup =
      masterPasswordInput.length >= MASTER_PASSWORT_MINDESTLAENGE &&
      masterPasswordInput === confirmPasswordInput &&
      (hintInput.trim().length > 0 || skipHintSetup) &&
      !isUnlocking

    return (
      <div className="flex h-full w-full overflow-y-auto p-4">
        <div className="my-auto mx-auto w-full max-w-sm p-6 space-y-5 rounded-2xl bg-surface-container border border-outline-variant/30 shadow-xl">
          <div className="text-center space-y-1.5">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20">
              <KeyRound className="h-6 w-6" />
            </div>
            <h2 className="text-base font-bold text-on-surface">
              {t('mss.vault.einrichtenTitel')}
            </h2>
          </div>

          <form
            onSubmit={async (e) => {
              e.preventDefault()
              if (!canSubmitSetup) return
              const ok = await personalInitializeVault(masterPasswordInput)
              if (ok) {
                if (hintInput.trim()) {
                  void personalSaveHint(hintInput)
                }
                setMasterPasswordInput('')
                setConfirmPasswordInput('')
                setHintInput('')
                setSkipHintSetup(false)
                onSetupModeChange(false)
                toast.success(t('mss.vault.eingerichtet'))
              }
            }}
            className="space-y-3.5"
          >
            <PasswordInput
              id="tresor-neues-master"
              label={t('mss.vault.neuesMasterPasswort')}
              value={masterPasswordInput}
              onChange={(e) => setMasterPasswordInput(e.target.value)}
              placeholder={t('mss.vault.mindestlaenge', { anzahl: MASTER_PASSWORT_MINDESTLAENGE })}
              autoComplete="new-password"
              autoFocus
            />

            <div>
              <PasswordInput
                id="tresor-master-wiederholen"
                label={t('mss.vault.passwortWiederholen')}
                value={confirmPasswordInput}
                onChange={(e) => setConfirmPasswordInput(e.target.value)}
                placeholder={t('mss.vault.erneutEingeben')}
                autoComplete="new-password"
              />

              {confirmPasswordInput.length > 0 && (
                <div className="mt-1 text-label-sm">
                  {masterPasswordInput === confirmPasswordInput ? (
                    <span className="flex items-center gap-1 text-status-success">
                      <Check className="h-3 w-3" /> {t('mss.vault.stimmtUeberein')}
                    </span>
                  ) : (
                    <span className="text-status-destructive">{t('mss.vault.stimmtNichtUeberein')}</span>
                  )}
                </div>
              )}
            </div>

            {/* Passwort-Hinweis (Pflicht / Optionale Ablehnung) */}
            <div className="space-y-1.5 pt-1 border-t border-outline-variant/20">
              <div className="flex flex-wrap items-center justify-between gap-x-2">
                <label htmlFor="tresor-hinweis-neu" className="block text-label-sm font-medium text-on-surface">
                  {t('mss.vault.hinweisBezeichnung')} {!skipHintSetup && <span className="text-primary font-bold">*</span>}
                </label>
                <span className="text-label-sm text-on-surface-variant">{t('mss.vault.hinweisWozu')}</span>
              </div>
              <Input
                id="tresor-hinweis-neu"
                type="text"
                disabled={skipHintSetup}
                value={skipHintSetup ? '' : hintInput}
                onChange={(e) => setHintInput(e.target.value)}
                placeholder={skipHintSetup ? t('mss.vault.hinweisAbgelehnt') : t('mss.vault.hinweisPlatzhalter')}
              />

              <label className="flex items-center gap-2 cursor-pointer pt-0.5 text-label-sm text-on-surface-variant hover:text-on-surface">
                <Checkbox
                  checked={skipHintSetup}
                  onCheckedChange={(gesetzt) => {
                    setSkipHintSetup(gesetzt)
                    if (gesetzt) setHintInput('')
                  }}
                />
                <span>{t('mss.vault.ohneHinweisFortfahren')}</span>
              </label>
            </div>

            {unlockError && (
              <div className="rounded-xl bg-status-destructive/15 border border-status-destructive/30 p-2.5 text-xs text-status-destructive">
                {unlockError}
              </div>
            )}

            <Button
              type="submit"
              disabled={!canSubmitSetup}
              className="w-full bg-primary text-on-primary hover:bg-primary-hover py-2 text-xs font-medium"
            >
              {isUnlocking
                ? t('mss.vault.richteEin')
                : !hintInput.trim() && !skipHintSetup && masterPasswordInput.length >= MASTER_PASSWORT_MINDESTLAENGE && masterPasswordInput === confirmPasswordInput
                  ? t('mss.vault.hinweisNoetig')
                  : t('mss.vault.einrichten')}
            </Button>
          </form>

          <div className="text-center pt-1">
            <Button
              fingerziel
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onSetupModeChange(false)
                setMasterPasswordInput('')
                setConfirmPasswordInput('')
              }}
              className="text-primary"
            >
              {t('mss.vault.bereitsEingerichtet')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // ── 2. ENTSPERREN MIT MAUNTING CARD ──
  return (
    <TageszeitKulisse>
      <div className="flex h-full w-full flex-col overflow-y-auto">
        <div className="my-auto mx-auto flex w-full max-w-xl flex-col items-center gap-6 px-4 py-6 sm:px-6">
          {zuruecksetzen ? (
            <div className="w-full max-w-sm p-6 space-y-5 rounded-2xl bg-surface-container border border-outline-variant/30 shadow-xl">
              <TresorZuruecksetzen
                isTeam={isTeam}
                teamId={team?.id}
                onAbbrechen={() => setZuruecksetzen(false)}
                onFertig={() => {
                  setZuruecksetzen(false)
                  if (isTeam && team?.id) {
                    void teamLoadStatus(team.id)
                    // Nach dem Zurücksetzen richtet sich der Tresor neu ein.
                    onSetupRetry()
                  } else {
                    onSetupModeChange(true)
                  }
                }}
              />
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="text-center space-y-2">
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20 shadow-sm backdrop-blur-md">
                  <ShieldCheck className="h-6 w-6" />
                </div>
                <span className="mx-auto inline-flex items-center gap-1.5 rounded-full border border-outline-variant/25 bg-surface-container/70 px-2.5 py-0.5 text-label-sm font-semibold text-on-surface-variant backdrop-blur-md">
                  <Lock className="h-3 w-3" aria-hidden="true" />
                  {t('mss.vault.sperre.marke')}
                </span>
                <h1 className="text-lg font-bold text-on-surface sm:text-xl">
                  {isTeam ? team?.name || t('teams.vaultUnlock') : t('mss.vault.titelManager')}
                </h1>
                <p className="text-xs text-on-surface-variant max-w-md">
                  {!isDeviceAuthorized && isInitialized
                    ? t('mss.card.vaultNeedsAuthorization', 'Dieses Gerät ist noch nicht für deine Maunting Card freigeschaltet. Bitte bestätige das Gerät einmalig.')
                    : isTeam
                      ? t('teams.vaultUnlockDesc')
                      : t('mss.vault.sperre.untertitel')}
                </p>
              </div>

              {/* Maunting Card als Tresor-Schloss */}
              <div className="w-full flex justify-center">
                <MauntingCard
                  className="w-full"
                  unlockOverride={activeUnlock}
                  externalUnlockTrigger={cardUnlockTrigger}
                  externalAuthorizeTrigger={cardAuthorizeTrigger}
                  onExternalUnlockHandled={() => setCardUnlockTrigger(false)}
                  onExternalAuthorizeHandled={() => setCardAuthorizeTrigger(false)}
                  onUnlockSuccess={() => {
                    toast.success(t('mss.vault.entsperrt'))
                  }}
                  onAuthorizeSuccess={() => {
                    toast.success(t('mss.card.authorizedErfolg', 'Gerät erfolgreich autorisiert'))
                  }}
                />
              </div>

              {/* Aktionsleiste unter der Karte */}
              <div className="w-full max-w-sm flex flex-col items-center space-y-3">
                {!isDeviceAuthorized && isInitialized ? (
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => setCardAuthorizeTrigger(true)}
                    className="w-full py-2.5 flex items-center justify-center gap-2 text-xs font-semibold shadow-md"
                  >
                    <Shield className="h-4 w-4" />
                    <span>{t('mss.card.actionAuthorize', 'Gerät autorisieren')}</span>
                  </Button>
                ) : (
                  <>
                    <Button
                      type="button"
                      variant="primary"
                      onClick={async () => {
                        // Steckt die Karte schon, öffnet der Team-Tresor direkt per
                        // Schlüsselhülle — sonst fragt erst der Karten-Dialog die PIN ab.
                        if (isTeam && team?.id && personalUnlocked) {
                          if (teamBusy) return
                          onTeamBusyChange(true)
                          try {
                            const ok = await teamUnlock(team.id)
                            if (ok) {
                              toast.success(t('mss.vault.entsperrt'))
                            }
                          } finally {
                            onTeamBusyChange(false)
                          }
                          return
                        }
                        setCardUnlockTrigger(true)
                      }}
                      disabled={isTeam ? teamBusy : isUnlocking}
                      className="w-full py-2.5 flex items-center justify-center gap-2 text-xs font-semibold shadow-md"
                    >
                      {(isTeam ? teamBusy : isUnlocking) ? (
                        <>
                          <RefreshCw className="h-4 w-4 animate-spin" />
                          <span>{t('mss.vault.entschluessle')}</span>
                        </>
                      ) : (
                        <>
                          <Unlock className="h-4 w-4" />
                          <span>{t('mss.vault.entsperren')}</span>
                        </>
                      )}
                    </Button>

                    {isBiometricsEnabled && isBiometricsSupported && (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={async () => {
                          const isBusy = isTeam ? teamBusy : isUnlocking
                          if (isBusy) return
                          // Ein Fingerabdruck für beide: Erst die Karte per Biometrie
                          // auf, dann öffnet die Hülle den Team-Tresor.
                          const ok = isTeam && team
                            ? (await personalUnlockWithBiometrics()) && await teamUnlock(team.id)
                            : await personalUnlockWithBiometrics()
                          if (ok) {
                            toast.success(t('mss.vault.entsperrtBiometrie'))
                          }
                        }}
                        disabled={isTeam ? teamBusy : isUnlocking}
                        className="w-full flex items-center justify-center gap-2 py-2 text-xs border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"
                      >
                        <Fingerprint className="h-4 w-4" />
                        <span>{t('mss.vault.mitFingerabdruck')}</span>
                      </Button>
                    )}

                    {!isTeam && isAndroid && isDeviceAuthorized && (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => window.dispatchEvent(new Event('msm:open-wallet'))}
                        disabled={isUnlocking}
                        className="w-full flex items-center justify-center gap-2 py-2 text-xs border border-outline-variant/40 bg-surface-container-high/70 text-on-surface hover:border-primary/40 hover:text-primary"
                      >
                        <QrCode className="h-4 w-4 text-primary" />
                        <span>{t('mss.vault.walletModusOeffnen', 'Smartcard-Wallet öffnen')}</span>
                      </Button>
                    )}
                  </>
                )}

                {isTeam && teamNeedsSlot && (
                  <div className="w-full rounded-xl bg-primary/10 border border-primary/30 p-2.5 text-xs text-on-surface text-center">
                    {t('teams.vaultWartetAufFreischaltung')}
                  </div>
                )}

                {unlockError && (
                  <div className="w-full rounded-xl bg-status-destructive/15 border border-status-destructive/30 p-2.5 text-xs text-status-destructive text-center">
                    {unlockError}
                  </div>
                )}

                {/* Sekundäre Aktionen: Hinweis anfordern, Einrichten, Zurücksetzen */}
                <div className="flex flex-col items-center gap-1.5 pt-1">
                  {!isTeam && activeHasHint && (
                    <Button
                      fingerziel
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void onRequestHint()}
                      disabled={isRequestingHint}
                      className="text-on-surface-variant hover:text-primary text-xs"
                    >
                      <HelpCircle className="h-3.5 w-3.5 mr-1" />
                      <span>{isRequestingHint ? t('mss.vault.sendeMail') : t('mss.vault.hinweisPerMail')}</span>
                    </Button>
                  )}

                  {!isTeam && !isInitialized && (
                    <Button
                      fingerziel
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        onSetupModeChange(true)
                        setMasterPasswordInput('')
                      }}
                      className="text-on-surface-variant hover:text-primary text-xs"
                    >
                      {t('mss.vault.neuenTresorEinrichten')}
                    </Button>
                  )}

                  {isInitialized && isOwner && (
                    <Button
                      fingerziel
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setZuruecksetzen(true)
                        setMasterPasswordInput('')
                      }}
                      className="mt-1 border border-status-destructive/25 bg-status-destructive/10 text-xs text-status-destructive/90 backdrop-blur-md hover:border-status-destructive/45 hover:bg-status-destructive/15 hover:text-status-destructive"
                    >
                      <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                      {t('mss.vault.zuruecksetzen.link')}
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </TageszeitKulisse>
  )
}
