import type { AiToolUse, AiWriteTool } from '../ai'

/**
 * Welches Fenster. `primary` ist der Dauerchat, in den der Mensch tippt;
 * `guardian` sammelt die Reparaturen, die eine Störung ausgelöst hat;
 * `worker` ist ein Hintergrund-Auftrag, den das Gehirn gestartet hat.
 *
 * `primary` und `guardian` sind feste Anlässe — je Benutzer genau eine
 * Unterhaltung, erzwungen über den (partiellen) `uq_ai_conversations_user_kind`.
 * Worker-Fenster gibt es dagegen **viele**: je Auftrag eines. Sie werden
 * deshalb nie über die Art geladen, sondern über ihre Kennung
 * (`getWorkerConversation`, `listWorkers`).
 */
export type AiConversationKind = 'primary' | 'guardian' | 'worker' | 'docs'

export interface AiConversation {
  id: string
  kind: AiConversationKind
  title: string
  project_id?: string | null
  pinned?: boolean
  created_at: string
  updated_at: string
}

export interface AiConversationSummary {
  id: string
  kind: AiConversationKind
  title: string
  project_id: string | null
  pinned: boolean
  created_at: string
  updated_at: string
}

export interface AiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  /**
   * Denkschritte des Modells, sofern es welche geliefert hat — **die ganze
   * Antwort am Stück**.
   *
   * Gezeichnet wird aus `sections`: dort steht der Denktext je Runde an seiner
   * Stelle. Dieses Feld bleibt für Nachrichten aus der Zeit vor den
   * Denkabschnitten (dann gibt es sie nur hier) und weil es dieselbe
   * Zeichenkette ist, die serverseitig in die Berichtsmail geht.
   */
  reasoning: string | null
  /**
   * Die Rueckfrage, die diese Nachricht gestellt hat.
   *
   * Sie haengt an der Nachricht und nicht an einem fluechtigen Ereignis:
   * frueher lebte sie nur im SSE-Strom, war nach einem Neuladen weg, und die
   * KI sah ihre eigene Frage im Verlauf nicht mehr — auf eine Antwort folgte
   * dieselbe Frage erneut.
   */
  question: AiQuestion | null
  /**
   * Die Gliederung dieser Antwort: Text und Werkzeuge in der Reihenfolge, in
   * der sie entstanden sind.
   *
   * Sie ersetzt `content` nicht, sie ordnet es. `content` ist der reine Text —
   * er geht an den Anbieter zurueck und wird durchsucht; die Abschnitte sind,
   * was gezeichnet wird. Aus `content` allein liesse sich nicht herstellen, an
   * welcher Stelle ein Werkzeug lief.
   *
   * `null` heisst „aus der Zeit vor dieser Spalte". Solche Nachrichten werden
   * wie immer als reiner Text dargestellt.
   */
  sections?: AiSection[] | null
  status: 'complete' | 'streaming' | 'failed'
  /**
   * Status der Übermittlung und Verarbeitung durch die KI (für Benutzernachrichten).
   * 'queued': Wird versendet
   * 'delivered': An KI übergeben / Stream verbunden
   * 'read': Von KI gelesen / antwortet
   * 'failed': Übermittlung fehlgeschlagen
   */
  deliveryStatus?: 'queued' | 'sent' | 'delivered' | 'read' | 'failed'
  provider_id: number | null
  model: string | null
  routed_tier?: string | null
  routed_model?: string | null
  routed_provider_name?: string | null
  routed_reason?: string | null
  created_at: string
}

/**
 * Ein Abschnitt einer Antwort — Text, ein Werkzeugaufruf oder ein Denkblock.
 *
 * Drei Formen in einem Typ statt dreier Listen, weil die **Reihenfolge
 * zwischen ihnen** die Information ist. „Ich sehe mir den Status an" —
 * Werkzeug — „der laeuft, jetzt die Logs" — Werkzeug ist etwas anderes als
 * derselbe Text mit denselben Werkzeugen davor, und genau so sah es aus,
 * solange beides getrennt gefuehrt wurde.
 *
 * `denken` kam zuletzt dazu, aus demselben Anlass: der Denktext lag als flaches
 * Feld daneben, und die Oberfläche konnte ihn deshalb nur als **einen** Kasten
 * über allem zeichnen — die Gedanken der dritten Runde standen dann über dem
 * Text der ersten. `AiMessage.reasoning` bleibt daneben, aber als Ableitung.
 */
