import { useEffect, useRef, useState, useCallback } from 'react'
import jsQR from 'jsqr'

export interface UseBackgroundQrScannerOptions {
  /** Ob die Kamera und der Scan aktiv sein sollen. Standard: true. */
  enabled?: boolean
  /** Callback, wenn ein QR-Code erkannt wurde. */
  onDetected?: (code: string) => void
  /** Ob bei erfolgreicher Erkennung das Gerät vibrieren soll. Standard: true. */
  vibrateOnDetect?: boolean
}

export interface UseBackgroundQrScannerReturn {
  videoRef: React.RefObject<HTMLVideoElement>
  isScanning: boolean
  isDetected: boolean
  error: string | null
  start: () => Promise<void>
  stop: () => void
  reset: () => void
}

/**
 * Headless High-Speed QR-Scanner Hook für Hintergrund-Kameras (z. B. im Wallet-Modus).
 *
 * Nutzt prioritär die native, hardwarebeschleunigte `BarcodeDetector`-API
 * (sub-100ms Erkennung auf modernen mobilen Browsern) und fällt nahtlos auf
 * einen optimierten 60-FPS-Canvas-Scan mit `jsQR` zurück.
 */
export function useBackgroundQrScanner({
  enabled = true,
  onDetected,
  vibrateOnDetect = true,
}: UseBackgroundQrScannerOptions = {}): UseBackgroundQrScannerReturn {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const animRef = useRef<number | null>(null)

  const [isScanning, setIsScanning] = useState(false)
  const [isDetected, setIsDetected] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stop = useCallback(() => {
    setIsScanning(false)
    if (animRef.current) {
      cancelAnimationFrame(animRef.current)
      animRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
  }, [])

  const reset = useCallback(() => {
    setIsDetected(false)
    setError(null)
  }, [])

  const start = useCallback(async () => {
    stop()
    reset()

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Kein Kamerazugriff auf diesem Gerät unterstützt.')
      }

      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        // playsInline ist zwingend nötig für iOS Safari im Vollbild/Hintergrund
        videoRef.current.playsInline = true
        videoRef.current.muted = true
        await videoRef.current.play().catch(() => {})
        setIsScanning(true)
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Kamerazugriff fehlgeschlagen.'
      setError(message)
      setIsScanning(false)
    }
  }, [stop, reset])

  // Lebenszyklus-Steuerung über enabled-Prop
  useEffect(() => {
    if (enabled) {
      void start()
    } else {
      stop()
    }
    return () => {
      stop()
    }
  }, [enabled, start, stop])

  // Kontinuierliche Scan-Schleife
  useEffect(() => {
    if (!isScanning || isDetected) return

    let detector: any = null
    if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
      try {
        detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] })
      } catch {}
    }

    let active = true

    const handleSuccess = (code: string) => {
      active = false
      setIsDetected(true)
      stop()

      if (vibrateOnDetect) {
        try {
          navigator.vibrate?.([40, 30, 40])
        } catch {}
      }

      onDetected?.(code)
    }

    async function scan() {
      if (!active || !videoRef.current || videoRef.current.readyState < 2) {
        if (active) animRef.current = requestAnimationFrame(scan)
        return
      }

      const video = videoRef.current
      const vw = video.videoWidth
      const vh = video.videoHeight

      if (!vw || !vh) {
        if (active) animRef.current = requestAnimationFrame(scan)
        return
      }

      // 1. Hardware BarcodeDetector
      if (detector) {
        try {
          const codes = await detector.detect(video)
          if (codes && codes.length > 0 && codes[0].rawValue) {
            const raw = String(codes[0].rawValue).trim()
            if (raw) {
              handleSuccess(raw)
              return
            }
          }
        } catch {}
      }

      // 2. High-Speed jsQR Analyse
      try {
        if (!canvasRef.current) {
          canvasRef.current = document.createElement('canvas')
        }
        const canvas = canvasRef.current

        // 720px Deckelung für konstante 60 FPS
        const scale = Math.min(1, 720 / Math.max(vw, vh))
        const w = Math.round(vw * scale)
        const h = Math.round(vh * scale)

        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w
          canvas.height = h
        }

        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (ctx) {
          ctx.drawImage(video, 0, 0, w, h)
          const imageData = ctx.getImageData(0, 0, w, h)
          let qr = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'attemptBoth',
          })

          // Weitwinkel-/Distanz-Optimierung mit zentriertem 60%-Crop
          if (!qr && w >= 320 && h >= 320) {
            const cropW = Math.round(w * 0.6)
            const cropH = Math.round(h * 0.6)
            const cropX = Math.round((w - cropW) / 2)
            const cropY = Math.round((h - cropH) / 2)
            const cropData = ctx.getImageData(cropX, cropY, cropW, cropH)
            qr = jsQR(cropData.data, cropData.width, cropData.height, {
              inversionAttempts: 'attemptBoth',
            })
          }

          if (qr && qr.data && qr.data.trim()) {
            handleSuccess(qr.data.trim())
            return
          }
        }
      } catch {}

      if (active) {
        animRef.current = requestAnimationFrame(scan)
      }
    }

    animRef.current = requestAnimationFrame(scan)

    return () => {
      active = false
      if (animRef.current) {
        cancelAnimationFrame(animRef.current)
        animRef.current = null
      }
    }
  }, [isScanning, isDetected, onDetected, vibrateOnDetect, stop])

  return {
    videoRef,
    isScanning,
    isDetected,
    error,
    start,
    stop,
    reset,
  }
}
