import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { CheckCircle2, X, AlertCircle, Fingerprint, KeyRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button, PasswordInput } from '@maunting/ui'

import { useBackgroundQrScanner } from '@/hooks/useBackgroundQrScanner'
import { fetchDeviceAuthPublicKey, resolveDeviceAuthSession } from '@/api/vaultDeviceAuth'
import { encryptAuthPayload, fingerprintPublicKey, parseDeviceAuthQrCode } from './deviceAuthCrypto'
import { useVaultStore } from './vaultStore'
import { useAuthStore } from '@/stores/authStore'
import { still } from '@/lib/still'
import { FACH_TRESOR, biometrieEntsperren } from '../tauri'
import { MauntingCard } from './MauntingCardView'

export interface SmartcardWalletModalProps {
  isOpen: boolean
  onClose: () => void
}

interface PendingUnlockTarget {
  sid: string
  rt: string
  publicKeyBase64: string
}

/**
 * Smartcard-Wallet-Modus für Smartphones.
 *
 * Zeigt die Maunting Smartcard im vollflächigen Querformat. Im Hintergrund läuft
 * eine unsichtbare High-Speed-Kamera, die das Zielgerät (Desktop/Browser) innerhalb
 * von < 0,5 Sekunden scannt und per Zero-Knowledge E2EE Session-Relay autorisiert
 * oder entsperrt.
 */