export interface AiSection {
  art: 'text' | 'tool' | 'denken'
  inhalt?: string | null
  werkzeug?: AiToolUse | null
}

export interface AiConversationDetail extends AiConversation {
  messages: AiMessage[]
  /**
   * Gibt es ältere Nachrichten als die älteste gelieferte? Dann lädt
   * `getConversation` mit `before` die Seite davor nach.
   *
   * Der Dauerchat brauchte das nie — zweihundert Nachrichten sind mehr, als
   * jemand zurückliest. Eine Reparatur über Stunden schreibt sie in einem
   * Anlauf voll.
   */
  has_more: boolean
}

/**
 * Ein Werkzeug, das gleich läuft — angekündigt, bevor es losgeht.
 *
 * Das Gegenstück zu `AiToolUse`: dort steht, was **war**, hier, was **kommt**.
 * `call_id` ist der Schlüssel und nicht `tool_name`, weil bis zu acht Werkzeuge
 * gleichzeitig laufen und dasselbe Werkzeug in einer Runde zweimal vorkommen
 * kann (zwei `read_config` für zwei Dateien).
 *
 * Die Argumente stehen bewusst **nicht** darin: Serverpfade, Dateinamen und IPs
 * gehören nicht in eine Statuszeile.
 */
export interface AiToolPlanAufruf {
  call_id: string
  tool_name: string
  /** Null, wenn das Werkzeug keinen Server betrifft. */
  server_id: number | null
}

/**
 * Ein Aktionsvorschlag — genau ein Vertrag für beide Wege.
 *
 * REST (`listActions`, `getAction`, `executeAction`) und das SSE-Ereignis
 * `proposal`/`action` liefern dasselbe Objekt aus derselben Serialisierung
 * (`ai_proposal_service.proposal_response`). Das ist keine Kosmetik: der Chat
 * **ersetzt** beim Wiederanhängen den Vorschlag aus der Liste durch den aus dem
 * Ereignis. Trägt das Ereignis weniger Felder, verschwinden Begründung und
 * erwartete Wirkung aus einer bereits gerenderten Karte — ausgerechnet auf der,
 * mit der ein Schreibvorgang freigegeben wird.
 */
export interface AiActionProposal {
  id: string
  conversation_id: string
  /** Null bei einem Erstellungsvorschlag — den Server gibt es dann noch nicht. */
  server_id: number | null
  tool_name: AiWriteTool | (string & {})
  proposal_type?: 'read' | 'worker' | 'write'
  preview: Record<string, unknown>
  expected_revision: string | null
  requires_confirmation: boolean
  /** True heisst: kein Mensch hat zugestimmt. Muss sichtbar anders aussehen. */
  autonomous: boolean
  reason: string | null
  expected_effect: string | null
  status: 'proposed' | 'confirmed' | 'executing' | 'succeeded' | 'failed' | 'expired'
  task_id: string | null
  error_code: string | null
  /**
   * Der Lauf, der auf diesen Vorschlag wartet.
   *
   * Nach dem Bestaetigen haengt sich der Chat daran — sonst waere die Aktion
   * ausgefuehrt und die KI stumm, und man muesste eine neue Nachricht
   * schreiben, damit es weitergeht. Genau die Beschwerde aus dem Betrieb.
   */
  run_id: string | null
  created_at: string
}

export interface AiAutonomyGrant {
  id: number
  /** Null = panelweit. */
  server_id: number | null
  project_id?: string | null
  enabled: boolean
  max_actions_per_hour: number
  used_last_hour: number
  created_at: string
  updated_at: string
}

