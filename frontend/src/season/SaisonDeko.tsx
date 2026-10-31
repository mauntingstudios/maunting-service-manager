import { SaisonHintergrund } from './SaisonHintergrund'
import { useSaison } from './useSaison'

/**
 * Zentrale Saison-Wache. Setzt `data-season` auf dem Wurzelelement und bringt
 * die Hintergrund-Animation mit. Alle anderen saisonalen Elemente (Logo,
 * Deko, Farben) lesen nur dieses Attribut.
 *
 * `gekoppelt` ist das Gate fuer Pontis und MSS: nur wer mit dem Panel
 * verbunden ist, bekommt den Server-Stand. Ohne Kopplung bleibt das
 * Standard-Design aktiv, egal was im lokalen Cache steht.
 */
export function SaisonDeko({ gekoppelt = true }: { gekoppelt?: boolean }) {
  useSaison(gekoppelt)
  return <SaisonHintergrund />
}
