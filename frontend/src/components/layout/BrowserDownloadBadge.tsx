import { useTranslation } from 'react-i18next'
import { Globe, Smartphone } from 'lucide-react'
import { geraeteArt } from '@/desktop/geraeteArt'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'
import { DownloadBadge } from './DownloadKnopf'

/**
 * Hinweis auf Maunting Pontis fuer Windows und Android.
 *
 * Steht ueber dem MSS-Download.
 * Wer das Panel bereits im MSB benutzt (geraeteArt() === 'browser'), sieht den
 * Hinweis nicht — wer schon im Browser surft, muss ihn nicht nochmals laden.
 */
export function BrowserDownloadBadge({ variante = 'knopf' }: { variante?: 'knopf' | 'zeile' } = {}) {
  const { t } = useTranslation()
  const enabled = usePublicSettingsStore((s) => s.browser_download_enabled)

  if (!enabled || geraeteArt() === 'browser') return null

  const isAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)

  const downloadUrl = isAndroid
    ? 'https://github.com/mauntingstudios/maunting-service-manager/releases/latest/download/MauntingSecureBrowser.apk'
    : 'https://github.com/mauntingstudios/maunting-service-manager/releases/latest/download/MauntingPontis-Setup.exe'

  return (
    <DownloadBadge
      variante={variante}
      href={downloadUrl}
      icon={isAndroid ? <Smartphone className="w-4 h-4" /> : <Globe className="w-4 h-4" />}
      titel={isAndroid ? 'Pontis Mobile' : 'Maunting Pontis'}
      subtext={isAndroid ? t('browserBadge.androidLabel') : t('browserBadge.label')}
      tooltip={isAndroid ? t('browserBadge.androidTooltip') : t('browserBadge.tooltip')}
    />
  )
}