/**
 * Eine Rückfrage der KI mit anklickbaren Vorschlägen.
 *
 * Sie beendet den Zug: das Modell wartet auf die nächste Nachricht. Ein Klick
 * schickt die Beschriftung als ganz normale Benutzernachricht — kein
 * Sonderweg, kein zweiter Zustand im Backend.
 */
export interface AiQuestion {
  question: string
  options: Array<{ label: string; hint: string | null }>
}

export interface AiAttachment {
  id: string
  conversation_id: string
  original_name: string
  media_type: string
  size_bytes: number
  status: 'quarantined' | 'ready' | 'rejected'
  rejection_code: string | null
  /**
   * Die Nachricht, mit der dieser Anhang abgeschickt wurde.
   *
   * `null` heißt: hochgeladen, aber noch nicht gesendet. Genau daran hängt die
   * Darstellung — Ungesendetes steht als Chip über dem Eingabefeld, alles
   * andere in seiner Nachricht.
   */
  message_id: string | null
  /** Wie viele Stellen beim Aufnehmen unkenntlich gemacht wurden. */
  redacted_spans: number | null
  created_at: string
}

export type AiStreamEvent =
  | {
      event: 'message'
      data: {
        message_id: string
        request_id: string
        /** Die Kennung der Benutzernachricht — ersetzt die optimistisch vergebene. */
        user_message_id?: string | null
        routed_tier?: string | null
        routed_model?: string | null
        routed_provider_name?: string | null
        routed_reason?: string | null
      }
    }
  | { event: 'delta'; data: { content: string } }
  // Denkschritte. Eigenes Ereignis, damit die Oberflaeche sie einklappen kann
  // und niemand sie fuer die Antwort haelt.
  | { event: 'reasoning'; data: { content: string } }
  // Ein gerade ausgefuehrtes Lesewerkzeug — macht sichtbar, worauf die Antwort
  // beruht.
  | { event: 'tool'; data: AiToolUse }
  // Was gleich läuft, gemeldet **bevor** es läuft. Flüchtig: das Ereignis
  // landet nicht im Abzug, weil es keine Tatsache über die Antwort ist,
  // sondern eine Anzeige während der Arbeit. Nach einem Neuladen mitten im
  // Lauf fehlt es also — das ist bewusst so.
  | { event: 'tool_plan'; data: { aufrufe: AiToolPlanAufruf[] } }
  // Rückfrage mit Vorschlägen. Beendet den Zug — ab hier ist der Mensch dran.
  | { event: 'question'; data: AiQuestion }
  // Der aeltere Teil des Verlaufs wurde zu einer Zusammenfassung gefaltet.
  | { event: 'compacted'; data: { conversation_id: string } }
  | { event: 'proposal'; data: AiActionProposal }
  // Eine bereits ausgefuehrte autonome Aktion. Bewusst ein eigenes Ereignis:
  // sie ist keine Anfrage an den Benutzer, sondern eine Meldung.
  | { event: 'action'; data: AiActionProposal }
  | { event: 'done'; data: { message_id: string; replayed?: boolean } }
  // Nur der Code, kein Wortlaut. Hier stand kurzzeitig ein `detail` mit dem
  // Satz des Anbieters; es ist bewusst wieder weg, weil dieser Satz das Konto
  // des Betreibers beschreibt und der Lauf einem Benutzer gehoert
  // (`ai_stream_service`, Ausnahmezweig). Der Code traegt die Erklaerung.
  | { event: 'error'; data: { code: string; message_key: string } }
  // Der vollstaendige Stand eines Laufs beim Anhaengen. Kommt immer zuerst.
  //
  // Ohne ihn saehe jemand, der sich spaeter anhaengt — nach einem Seitenwechsel,
  // nach einem Neustart des Browsers —, nur den Rest der Antwort. Der Client
  // **ersetzt** damit seinen Stand, er haengt ihn nicht an.
  | { event: 'snapshot'; data: AiRunSnapshot }
  // Der Lauf beginnt eine neue Nachricht (Fortsetzung nach einer Bestaetigung).
  // Der Text davor gehoert zur abgeschlossenen Nachricht und darf nicht
  // weiterwachsen.
  | { event: 'segment'; data: { run_id: string } }
  // Zustandswechsel des Laufs: laeuft, wartet, fertig.
  | { event: 'run'; data: { run_id: string; status: AiRunStatus; stop_reason?: string | null; live?: boolean } }

