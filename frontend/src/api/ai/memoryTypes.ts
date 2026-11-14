export interface AiMemoryEntry {
  id: string
  /**
   * `server` ist die **eigene** Notiz zu einer Anlage, `server_shared` das
   * Betriebswissen der Anlage selbst — sichtbar für jeden, der sie sehen darf,
   * und es überlebt den Kollegen, der es aufgeschrieben hat.
   */
  scope: 'user' | 'server' | 'server_shared' | 'team' | 'panel'
  server_id: number | null
  team_id: number | null
  /**
   * Nur Altbestand trägt noch einen Namen. Seit Gedächtnis v2 ist eine
   * Erinnerung ein bis fünf Sätze, die ohne Gespräch verständlich sind.
   */
  key: string | null
  /** Der Text der Erinnerung. */
  value: string
  titel: string | null
  thema: { id: string; name: string } | null
  art: AiMemoryArt | null
  quelle: AiMemoryQuelle
  wichtigkeit: number
  /** "user" = selbst hinterlegt, "ai" = von der KI gemerkt. */
  origin: 'user' | 'ai'
  /** `vergessen`: von der KI vergessen, 30 Tage zurückholbar. */
  status: AiMemoryAnsicht
  vergessen_am: string | null
  /**
   * Zählt jede Änderung. Wer ändert, schickt die Fassung mit, die er gesehen
   * hat; hat inzwischen jemand anderes geschrieben, antwortet der Server 409.
   */
  fassung: number
  /**
   * Steht in jedem Gespräch vorn „im Kopf“. Nur Menschen heften an; ohne
   * Angabe (ein Server vor 5.2) heißt es nein.
   */
  angeheftet?: boolean
  /**
   * Nur bei einem Schluss: die Erinnerungen, aus denen er folgt. Ändert sich
   * eine davon, vergisst das Gedächtnis den Schluss.
   */
  belege?: { id: string; text: string }[]
  use_count: number
  last_used_at: string | null
  created_at: string
  updated_at: string
}

/** Woher eine Erinnerung stammt — siehe `ai_memory_service.QUELLEN`. */
export type AiMemoryQuelle = 'eingetragen' | 'gespraech' | 'import' | 'pflege'

export type AiMemoryArt =
  | 'fakt' | 'vorliebe' | 'anweisung' | 'ereignis' | 'plan' | 'beziehung' | 'wissen'
  /** Von der nächtlichen Pflege aus mindestens zwei anderen geschlossen. */
  | 'schluss'

/** Was eine Liste zeigt: was gilt, oder was die KI vergessen hat. */
export type AiMemoryAnsicht = 'aktiv' | 'vergessen'

/** Ein Thema einer Ansicht und wie viele geltende Erinnerungen darunter stehen. */
export interface AiMemoryThema {
  id: string
  name: string
  anzahl: number
}

/** Eine frühere Fassung einer Erinnerung, die jüngste kommt zuerst. */
export interface AiMemoryFassung {
  id: string
  text: string
  titel: string | null
  grund: 'bearbeitet' | 'aktualisiert' | 'zusammengefuehrt' | 'aufgenommen' | 'umgeschrieben' | 'wiederhergestellt'
  /** Wer die Änderung gemacht hat, die diese Fassung abgelöst hat. */
  von: 'user' | 'ai'
  erstellt: string
}

/** Was eine Seite außer dem Offset noch einschränkt. */
export interface AiMemoryFilter {
  status?: AiMemoryAnsicht
  /** Kennungen von Themen; gleichnamige aus zwei Bereichen gehen zusammen. */
  thema?: string[]
  /**
   * Durchsucht den ganzen Bestand statt einer Seite, nach Bedeutung und
   * Wörtern; die Antwort sind die Treffer, das Passendste zuerst.
   */
  suche?: string
}

export function memoryFilter({ status = 'aktiv', thema = [], suche = '' }: AiMemoryFilter = {}): string {
  const nadel = suche.trim()
  return `&status=${status}${thema.map((id) => `&thema=${encodeURIComponent(id)}`).join('')}${
    nadel ? `&suche=${encodeURIComponent(nadel)}` : ''
  }`
}

export function memoryScopeQuery(scope: AiMemoryEntry['scope'], serverId?: number, teamId?: number): string {
  return `scope=${scope}${serverId ? `&server_id=${serverId}` : ''}${teamId ? `&team_id=${teamId}` : ''}`
}

/**
 * Eine Seite einer Erinnerungsliste — dieselbe Form für das eigene Profil und
 * für einen einzelnen Bereich (Team, Panel, Anlage).
 *
 * Zwei Formen wären zwei Rechnungen für Seitenzahl und nächsten Offset, und die
 * Oberfläche müsste beide führen.
 */
export interface AiMemoryPage {
  entries: AiMemoryEntry[]
  /** Alle Einträge dieser Ansicht, nicht nur die dieser Seite. */
  total: number
  /**
   * Davon das, was „Alle löschen" wirklich mitnimmt. Im Profil sind das nur die
   * allgemeinen Einträge — die Notizen zu einzelnen Servern stehen in derselben
   * Liste und bleiben stehen; in der Ansicht eines Bereichs sind es alle. Die
   * Zahl kommt vom Server, weil die Oberfläche seit der Seitenweise nur noch
   * einen Ausschnitt sieht und sie nicht mehr selbst zählen kann.
   */
  clearable: number
  /** Wie groß eine Seite ist. Bestimmt der Server, denn er bezahlt sie. */
  limit: number
}

/** Ein Bestandseintrag, den ein Vorschlag ersetzen würde (Fassung für die Gegenprobe). */
export interface AiMemoryImportBisher {
  id: string
  fassung: number
  text: string
  titel: string | null
}

