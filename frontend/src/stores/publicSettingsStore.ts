import { create } from 'zustand'
import { api } from '@/api/client'
import {
  DEFAULT_SEASONAL_SETTINGS,
  normalisiereSaison,
  type SeasonalSettings,
} from '@/season/typen'

export interface PublicBrandingSettings {
  name: string
  custom_name: string
  tagline: string
  ai_name: string
  logo_mode: 'default' | 'custom'
  season_logo_mode: 'default' | 'custom' | 'disabled'
  logo_url: string | null
  season_logos: Record<'birthday' | 'halloween' | 'christmas', string | null>
}

export const DEFAULT_PUBLIC_BRANDING: PublicBrandingSettings = {
  name: 'Maunting Service Manager',
  custom_name: '',
  tagline: '',
  ai_name: 'Singra',
  logo_mode: 'default',
  season_logo_mode: 'default',
  logo_url: null,
  season_logos: {
    birthday: null,
    halloween: null,
    christmas: null,
  },
}

export interface PublicSettings {
  /** Kanonische Panel-Adresse, z. B. fuer Einladungslinks. Leer heisst unkonfiguriert. */
  panel_url: string
  desktop_app_download_enabled: boolean
  browser_download_enabled: boolean
  story_fable_download_enabled: boolean
  imprint_enabled: boolean
  imprint_url: string
  calendar_enabled: boolean
  notes_enabled: boolean
  docs_enabled: boolean
  vault_enabled: boolean
  social_enabled: boolean
  shop_enabled: boolean
  external_shop_url: string
  seasonal: SeasonalSettings
  branding: PublicBrandingSettings
}

export const DEFAULT_PUBLIC_SETTINGS: PublicSettings = {
  panel_url: '',
  desktop_app_download_enabled: true,
  browser_download_enabled: true,
  story_fable_download_enabled: false,
  imprint_enabled: false,
  imprint_url: '',
  calendar_enabled: true,
  notes_enabled: true,
  docs_enabled: true,
  vault_enabled: true,
  social_enabled: true,
  shop_enabled: false,
  external_shop_url: '',
  seasonal: DEFAULT_SEASONAL_SETTINGS,
  branding: DEFAULT_PUBLIC_BRANDING,
}

function istSichereLogoUrl(wert: unknown): wert is string {
  if (typeof wert !== 'string' || !wert.trim()) return false
  const trimmed = wert.trim()
  if (trimmed.startsWith('/api/settings/public/branding/logo/')) return true
  return istHttpAdresse(trimmed)
}

function normalisiereBranding(
  raw: unknown,
  fallback: PublicBrandingSettings = DEFAULT_PUBLIC_BRANDING,
): PublicBrandingSettings {
  if (!raw || typeof raw !== 'object') return fallback
  const r = raw as Record<string, unknown>
  const custom_name = typeof r.custom_name === 'string' ? r.custom_name.trim() : fallback.custom_name
  const name =
    typeof r.name === 'string' && r.name.trim()
      ? r.name.trim()
      : custom_name || DEFAULT_PUBLIC_BRANDING.name
  const tagline = typeof r.tagline === 'string' ? r.tagline.trim() : fallback.tagline
  const ai_name = DEFAULT_PUBLIC_BRANDING.ai_name
  const logo_mode =
    r.logo_mode === 'custom' || r.logo_mode === 'default'
      ? r.logo_mode
      : fallback.logo_mode
  const season_logo_mode =
    r.season_logo_mode === 'custom' ||
    r.season_logo_mode === 'default' ||
    r.season_logo_mode === 'disabled'
      ? r.season_logo_mode
      : fallback.season_logo_mode
  const logo_url =
    r.logo_url === null
      ? null
      : istSichereLogoUrl(r.logo_url)
        ? r.logo_url.trim()
        : fallback.logo_url

  const rawSeasons =
    r.season_logos && typeof r.season_logos === 'object'
      ? (r.season_logos as Record<string, unknown>)
      : null
  const pickSeason = (key: 'birthday' | 'halloween' | 'christmas'): string | null => {
    if (!rawSeasons || !(key in rawSeasons)) return fallback.season_logos[key]
    const v = rawSeasons[key]
    if (v === null) return null
    return istSichereLogoUrl(v) ? v.trim() : fallback.season_logos[key]
  }

  return {
    name,
    custom_name,
    tagline,
    ai_name,
    logo_mode,
    season_logo_mode,
    logo_url,
    season_logos: {
      birthday: pickSeason('birthday'),
      halloween: pickSeason('halloween'),
      christmas: pickSeason('christmas'),
    },
  }
}

