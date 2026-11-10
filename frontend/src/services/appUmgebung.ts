declare const __MSM_APP__: string | undefined

/** In welcher Oberfläche läuft dieser Code? `mss` ist die Desktop-App. */
export function istDesktopApp(): boolean {
  return typeof __MSM_APP__ === 'string' && __MSM_APP__ === 'mss'
}