/**
 * Der erlaubte Zustandsvorrat eines Laufs — **eine** Liste, aus der sowohl der
 * Typ als auch die Frage „ruht der?" abgeleitet wird.
 *
 * Der Vorrat gehört dem Backend: `ai_runs` hält ihn als CheckConstraint
 * (backend/models/ai_run.py). Im Frontend stand er zuletzt dreimal — einmal als
 * Typ hier und zweimal als handgeschriebene Liste der ruhenden Zustände, in
 * AiChat und in AiRunNotice. Käme ein weiterer ruhender Zustand dazu, müsste er
 * an zwei unverbundenen Stellen nachgetragen werden; wer nur eine fände, hätte
 * entweder eine dauerhaft gesperrte Eingabe (AiChat gibt sie erst frei, wenn
 * der Lauf ruht) oder eine Glocke, die für diesen Lauf nie läutet
 * (AiRunNotice).
 */
export const AI_LAUFZUSTAENDE = [
  'running',
  'waiting_confirmation',
  'waiting_user',
  // Die dritte Parkstelle: ein Langläufer schläft bis `wake_at` (nur in
  // Worker-Fenstern). Ruhend wie die anderen Parkstellen — er tut nichts von
  // selbst, bis der Takt ihn weckt.
  'waiting_wake',
  'completed',
  'failed',
  'cancelled',
] as const

export type AiRunStatus = (typeof AI_LAUFZUSTAENDE)[number]

/**
 * Zustände, in denen der Lauf nichts mehr von selbst tut.
 *
 * Bewusst abgeleitet statt aufgezählt: „ruht" heißt genau „arbeitet nicht".
 * Ein neuer Zustand oben ist damit automatisch ein ruhender, und niemand muss
 * daran denken.
 */
export const AI_RUHENDE_LAUFZUSTAENDE: readonly AiRunStatus[] =
  AI_LAUFZUSTAENDE.filter((zustand) => zustand !== 'running')

export interface AiRunSnapshot {
  run_id: string
  status: AiRunStatus
  message_id: string | null
  content: string
  reasoning: string
  /**
   * Die Gliederung des laufenden Segments. Hier stand `tools: AiToolUse[]`
   * neben `content` — zwei Toepfe ohne Beziehung zueinander. Solange die KI
   * erst alle Werkzeuge rief und danach redete, liess sich die Anordnung raten
   * (alle Werkzeuge vor die Blase); sobald sie **waehrend** der Arbeit spricht,
   * geht das nicht mehr.
   */
  sections: AiSection[]
  question: AiQuestion | null
  proposals: AiActionProposal[]
  stop_reason: string | null
  routed_tier?: string | null
  routed_model?: string | null
  routed_provider_name?: string | null
  routed_reason?: string | null
}

export interface AiRunInfo {
  id: string
  status: AiRunStatus
  stop_reason: string | null
  message_id: string | null
  live: boolean
  created_at: string
  /**
   * In welchem Fenster dieser Lauf arbeitet.
   *
   * Ohne diese Angabe hängt sich der Chat an den nächstbesten aktiven Lauf —
   * und zeichnet eine Guardian-Reparatur in das Fenster des Menschen. Genau
   * das ist der Zustand, den die Trennung beseitigt. Die Glocke braucht es
   * ebenso, sonst meldet sie „die KI ist mit deinem Auftrag fertig" für etwas,
   * das niemand beauftragt hat.
   */
  kind: AiConversationKind
  conversation_id: string | null
  /** Um welchen Server es zuletzt ging — nur aus nachgewiesenem Zugriff. */
  server_id: number | null
}

