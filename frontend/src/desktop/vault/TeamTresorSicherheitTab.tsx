/**
 * Team-Tresor Sicherheitseinstellungen (MSS Desktop, Pontis & Profil).
 *
 * Konfiguration der automatischen Sperre, Sperre bei Fensterwechsel,
 * Leak-Prüfung und biometrischem Schnelleinstieg für jedes Team des Benutzers.
 */

import { useEffect, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Fingerprint, ShieldCheck, Users } from 'lucide-react'

import { teamsApi, type Team } from '@/api/teams'
import { sperrfristOptionen } from '@/services/autoSperre'
import { Button, Dialog, DialogContent, Dropdown, type DropdownOption, PasswordInput, Switch } from '@/Singra/UI'
import { toast } from '@/stores/toastStore'
import { useTeamVaultStore } from './teamVaultStore'
import { useShallow } from 'zustand/react/shallow'

export function TeamTresorSicherheitTab() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const [teams, setTeams] = useState<Team[]>([])
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null)
  const [loadingTeams, setLoadingTeams] = useState(true)

  const {
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

  // Teams laden
  useEffect(() => {
    let active = true
    setLoadingTeams(true)
    teamsApi
      .list()
      .then((rows) => {
        if (!active) return
        const echte = rows.filter((r) => !r.is_personal)
        setTeams(echte)
        if (echte.length > 0) {
          setSelectedTeamId(echte[0].id)
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingTeams(false)
      })
    return () => {
      active = false
    }
  }, [])

  // Sobald Team ausgewählt ist, Status und Biometrie laden
  useEffect(() => {
    if (selectedTeamId !== null) {
      void loadStatus(selectedTeamId)
      void checkBiometricsSupport(selectedTeamId)
    }
  }, [selectedTeamId, loadStatus, checkBiometricsSupport])

  const selectedTeam = useMemo(
    () => teams.find((item) => item.id === selectedTeamId) ?? null,
    [teams, selectedTeamId],
  )

  const teamOptions: DropdownOption[] = useMemo(
    () =>
      teams.map((item) => ({
        value: String(item.id),
        label: item.name,
      })),
    [teams],
  )

  const autoLockOptions: DropdownOption[] = sperrfristOptionen(t)

  const handleBiometricsToggle = async (checked: boolean) => {
    if (!selectedTeamId) return
    if (!checked) {
      await disableBiometrics(selectedTeamId)
      toast.success(t('mss.vault.biometrieAusToast'))
      return
    }
    setMasterPasswordInput('')
    setBiometricsModalOpen(true)
  }

  const handleConfirmBiometrics = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedTeamId || !masterPasswordInput) return
    setBiometricsLoading(true)
    try {
      const ok = await enableBiometrics(selectedTeamId, masterPasswordInput)
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

  if (loadingTeams) {
    return (
      <div className="msm-card p-5 text-sm text-on-surface-variant">
        {t('common.loading')}
      </div>
    )
  }

  if (teams.length === 0) {
    return (
      <div className="msm-card p-5 flex items-center gap-3 text-sm text-on-surface-variant">
        <Users className="h-5 w-5 shrink-0 text-outline" />
        <span>{t('teams.noTeams')}</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Team-Auswahl */}
      <div className="msm-card p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-on-surface">{t('teams.chooseTeam')}</h3>
              <p className="text-label-sm text-on-surface-variant">
                {selectedTeam ? selectedTeam.name : t('teams.selectUser')}
              </p>
            </div>
          </div>
          <div className="w-full sm:w-64">
            <Dropdown
              options={teamOptions}
              value={selectedTeamId ? String(selectedTeamId) : null}
              onChange={(val) => {
                if (val) setSelectedTeamId(Number(val))
              }}
              placeholder={t('teams.chooseTeam')}
            />
          </div>
        </div>
      </div>

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
            {selectedTeam && (
              <p className="text-label-sm text-on-surface-variant">{selectedTeam.name}</p>
            )}
          </div>
        </div>

        <div className="space-y-4 pt-2 border-t border-outline-variant/30">
          {!isInitialized ? (
            <div className="p-2.5 rounded-xl bg-surface-container-high border border-outline-variant/30 text-xs text-on-surface-variant">
              {t('teams.vaultNotSetup')}
            </div>
          ) : !isUnlocked ? (
            <div className="flex flex-col items-start gap-2 p-2.5 rounded-xl bg-surface-container-high border border-outline-variant/30 text-xs text-on-surface-variant sm:flex-row sm:items-center sm:gap-3">
              <span className="flex-1">{t('teams.vaultUnlockDesc')}</span>
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
                  if (selectedTeamId) setAutoLockMinutes(selectedTeamId, Number(val))
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
                if (selectedTeamId) setLockOnWindowBlur(selectedTeamId, val)
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
                if (selectedTeamId) setLeakCheckEnabled(selectedTeamId, an)
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
