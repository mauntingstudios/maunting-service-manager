import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Lock,
  QrCode,
  RefreshCw,
  RotateCw,
  Shield,
  Unlock,
} from 'lucide-react'

import {
  Avatar,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  PasswordInput,
} from '@/Singra/UI'
import { useAuthStore } from '@/stores/authStore'
import { toast } from '@/stores/toastStore'
import type { User } from '@/types'
import { useVaultStore } from './vaultStore'
import { DeviceAuthQrView } from './DeviceAuthQrView'
import {
  calculateCardExpiry,
  formatCardNumber,
  getCardStatus,
  type CardStatus,
} from './mauntingCard'

interface MauntingCardProps {
  className?: string
  /**
   * Zeigt ein anderes Konto als das angemeldete. Direkt nach der Namenswahl
   * steht der neue Name noch nicht im Sitzungsspeicher — die Karte soll ihn
   * aber schon tragen.
   */
  userOverride?: User | null
  onOpenSecurityTab?: () => void
  unlockOverride?: (password: string) => Promise<boolean>
  onUnlockSuccess?: () => void
  onAuthorizeSuccess?: () => void
  externalUnlockTrigger?: boolean
  externalAuthorizeTrigger?: boolean
  onExternalUnlockHandled?: () => void
  onExternalAuthorizeHandled?: () => void
}

/**
 * Maunting Card — Interaktive Smartcard-Komponente für die Zero-Knowledge-Identität.
 *
 * Rendert die KI-generierten Vorder- und Rückseiten-Texturen mit passgenauen
 * HTML/CSS-Overlays für Profilbild, Username, Status, Card-ID und Krypto-Aktionen.
 * Per Klick oder Tastatur (Leertaste/Enter) dreht sich die Karte geschmeidig um.
 */
