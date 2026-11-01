import { useCallback, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Lock,
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
import { useVaultStore } from './vaultStore'
import {
  calculateCardExpiry,
  formatCardNumber,
  formatFingerprint,
  getCardStatus,
  type CardStatus,
} from './mauntingCard'

interface MauntingCardProps {
  className?: string
  onOpenSecurityTab?: () => void
}

/**
 * Maunting Card — Interaktive Smartcard-Komponente für die Zero-Knowledge-Identität.
 *
 * Rendert die KI-generierten Vorder- und Rückseiten-Texturen mit passgenauen
 * HTML/CSS-Overlays für Profilbild, Username, Status, Card-ID und Krypto-Aktionen.
 * Per Klick oder Tastatur (Leertaste/Enter) dreht sich die Karte geschmeidig um.
 */
export function MauntingCard({ className = '', onOpenSecurityTab }: MauntingCardProps) {
  const { t } = useTranslation()
  const { user } = useAuthStore()

  const {
    isInitialized,
    isUnlocked,
    unlockError,
    bucketId,
    unlock,
    lock,
    rotationState,
  } = useVaultStore()

  const [isFlipped, setIsFlipped] = useState(false)
  const [unlockDialogOpen, setUnlockDialogOpen] = useState(false)
  const [passwordInput, setPasswordInput] = useState('')
  const [submittingUnlock, setSubmittingUnlock] = useState(false)

  // Berechnete Karten-Attribute
  const cardNumber = useMemo(() => formatCardNumber(bucketId, user?.id ?? 1), [bucketId, user?.id])
  const fingerprint = useMemo(() => formatFingerprint(bucketId), [bucketId])

  const expiry = useMemo(() => {
    // Falls ein Registrierungsdatum existiert, sonst aktuelles Jahr
    return calculateCardExpiry(user?.created_at, 24)
  }, [user?.created_at])

  const status: CardStatus = useMemo(() => {
    return getCardStatus({
      isInitialized,
      isUnlocked,
      isExpired: expiry.isExpired,
      needsRotation: rotationState === 'prepared',
    })
  }, [isInitialized, isUnlocked, expiry.isExpired, rotationState])

  const handleFlip = useCallback(() => {
    setIsFlipped((prev) => !prev)
  }, [])

  const handleUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!passwordInput.trim() || submittingUnlock) return

    setSubmittingUnlock(true)
    try {
      const success = await unlock(passwordInput)
      if (success) {
        toast.success(t('mss.vault.entsperrtErfolg', 'Maunting Card erfolgreich entsperrt'))
        setPasswordInput('')
        setUnlockDialogOpen(false)
      } else {
        toast.error(unlockError || t('mss.vault.falschesPasswort', 'Falsche PIN / Falsches Passwort'))
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
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm backdrop-blur-md">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {t('mss.card.statusActive', 'AKTIV')}
          </span>
        )
      case 'rotation_due':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm backdrop-blur-md">
            <AlertTriangle className="w-3 h-3 text-amber-400" />
            {t('mss.card.statusRotation', 'ERNEUERUNG FÄLLIG')}
          </span>
        )
      case 'locked':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-sky-500/20 text-sky-300 border border-sky-500/40 shadow-sm backdrop-blur-md">
            <Lock className="w-3 h-3 text-sky-400" />
            {t('mss.card.statusLocked', 'GESPERRT')}
          </span>
        )
      case 'uninitialized':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-500/20 text-slate-300 border border-slate-500/40 shadow-sm backdrop-blur-md">
            <KeyRound className="w-3 h-3 text-slate-400" />
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
            <div className="absolute bottom-4 right-12 font-mono text-[10px] sm:text-xs text-sky-300/90 tracking-widest drop-shadow-sm">
              <span className="text-sky-400/60 mr-1.5 font-sans font-medium text-[9px]">VALID THRU</span>
              {expiry.validThru}
            </div>

            {/* Flip-Icon unten rechts */}
            <div
              className="absolute bottom-3 right-3 p-1.5 rounded-full bg-black/40 text-sky-300 hover:text-white hover:bg-black/60 transition-colors backdrop-blur-sm"
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

            {/* Mittlere Metallic-Pill — Card Number und Fingerprint zentriert */}
            <div
              className="absolute flex flex-col justify-center items-center px-2 text-center pointer-events-none"
              style={{
                left: '51.50%',
                top: '45.00%',
                transform: 'translate(-50%, -50%)',
                width: '50.0%',
                height: '13.5%',
              }}
            >
              <span className="font-mono text-xs sm:text-sm md:text-base font-bold tracking-widest text-slate-950 drop-shadow-[0_1px_2px_rgba(255,255,255,0.7)] leading-tight">
                {cardNumber}
              </span>
              <span className="font-mono text-[9px] sm:text-[10px] md:text-xs font-semibold text-slate-800 tracking-wider truncate max-w-full drop-shadow-sm">
                FP: {fingerprint}
              </span>
            </div>

            {/* Aktionen auf der Rückseite */}
            <div
              className="absolute bottom-5 inset-x-6 flex items-center justify-center gap-2 z-10"
              onClick={(e) => e.stopPropagation()}
            >
              {!isUnlocked ? (
                <button
                  type="button"
                  className="bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold shadow-lg shadow-sky-500/30 flex items-center gap-1.5 text-xs py-1.5 px-3.5 rounded-lg transition-colors"
                  onClick={() => setUnlockDialogOpen(true)}
                >
                  <Unlock className="w-3.5 h-3.5" aria-hidden="true" />
                  {t('mss.card.actionUnlock', 'PIN eingeben')}
                </button>
              ) : (
                <button
                  type="button"
                  className="bg-slate-900/80 hover:bg-slate-800 text-sky-200 border border-sky-500/30 flex items-center gap-1.5 text-xs py-1.5 px-3.5 rounded-lg transition-colors"
                  onClick={handleQuickLock}
                >
                  <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                  {t('mss.card.actionLock', 'Sperren')}
                </button>
              )}

              {onOpenSecurityTab && (
                <button
                  type="button"
                  className="text-sky-300 hover:text-white hover:bg-sky-950/40 flex items-center gap-1 text-xs py-1.5 px-3 rounded-lg transition-colors"
                  onClick={onOpenSecurityTab}
                >
                  <Shield className="w-3.5 h-3.5" aria-hidden="true" />
                  {t('mss.card.actionManage', 'Verwalten')}
                </button>
              )}
            </div>

            {/* Flip-Icon unten rechts */}
            <div
              className="absolute bottom-3 right-3 p-1.5 rounded-full bg-black/40 text-sky-300 hover:text-white hover:bg-black/60 transition-colors backdrop-blur-sm"
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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-primary" aria-hidden="true" />
              {t('mss.card.unlockTitle', 'Maunting Card entsperren')}
            </DialogTitle>
            <DialogDescription>
              {t(
                'mss.card.unlockSubtitle',
                'Gib deine Karten-PIN / dein Passwort ein, um deinen Tresor freizuschalten.'
              )}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleUnlockSubmit} className="p-6 space-y-4">
            <PasswordInput
              id="card-unlock-password"
              label={t('mss.card.pinLabel', 'Karten-Passwort / PIN')}
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              placeholder={t('mss.card.pinPlaceholder', 'Karten-Passwort / PIN')}
              autoFocus
              disabled={submittingUnlock}
              required
            />

            <DialogFooter variant="plain" className="px-0 pb-0 mt-6">
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
        </DialogContent>
      </Dialog>
    </div>
  )
}