function istHttpAdresse(wert: unknown): wert is string {
  if (typeof wert !== 'string' || !wert.trim()) return false
  try {
    const url = new URL(wert)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

const CACHED_SETTINGS_KEY = 'msm_cached_public_settings'

function loadCachedSettings(): PublicSettings {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_PUBLIC_SETTINGS
    const raw = localStorage.getItem(CACHED_SETTINGS_KEY)
    if (!raw) return DEFAULT_PUBLIC_SETTINGS
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      return {
        panel_url: istHttpAdresse(parsed.panel_url)
          ? parsed.panel_url.replace(/\/+$/, '')
          : DEFAULT_PUBLIC_SETTINGS.panel_url,
        desktop_app_download_enabled:
          typeof parsed.desktop_app_download_enabled === 'boolean'
            ? parsed.desktop_app_download_enabled
            : DEFAULT_PUBLIC_SETTINGS.desktop_app_download_enabled,
        browser_download_enabled:
          typeof parsed.browser_download_enabled === 'boolean'
            ? parsed.browser_download_enabled
            : DEFAULT_PUBLIC_SETTINGS.browser_download_enabled,
        story_fable_download_enabled:
          typeof parsed.story_fable_download_enabled === 'boolean'
            ? parsed.story_fable_download_enabled
            : DEFAULT_PUBLIC_SETTINGS.story_fable_download_enabled,
        imprint_enabled:
          typeof parsed.imprint_enabled === 'boolean'
            ? parsed.imprint_enabled
            : DEFAULT_PUBLIC_SETTINGS.imprint_enabled,
        imprint_url:
          typeof parsed.imprint_url === 'string'
            ? parsed.imprint_url
            : DEFAULT_PUBLIC_SETTINGS.imprint_url,
        calendar_enabled:
          typeof parsed.calendar_enabled === 'boolean'
            ? parsed.calendar_enabled
            : DEFAULT_PUBLIC_SETTINGS.calendar_enabled,
        notes_enabled:
          typeof parsed.notes_enabled === 'boolean'
            ? parsed.notes_enabled
            : DEFAULT_PUBLIC_SETTINGS.notes_enabled,
        docs_enabled:
          typeof parsed.docs_enabled === 'boolean'
            ? parsed.docs_enabled
            : DEFAULT_PUBLIC_SETTINGS.docs_enabled,
        vault_enabled:
          typeof parsed.vault_enabled === 'boolean'
            ? parsed.vault_enabled
            : DEFAULT_PUBLIC_SETTINGS.vault_enabled,
        social_enabled:
          typeof parsed.social_enabled === 'boolean'
            ? parsed.social_enabled
            : DEFAULT_PUBLIC_SETTINGS.social_enabled,
        shop_enabled:
          typeof parsed.shop_enabled === 'boolean'
            ? parsed.shop_enabled
            : DEFAULT_PUBLIC_SETTINGS.shop_enabled,
        external_shop_url: istHttpAdresse(parsed.external_shop_url)
          ? parsed.external_shop_url.replace(/\/+$/, '')
          : DEFAULT_PUBLIC_SETTINGS.external_shop_url,
        seasonal: normalisiereSaison(parsed.seasonal),
        branding: normalisiereBranding(parsed.branding),
      }
    }
    return DEFAULT_PUBLIC_SETTINGS
  } catch {
    return DEFAULT_PUBLIC_SETTINGS
  }
}

function saveCachedSettings(settings: PublicSettings): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CACHED_SETTINGS_KEY, JSON.stringify(settings))
    }
  } catch {}
}

interface PublicSettingsState extends PublicSettings {
  isLoading: boolean
  error: string | null
  refresh: () => Promise<PublicSettings>
  setSettings: (partial: Partial<PublicSettings>) => void
  initFromCache: () => void
}

let letzteAbfrage = 0

