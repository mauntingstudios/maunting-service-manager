import { api } from '../client'
import type {
  AiCatalogModel,
  AiCostPolicy,
  AiGuardianPolicy,
  AiMapTilerMapConfig,
  AiMapTilerStatus,
  AiProviderAdmin,
  AiProviderAvailable,
  AiProviderKind,
  AiProviderTestResult,
  AiProviderWrite,
  AiSatelliteStatus,
  AiTomTomStatus,
  AiUsageEvents,
  AiUsageMine,
  AiUsageOverview,
  AiVoiceConfig,
  AiWebSearchStatus,
  CustomChatProtocol,
} from './providerTypes'
import type { AiWorkerPolicy } from './chatTypes'
import type {
  AiContextPolicy,
  AiLearningPolicy,
  AiMemorySearchFallback,
  AiMemorySearchPolicy,
} from './memoryTypes'

export const providersApi = {
  listProviderSettings: () => api<AiProviderAdmin[]>('/ai/settings/providers'),
  createProvider: (payload: AiProviderWrite) => api<AiProviderAdmin>('/ai/settings/providers', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  updateProvider: (id: number, payload: Partial<AiProviderWrite>) => api<AiProviderAdmin>(`/ai/settings/providers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  }),
  deleteProvider: (id: number) => api(`/ai/settings/providers/${id}`, { method: 'DELETE' }),
  listProviders: () => api<AiProviderAvailable[]>('/ai/providers'),
  listProviderKinds: () => api<AiProviderKind[]>('/ai/settings/provider-kinds'),
  /**
   * Die Modelle eines Anbieters. `refresh` umgeht den Zwischenspeicher.
   *
   * `providerId` nennt den Zugang, dessen Schlüssel den Katalog holt. Nur
   * nötig bei Anbietern mit `katalog_braucht_schluessel` (OpenAI); OpenRouter
   * gibt seine Liste offen heraus. Fehlt der Schlüssel, kommt eine leere
   * Liste — beim Anlegen eines Zugangs gibt es ihn noch gar nicht.
   */
  listCatalogModels: (kind: string, refresh = false, providerId?: number, apiKey?: string) => {
    const frage = new URLSearchParams()
    if (refresh) frage.set('refresh', 'true')
    if (providerId !== undefined) frage.set('provider_id', String(providerId))
    const headers: Record<string, string> = {}
    if (apiKey?.trim()) {
      // **Nur im Kopf, nie im Abfrageteil.** Hier stand der Schlüssel zusätzlich
      // als `api_key=…` in der Adresse — und eine Adresse landet in der
      // Zugriffszeile von Caddy und uvicorn, im Verlauf des Browsers und im
      // `Referer`. Aus keiner der drei Ablagen bekommt man ihn wieder heraus.
      // Der Server liest ihn seit derselben Änderung ausschliesslich hier.
      headers['X-Provider-Api-Key'] = apiKey.trim()
    }
    const anhang = frage.toString()
    return api<AiCatalogModel[]>(
      `/ai/settings/provider-kinds/${encodeURIComponent(kind)}/models${anhang ? `?${anhang}` : ''}`,
      apiKey?.trim() ? { headers } : undefined,
    )
  },
  /**
   * Ein **einzelnes** Modell — für Anbieter, die keine Liste führen.
   *
   * Bei Azure heisst ein Modell so, wie der Betreiber sein Deployment genannt
   * hat; einen Katalog zum Durchblättern gibt es nicht. Ohne diesen Weg bliebe
   * die Auswahl der Worker-Denkstufe dort leer, weil sie an der Katalogliste
   * hängt. `null` heisst „unter dieser Kennung ist nichts bekannt" — dann
   * zeigt die Oberfläche keine Stufen statt erfundener.
   */
  findCatalogModel: (kind: string, name: string, providerId?: number) => {
    const base = `/ai/settings/provider-kinds/${encodeURIComponent(kind)}/model?name=${encodeURIComponent(name)}`
    const url = providerId !== undefined ? `${base}&provider_id=${encodeURIComponent(String(providerId))}` : base
    return api<AiCatalogModel | null>(url)
  },
  previewCustomCatalogModels: (
    payload: {
      custom_base_url: string
      custom_chat_protocol: CustomChatProtocol
      provider_id?: number
    },
    apiKey?: string,
  ) => {
    const headers: Record<string, string> = {}
    if (apiKey?.trim()) {
      headers['X-Provider-Api-Key'] = apiKey.trim()
    }
    return api<AiCatalogModel[]>('/ai/settings/providers/custom-models-preview', {
      method: 'POST',
      body: JSON.stringify(payload),
      ...(apiKey?.trim() ? { headers } : {}),
    })
  },
  testProvider: (id: number) => api<AiProviderTestResult>(`/ai/settings/providers/${id}/test`, {
    method: 'POST',
  }),
  /**
   * Ob gesprochen werden kann. Braucht nur `ai.voice.use` — die Antwort nennt
   * keinen Schlüssel und keinen Zugang, nur die Modellkennung.
   */
  getVoiceConfig: (providerId?: number | null) =>
    api<AiVoiceConfig>(providerId ? `/ai/voice/config?provider_id=${providerId}` : '/ai/voice/config'),
  transcribeVoice: (providerId: number, pcm: ArrayBuffer) =>
    api<{ text: string }>(`/ai/voice/transcribe?provider_id=${providerId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: pcm,
    }),
  /**
   * Der eigene Verbrauch. Ohne Sonderrecht — wer von der KI wegen des
   * Kontingents abgewiesen wird, muss nachsehen können, woran es lag.
   */
  getMyUsage: () => api<AiUsageMine>('/ai/usage/me'),
  /** Alle Benutzer. Verlangt `ai.usage.read.all`. */
  getUsageOverview: () => api<AiUsageOverview>('/ai/usage'),
  /** Die eigenen Anfragen einzeln — der Nachweis hinter den eigenen Summen. */
  getMyUsageEvents: (limit = 50, offset = 0) =>
    api<AiUsageEvents>(`/ai/usage/me/events?limit=${limit}&offset=${offset}`),
  /** Alle Anfragen einzeln. Verlangt `ai.usage.read.all`. */
  getUsageEvents: (limit = 50, offset = 0) =>
    api<AiUsageEvents>(`/ai/usage/events?limit=${limit}&offset=${offset}`),
  getCostPolicy: () => api<AiCostPolicy>('/ai/settings/cost'),
  /** `usdRate` darf bei USD fehlen — dort gibt es keinen Kurs. */
  setCostPolicy: (currency: string, usdRate: string | null) =>
    api<AiCostPolicy>('/ai/settings/cost', {
      method: 'PUT',
      body: JSON.stringify({ currency, usd_rate: usdRate }),
    }),
  getWebSearchStatus: () => api<AiWebSearchStatus>('/ai/settings/web-search'),
  /** Leerer Schluessel entfernt ihn — dann verschwindet auch das Werkzeug. */
  setWebSearchKey: (apiKey: string) => api<AiWebSearchStatus>('/ai/settings/web-search', {
    method: 'PUT',
    body: JSON.stringify({ api_key: apiKey || null }),
  }),
  setWebSearchConfig: (payload: {
    apiKey?: string | null
    searxngUrl?: string | null
    aiEnabled?: boolean
    externalApisOnCustom?: boolean
  }) =>
    api<AiWebSearchStatus>('/ai/settings/web-search', {
      method: 'PUT',
      body: JSON.stringify({
        api_key: payload.apiKey !== undefined ? (payload.apiKey || null) : undefined,
        searxng_url: payload.searxngUrl !== undefined ? (payload.searxngUrl || null) : undefined,
        ai_enabled: payload.aiEnabled,
        external_apis_on_custom: payload.externalApisOnCustom,
      }),
    }),
  getSatelliteStatus: () => api<AiSatelliteStatus>('/ai/settings/satellite'),
  setSatelliteCredentials: (clientId: string, clientSecret: string) =>
    api<AiSatelliteStatus>('/ai/settings/satellite', {
      method: 'PUT',
      body: JSON.stringify({ client_id: clientId || null, client_secret: clientSecret || null }),
    }),
  getMapTilerStatus: () => api<AiMapTilerStatus>('/ai/settings/maptiler'),
  setMapTilerKey: (apiKey: string) => api<AiMapTilerStatus>('/ai/settings/maptiler', {
    method: 'PUT',
    body: JSON.stringify({ api_key: apiKey || null }),
  }),
  getMapTilerMapConfig: () => api<AiMapTilerMapConfig>('/ai/maptiler/config'),
  getTomTomStatus: () => api<AiTomTomStatus>('/ai/settings/tomtom'),
  setTomTomKey: (apiKey: string) => api<AiTomTomStatus>('/ai/settings/tomtom', {
    method: 'PUT',
    body: JSON.stringify({ api_key: apiKey || null }),
  }),
  testTomTomConnection: () => api<AiTomTomStatus>('/ai/settings/tomtom/test', { method: 'POST' }),
  getLearningPolicy: () => api<AiLearningPolicy>('/ai/settings/learning'),
  setLearningPolicy: (policy: AiLearningPolicy['policy']) => api<AiLearningPolicy>('/ai/settings/learning', {
    method: 'PUT', body: JSON.stringify({ policy }),
  }),
  getGuardianPolicy: () => api<AiGuardianPolicy>('/ai/settings/guardian'),
  setGuardianPolicy: (enabled: boolean) => api<AiGuardianPolicy>('/ai/settings/guardian', {
    method: 'PUT', body: JSON.stringify({ enabled }),
  }),
  getContextPolicy: () => api<AiContextPolicy>('/ai/settings/context'),
  setContextPolicy: (percent: number) => api<AiContextPolicy>('/ai/settings/context', {
    method: 'PUT', body: JSON.stringify({ compaction_percent: percent }),
  }),
  getMemorySearchPolicy: () => api<AiMemorySearchPolicy>('/ai/settings/memory-search'),
  setMemorySearchPolicy: (fallback: AiMemorySearchFallback) =>
    api<AiMemorySearchPolicy>('/ai/settings/memory-search', {
      method: 'PUT', body: JSON.stringify({ fallback }),
    }),
  getWorkerPolicy: () => api<AiWorkerPolicy>('/ai/settings/worker'),
  setWorkerPolicy: (maxParallelWorkers: number, roundsPerWorker: number) =>
    api<AiWorkerPolicy>('/ai/settings/worker', {
      method: 'PUT',
      body: JSON.stringify({
        max_parallel_workers: maxParallelWorkers,
        rounds_per_worker: roundsPerWorker,
      }),
    }),
}
