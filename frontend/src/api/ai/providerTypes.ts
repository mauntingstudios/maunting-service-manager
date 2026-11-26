export type CustomChatProtocol = 'chat_completions' | 'responses' | 'anthropic_messages'
export type CustomReasoningDialect =
  | 'none'
  | 'think_tags'
  | 'reasoning_effort'
  | 'reasoning'
  | 'anthropic_thinking'

export interface AiProviderAdmin {
  id: number
  name: string
  /** Schluessel aus der Anbieterliste, z. B. "openrouter". */
  provider_kind: string
  /**
   * Abgeleitet aus dem Anbieter — nur zur Anzeige, nicht editierbar.
   * `null`, wenn das Panel diesen Anbieter nicht (mehr) kennt.
   */
  base_url: string | null
  default_model: string | null
  /**
   * Die Stimm-Kennung eines Stimmzugangs, aus dem Konto des Betreibers.
   *
   * `null` heisst „nichts hinterlegt" und loest sich **nicht** auf: es gibt
   * keine Standardstimme. Ohne sie gibt es ueber diesen Zugang keinen
   * Sprachmodus — eine geratene Stimme stuende auf der Rechnung des Betreibers.
   *
   * Hier stand bis zum 16.08.2026 einer von acht festen Namen. Seit die
   * Kennung aus einem fremden Konto stammt, gibt es keine Liste mehr, gegen die
   * sich pruefen liesse — und deshalb ein Textfeld statt eines Auswahlfelds.
   *
   * Bei einem Chatzugang bleibt das Feld unbeachtet.
   */
  default_voice: string | null
  /**
   * Das hoerende Modell eines Chatzugangs — was Gesprochenes zu Text macht.
   *
   * `null` heisst „nichts hinterlegt": dann gibt es ueber diesen Zugang keinen
   * Sprachmodus. Hier gehoert ein **Transkriptionsmodell** hinein —
   * `openai/gpt-transcribe`, `openai/whisper-large-v3` — und kein Chatmodell.
   * Der Ton geht an OpenRouters `/audio/transcriptions`.
   *
   * Solche Modelle stehen **nicht** in der Modellauswahl: die liest `/models`,
   * und dort fuehrt OpenRouter Chatmodelle. Deshalb ist das Feld hier ein
   * Textfeld und keine Liste.
   *
   * Bei einem Stimmzugang bleibt das Feld unbeachtet.
   */
  transcription_model: string | null
  realtime_default?: boolean
  realtime_model?: string | null
  realtime_voice?: string | null
  /**
   * Die Wörter kommen vom Sprachweg des Modells (`AiSprachweg.denkstufen`) —
   * bei GPT-Live sind es sechs, und sie gelten dort dem Backend-Modell.
   */
  realtime_reasoning_effort?: string | null
  realtime_language?: 'auto' | 'de' | 'en'
  realtime_vad_eagerness?: 'auto' | 'low' | 'medium' | 'high'
  realtime_text_input_price_micro_usd_per_million?: number | null
  realtime_text_output_price_micro_usd_per_million?: number | null
  realtime_audio_input_price_micro_usd_per_million?: number | null
  realtime_audio_output_price_micro_usd_per_million?: number | null
  /**
   * Nur GPT-Live: das Modell, das hinter der Stimme nachdenkt und die
   * Werkzeuge ruft. `null` heisst „das Standardmodell des Zugangs".
   */
  realtime_backend_model?: string | null
  /** Nur GPT-Live: der Preis je Minute Sitzung, in Micro-USD. */
  realtime_minute_price_micro_usd?: number | null
  /**
   * Das Arbeitsmodell der Worker — die zweite Hälfte der Provider-Zweiteilung
   * (docs/agentic-framework.md, §5). `null` heisst: kein Hintergrund-Betrieb
   * über diesen Zugang, es gilt der heutige Ein-Modell-Betrieb. Kein Fehler,
   * sondern der dokumentierte Fallback.
   */
  worker_model: string | null
  /**
   * Die **feste** Denkstufe der Worker. Der Betreiber wählt sie, nie der
   * Kunde und nie das Modell selbst — er zahlt die Arbeit im Hintergrund.
   * `null` heisst: nicht nachdenken.
   */
  worker_reasoning_effort: string | null
  /**
   * Das Modell der Ethics Engine — die Reflexions- und Urteilsebene.
   * `null` heisst: keine Ethics Engine konfiguriert (deaktiviert).
   */
  ethics_model: string | null
  /**
   * Die feste Denkstufe fuer das Ethics-Modell.
   */
  ethics_reasoning_effort: string | null
  /**
   * Der Modus / die Zoning-Stufe: 'off' | 'auto' | 'always' | 'critical'.
   */
  ethics_mode: 'off' | 'auto' | 'always' | 'critical'
  memory_model?: string | null
  search_summary_model?: string | null
  /** Feste Denkstufe der Suchzusammenfassung; `null` heißt ohne Denken (schnellste Antwort). */
  search_summary_reasoning_effort?: string | null
  /**
   * Der Name der Azure-Ressource dieses Zugangs — das eine Stueck Adresse, das
   * MSM nicht selbst weiss. Nur Anbieter mit `ressource_noetig` brauchen ihn;
   * bei allen anderen ist `null` der Normalfall und das Feld unbeachtet.
   *
   * Ausdruecklich **keine** Adresse: Schema, Suffix und Pfad stehen im
   * Backend, hier steht ein einzelnes DNS-Label. Das Formular prueft die Form
   * nur der Bequemlichkeit halber — verbindlich prueft der Server.
   */
  azure_resource_name: string | null
  custom_base_url?: string | null
  custom_chat_protocol?: CustomChatProtocol
  custom_reasoning_dialect?: CustomReasoningDialect
  custom_context_tokens?: number | null
  custom_max_output_tokens?: number | null
  custom_supports_vision?: boolean | null
  disable_safety?: boolean
  enabled: boolean
  requires_api_key: boolean
  operator_key_configured: boolean
  operator_key_hint: string | null
  /**
   * Rückfallpreis je 1 Mio. Tokens, in US-Cent-Microunits (1 Cent = 10.000).
   *
   * Nur noch Rückfallebene: normalerweise wird gebucht, was der Anbieter
   * meldet. `null` = keine Preisquelle, Kosten bleiben 0. Die Oberfläche zeigt
   * hier eine Dezimalzahl in der Anzeigewährung (`utils/geld.ts`); in ganzen
   * Cent ließ sich „1,20 €" nicht eintragen.
   */
  token_price_micro_usd_per_million: number | null
  standard_input_price_micro_usd_per_million?: number | null
  standard_output_price_micro_usd_per_million?: number | null
  standard_cache_price_micro_usd_per_million?: number | null
  worker_input_price_micro_usd_per_million?: number | null
  worker_output_price_micro_usd_per_million?: number | null
  worker_cache_price_micro_usd_per_million?: number | null
  ethics_input_price_micro_usd_per_million?: number | null
  ethics_output_price_micro_usd_per_million?: number | null
  ethics_cache_price_micro_usd_per_million?: number | null
  memory_input_price_micro_usd_per_million?: number | null
  memory_output_price_micro_usd_per_million?: number | null
  memory_cache_price_micro_usd_per_million?: number | null
  search_summary_input_price_micro_usd_per_million?: number | null
  search_summary_output_price_micro_usd_per_million?: number | null
  search_summary_cache_price_micro_usd_per_million?: number | null
  standard_enabled?: boolean
  worker_enabled?: boolean
  ethics_enabled?: boolean
  memory_enabled?: boolean
  search_summary_enabled?: boolean
  transcription_enabled?: boolean
  realtime_enabled?: boolean
  enabled_models?: string[]
  allow_all_models?: boolean
  updated_at: string
}

