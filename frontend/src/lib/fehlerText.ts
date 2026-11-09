/**
 * Den Text eines Fehlers holen, gleich in welcher Form er ankommt.
 *
 * `api()` wirft `SanitizedApiError` mit `.message`. Tauri-Befehle lehnen
 * dagegen oft mit einem bloßen String ab (`Err(String)` in Rust) — und der
 * hat kein `.message`. Die Oberfläche zeigte dafür bisher nur „Fehler“,
 * obwohl der Grund längst da war.
 */
export function fehlerText(fehler: unknown, rueckfall: string): string {
  if (typeof fehler === 'string' && fehler.trim()) return fehler.trim()
  if (fehler && typeof fehler === 'object') {
    const nachricht = (fehler as { message?: unknown }).message
    if (typeof nachricht === 'string' && nachricht.trim()) return nachricht
  }
  return rueckfall
}
