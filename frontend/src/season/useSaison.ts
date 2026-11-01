import { useLayoutEffect } from 'react'

import { usePublicSettingsStore } from '@/stores/publicSettingsStore'
import { aktiveSaison } from './zeitfenster'
import type { SeasonId } from './typen'
import { useJetzt } from './useJetzt'

/**
 * Haelt `data-season` am Wurzelelement aktuell — und damit die gesamte
 * saisonale Gestaltung, ohne dass eine Komponente die Farben kennen muss.
 *
 * Der Takt liegt bei 15 Sekunden: die Fenster haben Minutenauflösung, und ein
 * Wechsel soll auch dann passieren, wenn niemand die Seite neu laedt. Beim
 * Zurueckkehren aus dem Hintergrund wird sofort nachgesehen, weil ein
 * eingefrorener Timer auf dem Telefon sonst erst spaeter aufwacht.
 */
export function useSaison(erlaubt = true): SeasonId | null {
  const seasonal = usePublicSettingsStore((s) => s.seasonal)
  const jetzt = useJetzt()

  // Nur fuer die Entwicklung: `VITE_SEASON_PREVIEW=christmas` zeigt die
  // Saison auch ohne Kopplung. Im Produktionsbau ist die Variable nicht
  // gesetzt, dann gilt ausschliesslich der Server-Stand.
  const vorschau = import.meta.env.DEV
    ? (import.meta.env.VITE_SEASON_PREVIEW as string | undefined)?.trim().toLowerCase()
    : undefined
  const vorschauSaison =
    vorschau === 'halloween' || vorschau === 'christmas' || vorschau === 'birthday' ? vorschau : null

  // Ungekoppelte Instanzen bleiben im Standard-Design, selbst wenn die
  // Vorgaben des Panels bereits im Cache liegen.
  const aktiv = vorschauSaison ?? (erlaubt ? aktiveSaison(seasonal, jetzt) : null)

  // Layout-Effekt: die Farbe soll schon im ersten Bild stimmen, nicht erst
  // nach einem sichtbaren Umschalten.
  useLayoutEffect(() => {
    const wurzel = document.documentElement
    if (aktiv) {
      wurzel.dataset.season = aktiv
    } else {
      // Der Standardzustand ist bewusst das Fehlen des Attributs, nicht
      // `data-season="default"`: so greifen die saisonalen Selektoren nicht.
      delete wurzel.dataset.season
    }
    return () => {
      delete wurzel.dataset.season
    }
  }, [aktiv])

  return aktiv
}