/** Eine Erinnerung, wie das Gedächtnismodell sie aus dem Text gelesen hat. */
export interface AiMemoryImportPreviewItem {
  text: string
  titel: string | null
  thema: string | null
  art: AiMemoryArt | null
  wichtigkeit: number
  /** Was darin aufgeht; leer heißt neu. */
  ersetzt: AiMemoryImportBisher[]
}

export interface AiMemoryImportPreview {
  detected_source: string | null
  items: AiMemoryImportPreviewItem[]
  total_detected: number
  total_known: number
  total_secrets_blocked: number
  unread_parts: number
  /** `null` heißt unbegrenzt. */
  available_slots: number | null
  memory_enabled: boolean
}

export interface AiMemoryImportItem {
  text: string
  titel?: string | null
  thema?: string | null
  art?: AiMemoryArt | null
  wichtigkeit?: number
  ersetzt?: { id: string; fassung: number }[]
}

export interface AiMemoryImportTarget {
  scope: AiMemoryEntry['scope']
  server_id?: number
  team_id?: number
  source_provider?: string
}

export interface AiMemoryImportResult {
  imported_count: number
  updated_count: number
  skipped_count: number
  skipped: { index: number; reason: 'full' | 'rejected' | 'duplicate' | 'conflict' }[]
}

export interface AiMemoryPreference {
  enabled: boolean
  /**
   * Ob der Hinweis vor der naechsten Nachricht gezeigt werden soll. Die
   * 24-Stunden-Regel entscheidet das Backend — sonst muesste jeder Client sie
   * nachbauen, und zwei Nachbauten weichen irgendwann voneinander ab.
   */
  notice_due: boolean
  notice_hidden: boolean
}

/**
 * Ein Skill ist Text, kein Programm.
 *
 * `scope` sagt, woher er kommt: `shipped` liegt als Datei im Repo und kommt mit
 * jedem MSM-Update, `global` gilt panelweit, `team` nur im jeweiligen Team.
 * Mitgelieferte Skills sind nicht änderbar — aber überschreibbar, indem man
 * einen globalen mit demselben Schlüssel anlegt.
 */
export interface AiSkillSummary {
  /** Nur bei Datenbank-Skills gesetzt; mitgelieferte haben keine Zeile. */
  id: string | null
  skill_key: string
  name: string
  description: string
  scope: 'shipped' | 'global' | 'team'
  origin: 'shipped' | 'operator' | 'ai'
  team_id: number | null
  status: 'active' | 'pending'
  enabled: boolean
  editable: boolean
}

/** Eine Datenbankzeile in der Verwaltung — auch abgeschaltete und wartende. */
export interface AiSkillManaged {
  id: string
  skill_key: string
  name: string
  description: string
  body: string
  scope: 'global' | 'team'
  origin: 'operator' | 'ai'
  team_id: number | null
  status: 'active' | 'pending'
  enabled: boolean
  created_by: number | null
  created_at: string
  updated_at: string
  /**
   * Abdruck über Name+Beschreibung+Text. Die Freigabe schickt ihn zurück und
   * bestätigt damit den gelesenen Inhalt — wurde der Skill zwischen Lesen und
   * Klick überschrieben, antwortet das Backend mit 409 statt fremden Text
   * panelweit freizugeben.
   */
  fingerprint: string
}

/**
 * Ob und wie die KI panelweit gültige Skills anlegen darf.
 *
 * `off` = nur der Betreiber. `review` = Personal sofort, Kundengespräche in die
 * Warteschlange. `instant` = jedes Gespräch wirkt sofort panelweit.
 */
export interface AiLearningPolicy {
  policy: 'off' | 'review' | 'instant'
  pending_count: number
}

/**
 * Wie voll der Kontext dieses Gesprächs ist — die Zahlen hinter dem Ring.
 *
 * `known` trennt „kleines Fenster" von „über das Modell ist nichts bekannt".
 * Im zweiten Fall zeigt der Ring ausdrücklich keinen Prozentwert: ein
 * geschätzter sähe aus wie ein gemessener, und man würde ihm glauben.
 *
 * Alle Zahlen sind Schätzungen (vier Zeichen je Token). Für „noch viel Platz"
 * gegen „gleich wird zusammengefasst" reicht das — die Oberfläche sagt deshalb
 * „etwa".
 */
export interface AiContextStatus {
  known: boolean
  /** Das volle Fenster des Modells. `null`, wenn unbekannt. */
  window_tokens: number | null
  /** Was die Eingabe davon füllen darf; Antwort und Sicherheit sind ab. */
  usable_tokens: number
  /** Belegt. Darf `usable_tokens` überschreiten — dann wird gleich gefaltet. */
  used_tokens: number
  /** Ab wie viel Prozent Belegung zusammengefasst wird. */
  compaction_percent: number
  summarized: boolean
}

/** Die panelweite Faltmarke, plus die Grenzen, die der Server zulässt. */
export interface AiContextPolicy {
  compaction_percent: number
  min_percent: number
  max_percent: number
}

export type AiMemorySearchFallback = 'off' | 'google' | 'openai'

/**
 * Bei wem die Bedeutungssuche ohne lokales Modell rechnen darf.
 *
 * `fallback` ist die Wahl des Betreibers (Standard `off`), `available` nennt
 * die Rückfallanbieter mit aktivem Zugang, `local_ready` sagt, ob das lokale
 * Modell läuft, und `ready`, ob die Suche gerade überhaupt rechnen kann.
 */
export interface AiMemorySearchPolicy {
  fallback: AiMemorySearchFallback
  available: Exclude<AiMemorySearchFallback, 'off'>[]
  local_ready: boolean
  ready: boolean
}