export function MauntingCard({
  className = '',
  userOverride,
  onOpenSecurityTab,
  unlockOverride,
  onUnlockSuccess,
  onAuthorizeSuccess,
  externalUnlockTrigger,
  externalAuthorizeTrigger,
  onExternalUnlockHandled,
  onExternalAuthorizeHandled,
}: MauntingCardProps) {
  const { t } = useTranslation()
  const { user: angemeldetesKonto } = useAuthStore()
  const user = userOverride ?? angemeldetesKonto

  const {
    isInitialized,
    isUnlocked,
    isDeviceAuthorized,
    unlockError,
    bucketId,
    unlock,
    authorizeDevice,
    lock,
    rotationState,
  } = useVaultStore()

  const [isFlipped, setIsFlipped] = useState(false)
  const [unlockDialogOpen, setUnlockDialogOpen] = useState(false)
  const [unlockTab, setUnlockTab] = useState<'qr' | 'password'>('qr')
  const [passwordInput, setPasswordInput] = useState('')
  const [submittingUnlock, setSubmittingUnlock] = useState(false)

  const [authorizeDialogOpen, setAuthorizeDialogOpen] = useState(false)
  const [authorizeTab, setAuthorizeTab] = useState<'qr' | 'password'>('qr')
  const [authorizePasswordInput, setAuthorizePasswordInput] = useState('')
  const [submittingAuthorize, setSubmittingAuthorize] = useState(false)

  const handleDeviceAuthQrSuccess = useCallback(
    (payload: Record<string, unknown>) => {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('msm_vault_device_authorized', 'true')
        localStorage.setItem('msm_vault_setup_done', 'true')
        if (typeof payload.bucketId === 'string' && payload.bucketId) {
          localStorage.setItem('msm_vault_server_bucket', payload.bucketId)
        }
      }
      useVaultStore.setState((prev) => ({
        ...prev,
        isDeviceAuthorized: true,
        bucketId: typeof payload.bucketId === 'string' && payload.bucketId ? payload.bucketId : prev.bucketId,
        failedUnlockAttempts: 0,
        unlockError: null,
      }))
      toast.success(t('mss.card.authorizedErfolg', 'Gerät via Smartcard-Wallet erfolgreich autorisiert'))
      setAuthorizeDialogOpen(false)
      onAuthorizeSuccess?.()
    },
    [t, onAuthorizeSuccess],
  )

  const handleUnlockQrSuccess = useCallback(
    () => {
      useVaultStore.setState((prev) => ({
        ...prev,
        isUnlocked: true,
        failedUnlockAttempts: 0,
        unlockError: null,
      }))
      toast.success(t('mss.vault.entsperrtErfolg', 'Maunting Card via Smartcard-Wallet erfolgreich entsperrt'))
      setUnlockDialogOpen(false)
      onUnlockSuccess?.()
    },
    [t, onUnlockSuccess],
  )

  useEffect(() => {
    if (externalUnlockTrigger) {
      setUnlockDialogOpen(true)
      onExternalUnlockHandled?.()
    }
  }, [externalUnlockTrigger, onExternalUnlockHandled])

  useEffect(() => {
    if (externalAuthorizeTrigger) {
      setAuthorizeDialogOpen(true)
      onExternalAuthorizeHandled?.()
    }
  }, [externalAuthorizeTrigger, onExternalAuthorizeHandled])

  // Berechnete Karten-Attribute
  const cardNumber = useMemo(() => formatCardNumber(bucketId, user?.id ?? 1), [bucketId, user?.id])

  const expiry = useMemo(() => {
    // Falls ein Registrierungsdatum existiert, sonst aktuelles Jahr
    return calculateCardExpiry(user?.created_at, 24)
  }, [user?.created_at])

  const status: CardStatus = useMemo(() => {
    return getCardStatus({
      isInitialized,
      isUnlocked,
      isDeviceAuthorized,
      isExpired: expiry.isExpired,
      needsRotation: rotationState === 'prepared',
    })
  }, [isInitialized, isUnlocked, isDeviceAuthorized, expiry.isExpired, rotationState])

  const handleFlip = useCallback(() => {
    setIsFlipped((prev) => !prev)
  }, [])

  const handleAuthorizeSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!authorizePasswordInput.trim() || submittingAuthorize) return

    setSubmittingAuthorize(true)
    try {
      const success = await authorizeDevice(authorizePasswordInput)
      if (success) {
        toast.success(t('mss.card.authorizedErfolg', 'Gerät erfolgreich autorisiert'))
        setAuthorizePasswordInput('')
        setAuthorizeDialogOpen(false)
        onAuthorizeSuccess?.()
      } else {
        toast.error(unlockError || t('mss.vault.falschesPasswort', 'Falsches Karten-Passwort'))
      }
    } finally {
      setSubmittingAuthorize(false)
    }
  }

  const handleUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!passwordInput.trim() || submittingUnlock) return

    setSubmittingUnlock(true)
    try {
      const success = unlockOverride ? await unlockOverride(passwordInput) : await unlock(passwordInput)
      if (success) {
        toast.success(t('mss.vault.entsperrtErfolg', 'Maunting Card erfolgreich entsperrt'))
        setPasswordInput('')
        setUnlockDialogOpen(false)
        onUnlockSuccess?.()
      } else {
        toast.error(unlockError || t('mss.vault.falschesPasswort', 'Falsches Karten-Passwort'))
      }
    } finally {
      setSubmittingUnlock(false)
    }
  }

  const handleQuickLock = () => {
    lock()
    toast.info(t('mss.vault.gesperrt', 'Maunting Card gesperrt'))
  }

  const statusBadge = useMemo(() => {
    switch (status) {
      case 'active':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-status-success/20 text-status-success border border-status-success/40 shadow-sm backdrop-blur-md">
            <span className="w-1.5 h-1.5 rounded-full bg-status-success animate-pulse" />
            {t('mss.card.statusActive', 'AKTIV')}
          </span>
        )
      case 'rotation_due':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-status-warning/20 text-status-warning border border-status-warning/40 shadow-sm backdrop-blur-md">
            <AlertTriangle className="w-3 h-3 text-status-warning" />
            {t('mss.card.statusRotation', 'ERNEUERUNG FÄLLIG')}
          </span>
        )
      case 'unauthorized':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-status-warning/20 text-status-warning border border-status-warning/40 shadow-sm backdrop-blur-md">
            <AlertTriangle className="w-3 h-3 text-status-warning" />
            {t('mss.card.statusUnauthorized', 'GERÄT NICHT AUTORISIERT')}
          </span>
        )
      case 'locked':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-primary/20 text-primary border border-primary/40 shadow-sm backdrop-blur-md">
            <Lock className="w-3 h-3 text-primary" />
            {t('mss.card.statusLocked', 'GESPERRT')}
          </span>
        )
      case 'uninitialized':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-surface-container-high/60 text-on-surface-variant border border-outline-variant/40 shadow-sm backdrop-blur-md">
            <KeyRound className="w-3 h-3 text-on-surface-variant" />
            {t('mss.card.statusUninitialized', 'NICHT EINGERICHTET')}
          </span>
        )
    }
  }, [status, t])

  const flipHintId = useId()

  return (
    <div className={`flex flex-col items-center select-none ${className}`}>
      {/* 3D-Karten-Container */}
      <div
        className="relative w-full max-w-[560px] sm:max-w-[620px] aspect-[5/3] cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-2xl"
        style={{ perspective: '1200px' }}
        tabIndex={0}
        role="button"
        aria-label={t('mss.card.flipAria', 'Maunting Card umdrehen')}
        aria-describedby={flipHintId}
        onClick={handleFlip}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            handleFlip()
          }
        }}
      >
        <div
          className="relative w-full h-full transition-transform duration-700 ease-out transform-gpu"
          style={{
            transformStyle: 'preserve-3d',
            transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
          }}
        >
          {/* ════════════════════════ VORDERSEITE ════════════════════════ */}
          <div
            className="absolute inset-0 w-full h-full filter drop-shadow-[0_12px_24px_rgba(0,0,0,0.55)]"
            style={{ backfaceVisibility: 'hidden' }}
          >
            {/* Hintergrundbild Vorderseite */}
            <img
              src="/cards/maunting-card-front.png"
              alt="Maunting Card Front"
              className="w-full h-full object-cover pointer-events-none rounded-2xl"
              draggable={false}
            />

            {/* Avatar in der Neon-Box — mathematisch zentriert */}
            <div
              className="absolute aspect-square flex items-center justify-center pointer-events-none"
              style={{
                left: '14.98%',
                top: '45.96%',
                transform: 'translate(-50%, -50%)',
                width: '17.5%',
              }}
            >
              <Avatar
                src={user?.avatar_url}
                name={user?.username}
                size="2xl"
                className="!w-full !h-full rounded-2xl shadow-inner [&>div]:rounded-2xl"
              />
            </div>

            {/* Username in der Neon-Pill — zentriert */}
            <div
              className="absolute flex items-center justify-center px-2 text-center pointer-events-none"
              style={{
                left: '24.75%',
                top: '70.00%',
                transform: 'translate(-50%, -50%)',
                width: '39.0%',
                height: '8.5%',
              }}
            >
              <span className="font-sans text-xs sm:text-sm md:text-base font-bold tracking-wider text-white truncate drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">
                {user?.username?.toUpperCase() || 'MAUNTING USER'}
              </span>
            </div>

            {/* Status-Badge oben rechts */}
            <div className="absolute top-4 right-4 z-10">{statusBadge}</div>

            {/* Ablaufdatum neben dem Chip */}
            <div className="absolute bottom-4 right-12 font-mono text-label-sm font-mono text-primary/90 tracking-widest drop-shadow-sm">
              <span className="text-primary/60 mr-1.5 font-sans font-medium text-label-sm">VALID THRU</span>
              {expiry.validThru}
            </div>

            {/* Flip-Icon unten rechts */}
            <div
              className="absolute bottom-3 right-3 p-1.5 rounded-full bg-black/40 text-primary hover:text-white hover:bg-black/60 transition-colors backdrop-blur-sm"
              aria-hidden="true"
            >
              <RotateCw className="w-3.5 h-3.5" aria-hidden="true" />
            </div>
          </div>

          {/* ════════════════════════ RÜCKSEITE ════════════════════════ */}
          <div
            className="absolute inset-0 w-full h-full filter drop-shadow-[0_12px_24px_rgba(0,0,0,0.55)]"
            style={{
              backfaceVisibility: 'hidden',
              transform: 'rotateY(180deg)',
            }}
          >
            {/* Hintergrundbild Rückseite */}
            <img
              src="/cards/maunting-card-back.png"
              alt="Maunting Card Back"
              className="w-full h-full object-cover pointer-events-none rounded-2xl"
              draggable={false}
            />

            {/* Mittlere Metallic-Pill — Card Number exakt zentriert und ausgemessen */}
            <div
              className="absolute flex items-center justify-center text-center pointer-events-none px-4"
              style={{
                left: '51.55%',
                top: '45.00%',
                transform: 'translate(-50%, -50%)',
                width: '52.5%',
                height: '14.5%',
              }}
            >
              <span className="font-mono text-xs sm:text-[13px] md:text-[14px] font-bold tracking-normal sm:tracking-wide text-black drop-shadow-[0_1px_2px_rgba(255,255,255,0.7)] leading-none whitespace-nowrap select-all">
                {cardNumber}
              </span>
            </div>

            {/* Aktionen auf der Rückseite */}
            <div
              className="absolute bottom-5 inset-x-6 flex items-center justify-center gap-2 z-10"
              onClick={(e) => e.stopPropagation()}
            >
              {status === 'unauthorized' ? (
                <button
                  type="button"
                  className="bg-status-warning hover:bg-status-warning/90 text-black font-semibold shadow-lg flex items-center gap-1.5 text-xs py-1.5 px-3.5 rounded-lg transition-colors"
                  onClick={() => setAuthorizeDialogOpen(true)}
                >
                  <Shield className="w-3.5 h-3.5" aria-hidden="true" />
                  {t('mss.card.actionAuthorize', 'Gerät autorisieren')}
                </button>
              ) : !isUnlocked ? (
                <button
                  type="button"
                  className="bg-primary hover:bg-primary/90 text-on-primary font-semibold shadow-lg flex items-center gap-1.5 text-xs py-1.5 px-3.5 rounded-lg transition-colors"
                  onClick={() => {
                    setUnlockTab('password')
                    setUnlockDialogOpen(true)
                  }}
                >
                  <Unlock className="w-3.5 h-3.5" aria-hidden="true" />
                  {t('mss.card.actionUnlock', 'Karte entsperren')}
                </button>
              ) : (
                <button
                  type="button"
                  className="bg-surface-container-high/90 hover:bg-surface-container-highest text-primary border border-primary/30 flex items-center gap-1.5 text-xs py-1.5 px-3.5 rounded-lg transition-colors"
                  onClick={handleQuickLock}
                >
                  <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                  {t('mss.card.actionLock', 'Sperren')}
                </button>
              )}

              {onOpenSecurityTab && (
                <button
                  type="button"
                  className="text-primary hover:text-on-surface hover:bg-surface-container-high/60 flex items-center gap-1 text-xs py-1.5 px-3 rounded-lg transition-colors"
                  onClick={onOpenSecurityTab}
                >
                  <Shield className="w-3.5 h-3.5" aria-hidden="true" />
                  {t('mss.card.actionManage', 'Verwalten')}
                </button>
              )}
            </div>

            {/* Flip-Icon unten rechts */}
            <div
              className="absolute bottom-3 right-3 p-1.5 rounded-full bg-black/40 text-primary hover:text-white hover:bg-black/60 transition-colors backdrop-blur-sm"
              aria-hidden="true"
            >
              <RotateCw className="w-3.5 h-3.5" aria-hidden="true" />
            </div>
          </div>
        </div>
      </div>

      <p id={flipHintId} className="text-xs text-on-surface-variant/60 mt-2 text-center">
        {t('mss.card.clickToFlip', 'Klicken zum Umdrehen • Authentifiziert mit Argon2id & DIS')}
      </p>

      {/* ════════════════════════ ENTSPERR-MODAL (Design DNA) ════════════════════════ */}
      <Dialog open={unlockDialogOpen} onOpenChange={setUnlockDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader className="pr-10 sm:pr-12">
            <DialogTitle className="flex items-center gap-2.5 text-base sm:text-lg font-bold">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary border border-primary/25">
                <KeyRound className="w-4 h-4" aria-hidden="true" />
              </span>
              <span>{t('mss.card.unlockTitle', 'Smartcard entsperren')}</span>
            </DialogTitle>
            <DialogDescription className="mt-1.5 text-xs text-on-surface-variant leading-relaxed">
              {t(
                'mss.card.unlockSubtitle',
                'Scanne den Code mit deinem Smartphone oder gib dein persönliches Karten-Passwort ein.'
              )}
            </DialogDescription>
          </DialogHeader>

          {/* Reiter-Auswahl: Segmented Control Pill */}
          <div className="px-6 pt-5">
            <div className="flex p-1 rounded-xl bg-surface-container-high/60 border border-outline-variant/25 gap-1">
              <button
                type="button"
                onClick={() => setUnlockTab('qr')}
                className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                  unlockTab === 'qr'
                    ? 'bg-surface text-primary shadow-sm font-bold border border-outline-variant/20'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                <QrCode className="w-3.5 h-3.5" />
                <span>{t('mss.card.tabSmartphoneScan', 'Mit Smartphone scannen')}</span>
              </button>
              <button
                type="button"
                onClick={() => setUnlockTab('password')}
                className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                  unlockTab === 'password'
                    ? 'bg-surface text-primary shadow-sm font-bold border border-outline-variant/20'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>{t('mss.card.tabPassword', 'Karten-Passwort')}</span>
              </button>
            </div>
          </div>

          {unlockTab === 'qr' ? (
            <div className="px-6 py-5 space-y-4">
              <DeviceAuthQrView
                purpose="unlock"
                onSuccess={handleUnlockQrSuccess}
              />
              <DialogFooter variant="plain" className="px-0 pb-0 pt-1 flex justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setUnlockDialogOpen(false)}
                >
                  {t('common.cancel', 'Abbrechen')}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={handleUnlockSubmit} className="px-6 py-5 space-y-4">
              <div className="space-y-1.5">
                <PasswordInput
                  id="card-unlock-password"
                  label={t('mss.card.passwordLabel', 'Karten-Passwort')}
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder={t('mss.card.passwordPlaceholder', 'Dein bei der Einrichtung gewähltes Passwort')}
                  autoFocus
                  disabled={submittingUnlock}
                  required
                />
                <p className="text-xs text-on-surface-variant/75 pl-0.5">
                  {t(
                    'mss.card.passwordHelp',
                    'Das persönliche Passwort, das du bei der Erstellung deiner Smartcard (Master-Passwort) vergeben hast.'
                  )}
                </p>
              </div>

              <DialogFooter variant="plain" className="px-0 pb-0 pt-2 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setUnlockDialogOpen(false)}
                  disabled={submittingUnlock}
                >
                  {t('common.cancel', 'Abbrechen')}
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={submittingUnlock || !passwordInput.trim()}
                >
                  {submittingUnlock ? (
                    <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                  )}
                  {t('mss.card.unlockSubmit', 'Entsperren')}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
      {/* ════════════════════════ AUTORISIERUNGS-MODAL (Design DNA) ════════════════════════ */}
      <Dialog open={authorizeDialogOpen} onOpenChange={setAuthorizeDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader className="pr-10 sm:pr-12">
            <DialogTitle className="flex items-center gap-2.5 text-base sm:text-lg font-bold">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-status-warning/15 text-status-warning border border-status-warning/25">
                <Shield className="w-4 h-4" aria-hidden="true" />
              </span>
              <span>{t('mss.card.authorizeTitle', 'Gerät autorisieren')}</span>
            </DialogTitle>
            <DialogDescription className="mt-1.5 text-xs text-on-surface-variant leading-relaxed">
              {t(
                'mss.card.authorizeSubtitle',
                'Bestätige deine Identität, um dieses Gerät für deine Smartcard freizuschalten. Schlüssel verbleiben dabei nicht im Arbeitsspeicher.'
              )}
            </DialogDescription>
          </DialogHeader>

          {/* Reiter-Auswahl: Segmented Control Pill */}
          <div className="px-6 pt-5">
            <div className="flex p-1 rounded-xl bg-surface-container-high/60 border border-outline-variant/25 gap-1">
              <button
                type="button"
                onClick={() => setAuthorizeTab('qr')}
                className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                  authorizeTab === 'qr'
                    ? 'bg-surface text-primary shadow-sm font-bold border border-outline-variant/20'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                <QrCode className="w-3.5 h-3.5" />
                <span>{t('mss.card.tabSmartphoneScan', 'Mit Smartphone scannen')}</span>
              </button>
              <button
                type="button"
                onClick={() => setAuthorizeTab('password')}
                className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                  authorizeTab === 'password'
                    ? 'bg-surface text-primary shadow-sm font-bold border border-outline-variant/20'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>{t('mss.card.tabPassword', 'Karten-Passwort')}</span>
              </button>
            </div>
          </div>

          {authorizeTab === 'qr' ? (
            <div className="px-6 py-5 space-y-4">
              <DeviceAuthQrView
                purpose="authorize"
                onSuccess={handleDeviceAuthQrSuccess}
              />
              <DialogFooter variant="plain" className="px-0 pb-0 pt-1 flex justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setAuthorizeDialogOpen(false)}
                >
                  {t('common.cancel', 'Abbrechen')}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={handleAuthorizeSubmit} className="px-6 py-5 space-y-4">
              <div className="space-y-1.5">
                <PasswordInput
                  id="card-authorize-password"
                  label={t('mss.card.passwordLabel', 'Karten-Passwort')}
                  value={authorizePasswordInput}
                  onChange={(e) => setAuthorizePasswordInput(e.target.value)}
                  placeholder={t('mss.card.passwordPlaceholder', 'Dein bei der Einrichtung gewähltes Passwort')}
                  autoFocus
                  disabled={submittingAuthorize}
                  required
                />
                <p className="text-xs text-on-surface-variant/75 pl-0.5">
                  {t(
                    'mss.card.passwordHelp',
                    'Das persönliche Passwort, das du bei der Erstellung deiner Smartcard (Master-Passwort) vergeben hast.'
                  )}
                </p>
              </div>

              <DialogFooter variant="plain" className="px-0 pb-0 pt-2 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setAuthorizeDialogOpen(false)}
                  disabled={submittingAuthorize}
                >
                  {t('common.cancel', 'Abbrechen')}
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={submittingAuthorize || !authorizePasswordInput.trim()}
                >
                  {submittingAuthorize ? (
                    <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                  )}
                  {t('mss.card.authorizeSubmit', 'Gerät freischalten')}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
