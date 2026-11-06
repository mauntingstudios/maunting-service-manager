import { useEffect, useRef, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'

import {
  createDeviceAuthSession,
  getDeviceAuthSessionStatus,
  type DeviceAuthSessionResponse,
} from '@/api/vaultDeviceAuth'
import {
  buildDeviceAuthQrValueV3,
  decryptAuthPayload,
  fingerprintPublicKey,
  generateEphemeralAuthKeyPair,
} from './deviceAuthCrypto'
import { MauntingQrCard } from '@/components/qr/MauntingQrCard'
import { Spinner } from '@maunting/ui'
import { useAuthStore } from '@/stores/authStore'
import { still } from '@/lib/still'

export interface DeviceAuthQrViewProps {
  purpose: 'authorize' | 'unlock'
  onSuccess: (payload: Record<string, unknown>) => void
  onError?: (error: string) => void
}

/**
 * QR-Code-Ansicht für das Zielgerät (Desktop/Browser).
 *
 * Erzeugt ein ephemeres RSA-Schlüsselpaar, fordert eine Relais-Session an,
 * rendert den Signatur-`MauntingQrCard`-Code und pollt im Hintergrund nach der
 * Ende-zu-Ende verschlüsselten Freigabe durch das Smartphone.
 *
 * Der Code trägt nur Kennung, Zweck, Auflöse-Token und den Fingerabdruck des
 * Schlüssels (`msm3:…`), nicht den Schlüssel selbst: 503 Zeichen ergaben
 * 101×101 Module und brauchten Sekunden, 63 ergeben 45×45 wie beim
 * Kopplungscode. Den Schlüssel holt das Handy nach dem Scan.
 */
export function DeviceAuthQrView({ purpose, onSuccess, onError }: DeviceAuthQrViewProps) {
  const user = useAuthStore((s) => s.user)

  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<DeviceAuthSessionResponse | null>(null)
  const [qrValue, setQrValue] = useState<string | null>(null)
  const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null)
  const [resolved, setResolved] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const pollingRef = useRef<NodeJS.Timeout | null>(null)
  const unmountedRef = useRef(false)
  const consecutiveErrorsRef = useRef(0)

  // 1. Ephemeres Schlüsselpaar & Session anfordern
  useEffect(() => {
    unmountedRef.current = false
    let active = true

    async function initSession() {
      setLoading(true)
      setErrorMsg(null)
      setResolved(false)

      try {
        const { publicKeyBase64, privateKey: privKey } = await generateEphemeralAuthKeyPair()
        if (!active) return

        setPrivateKey(privKey)
        const abdruck = await fingerprintPublicKey(publicKeyBase64)
        if (!active) return

        const sess = await createDeviceAuthSession(
          publicKeyBase64,
          purpose,
          typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 80) : undefined,
        )
        if (!active) return

        setSession(sess)
        setQrValue(buildDeviceAuthQrValueV3(sess.session_id, purpose, sess.resolve_token, abdruck))
        setLoading(false)
      } catch (err: unknown) {
        if (!active) return
        const msg = err instanceof Error ? err.message : 'Session konnte nicht erstellt werden.'
        setErrorMsg(msg)
        setLoading(false)
        onError?.(msg)
      }
    }

    void initSession()

    return () => {
      active = false
      unmountedRef.current = true
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [purpose, user?.id, onError])

  // 2. Polling nach Freigabe
  useEffect(() => {
    if (!session || !privateKey || resolved || unmountedRef.current) return

    const poll = async () => {
      try {
        const status = await getDeviceAuthSessionStatus(session.session_id, session.session_token)
        if (unmountedRef.current) return
        consecutiveErrorsRef.current = 0

        if (status.status === 'resolved' && status.encrypted_payload) {
          if (pollingRef.current) {
            clearInterval(pollingRef.current)
            pollingRef.current = null
          }

          try {
            const decrypted = await decryptAuthPayload(privateKey, status.encrypted_payload)
            setResolved(true)
            onSuccess(decrypted)
          } catch (decErr) {
            still(decErr, 'DeviceAuthQrView.poll.decrypt')
            setErrorMsg('Fehler beim Entschlüsseln der Freigabe-Daten.')
          }
        } else if (status.status === 'expired') {
          if (pollingRef.current) {
            clearInterval(pollingRef.current)
            pollingRef.current = null
          }
          setErrorMsg('Session abgelaufen. Bitte erneut versuchen.')
        }
      } catch (err) {
        still(err, 'DeviceAuthQrView.poll')
        consecutiveErrorsRef.current += 1
        if (consecutiveErrorsRef.current >= 15) {
          if (pollingRef.current) {
            clearInterval(pollingRef.current)
            pollingRef.current = null
          }
          setErrorMsg('Verbindung zum Server verloren oder Sitzung ungültig.')
        }
      }
    }

    pollingRef.current = setInterval(() => {
      void poll()
    }, 800)

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [session, privateKey, resolved, onSuccess])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center space-y-3">
        <Spinner size="md" className="text-primary" />
        <p className="text-xs text-on-surface-variant font-medium">
          Erzeuge sichere Zero-Knowledge Session...
        </p>
      </div>
    )
  }

  if (errorMsg) {
    return (
      <div className="flex flex-col items-center justify-center p-6 text-center space-y-3">
        <p className="text-xs text-status-destructive font-semibold">{errorMsg}</p>
      </div>
    )
  }

  if (resolved) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center space-y-3 animate-scale-in">
        <div className="grid h-12 w-12 place-items-center rounded-full bg-status-success/20 text-status-success border border-status-success/40 shadow-lg">
          <CheckCircle2 className="h-6 w-6" />
        </div>
        <p className="text-sm font-bold text-on-surface">Erfolgreich freigegeben!</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center space-y-3.5 py-1">
      {qrValue && (
        <MauntingQrCard
          value={qrValue}
          size="md"
          hint="Öffne den Wallet-Modus auf deinem Smartphone und halte es vor diesen Code."
          className="shadow-2xl ring-2 ring-primary/30"
        />
      )}

      <div className="flex items-center gap-2 text-xs text-on-surface-variant/80">
        <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
        <span>Warte auf Smartphone-Scan (Zero-Knowledge E2EE)...</span>
      </div>
    </div>
  )
}