export interface RoleAiModelAccessItem {
  provider_id: number
  provider_name?: string | null
  allow_all: boolean
  allowed_models: string[]
}

export interface AiRoleLimitsResponse {
  role_id: number
  role_name: string
  configured: boolean
  five_hour_token_limit?: number | null
  daily_token_limit: number | null
  weekly_token_limit: number | null
  monthly_token_limit: number | null
  monthly_realtime_minutes_limit: number | null
  monthly_dictation_minutes_limit: number | null
  max_memory_entries: number | null
  max_reasoning_effort: number | null
  max_attachment_storage_mb: number | null
  max_context_tokens: number | null
  allow_all_models: boolean
  model_access: RoleAiModelAccessItem[]
  updated_at: string | null
}

export interface AiRoleLimitsUpdate {
  five_hour_token_limit?: number | null
  daily_token_limit: number | null
  weekly_token_limit: number | null
  monthly_token_limit: number | null
  monthly_realtime_minutes_limit?: number | null
  monthly_dictation_minutes_limit?: number | null
  max_memory_entries?: number | null
  max_reasoning_effort?: number | null
  max_attachment_storage_mb?: number | null
  max_context_tokens?: number | null
  allow_all_models?: boolean
  model_access?: RoleAiModelAccessItem[]
}