export const usePublicSettingsStore = create<PublicSettingsState>((set, get) => {
  const initial = loadCachedSettings()

  return {
    ...initial,
    isLoading: false,
    error: null,

    refresh: async () => {
      const abfrage = ++letzteAbfrage
      set({ isLoading: true, error: null })
      try {
        const remote = await api<Partial<PublicSettings>>('/settings/public')
        if (abfrage !== letzteAbfrage) return get()
        const aktualisiert: PublicSettings = {
          panel_url: istHttpAdresse(remote.panel_url)
            ? remote.panel_url.replace(/\/+$/, '')
            : get().panel_url,
          desktop_app_download_enabled:
            typeof remote.desktop_app_download_enabled === 'boolean'
              ? remote.desktop_app_download_enabled
              : get().desktop_app_download_enabled,
          browser_download_enabled:
            typeof remote.browser_download_enabled === 'boolean'
              ? remote.browser_download_enabled
              : get().browser_download_enabled,
          story_fable_download_enabled:
            typeof remote.story_fable_download_enabled === 'boolean'
              ? remote.story_fable_download_enabled
              : get().story_fable_download_enabled,
          imprint_enabled:
            typeof remote.imprint_enabled === 'boolean'
              ? remote.imprint_enabled
              : get().imprint_enabled,
          imprint_url:
            typeof remote.imprint_url === 'string'
              ? remote.imprint_url
              : get().imprint_url,
          calendar_enabled:
            typeof remote.calendar_enabled === 'boolean'
              ? remote.calendar_enabled
              : get().calendar_enabled,
          notes_enabled:
            typeof remote.notes_enabled === 'boolean'
              ? remote.notes_enabled
              : get().notes_enabled,
          docs_enabled:
            typeof remote.docs_enabled === 'boolean'
              ? remote.docs_enabled
              : get().docs_enabled,
          vault_enabled:
            typeof remote.vault_enabled === 'boolean'
              ? remote.vault_enabled
              : get().vault_enabled,
          social_enabled:
            typeof remote.social_enabled === 'boolean'
              ? remote.social_enabled
              : get().social_enabled,
          shop_enabled:
            typeof remote.shop_enabled === 'boolean'
              ? remote.shop_enabled
              : get().shop_enabled,
          external_shop_url:
            typeof remote.external_shop_url === 'string'
              ? (istHttpAdresse(remote.external_shop_url)
                  ? remote.external_shop_url.replace(/\/+$/, '')
                  : '')
              : get().external_shop_url,
          // Die Saison ist ein verschachteltes Objekt. Fehlt sie in einer
          // aelteren API-Antwort, bleibt die bisherige Einstellung stehen;
          // kaputte Einzelfelder fallen ebenso einzeln zurueck.
          seasonal: normalisiereSaison(remote.seasonal, get().seasonal),
          branding: normalisiereBranding(remote.branding, get().branding),
        }
        saveCachedSettings(aktualisiert)
        set({ ...aktualisiert, isLoading: false, error: null })
        return aktualisiert
      } catch (err: unknown) {
        if (abfrage !== letzteAbfrage) return get()
        // Bei Netzwerk- oder Offline-Fehlern: Behalte gecachte Einstellungen unverändert bei.
        set({
          isLoading: false,
          error: err instanceof Error ? err.message : 'Fehler beim Laden der Einstellungen',
        })
        return get()
      }
    },

    setSettings: (partial: Partial<PublicSettings>) => {
      const updated: PublicSettings = {
        panel_url: istHttpAdresse(partial.panel_url)
          ? partial.panel_url.replace(/\/+$/, '')
          : get().panel_url,
        desktop_app_download_enabled:
          partial.desktop_app_download_enabled ?? get().desktop_app_download_enabled,
        browser_download_enabled:
          partial.browser_download_enabled ?? get().browser_download_enabled,
        story_fable_download_enabled:
          partial.story_fable_download_enabled ?? get().story_fable_download_enabled,
        imprint_enabled: partial.imprint_enabled ?? get().imprint_enabled,
        imprint_url: partial.imprint_url ?? get().imprint_url,
        calendar_enabled: partial.calendar_enabled ?? get().calendar_enabled,
        notes_enabled: partial.notes_enabled ?? get().notes_enabled,
        docs_enabled: partial.docs_enabled ?? get().docs_enabled,
        vault_enabled: partial.vault_enabled ?? get().vault_enabled,
        social_enabled: partial.social_enabled ?? get().social_enabled,
        shop_enabled: partial.shop_enabled ?? get().shop_enabled,
        external_shop_url:
          partial.external_shop_url !== undefined
            ? (istHttpAdresse(partial.external_shop_url)
                ? partial.external_shop_url.replace(/\/+$/, '')
                : '')
            : get().external_shop_url,
        seasonal: partial.seasonal
          ? normalisiereSaison(partial.seasonal, get().seasonal)
          : get().seasonal,
        branding: partial.branding
          ? normalisiereBranding(partial.branding, get().branding)
          : get().branding,
      }
      saveCachedSettings(updated)
      set({ ...updated })
    },

    initFromCache: () => {
      const cached = loadCachedSettings()
      set({ ...cached })
    },
  }
})
