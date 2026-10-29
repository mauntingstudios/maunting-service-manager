import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { KeyRound } from 'lucide-react'
import { Button } from '@/Singra/UI'
import { oeffneBrowser } from '@/desktop/tauri'
import { istEigenerBestaetigungsClient } from '@/services/passkeyService'
import { useBrowserBestaetigung } from '@/stores/browserBestaetigung'

interface Einladung {
  vorgang: string
  url: string
}

/**
 * Ein anderer Client desselben Kontos hat eine Bestätigung angefordert.
 *
 * Der Hinweis öffnet die vorhandene Seite `/bestaetigen`; dort bleiben
 * Zahlenwahl und Passkey. Das anfragende Fenster erkennt sein eigenes
 * Ereignis an der Client-Kennung und zeigt den Hinweis nicht.
 */
export function PasskeyFernBestaetigung() {
  const { t } = useTranslation()
  const [einladung, setEinladung] = useState<Einladung | null>(null)
  const offen = useBrowserBestaetigung((s) => s.offen)

  useEffect(() => {
    const handle = (e: Event) => {
      const detail = (e as CustomEvent<Record<string, unknown>>).detail
      if (detail?.type !== 'passkey_bestaetigung') return
      if (istEigenerBestaetigungsClient(detail.client)) return
      const url = String(detail.url ?? '')
      const vorgang = String(detail.vorgang ?? '')
      if (!url || !vorgang) return
      setEinladung({ url, vorgang })
    }
    window.addEventListener('msm:sync-event', handle)
    return () => window.removeEventListener('msm:sync-event', handle)
  }, [])

  if (!einladung) return null
  // Die App hat denselben Vorgang schon selbst offen: kein zweiter Hinweis.
  if (offen?.vorgang === einladung.vorgang) return null

  const oeffnen = async () => {
    const url = einladung.url
    setEinladung(null)
    try {
      if (typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)) {
        await oeffneBrowser(url)
        return
      }
    } catch {
      // Pontis/Web ohne den Tauri-Befehl: der Browser öffnet den Link.
    }
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div
      className="fixed bottom-[max(1rem,var(--msm-unten-sicher))] right-4 z-40 w-[min(calc(100vw-2rem),22rem)] rounded-xl border border-outline-variant bg-surface-container-high p-4 shadow-xl"
      role="status"
    >
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-on-surface">
            {t('auth.browserBestaetigung.remoteTitle')}
          </p>
          <p className="mt-1 text-xs text-on-surface-variant">
            {t('auth.browserBestaetigung.remoteText')}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void oeffnen()}>
              {t('auth.browserBestaetigung.remoteOpen')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEinladung(null)}>
              {t('auth.browserBestaetigung.remoteLater')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
