import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, X, AlertCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useBackgroundQrScanner } from '@/hooks/useBackgroundQrScanner'
import { resolveDeviceAuthSession } from '@/api/vaultDeviceAuth'
import { encryptAuthPayload, parseDeviceAuthQrCode } from './deviceAuthCrypto'
import { useVaultStore } from './vaultStore'
import { useAuthStore } from '@/stores/authStore'
import { still } from '@/lib/still'
import { MauntingCard } from './MauntingCardView'

export interface SmartcardWalletModalProps {
  isOpen: boolean
  onClose: () => void
}

/**
 * Smartcard-Wallet-Modus für Smartphones.
 *
 * Zeigt die Maunting Smartcard im vollflächigen Querformat. Im Hintergrund läuft
 * eine unsichtbare High-Speed-Kamera, die das Zielgerät (Desktop/Browser) innerhalb
 * von < 0,5 Sekunden scannt und per Zero-Knowledge E2EE Session-Relay autorisiert.
 */
export function SmartcardWalletModal({ isOpen, onClose }: SmartcardWalletModalProps) {
  const { t } = useTranslation()
  const user = useAuthStore((s) => s.user)
  const { bucketId } = useVaultStore()

  const [isPortrait, setIsPortrait] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Bildschirm-Orientierung überwachen
  useEffect(() => {
    if (!isOpen) return

    const checkOrientation = () => {
      const portrait = typeof window !== 'undefined' && window.innerHeight > window.innerWidth
      setIsPortrait(portrait)
    }

    checkOrientation()
    window.addEventListener('resize', checkOrientation)
    window.addEventListener('orientationchange', checkOrientation)

    // Versuche Screen-Orientation API für natives Querformat zu sperren
    try {
      const anyScreen = window.screen as any
      if (anyScreen?.orientation?.lock) {
        anyScreen.orientation.lock('landscape').catch((err: unknown) => {
          still(err, 'SmartcardWalletModal.orientation.lock.promise')
        })
      }
    } catch (err) {
      still(err, 'SmartcardWalletModal.orientation.lock')
    }

    return () => {
      window.removeEventListener('resize', checkOrientation)
      window.removeEventListener('orientationchange', checkOrientation)
      try {
        const anyScreen = window.screen as any
        if (anyScreen?.orientation?.unlock) {
          anyScreen.orientation.unlock()
        }
      } catch (err) {
        still(err, 'SmartcardWalletModal.orientation.unlock')
      }
    }
  }, [isOpen])

  // Behandlung des gescannten QR-Codes
  const handleQrDetected = useCallback(
    async (rawCode: string) => {
      if (isProcessing || successMessage) return

      const parsed = parseDeviceAuthQrCode(rawCode)
      if (!parsed) {
        // Nicht unser QR-Code-Format; weiter scannen
        return
      }

      if (user?.id && parsed.uid !== user.id) {
        setErrorMessage('QR-Code gehört zu einem anderen Benutzerkonto.')
        try {
          navigator.vibrate?.([100, 50, 100])
        } catch (err) {
          still(err, 'SmartcardWalletModal.vibrateError')
        }
        setTimeout(() => setErrorMessage(null), 3000)
        return
      }

      setIsProcessing(true)
      try {
        // Zero-Knowledge E2EE Payload verschlüsseln
        const payloadData = {
          action: parsed.p,
          bucketId: bucketId || null,
          authorizedBy: user?.username || 'Mobile Smartcard',
          timestamp: Date.now(),
        }

        const encryptedPayload = await encryptAuthPayload(parsed.pk, payloadData)

        // Session auf dem Server auflösen
        await resolveDeviceAuthSession(parsed.sid, encryptedPayload)

        const msg =
          parsed.p === 'unlock'
            ? 'Zielgerät erfolgreich entsperrt!'
            : 'Zielgerät erfolgreich autorisiert!'

        setSuccessMessage(msg)
        try {
          navigator.vibrate?.([60, 40, 120])
        } catch (err) {
          still(err, 'SmartcardWalletModal.vibrateSuccess')
        }

        // Nach kurzem Feedback-Puls Wallet-Modus schließen
        setTimeout(() => {
          onClose()
        }, 1400)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Freigabe fehlgeschlagen.'
        setErrorMessage(msg)
        setTimeout(() => setErrorMessage(null), 3500)
      } finally {
        setIsProcessing(false)
      }
    },
    [isProcessing, successMessage, user?.id, user?.username, bucketId, onClose],
  )

  // Unsichtbare Hintergrundkamera mit High-Speed Scanner Hook
  const { videoRef, error: cameraError } = useBackgroundQrScanner({
    enabled: isOpen && !successMessage,
    onDetected: (code) => void handleQrDetected(code),
    vibrateOnDetect: true,
  })

  // ESC-Taste zum Schließen
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-surface-container-lowest/95 p-3 backdrop-blur-2xl overflow-hidden select-none touch-none"
      role="dialog"
      aria-modal="true"
      aria-label="Smartcard Wallet-Modus"
    >
      {/* ── Unsichtbarer Video-Stream im Hintergrund ───────────────────── */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="absolute inset-0 h-full w-full object-cover opacity-0 pointer-events-none -z-10"
        aria-hidden="true"
      />

      {/* ── Schließen-Schaltfläche oben rechts ────────────────────────── */}
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 z-50 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white/80 backdrop-blur-md transition-all hover:bg-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary active:scale-95 shadow-lg"
        aria-label={t('common.close', 'Schließen')}
      >
        <X className="h-5 w-5" />
      </button>

      {/* ── Interaktive Maunting Smartcard im Querformat ──────────────── */}
      <div
        className={`relative flex items-center justify-center transition-all duration-500 ease-out ${
          isPortrait
            ? 'rotate-90 origin-center scale-[1.08] sm:scale-125'
            : 'scale-100 sm:scale-110'
        }`}
        style={{
          width: isPortrait ? '78vh' : '92vw',
          maxWidth: isPortrait ? '540px' : '580px',
        }}
      >
        <div
          className={`w-full transition-all duration-300 rounded-2xl ${
            successMessage
              ? 'ring-4 ring-status-success shadow-[0_0_80px_rgba(52,211,153,0.55)] scale-[1.02]'
              : isProcessing
              ? 'ring-4 ring-primary shadow-[0_0_70px_rgba(56,189,248,0.5)] animate-pulse'
              : 'shadow-[0_0_50px_rgba(56,189,248,0.22)] ring-2 ring-primary/40'
          }`}
        >
          <MauntingCard className="w-full !max-w-none" />
        </div>
      </div>

      {/* ── Status-Leiste & Feedback unten ────────────────────────────── */}
      <div className="absolute bottom-5 inset-x-4 z-40 flex flex-col items-center justify-center pointer-events-none">
        {successMessage ? (
          <div className="flex items-center gap-2 rounded-full bg-status-success/20 px-4 py-2 text-sm font-semibold text-status-success border border-status-success/40 shadow-xl backdrop-blur-md animate-scale-in">
            <CheckCircle2 className="h-4 w-4 text-status-success" />
            <span>{successMessage}</span>
          </div>
        ) : errorMessage ? (
          <div className="flex items-center gap-2 rounded-full bg-status-destructive/20 px-4 py-2 text-xs sm:text-sm font-medium text-status-destructive border border-status-destructive/40 shadow-xl backdrop-blur-md">
            <AlertCircle className="h-4 w-4 text-status-destructive" />
            <span>{errorMessage}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-full bg-surface-container-high/90 px-4 py-1.5 text-xs font-medium text-primary border border-primary/25 shadow-xl backdrop-blur-md">
            <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
            <span>An Zielgerät halten zum Freigeben</span>
          </div>
        )}

        {cameraError && !successMessage && (
          <p className="mt-2 text-label-sm text-status-warning text-center max-w-xs">
            Kamera aktiv: Bitte Zugriff erlauben, falls das Zielgerät nicht erkannt wird.
          </p>
        )}
      </div>
    </div>
  )
}
