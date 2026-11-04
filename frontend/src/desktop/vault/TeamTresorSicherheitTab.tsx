/**
 * Team-Tresor Sicherheitseinstellungen (MSS Desktop, Pontis & Profil).
 *
 * Konfiguration der automatischen Sperre, Sperre bei Fensterwechsel,
 * Leak-Prüfung und biometrischem Schnelleinstieg für den aktiven Team-Tresor.
 *
 * Bis 11/2026 wählte man hier erst ein Team aus einer Liste (`teamsApi.list`).
 * Die Auswahl ist entfallen: die Sektion gilt für den Team-Tresor, dessen
 * Status der Store gerade hält (`teamVaultStore.teamId`, gesetzt beim Öffnen
 * eines Team-Tresors). Die Ablage bleibt je Team (`mss_team_vault_*_<teamId>`).
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Fingerprint, ShieldCheck, Users } from 'lucide-react'

import { sperrfristOptionen } from '@/services/autoSperre'
import { Button, Dialog, DialogContent, Dropdown, type DropdownOption, PasswordInput, Switch } from '@/Singra/UI'
import { toast } from '@/stores/toastStore'
import { useTeamVaultStore } from './teamVaultStore'
import { useShallow } from 'zustand/react/shallow'

export function TeamTresorSicherheitTab() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const {
    teamId,
    isInitialized,
    isUnlocked,
    autoLockMinutes,
    lockOnWindowBlur,
    leakCheckEnabled,
    isBiometricsSupported,
    isBiometricsEnabled,
    loadStatus,
    setAutoLockMinutes,
    setLockOnWindowBlur,
    setLeakCheckEnabled,
    checkBiometricsSupport,
    enableBiometrics,
    disableBiometrics,
  } = useTeamVaultStore(
    useShallow((s) => ({
      teamId: s.teamId,
      isInitialized: s.isInitialized,
      isUnlocked: s.isUnlocked,
      autoLockMinutes: s.autoLockMinutes,
      lockOnWindowBlur: s.lockOnWindowBlur,
      leakCheckEnabled: s.leakCheckEnabled,
      isBiometricsSupported: s.isBiometricsSupported,
      isBiometricsEnabled: s.isBiometricsEnabled,
      loadStatus: s.loadStatus,
      setAutoLockMinutes: s.setAutoLockMinutes,
      setLockOnWindowBlur: s.setLockOnWindowBlur,
      setLeakCheckEnabled: s.setLeakCheckEnabled,
      checkBiometricsSupport: s.checkBiometricsSupport,
      enableBiometrics: s.enableBiometrics,
      disableBiometrics: s.disableBiometrics,
    })),
  )

  const [biometricsModalOpen, setBiometricsModalOpen] = useState(false)
  const [masterPasswordInput, setMasterPasswordInput] = useState('')
  const [biometricsLoading, setBiometricsLoading] = useState(false)

  // Status und Biometrie für den aktiven Team-Tresor laden
  useEffect(() => {
    if (teamId !== null) {
      void loadStatus(teamId)
      void checkBiometricsSupport(teamId)
    }
  }, [teamId, loadStatus, checkBiometricsSupport])

  const autoLockOptions: DropdownOption[] = sperrfristOptionen(t)

  const handleBiometricsToggle = async (checked: boolean) => {
    if (teamId === null) return
    if (!checked) {
      await disableBiometrics(teamId)
      toast.success(t('mss.vault.biometrieAusToast'))
      return
    }
    setMasterPasswordInput('')
    setBiometricsModalOpen(true)
  }

  const handleConfirmBiometrics = async (e: React.FormEvent) => {
    e.preventDefault()
    if (teamId === null || !masterPasswordInput) return
    setBiometricsLoading(true)
    try {
      const ok = await enableBiometrics(teamId, masterPasswordInput)
      if (ok) {
        toast.success(t('mss.vault.biometrieAn'))
        setBiometricsModalOpen(false)
        setMasterPasswordInput('')
      } else {
        toast.error(t('mss.vault.biometrieFehler'))
      }
    } catch {
      toast.error(t('mss.vault.biometrieFehler'))
    } finally {
      setBiometricsLoading(false)
    }
  }

  if (teamId === null) {
    return (
      <div className="msm-card p-5 flex flex-col items-start gap-3 text-sm text-on-surface-variant sm:flex-row sm:items-center">
        <div className="flex items-center gap-3 flex-1">
          <Users className="h-5 w-5 shrink-0 text-outline" />
          <span>{t('teams.vaultSecurityNeedsTeam')}</span>
        </div>
        <Button
          variant="secondary"
          size="sm"
          type="button"
          onClick={() => navigate('/teams')}
        >
          {t('teams.vaultUnlock')}
        </Button>
      </div>
    )
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
            <h3 className="text-sm font-semibold text-on-surface">
              {t('teams.vault')} – {t('mss.vault.titel')}
            </h3>
          </div>
        </div>

        <div className="space-y-4 pt-2 border-t border-outline-variant/30">
          {!isInitialized ? (
            <div className="p-2.5 rounded-xl bg-surface-container-high border border-outline-variant/30 text-xs text-on-surface-variant">
              {t('teams.vaultNotSetup')}
            </div>
          ) : !isUnlocked ? (
            <div className="flex flex-col items-start gap-2 p-2.5 rounded-xl bg-surface-container-high border border-outline-variant/30 text-xs text-on-surface-variant sm:flex-row sm:items-center sm:gap-3">
              {/* Kein Passwortfeld hier: entsperrt wird unter Teams, die Eingabe steht auf der Karte. */}
              <span className="flex-1">{t('teams.vaultSecurityNeedsTeam')}</span>
              <Button
                variant="secondary"
                size="sm"
                type="button"
                onClick={() => navigate('/teams')}
              >
                {t('teams.vaultUnlock')}
              </Button>
            </div>
          ) : null}

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <label className="text-xs font-medium text-on-surface">{t('mss.vault.autoSperre')}</label>
            </div>
            <div className="w-full sm:w-56">
              <Dropdown
                options={autoLockOptions}
                value={String(autoLockMinutes)}
                onChange={(val) => {
                  if (val) setAutoLockMinutes(teamId, Number(val))
                }}
                disabled={!isInitialized}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 pt-2 border-t border-outline-variant/20">
            <div>
              <span id="team-tresor-fensterwechsel" className="text-xs font-medium text-on-surface">
                {t('mss.vault.beiFensterwechsel')}
              </span>
              <p className="text-label-sm text-on-surface-variant">
                {t('mss.vault.beiFensterwechselHinweis')}
              </p>
            </div>
            <Switch
              aria-labelledby="team-tresor-fensterwechsel"
              checked={lockOnWindowBlur}
              onCheckedChange={(val) => {
                setLockOnWindowBlur(teamId, val)
              }}
              disabled={!isInitialized}
            />
          </div>

          <div className="flex items-center justify-between gap-4 pt-2 border-t border-outline-variant/20">
            <div>
              <span id="team-tresor-leckpruefung" className="text-xs font-medium text-on-surface">
                {t('mss.vault.leckPruefung')}
              </span>
              <p className="text-label-sm text-on-surface-variant">{t('mss.vault.leckPruefungHinweis')}</p>
            </div>
            <Switch
              aria-labelledby="team-tresor-leckpruefung"
              checked={leakCheckEnabled}
              onCheckedChange={(an) => {
                setLeakCheckEnabled(teamId, an)
              }}
              disabled={!isInitialized}
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
            <h3 className="text-sm font-semibold text-on-surface">{t('mss.vault.biometrieTitel')}</h3>
          </div>
        </div>

        <div className="pt-2 border-t border-outline-variant/30 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <span id="team-tresor-biometrie" className="text-xs font-medium text-on-surface">
                {t('mss.vault.biometrieSchalter')}
              </span>
              <p className="text-label-sm text-on-surface-variant">
                {t('mss.vault.biometrieHinweis')}
              </p>
            </div>
            <Switch
              aria-labelledby="team-tresor-biometrie"
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
          aria-labelledby="team-biometrie-einrichten-titel"
          aria-describedby="team-biometrie-einrichten-beschr"
        >
          <div className="flex items-center gap-3 pr-8">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Fingerprint className="h-4 w-4" />
            </div>
            <h3 id="team-biometrie-einrichten-titel" className="text-sm font-semibold text-on-surface">
              {t('mss.vault.biometrieEinrichten')}
            </h3>
          </div>
          <p id="team-biometrie-einrichten-beschr" className="text-xs text-on-surface-variant">
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
              <Button type="submit" disabled={biometricsLoading || !masterPasswordInput}>
                {biometricsLoading ? t('mss.vault.biometriePruefe') : t('mss.vault.biometrieAktivieren')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
