import { useTranslation } from 'react-i18next'
import { Monitor, Smartphone } from 'lucide-react'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'
import { DownloadBadge } from './DownloadKnopf'

export function DesktopAppDownloadBadge({ variante = 'knopf' }: { variante?: 'knopf' | 'zeile' } = {}) {
  const { t } = useTranslation()
  const enabled = usePublicSettingsStore((s) => s.desktop_app_download_enabled)

  if (!enabled) return null

  const isAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)

  const downloadUrl = isAndroid
    ? 'https://github.com/mauntingstudios/maunting-service-manager/releases/latest/download/MauntingSmartSystem.apk'
    : 'https://github.com/mauntingstudios/maunting-service-manager/releases/latest/download/MauntingSmartSystem-Setup.exe'

  return (
    <DownloadBadge
      variante={variante}
      href={downloadUrl}
      icon={isAndroid ? <Smartphone className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
      titel={isAndroid ? 'MSS Mobile App' : 'MSS Desktop'}
      subtext={isAndroid ? t('desktopBadge.androidLabel') : t('desktopBadge.label')}
      tooltip={isAndroid ? t('desktopBadge.androidTooltip') : t('desktopBadge.tooltip')}
    />
  )
}