export interface AiProviderModelOption {
  model_id: string
  name: string
  reasoning: boolean
  efforts: string[]
  can_disable: boolean
  default_effort: string | null
  vision: boolean | null
}

export interface AiProviderAvailable {
  id: number
  name: string
  default_model: string
  enabled_models?: string[]
  allow_all_models?: boolean
  models?: AiProviderModelOption[]
  requires_api_key: boolean
  operator_key_available: boolean
  available: boolean
  /** Ob bei diesem Modell ueberhaupt nachgedacht werden kann. */
  reasoning: boolean
  /**
   * Die waehlbaren Denkstufen, flach nach tief — **bereits auf die Rolle des
   * Benutzers geklemmt**. Leer heisst nicht "denkt nicht", sondern "kennt
   * keine Stufen": gemessen koennen 145 der 272 denkenden Modelle bei
   * OpenRouter nur an oder aus.
   */
  efforts: string[]
  /** Ob "aus" eine gueltige Wahl ist. Bei 82 der 402 Modelle nicht. */
  can_disable: boolean
  /** Was gilt, wenn nichts gewaehlt wird. */
  default_effort: string | null
}

/** Ein von MSM unterstuetzter Anbieter — die Auswahl im Einrichtungsformular. */
export interface AiProviderKind {
  kind: string
  label: string
  /**
   * Bei einem Anbieter mit `ressource_noetig` eine **Vorlage** mit
   * `{ressource}` darin und keine fertige Adresse. Absicht: der Hinweis unter
   * der Anbieterauswahl zeigt damit, wo der eingetippte Name landet.
   */
  base_url: string
  key_url: string
  key_prefix: string | null
  /**
   * Wofür dieser Zugang taugt. `chat_completions` ist das Modell, das denkt
   * (und im Sprachmodus zusaetzlich zuhoert), `tts` die Stimme, die vorliest —
   * zwei verschiedene APIs, die sich nicht gegenseitig vertreten. Ein
   * Stimmzugang erscheint deshalb gar nicht erst in der Modellauswahl des
   * Chats.
   *
   * Das Feld entscheidet ausserdem, welches Zusatzfeld das Formular zeigt: das
   * hoerende Modell beim einen, die Stimm-Kennung beim anderen.
   */
  protokoll: 'chat_completions' | 'tts'
  /**
   * Ob der Modellkatalog dieses Anbieters den Schlüssel braucht. Wenn ja,
   * bleibt die Modelliste leer, bis der Zugang mit Schlüssel gespeichert ist —
   * das ist kein Fehler, sondern die Reihenfolge.
   */
  katalog_braucht_schluessel: boolean
  /**
   * Ob dieser Anbieter den Namen einer Ressource des Betreibers braucht.
   *
   * Das Feld steht hier, damit das Formular das Eingabefeld zeigen kann,
   * **ohne** einen Anbieter beim Namen zu kennen. Ein
   * `provider_kind === 'azure_openai'` waere die Registry an einem zweiten
   * Ort, und der erste vergessene Eintrag darin ein Anbieter, den man nicht
   * einrichten kann.
   */
  ressource_noetig: boolean
  /**
   * Ob dieser Anbieter eine frei eingetragene Basis-URL samt Protokoll,
   * Reasoning-Dialekt und optionalen Modellgrenzen entgegennimmt (`custom`).
   */
  adresse_eintragbar?: boolean
  /**
   * Ob dieser Anbieter ueberhaupt eine Modelliste fuehrt.
   *
   * `false` heisst **nicht** „Katalog gerade nicht erreichbar": bei Azure
   * heisst ein Modell so, wie der Betreiber sein Deployment genannt hat, und
   * eine Liste dafuer gibt es nicht. Ohne diese Unterscheidung meldete die
   * Oberflaeche eine Stoerung, die keine ist.
   */
  fuehrt_katalog: boolean
  /**
   * Ob dieser Anbieter Gesprochenes in Text wandeln kann.
   *
   * Ein Chatanbieter ohne Gehoer gibt es seit Azure. `false` heisst: der
   * Sprachmodus greift auf diesen Zugang nie zu, gleich was im Feld fuer das
   * hoerende Modell steht — deshalb zeigt das Formular es dann gar nicht erst.
   */
  kann_hoeren: boolean
  realtime_tauglich?: boolean
  /**
   * Die Sprachwege dieses Anbieters, in der Reihenfolge, in der sie ein Modell
   * erkennen — dieselben Felder, nach denen der Server prüft
   * (`services/ai_voice/sprachwege.py`).
   */
  sprachwege?: AiSprachweg[]
}

