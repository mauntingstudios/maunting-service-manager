/**
 * Rollenbasierte KI-Kontingente. Die Ansicht ist nur Konfiguration: Das
 * Backend löst mehrere Rollen auf und erzwingt die Werte an den AI-Endpunkten.
 *
 * Es wird bewusst immer nur *eine* Rolle gleichzeitig gezeigt. Vorher standen
 * alle Rollen mit je sechs Zahlenfeldern untereinander — bei einer Handvoll
 * Rollen war die Seite nicht mehr überschaubar und man verlor beim Scrollen,
 * welches Feld zu welcher Rolle gehört.
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BarChart3, Bot, KeyRound, Save, Sliders, Sparkles } from 'lucide-react'

import { api, SanitizedApiError } from '@/api/client'
import { type AiProviderAdmin, type RoleAiModelAccessItem } from '@/api/ai'
import { AiMemoryManager } from '@/components/ai/AiMemoryManager'
import { AiSkillManager } from '@/components/ai/AiSkillManager'
import { TabBar, TabDef } from '@maunting/ui'
import { useHasPermission } from '@/hooks/useHasPermission'
import { Button, Dropdown, NumberStepper, Switch } from '@maunting/ui'
import { toast } from '@/stores/toastStore'
import { AiContextSettings } from './AiContextSettings'
import { AiCostSettings } from './AiCostSettings'
import { AiWorkerSettings } from './AiWorkerSettings'
import { AiGuardianSettings } from './AiGuardianSettings'
import { AiMemorySearchSettings } from './AiMemorySearchSettings'
import { AiLearningSettings } from './AiLearningSettings'
import { AiProvidersSettings } from './AiProvidersSettings'
import { AiUsageSettings } from './AiUsageSettings'
import { AiWebSearchSettings } from './AiWebSearchSettings'
import { AiSatelliteSettings } from './AiSatelliteSettings'
import { AiMapTilerSettings } from './AiMapTilerSettings'
import { AiTomTomSettings } from './AiTomTomSettings'

import { Spinner } from '@maunting/ui'
export type AiSubTab = 'providers' | 'features' | 'limits' | 'usage'

const AI_TABS: TabDef<AiSubTab>[] = [
  { id: 'providers', labelKey: 'aiSettings.subtabs.providers', icon: KeyRound },
  { id: 'features', labelKey: 'aiSettings.subtabs.features', icon: Sparkles },
  { id: 'limits', labelKey: 'aiSettings.subtabs.limits', icon: Sliders },
  { id: 'usage', labelKey: 'aiSettings.subtabs.usage', icon: BarChart3 },
]

export interface AiRoleLimits {
  role_id: number
  role_name: string
  /** False heisst: für diese Rolle ist nichts gespeichert (alle Werte null). */
  configured: boolean
  daily_token_limit: number | null
  weekly_token_limit: number | null
  monthly_token_limit: number | null
  monthly_realtime_minutes_limit: number | null
  monthly_dictation_minutes_limit: number | null
  /**
   * Wieviele Memory-Eintraege in **je einem Bereich** liegen duerfen — hier
   * stand vorher „was ein Benutzer dieser Rolle anlegen darf", und das war
   * falsch. Gezaehlt wird je scope_identity: persoenlich allgemein, je Server
   * und je Team. „Je Server" meint dabei die persoenlichen Notizen zu einem
   * Server; das geteilte „Wissen dieses Servers" ist ein anderer Bereich und
   * haengt wie das panelweite Gedaechtnis an gar keiner Rolle. Wieviele
   * Bereiche es gibt, bestimmt der Benutzer selbst; wer 20 Server sieht, hat
   * bei „25" nicht 25 Eintraege, sondern 25 persoenliche plus 25 je Server
   * plus 25 je selbst gegruendetem Team.
   *
   * `null` heisst unbegrenzt — dieselbe Bedeutung wie bei den Kontingenten
   * darueber, 0 sperrt. Bis zum 05.10.2026 machte das Backend aus `null` hier
   * still die Systemgrenze von 100, waehrend der Schalter „Unbegrenzt" zeigte.
   * Der Kontextaufbau bleibt auch bei unbegrenztem Vorrat ueber
   * `MAX_CONTEXT_ROWS` gedeckelt.
   *
   * Team-Gedaechtnis zaehlt gegen das Limit des Team-Gruenders, nicht gegen das
   * des schreibenden Mitglieds. Das ist an der Oberflaeche sonst nicht zu
   * erraten: wer hier eine Rolle knapp haelt, begrenzt damit auch die Teams,
   * die ein Traeger dieser Rolle gegruendet hat.
   */
  max_memory_entries: number | null
  /**
   * Hoechste erlaubte Denktiefe als Rang: 0 = gar nicht, 1 = minimal … 6 = max.
   * `null` heisst unbegrenzt — dieselbe Bedeutung wie bei den Kontingenten.
   *
   * Ein Rang und kein Wort, weil jedes Modell andere Stufen kennt: gemessen
   * gibt es bei OpenRouter 20 verschiedene Stufenlisten. Gewaehlt wird spaeter
   * aus den echten Stufen des Modells, der Rang vergleicht nur.
   */
  max_reasoning_effort: number | null
  max_attachment_storage_mb: number | null
  /**
   * Obergrenze fuer die Eingabe **einer** Anfrage in Token, unabhaengig vom
   * Fenster des gewaehlten Modells. `null` heisst hier „nichts hinterlegt" —
   * dann gilt der Standard von 44.000. Anders als bei den Feldern darueber
   * heisst `null` **nicht** unbegrenzt: ein unbegrenzter Deckel waere genau
   * der Zustand, den diese Einstellung beendet.
   */
  max_context_tokens: number | null
  allow_all_models: boolean
  model_access?: RoleAiModelAccessItem[]
  updated_at: string | null
}

