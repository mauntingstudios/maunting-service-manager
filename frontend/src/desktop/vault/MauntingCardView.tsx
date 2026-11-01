import { useCallback, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  KeyRound,
  Lock,
  RefreshCw,
  RotateCw,
  Shield,
  Unlock,
} from 'lucide-react'

import { Avatar, Button, Dialog, DialogContent, PasswordInput } from '@/Singra/UI'
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
    isUnlocking,
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
        className="relative w-full max-w-[460px] aspect-[1024/644] cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-2xl"
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
            className="absolute inset-0 w-full h-full rounded-2xl overflow-hidden shadow-2xl border border-sky-500/30"
            style={{ backfaceVisibility: 'hidden' }}
          >
            {/* Hintergrundbild Vorderseite */}
            <img
              src="/cards/maunting-card-front.jpg"
              alt="Maunting Card Front"
              className="w-full h-full object-cover pointer-events-none"
              draggable={false}
            />

            {/* Avatar in der Neon-Box (X: 6.35%, Y: 30.43%, W: 19.53%, H: 30.90%) */}
            <div
              className="absolute flex items-center justify-center p-1 rounded-xl overflow-hidden"
              style={{
                left: '6.35%',
                top: '30.43%',
                width: '19.53%',
                height: '30.90%',
              }}
            >
              <Avatar
                src={user?.avatar_url}
                name={user?.username}
                size="lg"
                className="w-full h-full rounded-lg object-cover shadow-inner"
              />
            </div>

            {/* Username in der Neon-Pill (X: 5.66%, Y: 62.89%, W: 41.21%, H: 9.94%) */}
            <div
              className="absolute flex items-center px-3"
              style={{
                left: '5.66%',
                top: '62.89%',
                width: '41.21%',
                height: '9.94%',
              }}
            >
              <span className="font-mono text-xs sm:text-sm font-bold tracking-wider text-sky-200 truncate drop-shadow-[0_0_8px_rgba(56,189,248,0.6)]">
                {user?.username?.toUpperCase() || 'MAUNTING USER'}
              </span>
            </div>

            {/* Status-Badge oben rechts */}
            <div className="absolute top-4 right-4 z-10">{statusBadge}</div>

            {/* Ablaufdatum neben dem Chip */}
            <div className="absolute bottom-4 right-14 font-mono text-[10px] sm:text-xs text-sky-300/80 tracking-widest drop-shadow-sm">
              <span className="text-sky-400/50 mr-1.5 font-sans font-medium text-[9px]">VALID THRU</span>
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
            className="absolute inset-0 w-full h-full rounded-2xl overflow-hidden shadow-2xl border border-sky-500/30"
            style={{
              backfaceVisibility: 'hidden',
              transform: 'rotateY(180deg)',
            }}
          >
            {/* Hintergrundbild Rückseite */}
            <img
              src="/cards/maunting-card-back.jpg"
              alt="Maunting Card Back"
              className="w-full h-full object-cover pointer-events-none"
              draggable={false}
            />

            {/* Mittlere Neon-Pill (X: 23.63%, Y: 34.63%, W: 52.54%, H: 17.70%) */}
            <div
              className="absolute flex flex-col justify-center items-center px-2"
              style={{
                left: '23.63%',
                top: '34.63%',
                width: '52.54%',
                height: '17.70%',
              }}
            >
              <span className="font-mono text-xs sm:text-sm md:text-base font-bold tracking-widest text-sky-100 drop-shadow-[0_0_10px_rgba(56,189,248,0.8)]">
                {cardNumber}
              </span>
              <span className="font-mono text-[9px] sm:text-[10px] text-sky-300/70 tracking-wider truncate max-w-full">
                FP: {fingerprint}
              </span>
            </div>

            {/* Aktionen auf der Rückseite (unter der Pill-Box) */}
            <div
              className="absolute bottom-5 inset-x-6 flex items-center justify-center gap-2 z-10"
              onClick={(e) => e.stopPropagation()}
            >
              {!isUnlocked ? (
                <button
                  type="button"
                  className="bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold shadow-lg shadow-sky-500/30 flex items-center gap-1.5 text-xs py-1 px-3 rounded-md"
                  onClick={() => setUnlockDialogOpen(true)}
                >
                  <Unlock className="w-3.5 h-3.5" aria-hidden="true" />
                  {t('mss.card.actionUnlock', 'PIN eingeben')}
                </button>
              ) : (
                <button
                  type="button"
                  className="bg-slate-900/80 hover:bg-slate-800 text-sky-200 border border-sky-500/30 flex items-center gap-1.5 text-xs py-1 px-3 rounded-md"
                  onClick={handleQuickLock}
                >
                  <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                  {t('mss.card.actionLock', 'Sperren')}
                </button>
              )}

              {onOpenSecurityTab && (
                <button
                  type="button"
                  className="text-sky-300 hover:text-white hover:bg-sky-950/40 flex items-center gap-1 text-xs py-1 px-2.5 rounded-md"
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

      {/* ════════════════════════ ENTSPERR-MODAL ════════════════════════ */}
      {unlockDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-sky-500/30 p-6 text-white shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 rounded-xl bg-sky-500/10 text-sky-400 border border-sky-500/20">
                <KeyRound className="w-5 h-5" aria-hidden="true" />
              </div>
              <div>
                <h3 id="card-unlock-title" className="font-headline text-lg font-semibold text-white">
                  {t('mss.card.unlockTitle', 'Maunting Card entsperren')}
                </h3>
                <p className="text-xs text-slate-400">
                  {t('mss.card.unlockSubtitle', 'Gib deine Karten-PIN / dein Passwort ein, um deinen Tresor freizuschalten.')}
                </p>
              </div>
            </div>

            <form onSubmit={handleUnlockSubmit} className="space-y-4">
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder={t('mss.card.pinPlaceholder', 'Karten-Passwort / PIN')}
                autoFocus
                disabled={submittingUnlock}
                required
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-sky-500/30 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setUnlockDialogOpen(false)}
                  disabled={submittingUnlock}
                >
                  {t('common.cancel', 'Abbrechen')}
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={submittingUnlock || !passwordInput.trim()}
                  className="bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold flex items-center gap-1.5"
                >
                  {submittingUnlock ? (
                    <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                  )}
                  {t('mss.card.unlockSubmit', 'Entsperren')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