/**
 * Ein Sprachweg: welche Echtzeit-Schnittstelle ein Sprachmodell spricht.
 *
 * Ein Modell gehört zu einem Weg, wenn seine Kennung `merkmal` enthält und
 * keinen der `ausschluesse` — dieselbe Regel wie `Sprachweg.passt` im Server.
 * Eine zweite, klügere Regel hier wäre eine zweite Antwort auf dieselbe Frage.
 */
export interface AiSprachweg {
  weg: 'openai_realtime' | 'openai_live' | 'gemini_live' | (string & {})
  merkmal: string
  ausschluesse: string[]
  stimmen: string[]
  empfohlene_stimmen: string[]
  empfohlene_modelle: string[]
  denkstufen: string[]
  /** Nur Modelle mit diesem Teilwort nehmen eine Denkstufe an; `null`: jedes. */
  denkstufen_merkmal: string | null
  /** Die Denkstufe gilt dem Backend-Modell, nicht der Stimme (GPT-Live). */
  denkt_im_backend: boolean
  vad: boolean
  audiopreise: boolean
  minutenpreis: boolean
  backend_modell: boolean
}

/** Ein Modell aus dem Katalog des Anbieters, mit seinen Denkfaehigkeiten. */
export interface AiCatalogModel {
  model_id: string
  name: string
  /**
   * Ob das Modell nachdenkt. `null` heisst „der Katalog sagt dazu nichts" und
   * nie „denkt nicht". Bis zum 22.09.2026 kam hier `false`, und GPT-6 Luna
   * stand am Erscheinungstag mit „Dieses Modell denkt nicht nach" da.
   */
  reasoning: boolean | null
  efforts: string[]
  default_effort: string | null
  mandatory: boolean
  /**
   * Das von MSM empfohlene Modell — die einzige Angabe hier, die nicht vom
   * Anbieter stammt. Hoechstens eines je Katalog, und keines, wenn der Anbieter
   * die empfohlene Kennung nicht mehr fuehrt.
   */
  recommended: boolean
  /**
   * Ob dieses Modell Bilder lesen kann. `null` heisst „der Katalog sagt nichts
   * dazu" und nie „sieht nichts".
   *
   * Steht hier, weil die KI im Chat nie technisch darueber spricht: kann sie
   * nicht hinsehen, sagt sie das als eine Faehigkeit, die ihr fehlt. Wer
   * wissen will, woran es liegt, sieht an der Stelle nach, an der er das
   * Modell waehlt — also hier.
   */
  vision: boolean | null
  /** Das Kontextfenster in Token, `null` wenn der Katalog es nicht nennt. */
  context_tokens: number | null
  /** Die laengste Antwort in Token, `null` wenn der Katalog sie nicht nennt. */
  max_output_tokens: number | null
  /**
   * Der angekuendigte Abschalttag des Herstellers als ISO-Datum, oder `null`.
   * Nie der eines Vermittlers: OpenRouters Tag sagt, wann OpenRouter ein
   * Modell aus seiner Liste nimmt, nicht wann OpenAI es abschaltet.
   */
  shutdown_date: string | null
}

