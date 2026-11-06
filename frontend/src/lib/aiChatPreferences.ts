/**
 * Was der KI-Chat sich zwischen zwei Besuchen merkt: das gewaehlte **Modell**
 * und die gewaehlte **Denkstufe**.
 *
 * Diese Werte gehoeren nicht in die Unterhaltung: sie gelten fuer den naechsten Besuch,
 * nicht fuer die vorige Antwort, und `ai_runs` haelt ohnehin fest, womit jeder
 * einzelne Lauf tatsaechlich gelaufen ist. Der Browser ist der richtige Ort —
 * es sind Einstellungen dieses Arbeitsplatzes, keine Serverwahrheit.
 *
 * Die Schluessel tragen die Benutzerkennung, weil localStorage der Herkunft
 * gehoert und nicht der Anmeldung: ohne sie faende der naechste Benutzer am
 * selben Rechner die Wahl des vorigen vor — und die haengt an dessen Rolle
 * (welche Provider er sehen darf, welche Stufen fuer ihn freigegeben sind),
 * nicht an seiner.
 *
 * Nichts hiervon ist eine Zusage: was gemerkt wurde, muss der Aufrufer gegen
 * den Katalog pruefen, bevor er es anzeigt. Ein Provider kann geloescht, ein
 * Schluessel entfernt, eine Stufe entzogen worden sein.
 */
export const AI_CHAT_PREFERENCE_PREFIX = 'msm_ai_chat'

export interface AiChatPreferenceKeys {
  provider: string
  reasoning: string
}

export function aiChatPreferenceKeys(userId: number | string): AiChatPreferenceKeys {
  return {
    provider: `${AI_CHAT_PREFERENCE_PREFIX}:provider:${userId}`,
    reasoning: `${AI_CHAT_PREFERENCE_PREFIX}:reasoning:${userId}`,
  }
}

/**
 * Dieselben zwei Felder wie im Chat und auf der Leitung: **ob** nachgedacht
 * wird und **wie tief**. `stufe: null` bei `an: true` heisst „denk nach, so wie
 * du es fuer richtig haeltst" — der Normalfall bei den Modellen ohne Stufen.
 */
export interface GespeicherteDenkwahl {
  an: boolean
  stufe: string | null
}

export type Denkwahl = GespeicherteDenkwahl

/**
 * Liest die gemerkte Denkwahl. Alles Unerwartete gilt als „nichts gemerkt":
 * der Aufrufer faellt dann auf den Vorschlag des Modells zurueck, und niemand
 * bekommt eine erfundene Stufe untergeschoben, weil jemand im Speicher geruehrt
 * hat.
 */
export function readAiReasoningChoice(key: string): GespeicherteDenkwahl | null {
  try {
    const saved = localStorage.getItem(key)
    if (!saved) return null
    const parsed: unknown = JSON.parse(saved)
    if (typeof parsed !== 'object' || parsed === null) return null
    const { an, stufe } = parsed as Record<string, unknown>
    if (typeof an !== 'boolean') return null
    if (stufe !== null && typeof stufe !== 'string') return null
    return { an, stufe }
  } catch {
    return null
  }
}

export function writeAiReasoningChoice(key: string, wahl: GespeicherteDenkwahl): void {
  schreibe(key, JSON.stringify(wahl))
}

/**
 * Liest das gemerkte Modell — eine Datenbankkennung, deshalb roh und nicht als
 * JSON. Was keine positive Ganzzahl ist, gilt als nichts gemerkt.
 */
export function readAiProviderChoice(key: string): number | null {
  try {
    const saved = localStorage.getItem(key)
    if (!saved) return null
    const id = Number(saved)
    return Number.isInteger(id) && id > 0 ? id : null
  } catch {
    return null
  }
}

export function writeAiProviderChoice(key: string, providerId: number): void {
  schreibe(key, String(providerId))
}

/**
 * Schluessel fuer die Denkstufe eines ganz konkreten KI-Modells.
 * Damit behaelt jedes Modell (z.B. o3-mini vs. GPT-4o vs. Gemini 2.5 Flash)
 * seine eigene praeferierte Denkstufe, unabhaengig vom Provider.
 */
export function aiModelReasoningKey(
  userId: number | string,
  providerId: number | string,
  modelId: string
): string {
  return `${AI_CHAT_PREFERENCE_PREFIX}:model_reasoning:${userId}:${providerId}:${modelId}`
}

export function readAiModelReasoningChoice(key: string): GespeicherteDenkwahl | null {
  return readAiReasoningChoice(key)
}

export function writeAiModelReasoningChoice(key: string, wahl: GespeicherteDenkwahl): void {
  writeAiReasoningChoice(key, wahl)
}

/**
 * Schluessel fuer das zuletzt gewaehlte Modell eines Providers.
 */
export function aiModelChoiceKey(userId: number | string, providerId: number | string): string {
  return `${AI_CHAT_PREFERENCE_PREFIX}:model_choice:${userId}:${providerId}`
}

export function readAiModelChoice(key: string): string | null {
  try {
    const saved = localStorage.getItem(key)
    return saved && typeof saved === 'string' && saved.trim() ? saved.trim() : null
  } catch {
    return null
  }
}

export function writeAiModelChoice(key: string, modelId: string): void {
  schreibe(key, modelId)
}

/**
 * Speicher voll oder gesperrt (privates Fenster): dann merkt sich der Browser
 * die Wahl eben nicht. Der Chat funktioniert unveraendert weiter — an diesen
 * beiden Werten haengt nur der Komfort.
 */
function schreibe(key: string, wert: string): void {
  try {
    localStorage.setItem(key, wert)
  } catch {
    // Absichtlich still, siehe oben.
  }
}