/**
 * Die Woerter zu den Raengen — dieselbe Reihenfolge wie
 * `services/ai_reasoning.RANGFOLGE` im Backend. Rang 0 ist „gar nicht" und hat
 * dort kein Wort; hier bekommt es eines, weil es in der Auswahl stehen muss.
 */
const REASONING_RANKS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/**
 * Grenzen des Anfragedeckels — spiegeln
 * `ai_context_window.DECKEL_MIN_TOKENS` / `DECKEL_MAX_TOKENS` im Backend.
 * Beide Zahlen werden von `test_ai_role_limits.py` gegen den Quelltext
 * verglichen; wer eine Seite verschiebt, bekommt dort einen roten Test statt
 * hier ein Formular, das gueltige Werte abweist.
 */
const KONTEXT_DECKEL_MIN = 44_000
const KONTEXT_DECKEL_MAX = 1_000_000

/**
 * Die Felder des Rasters. `max_context_tokens` steht bewusst nicht hier: das
 * Raster haengt an jedem Feld einen „Unbegrenzt"-Schalter, und `null` heisst
 * beim Deckel „Standard", nicht „unbegrenzt". Er bekommt eine eigene Karte.
 */
type LimitField = Exclude<
  keyof AiRoleLimits,
  | 'role_id'
  | 'role_name'
  | 'configured'
  | 'updated_at'
  | 'allow_all_models'
  | 'model_access'
  | 'max_context_tokens'
>

