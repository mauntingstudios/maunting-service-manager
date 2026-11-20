/** Das Web-Panel liegt seit der Storefront unter `/dashboard`. */
export const PANEL_HOME = '/dashboard'

export function istPanelHome(pfad: string): boolean {
  return pfad === PANEL_HOME
}
