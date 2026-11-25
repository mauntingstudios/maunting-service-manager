/**
 * Ein Entwurf für das Eingabefeld des KI-Chats, etwa „Seite an Singra
 * übergeben“ aus Maunting Pontis. Der Chat nimmt ihn beim Öffnen oder,
 * wenn er schon offen ist, auf das Ereignis hin; abgeschickt wird erst, wenn
 * der Nutzer selbst sendet.
 *
 * Der Entwurf liegt nur bis zum Abholen im Speicher. Ist der Chat noch nicht
 * geladen, wartet er hier, statt dass ein Ereignis ins Leere geht.
 */
export const AI_ENTWURF_EVENT = 'msm:ai-entwurf'

export interface AiEntwurfOptionen {
  neuerChat?: boolean
}

let wartend: string | null = null
let wartendNeuerChat = false

export function entwurfUebergeben(text: string, optionen?: AiEntwurfOptionen): void {
  wartend = text
  wartendNeuerChat = Boolean(optionen?.neuerChat)
  window.dispatchEvent(
    new CustomEvent(AI_ENTWURF_EVENT, { detail: { neuerChat: wartendNeuerChat } }),
  )
}

/** Gibt den wartenden Entwurf einmal heraus. */
export function entwurfNehmen(): string | null {
  const text = wartend
  wartend = null
  return text
}

/** Meldet einmalig, ob der übergebene Entwurf ausdrücklich einen neuen Chat verlangt. */
export function entwurfWillNeuenChat(): boolean {
  const flag = wartendNeuerChat
  wartendNeuerChat = false
  return flag
}