const FIELD_DEFINITIONS: Array<{
  key: LimitField
  labelKey: string
  max: number
  step: number
  /**
   * Statt eines Zahlenfelds eine Auswahl mit Woertern. Nur fuer die Denktiefe:
   * „4" sagt niemandem etwas, „hoch" schon. Alle uebrigen Felder sind echte
   * Mengen und bleiben Zahlen.
   */
  ranks?: readonly string[]
  /**
   * Ein ruhiger Satz unter dem Feld, fuer die Faelle, in denen Beschriftung und
   * Schalter allein in die Irre fuehren. Bisher hat das kein Feld gebraucht;
   * `max_memory_entries` braucht es, weil dort dreierlei nicht selbsterklaerend
   * ist: die Zahl gilt je Bereich, im Teambereich entscheidet die Rolle des
   * Gruenders statt der des Schreibenden, und Anlagen- wie Panelwissen haengen
   * an gar keiner Rolle.
   *
   * Schon einmal hat dieser Satz gelogen, weil er eine Rollenkarte beschrieb,
   * wo das Backend benutzerweit aufloest: er zaehlte den Teambereich auf, als
   * sei er von der eingestellten Zahl gedeckelt — wer „basic" auf 5 setzt,
   * deckelt damit aber kein einziges Team, dessen Gruender eine andere Rolle
   * traegt; ein Basic-Kunde schreibt im Team eines VIP-Gruenders weiterhin
   * dessen 500.
   *
   * Optional, damit die uebrigen Felder unveraendert bleiben — sie sagen genau
   * das, was ihre Beschriftung sagt.
   */
  hintKey?: string
}> = [
  // Muss `TOKEN_LIMIT_MAX` im Backend entsprechen: die Tokenspalten sind
  // PostgreSQL INTEGER, höhere Werte würden beim Speichern abbrechen.
  { key: 'daily_token_limit', labelKey: 'aiSettings.dailyTokens', max: 2_147_483_647, step: 1_000 },
  { key: 'weekly_token_limit', labelKey: 'aiSettings.weeklyTokens', max: 2_147_483_647, step: 10_000 },
  { key: 'monthly_token_limit', labelKey: 'aiSettings.monthlyTokens', max: 2_147_483_647, step: 10_000 },
  // Muss `REALTIME_MINUTES_LIMIT_MAX` im Backend entsprechen.
  {
    key: 'monthly_realtime_minutes_limit',
    labelKey: 'aiSettings.monthlyRealtimeMinutes',
    max: 100_000,
    step: 5,
    hintKey: 'aiSettings.monthlyRealtimeMinutesHint',
  },
  {
    key: 'monthly_dictation_minutes_limit',
    labelKey: 'aiSettings.monthlyDictationMinutes',
    max: 100_000,
    step: 10,
    hintKey: 'aiSettings.monthlyDictationMinutesHint',
  },
  // 5_000 muss `MAX_MEMORY_ENTRIES_MAX` im Backend entsprechen: dort steht die
  // Zahl nicht höher, weil sie den gespeicherten Bestand begrenzt — und der
  // wächst je Bereich, von denen ein Benutzer beliebig viele haben kann.
  // Als Begründung stand hier „weil jeder Eintrag beim Promptaufbau einzeln
  // entschlüsselt wird"; seit `MAX_CONTEXT_ROWS` entschlüsselt eine Chatanfrage
  // nur noch so viele Zeilen, egal wie groß der Vorrat ist. Was der Bestand
  // dagegen wirklich kostet — Ladezeit vor jeder Antwort und eine
  // Verwaltungsansicht, die jede Zeile einzeln entschlüsselt —, steht bei der
  // Konstante im Backend. Ein hier großzügigeres Maximum ließe den Betreiber
  // Werte eintragen, die das Backend abweist.
  // „Muss entsprechen" war bis eben eine blosse Bitte: die Zahl steht hier,
  // die Konstante dort, und keine Prüfung sah beide. `test_ai_role_limits.py`
  // liest diese Zeile jetzt und vergleicht sie — wer den Backend-Deckel
  // verschiebt, bekommt dort einen roten Test statt hier ein stilles Formular,
  // das gültige Werte abweist oder ungültige durchlässt.
  {
    key: 'max_memory_entries',
    labelKey: 'aiSettings.maxMemoryEntries',
    max: 5_000,
    step: 10,
    hintKey: 'aiSettings.maxMemoryEntriesHint',
  },
  {
    key: 'max_reasoning_effort',
    labelKey: 'aiSettings.maxReasoningEffort',
    max: REASONING_RANKS.length - 1,
    step: 1,
    ranks: REASONING_RANKS,
  },
  {
    key: 'max_attachment_storage_mb',
    labelKey: 'aiSettings.maxAttachmentStorageMb',
    max: 100_000,
    step: 10,
    hintKey: 'aiSettings.maxAttachmentStorageMbHint',
  },
]

/** Wandelt Stepper-Text nur dann um, wenn er eine sichere Ganzzahl darstellt. */
function parseLimitValue(raw: string, max: number, min = 0): number | null {
  if (!/^\d+$/.test(raw)) return null
  const value = Number(raw)
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : null
}

