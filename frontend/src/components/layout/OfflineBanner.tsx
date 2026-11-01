import { useState } from 'react'
import { WifiOff, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useIsOnline } from '@/hooks/useIsOnline'
import { getEffectiveApiUrl } from '@/config/api'

export function OfflineBanner() {
  const isOnline = useIsOnline()
  const { t } = useTranslation()
  const [retrying, setRetrying] = useState(false)

  if (isOnline) {
    return null
  }

  const handleRetry = async () => {
    if (typeof window === 'undefined' || retrying) return
    setRetrying(true)
    try {
      const baseUrl = getEffectiveApiUrl()
      const res = await fetch(`${baseUrl}/api/health`, { cache: 'no-store' })
      if (res.ok) {
        window.dispatchEvent(new CustomEvent('msm:network-online'))
      }
    } catch {
      // Weiter offline; Banner bleibt sichtbar.
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-status-destructive text-on-destructive px-4 py-2 flex items-center justify-between text-xs font-medium z-30 shadow-md animate-fade-in"
    >
      <div className="flex items-center gap-2">
        <WifiOff className="w-4 h-4 shrink-0" />
        <span>{t('common.offline')}</span>
      </div>
      <button
        type="button"
        onClick={handleRetry}
        className="flex items-center gap-1.5 px-2 py-1 rounded bg-black/20 hover:bg-black/30 active:scale-95 transition-all text-xs cursor-pointer"
      >
        <RotateCcw className="w-3.5 h-3.5" />
        <span>{t('common.retry')}</span>
      </button>
    </div>
  )
}