/** Zustand der Websuch-Konfiguration. */
export interface AiWebSearchStatus {
  configured: boolean
  search_engine_configured?: boolean
  ai_enabled?: boolean
  has_api_key?: boolean
  external_apis_on_custom?: boolean
  searxng_url?: string | null
  default_searxng_url?: string | null
  is_default_searxng?: boolean
  custom_searxng_url?: string | null
  sidecar_running?: boolean
}

/** Nur der Zustand — Satelliten-Zugangsdaten verlassen das Backend nie. */
export interface AiSatelliteStatus {
  configured: boolean
}

export interface AiMapTilerStatus {
  configured: boolean
}

export interface AiMapTilerMapConfig extends AiMapTilerStatus {
  style_url: string | null
}

/** Nur der Zustand; der TomTom-Schlüssel bleibt im Backend. */
export interface AiTomTomStatus {
  configured: boolean
  traffic_status?: 'available' | 'not_configured' | 'unavailable' | null
  reason?: 'invalid_key' | 'traffic_not_enabled' | 'no_coverage' | 'rate_limited' | 'network_error' | 'provider_error' | 'invalid_response' | null
}

export interface AiSatelliteLayer {
  id: string
  name: string
  url: string
  resolution?: string
  mission?: string
  description?: string
  /**
   * `scene`: eine Sentinel-2-Szene mit Aufnahmezeitpunkt. `map`: das
   * Kartenbild, ein Mosaik ohne Zeitpunkt — nie als Überflug anzeigen.
   * Fehlt bei Ständen von vor 09/2026.
   */
  kind?: 'scene' | 'map'
  scene_id?: string
  /** Der Ausschnitt des Kartenbilds, mit dem es das Panel holt (`kind: 'map'`). */
  bbox?: [number, number, number, number]
  captured_at?: string
  cloud_cover_percent?: number | null
  /** Die Quellennennung, die neben dem Bild stehen muss. */
  attribution?: string
}

export interface AiSatelliteScene {
  id: string
  mission: string
  datetime: string
  cloud_cover_percent: number | null
  preview_url: string
  layers?: Record<string, AiSatelliteLayer>
}

export interface AiRegionalAnalysis {
  status: 'success' | 'error'
  location: string
  country: string
  coordinates: {
    latitude: number
    longitude: number
    bbox: [number, number, number, number]
  }
  weather?: {
    temperature_celsius: number
    apparent_temperature_celsius: number
    humidity_percent: number
    precipitation_mm: number
    wind_speed_kmh: number
    condition: string
  } | null
  satellite?: {
    available: boolean
    scenes: AiSatelliteScene[]
    layers?: Record<string, AiSatelliteLayer>
  } | null
  news?: Array<{
    title?: string
    url?: string
    snippet?: string
    description?: string
    content?: string
    published_date?: string
  }>
  news_status?: 'pending' | 'available' | 'not_allowed' | 'not_configured' | 'unavailable'
  traffic?: {
    status: 'available' | 'not_configured' | 'unavailable'
    reason?: 'invalid_key' | 'traffic_not_enabled' | 'no_coverage' | 'rate_limited' | 'network_error' | 'provider_error' | 'invalid_response'
    current_speed_kmh?: number
    free_flow_speed_kmh?: number
    current_travel_time_seconds?: number
    free_flow_travel_time_seconds?: number
    confidence?: number
    road_closure?: boolean
  }
  public_posts?: {
    status: 'available' | 'unavailable'
    reddit: Array<{ title: string; snippet: string; url: string }>
    bluesky: Array<{ author: string; text: string; url: string }>
    untrusted: true
  }
  camera?: {
    mode: 'overview' | 'focus' | 'detail'
    action?: 'zoom_in' | 'zoom_out' | 'overview' | 'focus_location'
    command_id?: string
  }
  sights?: Array<{
    latitude: number
    longitude: number
    name: string
    summary?: string
    commandId: string
  }>
}