export function AiTab() {
  const { t } = useTranslation()
  const canRead = useHasPermission('panel.settings.read')
  const canWrite = useHasPermission('panel.settings.write')
  const canManageSkills = useHasPermission('ai.skills.manage')
  // Eigenes Recht, nicht `panel.settings.read`: wer Verbraeuche sieht, sieht
  // das Nutzungsverhalten fremder Benutzer.
  const canReadUsage = useHasPermission('ai.usage.read.all')
  const [activeTab, setActiveTab] = useState<AiSubTab>('providers')
  const [rows, setRows] = useState<AiRoleLimits[]>([])
  const [providers, setProviders] = useState<AiProviderAdmin[]>([])
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null)
  const [loading, setLoading] = useState(canRead)
  const [saving, setSaving] = useState(false)

  const visibleTabs = useMemo(() => {
    return AI_TABS.filter((tab) => tab.id !== 'usage' || canReadUsage)
  }, [canReadUsage])

  useEffect(() => {
    if (!visibleTabs.some((tab) => tab.id === activeTab)) {
      setActiveTab('providers')
    }
  }, [visibleTabs, activeTab])

  useEffect(() => {
    if (!canRead) {
      setLoading(false)
      return
    }
    let active = true
    Promise.all([
      api<AiRoleLimits[]>('/ai/settings/role-limits'),
      api<AiProviderAdmin[]>('/ai/settings/providers').catch(() => [] as AiProviderAdmin[]),
    ])
      .then(([roleData, providerData]) => {
        if (!active) return
        const list = Array.isArray(roleData) ? roleData : []
        setRows(list)
        setProviders(Array.isArray(providerData) ? providerData : [])
        // Bevorzugt die erste bereits konfigurierte Rolle: dort gibt es etwas
        // zu sehen. Ist nichts konfiguriert, greift schlicht die erste Rolle.
        setSelectedRoleId((list.find((row) => row.configured) ?? list[0])?.role_id ?? null)
      })
      .catch((error: unknown) => {
        // Vorzeigbar ist nur, was aus einer verarbeiteten Backend-Antwort kommt
        // (siehe api/client.ts). Ist das Panel nicht erreichbar, wirft `fetch`
        // einen blanken TypeError — dessen `message` ist die englische Meldung
        // des Browsers („Failed to fetch") und stünde unübersetzt in der
        // Oberfläche, egal welche Sprache eingestellt ist.
        if (active) toast.error(error instanceof SanitizedApiError ? error.message : t('aiSettings.loadFailed'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [canRead, t])

  const selected = useMemo(
    () => rows.find((row) => row.role_id === selectedRoleId) ?? null,
    [rows, selectedRoleId],
  )

  const chatProviders = useMemo(() => {
    return providers.filter((p) => p.enabled && p.standard_enabled !== false)
  }, [providers])

  /** Ändert genau ein Feld lokal; gespeichert wird anschließend das Vollset. */
  const updateField = (roleId: number, field: LimitField, value: number | null) => {
    setRows((current) => current.map((row) => (
      row.role_id === roleId ? { ...row, [field]: value } : row
    )))
  }

  /** Der Anfragedeckel ist kein Kontingent: `null` heißt hier „Standard“. */
  const updateContextCeiling = (roleId: number, value: number | null) => {
    setRows((current) => current.map((row) => (
      row.role_id === roleId ? { ...row, max_context_tokens: value } : row
    )))
  }

  const updateRoleAllowAllModels = (roleId: number, allowAll: boolean) => {
    setRows((current) => current.map((row) => (
      row.role_id === roleId ? { ...row, allow_all_models: allowAll } : row
    )))
  }

  const updateRoleModelAccessMode = (
    roleId: number,
    providerId: number,
    mode: 'blocked' | 'all' | 'custom',
  ) => {
    setRows((current) => current.map((row) => {
      if (row.role_id !== roleId) return row
      const currentList = row.model_access ?? []
      let nextList: RoleAiModelAccessItem[]
      if (mode === 'blocked') {
        nextList = currentList.filter((a) => a.provider_id !== providerId)
      } else if (mode === 'all') {
        const existing = currentList.find((a) => a.provider_id === providerId)
        const updatedItem: RoleAiModelAccessItem = {
          provider_id: providerId,
          allow_all: true,
          allowed_models: existing?.allowed_models ?? [],
        }
        nextList = [...currentList.filter((a) => a.provider_id !== providerId), updatedItem]
      } else {
        const existing = currentList.find((a) => a.provider_id === providerId)
        const updatedItem: RoleAiModelAccessItem = {
          provider_id: providerId,
          allow_all: false,
          allowed_models: existing?.allowed_models ?? [],
        }
        nextList = [...currentList.filter((a) => a.provider_id !== providerId), updatedItem]
      }
      return { ...row, model_access: nextList }
    }))
  }

  const toggleRoleModel = (roleId: number, providerId: number, modelId: string) => {
    setRows((current) => current.map((row) => {
      if (row.role_id !== roleId) return row
      const currentList = row.model_access ?? []
      const existing = currentList.find((a) => a.provider_id === providerId)
      const currentModels = existing?.allowed_models ?? []
      const nextModels = currentModels.includes(modelId)
        ? currentModels.filter((m) => m !== modelId)
        : [...currentModels, modelId]
      const updatedItem: RoleAiModelAccessItem = {
        provider_id: providerId,
        allow_all: false,
        allowed_models: nextModels,
      }
      const nextList = [...currentList.filter((a) => a.provider_id !== providerId), updatedItem]
      return { ...row, model_access: nextList }
    }))
  }

  const save = async (row: AiRoleLimits) => {
    if (!canWrite || saving) return
    setSaving(true)
    try {
      const payload = {
        ...Object.fromEntries(
          FIELD_DEFINITIONS.map(({ key }) => [key, row[key]]),
        ),
        allow_all_models: row.allow_all_models ?? true,
        model_access: row.model_access ?? [],
        max_context_tokens: row.max_context_tokens,
      }
      const updated = await api<AiRoleLimits>(`/ai/settings/role-limits/${row.role_id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      })
      setRows((current) => current.map((item) => (
        item.role_id === updated.role_id ? updated : item
      )))
      toast.success(t('aiSettings.saved'))
    } catch (error: unknown) {
      // Wie beim Laden: ein roher Laufzeitfehler bekommt den übersetzten Satz.
      toast.error(error instanceof SanitizedApiError ? error.message : t('aiSettings.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  if (!canRead) {
    return <div className="msm-card p-6 text-sm text-on-surface-variant">{t('aiSettings.noPermission')}</div>
  }
  if (loading) {
    return <div className="flex h-64 items-center justify-center"><Spinner size="lg" className="text-primary" /></div>
  }

  return (
    <div className="space-y-6">
      <TabBar
        tabs={visibleTabs}
        active={activeTab}
        onChange={setActiveTab}
        ariaLabel={t('aiSettings.tabsAriaLabel')}
      />

      {activeTab === 'providers' && (
        <div className="space-y-6">
          <AiProvidersSettings canWrite={canWrite} />
          {/* Die Deckel der Hintergrund-Aufträge stehen bei den Zugängen, weil
              sie zusammen die Worker-Rolle ergeben: das Modell je Zugang oben,
              wie viel davon gleichzeitig laufen darf hier. */}
          <AiWorkerSettings canWrite={canWrite} />
          {/* Direkt unter der Providerwahl: wie groß der Kontext ist, entscheidet
              das dort gewählte Modell — einzustellen bleibt nur, wie voll er werden
              darf, bevor zusammengefasst wird. */}
          <AiContextSettings canWrite={canWrite} />
          {/* Neben dem Kontext, weil beide dieselbe Frage beantworten: was von
              einer Anfrage wohin geht. Die Wahl betrifft die Zugänge oben
              (Google, OpenAI), aber nicht den Chat — nur die Bedeutungssuche. */}
          <AiMemorySearchSettings canWrite={canWrite} />
          {/* Die Währung steht direkt hinter der Providerwahl, weil der Preis dort
              eingetragen wird: welche Zahl „1,20" bedeutet, entscheidet sich hier. */}
          <AiCostSettings canWrite={canWrite} />
        </div>
      )}

      {activeTab === 'features' && (
        <div className="space-y-6">
          <AiGuardianSettings canWrite={canWrite} />
          <AiWebSearchSettings canWrite={canWrite} />
          <AiSatelliteSettings canWrite={canWrite} />
          <AiMapTilerSettings canWrite={canWrite} />
          <AiTomTomSettings canWrite={canWrite} />
          <AiLearningSettings canWrite={canWrite} />

          {/* Panelweite Skills gehören zum Betreiber, nicht ins Profil eines
              Benutzers — und damit neben die Freigabe der KI-gelernten oben.
              Bis eben wurden sie über dasselbe Panel angelegt, das im Profil
              stand; wer dort etwas eintrug, schrieb unbemerkt für alle. */}
          {canManageSkills && <AiSkillManager scope={{ kind: 'panel', canManage: canWrite }} />}

          {/* Panelweites Gedaechtnis gilt fuer **jeden** Benutzer und lief bisher in
              jedem Gespraech mit, ohne dass es irgendwo sichtbar war — erreichbar
              nur ueber die API. Was fuer alle gilt, gehoert dorthin, wo der
              Betreiber es sieht. */}
          <AiMemoryManager scope={{ kind: 'panel', canManage: canWrite }} />
        </div>
      )}

      {activeTab === 'limits' && (
        <div className="space-y-6">
          <div className="msm-card p-6">
            <div className="mb-3 flex items-center gap-2">
              <Bot className="h-5 w-5 text-primary" aria-hidden="true" />
              <h3 className="font-headline text-title-lg font-semibold text-on-surface">{t('aiSettings.title')}</h3>
            </div>
            <p className="max-w-3xl text-sm text-on-surface-variant">{t('aiSettings.description')}</p>
            <p className="mt-2 max-w-3xl text-xs text-on-surface-variant">{t('aiSettings.ruleHelp')}</p>
          </div>

          {rows.length === 0 && (
            <div className="msm-card p-6 text-sm text-on-surface-variant">{t('aiSettings.noRoles')}</div>
          )}

          {selected && (
            <section className="msm-card p-6" aria-labelledby="ai-role-limits-title">
              <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
                <label className="block w-full max-w-sm space-y-1.5">
                  <span id="ai-role-limits-title" className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                    {t('aiSettings.selectRole')}
                  </span>
                  <Dropdown
                    value={String(selected.role_id)}
                    onChange={(value) => setSelectedRoleId(Number(value))}
                    options={rows.map((row) => ({
                      value: String(row.role_id),
                      label: row.role_name,
                      hint: row.configured ? t('aiSettings.configured') : t('aiSettings.notConfigured'),
                    }))}
                    disabled={saving}
                    aria-label={t('aiSettings.selectRole')}
                  />
                </label>
                {canWrite && (
                  <Button
                    type="button"
                    disabled={saving}
                    onClick={() => void save(selected)}
                    aria-label={`${t('common.save')}: ${selected.role_name}`}
                  >
                    <Save className="h-4 w-4" aria-hidden="true" />
                    {saving ? t('common.loading') : t('common.save')}
                  </Button>
                )}
              </div>

              {!selected.configured && (
                <p className="mb-5 rounded-lg border border-outline-variant/40 bg-surface-container-low/45 p-3 text-xs leading-5 text-on-surface-variant">
                  {t('aiSettings.notConfiguredHint')}
                </p>
              )}

              <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
                {FIELD_DEFINITIONS.map(({ key, labelKey, max, step, ranks, hintKey }) => {
                  const unlimited = selected[key] === null
                  const label = t(labelKey)
                  const fieldId = `ai-${selected.role_id}-${key}`
                  const hintId = hintKey ? `${fieldId}-hint` : undefined
                  return (
                    <div key={key} className="space-y-2 rounded-xl border border-outline-variant/40 bg-surface-container-low/35 p-4">
                      <label htmlFor={fieldId} className="block min-h-10 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                        {label}
                      </label>
                      {ranks ? (
                        <Dropdown
                          id={fieldId}
                          value={String(selected[key] ?? 0)}
                          disabled={!canWrite || unlimited || saving}
                          onChange={(wert) => updateField(selected.role_id, key, Number(wert))}
                          options={ranks.map((rank, rang) => ({
                            value: String(rang),
                            label: rang === 0
                              ? t('ai.reasoning.off')
                              : t(`ai.reasoning.levels.${rank}`, { defaultValue: rank }),
                          }))}
                          aria-label={`${label}: ${selected.role_name}`}
                          aria-describedby={hintId}
                        />
                      ) : (
                        <NumberStepper
                          id={fieldId}
                          min={0}
                          max={max}
                          step={step}
                          value={selected[key] ?? 0}
                          disabled={!canWrite || unlimited || saving}
                          onValueChange={(raw) => {
                            const parsed = parseLimitValue(raw, max)
                            if (parsed !== null) updateField(selected.role_id, key, parsed)
                          }}
                          aria-label={`${label}: ${selected.role_name}`}
                          aria-describedby={hintId}
                        />
                      )}
                      <div className="flex min-h-10 items-center justify-between gap-3">
                        <span className="text-xs text-on-surface-variant">{t('aiSettings.unlimited')}</span>
                        <Switch
                          checked={unlimited}
                          disabled={!canWrite || saving}
                          onCheckedChange={(next) => updateField(selected.role_id, key, next ? null : 0)}
                          aria-label={`${t('aiSettings.unlimited')}: ${label}: ${selected.role_name}`}
                          aria-describedby={hintId}
                        />
                      </div>
                      {hintKey && (
                        <p id={hintId} className="text-xs leading-5 text-on-surface-variant">
                          {t(hintKey)}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Eigene Karte, kein Feld im Raster: neben jedem Rasterfeld steht
                  ein „Unbegrenzt“-Schalter, und beim Deckel wäre der eine Lüge —
                  ohne Eintrag gilt der Standard, nicht unbegrenzt. */}
              <div className="mt-6 rounded-xl border border-outline-variant/40 bg-surface-container-low/35 p-5">
                <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                  <div className="space-y-2">
                    <label
                      htmlFor={`ai-${selected.role_id}-max_context_tokens`}
                      className="block min-h-10 text-xs font-semibold uppercase tracking-wider text-on-surface-variant"
                    >
                      {t('aiSettings.maxContextTokens')}
                    </label>
                    <NumberStepper
                      id={`ai-${selected.role_id}-max_context_tokens`}
                      min={KONTEXT_DECKEL_MIN}
                      max={KONTEXT_DECKEL_MAX}
                      step={10_000}
                      value={selected.max_context_tokens ?? KONTEXT_DECKEL_MIN}
                      disabled={!canWrite || saving}
                      onValueChange={(raw) => {
                        const parsed = parseLimitValue(raw, KONTEXT_DECKEL_MAX, KONTEXT_DECKEL_MIN)
                        if (parsed !== null) updateContextCeiling(selected.role_id, parsed)
                      }}
                      aria-label={`${t('aiSettings.maxContextTokens')}: ${selected.role_name}`}
                      aria-describedby={`ai-${selected.role_id}-max-context-hint`}
                    />
                  </div>
                  <p
                    id={`ai-${selected.role_id}-max-context-hint`}
                    className="self-end text-xs leading-5 text-on-surface-variant"
                  >
                    {t('aiSettings.maxContextTokensHint')}
                  </p>
                </div>
              </div>

              {/* Master-Schalter für globale Modell-Freigaben */}
              <div className="mt-6 rounded-xl border border-outline-variant/40 bg-surface-container-low/35 p-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="space-y-1">
                    <h4 className="text-sm font-semibold text-on-surface">
                      {t('aiSettings.allowAllModels')}
                    </h4>
                    <p className="max-w-2xl text-xs text-on-surface-variant">
                      {t('aiSettings.allowAllModelsHint')}
                    </p>
                  </div>
                  <Switch
                    checked={selected.allow_all_models ?? true}
                    disabled={!canWrite || saving}
                    onCheckedChange={(next) => updateRoleAllowAllModels(selected.role_id, next)}
                    aria-label={`${t('aiSettings.allowAllModels')}: ${selected.role_name}`}
                  />
                </div>
              </div>

              {/* Provider- und Modell-Freigaben, wenn Master-Schalter deaktiviert */}
              {!(selected.allow_all_models ?? true) && (
                <div className="mt-6 space-y-4">
                  <div className="space-y-1">
                    <h4 className="text-sm font-semibold text-on-surface">
                      {t('aiSettings.providerModelAccess')}
                    </h4>
                    <p className="text-xs text-on-surface-variant">
                      {t('aiSettings.providerModelAccessDesc')}
                    </p>
                  </div>

                  {chatProviders.length === 0 ? (
                    <div className="rounded-xl border border-outline-variant/40 bg-surface-container-low/20 p-4 text-xs text-on-surface-variant">
                      {t('aiSettings.noActiveProviders')}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                      {chatProviders.map((p) => {
                        const access = selected.model_access?.find((a) => a.provider_id === p.id)
                        const mode: 'blocked' | 'all' | 'custom' = !access
                          ? 'blocked'
                          : access.allow_all
                            ? 'all'
                            : 'custom'

                        const providerModels = Array.from(new Set([
                          ...(p.default_model ? [p.default_model] : []),
                          ...(p.enabled_models ?? []),
                        ])).filter(Boolean)

                        const allowedModels = access?.allowed_models ?? []

                        return (
                          <div
                            key={p.id}
                            className="space-y-3 rounded-xl border border-outline-variant/40 bg-surface-container-low/35 p-4"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <span className="font-semibold text-sm text-on-surface">{p.name}</span>
                                <span className="ml-2 text-xs text-on-surface-variant">({p.provider_kind})</span>
                              </div>
                              <div className="w-56">
                                <Dropdown
                                  value={mode}
                                  disabled={!canWrite || saving}
                                  onChange={(val) => updateRoleModelAccessMode(selected.role_id, p.id, val as 'blocked' | 'all' | 'custom')}
                                  options={[
                                    { value: 'blocked', label: t('aiSettings.providerAccessBlocked') },
                                    { value: 'all', label: t('aiSettings.providerAccessAll') },
                                    { value: 'custom', label: t('aiSettings.providerAccessCustom') },
                                  ]}
                                  aria-label={`${p.name} Modus: ${selected.role_name}`}
                                />
                              </div>
                            </div>

                            {mode === 'custom' && (
                              <div className="pt-2 border-t border-outline-variant/20 space-y-2">
                                <span className="block text-xs font-medium text-on-surface-variant">
                                  {t('aiSettings.providerAccessCustom')}
                                </span>
                                {providerModels.length === 0 ? (
                                  <p className="text-xs text-on-surface-variant">
                                    {p.allow_all_models
                                      ? t('aiSettings.globallyAllModelsAllowed')
                                      : t('aiSettings.noModelsSelected')}
                                  </p>
                                ) : (
                                  <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto p-2 rounded-xl border border-outline-variant/20 bg-surface-container-low/40">
                                    {providerModels.map((m) => {
                                      const isSelected = allowedModels.includes(m)
                                      return (
                                        <button
                                          key={m}
                                          type="button"
                                          disabled={!canWrite || saving}
                                          onClick={() => toggleRoleModel(selected.role_id, p.id, m)}
                                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                                            isSelected
                                              ? 'border-primary/50 bg-primary/15 text-primary font-medium'
                                              : 'border-outline-variant/40 bg-surface-container-low text-on-surface-variant hover:text-on-surface'
                                          }`}
                                        >
                                          <span>{m}</span>
                                          {m === p.default_model && (
                                            <span className="text-label-sm opacity-75">(Standard)</span>
                                          )}
                                        </button>
                                      )
                                    })}
                                  </div>
                                )}
                                {allowedModels.length === 0 && (
                                  <p className="text-xs text-on-surface-variant italic">
                                    {t('aiSettings.noModelsSelected')}
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {activeTab === 'usage' && canReadUsage && (
        <div className="space-y-6">
          <AiUsageSettings />
        </div>
      )}
    </div>
  )
}