export function SmartcardWalletModal({ isOpen, onClose }: SmartcardWalletModalProps) {
  const { t } = useTranslation()
  const user = useAuthStore((s) => s.user)
  const {
    bucketId,
    isDeviceAuthorized,
    isBiometricsEnabled,
    isBiometricsSupported,
    getKnownBucketId,
    deriveWalletUnlockPayload,
  } = useVaultStore()

  const [isPortrait, setIsPortrait] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [pendingUnlock, setPendingUnlock] = useState<PendingUnlockTarget | null>(null)
  const [passwordInput, setPasswordInput] = useState('')
  const [isSubmittingPassword, setIsSubmittingPassword] = useState(false)

  const knownBucketId =
    bucketId ||
    getKnownBucketId?.() ||
    (typeof localStorage !== 'undefined'
      ? localStorage.getItem('mss:vault_server_bucket') || localStorage.getItem('msm_vault_server_bucket')
      : null)

  const isCardConfirmedOnPhone =
    isDeviceAuthorized !== false ||
    Boolean(knownBucketId) ||
    (typeof localStorage !== 'undefined' &&
      (localStorage.getItem('mss:vault_device_authorized') === 'true' ||
        localStorage.getItem('msm_vault_device_authorized') === 'true'))

  // Bildschirm-Orientierung überwachen & Android-Activity ins Querformat drehen
  useEffect(() => {
    if (!isOpen) {
      setPendingUnlock(null)
      setPasswordInput('')
      setErrorMessage(null)
      setSuccessMessage(null)
      setIsProcessing(false)
      return
    }

    const checkOrientation = () => {
      const portrait = typeof window !== 'undefined' && window.innerHeight > window.innerWidth
      setIsPortrait(portrait)
    }

    checkOrientation()
    window.addEventListener('resize', checkOrientation)
    window.addEventListener('orientationchange', checkOrientation)

    try {
      ;(window as unknown as { MsmRand?: { querformat?: (aktiv: boolean) => void } }).MsmRand?.querformat?.(true)
    } catch (err) {
      still(err, 'SmartcardWalletModal.MsmRand.querformat.true')
    }

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
        ;(window as unknown as { MsmRand?: { querformat?: (aktiv: boolean) => void } }).MsmRand?.querformat?.(false)
      } catch (err) {
        still(err, 'SmartcardWalletModal.MsmRand.querformat.false')
      }
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

  const completeUnlockWithPassword = useCallback(
    async (target: PendingUnlockTarget, masterPassword: string) => {
      const transfer = await deriveWalletUnlockPayload(masterPassword)
      const payloadData = {
        action: 'unlock' as const,
        bucketId: transfer.bucketId,
        bucketAuthToken: transfer.bucketAuthToken,
        keyBase64: transfer.keyBase64,
        authorizedBy: user?.username || 'Mobile Smartcard',
        timestamp: Date.now(),
      }
      const encryptedPayload = await encryptAuthPayload(target.publicKeyBase64, payloadData)
      await resolveDeviceAuthSession(target.sid, encryptedPayload, target.rt)

      setPendingUnlock(null)
      setPasswordInput('')
      setSuccessMessage('Zielgerät erfolgreich entsperrt!')
      try {
        navigator.vibrate?.([60, 40, 120])
      } catch (err) {
        still(err, 'SmartcardWalletModal.vibrateSuccess')
      }
      setTimeout(() => {
        onClose()
      }, 1400)
    },
    [deriveWalletUnlockPayload, user?.username, onClose],
  )

  // Behandlung des gescannten QR-Codes
  const handleQrDetected = useCallback(
    async (rawCode: string) => {
      if (isProcessing || successMessage || pendingUnlock) return

      const parsed = parseDeviceAuthQrCode(rawCode)
      if (!parsed) {
        // Nicht unser QR-Code-Format; weiter scannen
        return
      }

      if (!isCardConfirmedOnPhone) {
        setErrorMessage('Bitte bestätige zuerst deine Maunting Card auf diesem Smartphone.')
        setTimeout(() => setErrorMessage(null), 3500)
        return
      }

      // Altes Format (v2): der Schlüssel steckt im Code, das Konto steht dabei.
      // Der kurze Code (v3) trägt kein Konto; dort prüft der Server beim
      // Schlüsselabruf und beim Auflösen, dass beide Geräte zusammengehören.
      if (parsed.v === 2 && user?.id && parsed.uid !== user.id) {
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
        // Kurzer Code (v3): nur Kennung, Zweck, Auflöse-Token und Fingerabdruck.
        // Der Schlüssel kommt erst nach dem Scan vom Server; der Fingerabdruck
        // bindet ihn an diesen Code und entlarvt einen untergeschobenen Schlüssel.
        let publicKeyBase64: string
        if (parsed.v === 3) {
          const key = await fetchDeviceAuthPublicKey(parsed.sid, parsed.rt)
          const abdruck = await fingerprintPublicKey(key.public_key)
          if (abdruck !== parsed.fp || key.purpose !== parsed.p) {
            throw new Error('Sicherheitswarnung: Der Schlüssel passt nicht zum QR-Code.')
          }
          publicKeyBase64 = key.public_key
        } else {
          publicKeyBase64 = parsed.pk
        }

        const hasLocalKeyMaterial =
          typeof deriveWalletUnlockPayload === 'function' &&
          (Boolean(isBiometricsEnabled) ||
            (typeof localStorage !== 'undefined' &&
              Boolean(
                localStorage.getItem('mss:vault_salt') ||
                  localStorage.getItem('mss:vault_canary') ||
                  localStorage.getItem('mss:vault_server_bucket') ||
                  localStorage.getItem('msm_vault_server_bucket'),
              )))

        // Stufe 2 (Tresor entsperren): Biometrie oder Master-Passwort verlangen,
        // damit der abgeleitete Tresorschlüssel E2EE an das Zielgerät übertragen wird.
        if (parsed.p === 'unlock' && hasLocalKeyMaterial) {
          const target: PendingUnlockTarget = {
            sid: parsed.sid,
            rt: parsed.rt,
            publicKeyBase64,
          }

          if (isBiometricsEnabled && isBiometricsSupported) {
            try {
              const masterPw = await biometrieEntsperren(
                t('mss.vault.walletEntsperrenGrund', 'Tresor am Zielgerät entsperren'),
                FACH_TRESOR,
              )
              if (masterPw) {
                await completeUnlockWithPassword(target, masterPw)
                return
              }
            } catch (bioErr) {
              still(bioErr, 'SmartcardWalletModal.biometricsFallbackToPassword')
            }
          }

          // Biometrie nicht aktiv oder abgebrochen -> Master-Passwort direkt im Wallet abfragen
          setPendingUnlock(target)
          return
        }

        // Stufe 1 (Karte bestätigen / Gerät autorisieren): Sofort ohne Abfrage freigeben
        const payloadData = {
          action: parsed.p,
          bucketId: knownBucketId || null,
          authorizedBy: user?.username || 'Mobile Smartcard',
          timestamp: Date.now(),
        }

        const encryptedPayload = await encryptAuthPayload(publicKeyBase64, payloadData)
        await resolveDeviceAuthSession(parsed.sid, encryptedPayload, parsed.rt)

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
    [
      isProcessing,
      successMessage,
      pendingUnlock,
      isCardConfirmedOnPhone,
      user?.id,
      user?.username,
      knownBucketId,
      deriveWalletUnlockPayload,
      isBiometricsEnabled,
      isBiometricsSupported,
      completeUnlockWithPassword,
      onClose,
      t,
    ],
  )

  const handlePasswordUnlockSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!pendingUnlock || !passwordInput.trim() || isSubmittingPassword) return
    setIsSubmittingPassword(true)
    setErrorMessage(null)
    try {
      await completeUnlockWithPassword(pendingUnlock, passwordInput)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Master-Passwort ungültig.'
      setErrorMessage(msg)
    } finally {
      setIsSubmittingPassword(false)
    }
  }

  const handleRetryBiometrics = async () => {
    if (!pendingUnlock || isSubmittingPassword) return
    setIsSubmittingPassword(true)
    setErrorMessage(null)
    try {
      const masterPw = await biometrieEntsperren(
        t('mss.vault.walletEntsperrenGrund', 'Tresor am Zielgerät entsperren'),
        FACH_TRESOR,
      )
      if (masterPw) {
        await completeUnlockWithPassword(pendingUnlock, masterPw)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Biometrie fehlgeschlagen.'
      setErrorMessage(msg)
    } finally {
      setIsSubmittingPassword(false)
    }
  }

  // Unsichtbare Hintergrundkamera mit High-Speed Scanner Hook
  const { videoRef, error: cameraError } = useBackgroundQrScanner({
    enabled: isOpen && !successMessage && !pendingUnlock,
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
              : isProcessing || pendingUnlock
              ? 'ring-4 ring-primary shadow-[0_0_70px_rgba(56,189,248,0.5)]'
              : 'shadow-[0_0_50px_rgba(56,189,248,0.22)] ring-2 ring-primary/40'
          }`}
        >
          <MauntingCard className="w-full !max-w-none" />
        </div>
      </div>

      {/* ── Stufe-2-Bestätigung: Master-Passwort / Fingerabdruck für Tresor-Entsperrung ── */}
      {pendingUnlock && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md">
          <form
            onSubmit={handlePasswordUnlockSubmit}
            className="w-full max-w-sm rounded-2xl border border-primary/30 bg-surface-container-low p-5 shadow-2xl space-y-3.5"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary border border-primary/25">
                  <KeyRound className="h-4 w-4" />
                </span>
                <div>
                  <h2 className="text-sm font-bold text-on-surface">
                    {t('mss.vault.walletUnlockTitle', 'Tresor am Zielgerät entsperren')}
                  </h2>
                  <p className="text-xs text-on-surface-variant">
                    {t('mss.vault.walletUnlockSubtitle', 'Master-Passwort zur Schlüsselableitung bestätigen')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPendingUnlock(null)
                  setPasswordInput('')
                  setErrorMessage(null)
                }}
                className="rounded-lg p-1 text-on-surface-variant hover:text-on-surface"
                aria-label={t('common.cancel', 'Abbrechen')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <PasswordInput
              id="wallet-unlock-master-password"
              label={t('mss.vault.masterPasswort', 'Master-Passwort')}
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              placeholder={t('mss.vault.masterPasswortPlatzhalter', 'Master-Passwort eingeben')}
              autoFocus
              disabled={isSubmittingPassword}
              required
            />

            {errorMessage && (
              <div className="rounded-xl border border-status-destructive/30 bg-status-destructive/15 px-3 py-2 text-xs text-status-destructive">
                {errorMessage}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              {isBiometricsEnabled && isBiometricsSupported && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void handleRetryBiometrics()}
                  disabled={isSubmittingPassword}
                  className="mr-auto flex items-center gap-1.5 text-xs"
                >
                  <Fingerprint className="h-3.5 w-3.5 text-primary" />
                  <span>{t('mss.vault.mitFingerabdruck', 'Fingerabdruck')}</span>
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPendingUnlock(null)
                  setPasswordInput('')
                  setErrorMessage(null)
                }}
                disabled={isSubmittingPassword}
              >
                {t('common.cancel', 'Abbrechen')}
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isSubmittingPassword || !passwordInput.trim()}
              >
                {isSubmittingPassword
                  ? t('mss.vault.entschluessle', 'Entschlüsselt…')
                  : t('mss.vault.entsperren', 'Entsperren')}
              </Button>
            </div>
          </form>
        </div>
      )}

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