export interface AiGeoCameraCommand {
  action: 'zoom_in' | 'zoom_out' | 'overview' | 'focus_location'
  command_id: string
  location?: string
  country?: string
  coordinates?: AiRegionalAnalysis['coordinates']
}

export interface AiGuardianPolicy {
  enabled: boolean
}

export interface AiProviderTestResult {
  ok: boolean
  code: string | null
  detail: string | null
}

/**
 * Was der Sprachmodus braucht, um überhaupt angeboten zu werden.
 *
 * OpenAI Realtime hat panelweit Vorrang. Ohne diese Auswahl beschreibt der
 * Vertrag weiterhin den Legacy-Weg aus Transkriptions- und Stimmzugang.
 * `available=false` blendet den Sprachknopf vollständig aus.
 */
export interface AiVoiceConfig {
  available: boolean
  mode?: 'legacy' | 'openai_realtime' | 'openai_live' | 'gemini_live'
  /** Nur zur Anzeige. `null`, solange nichts eingerichtet ist. */
  model: string | null
  /**
   * Die Voice ID des Stimmzugangs, nur zur Anzeige. `null`, solange keiner
   * eingerichtet ist — aufgelöst wird nichts, eine Standardstimme gibt es
   * nicht. Sinnvoll belegt nur, solange `available` wahr ist.
   */
  voice: string | null
  language?: string
  reasoning_effort?: string | null
  /**
   * Nur bei GPT-Live: das Modell, das hinter der Stimme nachdenkt — die
   * Denkstufe darüber gehört dann ihm.
   */
  backend_model?: string | null
  dictation_available?: boolean
  dictation_monthly_limit_minutes?: number | null
  dictation_used_seconds?: number
  dictation_remaining_seconds?: number | null
  sample_rate: number
  max_seconds: number
  /**
   * Fähigkeitsmarker: dieses Backend nimmt das Bearer-Token als
   * WebSocket-Subprotokoll an (der Weg der Desktop-App). Fehlt das Feld,
   * ist das Backend älter als der App-Sprachmodus — die App zeigt dann
   * „Panel zu alt" statt eines nichtssagenden Verbindungsfehlers.
   */
  bearer_ws?: boolean
}

/**
 * Wie Beträge angezeigt werden. Nicht, wie sie gebucht werden.
 *
 * Gebucht wird ausnahmslos in US-Cent-Microunits. Diese beiden Angaben machen
 * daraus einen Betrag in der Währung des Betreibers — angewandt genau einmal,
 * in `utils/geld.ts`.
 */
export interface AiCostPolicy {
  currency: string
  usd_rate: string
  available_currencies: string[]
  min_rate: string
  max_rate: string
}

/**
 * Der Verbrauch eines Benutzers in denselben Zeiträumen wie die Grenzen.
 *
 * Kosten kommen in **US-Cent-Microunits** (1 Cent = 10.000) — der Einheit, in
 * der auch gebucht wird. Hier standen einmal aufgerundete Cent; für eine
 * Monatssumme war das harmlos, für eine einzelne Anfrage nicht. Gerundet wird
 * jetzt erst beim Anzeigen, mit `betragFormatieren`.
 */
export interface AiUsageEntry {
  user_id: number
  username: string
  tokens_5h?: number
  tokens_today: number
  tokens_week: number
  tokens_month: number
  cost_month_micro_usd: number
  requests_month: number
  /** Letzte Anfrage im ausgewerteten Zeitraum, nicht die letzte überhaupt. */
  last_request_at: string | null
  /** Sprach- und Diktiersekunden der letzten 30 Tage. */
  realtime_seconds_month: number
  dictation_seconds_month: number
}

