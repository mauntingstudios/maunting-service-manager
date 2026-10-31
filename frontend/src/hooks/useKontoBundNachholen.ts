import { useEffect } from 'react'

import { stosseKontoBundNachholenAn } from '@/services/kontoBundNachholen'
import { istOffen } from '@/services/lokaleVersiegelung'

/**
 * Holt den Konto-Schluessel auf freigegebene Geraete nach, die ihn verloren
 * haben — auch ausserhalb des Messengers.
 *
 * Der Lauf stand bis 10/2026 nur in `useMessengerKern`. Wer ein Geraet freigab
 * und danach im Profil blieb, wartete auf einen „naechsten Abgleich“, der erst
 * beim Oeffnen des Messengers kam. Hier laeuft er in der authentifizierten
 * Huelle, beim Netzwechsel, beim Zurueckkehren in den Tab und im Takt.
 */
export function useKontoBundNachholen(aktiv: boolean, taktMs = 60_000): void {
  useEffect(() => {
    if (!aktiv) return
    let lebt = true
    const lauf = () => {
      if (!lebt) return
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      // Bei gesperrtem Messenger liegt der private Geraeteschluessel hinter
      // dem PIN. Dann wird weder entschluesselt noch gesendet.
      if (!istOffen()) return
      void stosseKontoBundNachholenAn().catch(() => {})
    }
    const beiSync = (ereignis: Event) => {
      const detail = (ereignis as CustomEvent<{ entity?: string }>).detail
      if (detail?.entity === 'e2ee_devices') lauf()
    }
    lauf()
    window.addEventListener('online', lauf)
    document.addEventListener('visibilitychange', lauf)
    window.addEventListener('msm:sync-event', beiSync)
    const takt = setInterval(lauf, taktMs)
    return () => {
      lebt = false
      window.removeEventListener('online', lauf)
      document.removeEventListener('visibilitychange', lauf)
      window.removeEventListener('msm:sync-event', beiSync)
      clearInterval(takt)
    }
  }, [aktiv, taktMs])
}