/**
 * Die Ereignisse, die dieser Client versteht.
 *
 * An die Union gebunden, damit ein neues Ereignis in `AiStreamEvent` hier
 * auffällt, statt still zu fehlen — ohne die Bindung war die Liste eine
 * handgepflegte Kopie.
 */
export const STREAM_EVENTS: readonly AiStreamEvent['event'][] = [
  'message', 'delta', 'reasoning', 'tool', 'tool_plan', 'question', 'compacted',
  'proposal', 'action', 'done', 'error', 'snapshot', 'segment', 'run',
]

/**
 * Ein Hintergrund-Auftrag, wie die Worker-Leiste des Chats ihn zeigt.
 *
 * Bewusst nur das Nötigste: Kennung, geschwärzter Titel, Laufzustand, Beginn.
 * Kein Auftragstext, keine Serverdaten — die Leiste ist eine Übersicht, kein
 * zweiter Verlauf.
 */
export interface AiWorkerInfo {
  conversation_id: string
  title: string
  /** `running` oder eine Parkstelle (`waiting_*`); Beendete stehen nie hier. */
  status: AiRunStatus
  created_at: string
  project_id?: string | null
  project_name?: string | null
  parent_conversation_id?: string | null
  parent_conversation_title?: string | null
  task_id?: string | null
  task_title?: string | null
}

/**
 * Ein stehender Auftrag, wie `GET /ai/tasks` ihn liefert — dieselbe Form, die
 * auch das Chat-Werkzeug `list_tasks` sieht (`ai_task_service.eintrag`).
 *
 * `plan` ist der fertige Satz des Backends (deutsch, mit Zeitzone); die
 * Aufgabenliste baut ihre Anzeige aus den strukturierten Feldern daneben, um
 * beide Sprachen bedienen zu können. `conversation_id` ist das
 * Hintergrundfenster der Aufgabe — der Link auf `?ansicht=worker&id=…`.
 */
export type AiTaskScope = 'personal' | 'team' | 'global'

export interface AiTaskEntry {
  task_id: string
  scope: AiTaskScope
  team_id: number | null
  team_name: string | null
  created_by_user_id?: number | null
  created_by?: string | null
  updated_by?: string | null
  title: string
  instruction: string
  /** `act` heisst: darf Schreibwerkzeuge nutzen — setzt den autonomen Modus voraus. */
  kind: 'report' | 'act'
  plan: string
  plan_kind: 'daily' | 'interval' | 'once'
  /** ``"HH:MM"`` in der Zeitzone der Aufgabe; nur bei `daily`. */
  time_of_day: string | null
  /** ISO-Wochentage als ``"1,3,5"`` (Montag = 1); `null` heisst täglich. */
  weekdays: string | null
  interval_hours: number | null
  /** ISO-8601 in UTC; nur bei `once`. */
  once_at: string | null
  timezone: string
  channel: 'chat' | 'email' | 'both'
  enabled: boolean
  conversation_id: string | null
  next_run: string | null
  last_started: string | null
}

/**
 * Was beim Anlegen oder Ändern übertragen wird — Teilangaben sind erlaubt.
 *
 * `JSON.stringify` lässt `undefined`-Felder weg, und genau darauf baut das
 * Backend (`exclude_unset`): nur was genannt ist, wird angefasst. Wer eine
 * Aufgabe nur pausieren will, schickt allein `enabled`.
 */
export interface AiTaskWrite {
  scope?: AiTaskScope
  team_id?: number | null
  title?: string
  instruction?: string
  kind?: 'report' | 'act'
  plan_kind?: 'daily' | 'interval' | 'once'
  time_of_day?: string
  weekdays?: number[]
  interval_hours?: number
  once_at?: string
  timezone?: string
  channel?: 'chat' | 'email' | 'both'
  enabled?: boolean
}

/** Die Betreiber-Deckel der Worker: wie viele je Benutzer, wie viele Runden je Lauf. */
export interface AiWorkerPolicy {
  max_parallel_workers: number
  rounds_per_worker: number
  min_workers: number
  max_workers: number
  min_rounds: number
  max_rounds: number
}