/** Alle Benutzer mit Verbrauch. Wer nichts verbraucht hat, fehlt. */
export interface AiUsageOverview {
  entries: AiUsageEntry[]
  total_tokens_month: number
  total_cost_month_micro_usd: number
  cost_policy: AiCostPolicy
}

/**
 * Eine einzelne Anfrage, so wie der Anbieter sie gemeldet hat.
 *
 * Der Nachweis hinter den Summen — und die einzige Ansicht, mit der sich „das
 * kann nicht stimmen" prüfen lässt: Zeile für Zeile gegen das Dashboard des
 * Anbieters, mit `cost_source` als Auskunft, ob überhaupt gemessen wurde.
 */
export interface AiUsageEvent {
  id: number
  created_at: string
  user_id: number
  username: string
  model: string | null
  /** Die verbuchte Gesamtzahl — die, an der die Kontingente hängen. */
  tokens: number
  prompt_tokens: number | null
  completion_tokens: number | null
  /** Teilmenge von `prompt_tokens`. Wer sie addiert, zählt doppelt. */
  cached_tokens: number | null
  /** Die Gegenzahl dazu: was in den Zwischenspeicher geschrieben wurde. */
  cache_write_tokens: number | null
  reasoning_tokens: number | null
  realtime_text_input_tokens?: number | null
  realtime_text_output_tokens?: number | null
  realtime_audio_input_tokens?: number | null
  realtime_audio_output_tokens?: number | null
  /** Eine Chatnachricht ist nicht eine Anfrage: jede Werkzeugrunde ruft neu. */
  provider_requests: number | null
  cost_micro_usd: number
  /** `null` bei Zeilen aus der Zeit vor der Aufschlüsselung. */
  cost_source: 'provider' | 'estimate' | 'none' | null
  /**
   * Wozu MSM die Anfrage für den Benutzer gestellt hat: Ethik-Beratung vor
   * einem Werkzeug oder der Gedächtnisschreiber. `null` hat er selbst gefragt.
   */
  zweck?: 'ethik' | 'gedaechtnis' | null
}

export interface AiUsageEvents {
  entries: AiUsageEvent[]
  has_more: boolean
  cost_policy: AiCostPolicy
}

/** Der eigene Verbrauch — mit den Grenzen daneben, gegen die er läuft. */
export interface AiUsageMine extends AiUsageEntry {
  cost_policy: AiCostPolicy
  reset_5h_at?: string | null
  reset_today_at?: string | null
  reset_week_at?: string | null
  reset_month_at?: string | null
  limits: {
    five_hour_token_limit?: number | null
    daily_token_limit: number | null
    weekly_token_limit: number | null
    monthly_token_limit: number | null
    monthly_realtime_minutes_limit: number | null
    monthly_dictation_minutes_limit: number | null
    role_ids: number[]
  }
}

