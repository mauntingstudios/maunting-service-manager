import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Monitor, Smartphone } from 'lucide-react'
import { api } from '@/api/client'
import { DownloadKnopf, DownloadZeile } from './DownloadKnopf'

export function DesktopAppDownloadBadge({ variante = 'knopf' }: { variante?: 'knopf' | 'zeile' } = {}) {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useState<boolean>(true)

  useEffect(() => {
    let active = true
    api<{ desktop_app_download_enabled?: boolean }>('/settings/public')
      .then((data) => {
        if (active && data) {
          setEnabled(data.desktop_app_download_enabled ?? true)
        }
      })
      .catch(() => {
        // Fallback: aktiviert lassen
      })
    return () => {
      active = false
    }
  }, [])

  if (!enabled) return null

  const isAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)

  const downloadUrl = isAndroid
    ? 'https://github.com/mauntingstudios/maunting-service-manager/releases/latest/download/MauntingSmartSystem.apk'
    : 'https://github.com/mauntingstudios/maunting-service-manager/releases/latest/download/MauntingSmartSystem-Setup.exe'

  const titleText = isAndroid ? 'MSS Mobile App' : 'MSS Desktop'
  const subtext = isAndroid
    ? t('desktopBadge.androidLabel')
    : t('desktopBadge.label')
  const tooltip = isAndroid
    ? t('desktopBadge.androidTooltip')
    : t('desktopBadge.tooltip')

  const Darstellung = variante === 'zeile' ? DownloadZeile : DownloadKnopf
  return (
    <Darstellung
      href={downloadUrl}
      icon={isAndroid ? <Smartphone className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
      titel={titleText}
      subtext={subtext}
      tooltip={tooltip}
    />
  )
}
