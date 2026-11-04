/**
 * Die Fensterleiste des Hauptfensters (Windows, macOS, Linux).
 *
 * Das Fenster hat keinen Rahmen des Systems (`decorations: false`); gezogen
 * wird an der freien Fläche, ein Doppelklick maximiert. Das X geht denselben
 * Weg wie das des Systems: Rust hält das Fenster an und `SchliessenDialog`
 * fragt. Unter Android gibt es kein Fenster und keine Leiste.
 */
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useTranslation } from 'react-i18next'

import { Fensterleiste } from '@maunting/ui'
import { Logo } from '@/components/Logo'

type Aktion = 'minimieren' | 'maximieren' | 'schliessen'

function ausfuehren(aktion: Aktion) {
  try {
    const fenster = getCurrentWindow()
    const lauf = aktion === 'minimieren' ? fenster.minimize() : aktion === 'maximieren' ? fenster.toggleMaximize() : fenster.close()
    void lauf.catch(() => undefined)
  } catch {
    // Im Browser ohne Tauri gibt es kein Fenster; die Leiste ist dort nicht sichtbar.
  }
}

export function Titelleiste() {
  const { t } = useTranslation()
  if (/android/i.test(navigator.userAgent)) return null

  return (
    <Fensterleiste
      steuerung={{
        minimieren: () => ausfuehren('minimieren'),
        maximieren: () => ausfuehren('maximieren'),
        schliessen: () => ausfuehren('schliessen'),
      }}
      beschriftungen={{
        minimieren: t('mss.fenster.minimieren'),
        maximieren: t('mss.fenster.maximieren'),
        schliessen: t('common.close'),
      }}
      marke={<Logo size="sm" />}
      titel="Smart System"
    />
  )
}