export interface AiProviderWrite {
  name: string
  provider_kind: string
  default_model?: string | null
  enabled: boolean
  requires_api_key: boolean
  token_price_micro_usd_per_million?: number | null
  standard_input_price_micro_usd_per_million?: number | null
  standard_output_price_micro_usd_per_million?: number | null
  standard_cache_price_micro_usd_per_million?: number | null
  worker_input_price_micro_usd_per_million?: number | null
  worker_output_price_micro_usd_per_million?: number | null
  worker_cache_price_micro_usd_per_million?: number | null
  ethics_input_price_micro_usd_per_million?: number | null
  ethics_output_price_micro_usd_per_million?: number | null
  ethics_cache_price_micro_usd_per_million?: number | null
  memory_input_price_micro_usd_per_million?: number | null
  memory_output_price_micro_usd_per_million?: number | null
  memory_cache_price_micro_usd_per_million?: number | null
  search_summary_input_price_micro_usd_per_million?: number | null
  search_summary_output_price_micro_usd_per_million?: number | null
  search_summary_cache_price_micro_usd_per_million?: number | null
  standard_enabled?: boolean
  worker_enabled?: boolean
  ethics_enabled?: boolean
  memory_enabled?: boolean
  search_summary_enabled?: boolean
  transcription_enabled?: boolean
  realtime_enabled?: boolean
  /**
   * Nur ein Sprachzugang schickt das Feld mit; ein Chatzugang laesst es weg,
   * statt `null` zu senden. Der Unterschied zaehlt, weil `PATCH` in die
   * vorhandene Zeile mischt: „nicht genannt" laesst die Stimme stehen,
   * ausdrueckliches `null` nimmt sie zurueck.
   */
  default_voice?: string | null
  transcription_model?: string | null
  realtime_default?: boolean
  realtime_model?: string | null
  realtime_voice?: AiProviderAdmin['realtime_voice']
  realtime_reasoning_effort?: AiProviderAdmin['realtime_reasoning_effort']
  realtime_language?: AiProviderAdmin['realtime_language']
  realtime_vad_eagerness?: AiProviderAdmin['realtime_vad_eagerness']
  realtime_text_input_price_micro_usd_per_million?: number | null
  realtime_text_output_price_micro_usd_per_million?: number | null
  realtime_audio_input_price_micro_usd_per_million?: number | null
  realtime_audio_output_price_micro_usd_per_million?: number | null
  realtime_backend_model?: string | null
  realtime_minute_price_micro_usd?: number | null
  /**
   * Wie `default_voice`: „nicht genannt" lässt den Stand stehen,
   * ausdrückliches `null` schaltet den Hintergrund-Betrieb ab.
   */
  worker_model?: string | null
  worker_reasoning_effort?: string | null
  ethics_model?: string | null
  ethics_reasoning_effort?: string | null
  ethics_mode?: 'off' | 'auto' | 'always' | 'critical'
  memory_model?: string | null
  search_summary_model?: string | null
  /** Feste Denkstufe der Suchzusammenfassung; `null` heißt ohne Denken (schnellste Antwort). */
  search_summary_reasoning_effort?: string | null
  /**
   * Wie `default_voice`: „nicht genannt" laesst den Namen stehen,
   * ausdrueckliches `null` nimmt ihn zurueck. Der Unterschied zaehlt hier
   * doppelt — ein **geaenderter** Ressourcenname loescht serverseitig den
   * gespeicherten Schluessel, ein nicht mitgeschickter nicht.
   */
  azure_resource_name?: string | null
  custom_base_url?: string | null
  custom_chat_protocol?: CustomChatProtocol
  custom_reasoning_dialect?: CustomReasoningDialect
  custom_context_tokens?: number | null
  custom_max_output_tokens?: number | null
  custom_supports_vision?: boolean | null
  disable_safety?: boolean
  enabled_models?: string[] | null
  allow_all_models?: boolean
  operator_api_key?: string
  clear_operator_api_key?: boolean
}

export interface AiRouterPoolEntry {
  provider_id: number
  model: string
  provider_name?: string
  available?: boolean
}

export interface AiRouterAvailableProviderModels {
  provider_id: number
  provider_name: string
  provider_kind: string
  models: string[]
}

export interface AiRouterConfig {
  enabled: boolean
  router_provider_id: number | null
  ready: boolean
  eco_models: AiRouterPoolEntry[]
  standard_models: AiRouterPoolEntry[]
  flagship_models: AiRouterPoolEntry[]
  fallback_models: AiRouterPoolEntry[]
  eco_weight: number
  standard_weight: number
  flagship_weight: number
  fallback_weight: number
  available_providers: AiRouterAvailableProviderModels[]
  updated_at: string | null
}

export interface AiRouterConfigUpdate {
  enabled?: boolean
  eco_models?: Array<{ provider_id: number; model: string }>
  standard_models?: Array<{ provider_id: number; model: string }>
  flagship_models?: Array<{ provider_id: number; model: string }>
  fallback_models?: Array<{ provider_id: number; model: string }>
  eco_weight?: number
  standard_weight?: number
  flagship_weight?: number
  fallback_weight?: number
}
