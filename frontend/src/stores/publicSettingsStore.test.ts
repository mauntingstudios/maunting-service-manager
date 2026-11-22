import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  usePublicSettingsStore,
  DEFAULT_PUBLIC_SETTINGS,
} from './publicSettingsStore'
import { DEFAULT_SEASONAL_SETTINGS } from '@/season/typen'

vi.mock('@/api/client', () => ({
  api: vi.fn(),
}))

import { api } from '@/api/client'

describe('publicSettingsStore', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    usePublicSettingsStore.setState({
      ...DEFAULT_PUBLIC_SETTINGS,
      isLoading: false,
      error: null,
    })
  })

  it('verwendet standardmäßig DEFAULT_PUBLIC_SETTINGS bei leerem Cache', () => {
    const state = usePublicSettingsStore.getState()
    expect(state.panel_url).toBe('')
    expect(state.calendar_enabled).toBe(true)
    expect(state.notes_enabled).toBe(true)
    expect(state.vault_enabled).toBe(true)
    expect(state.social_enabled).toBe(true)
  })

  it('übernimmt die Panel-Adresse und entfernt den Schrägstrich', async () => {
    vi.mocked(api).mockResolvedValueOnce({ panel_url: 'https://panel.example/' })

    await usePublicSettingsStore.getState().refresh()

    expect(usePublicSettingsStore.getState().panel_url).toBe('https://panel.example')
  })

  it('behält die bisherige Panel-Adresse bei einer ungültigen Angabe', async () => {
    usePublicSettingsStore.setState({ ...DEFAULT_PUBLIC_SETTINGS, panel_url: 'https://alt.example' })
    vi.mocked(api).mockResolvedValueOnce({ panel_url: 'javascript:alert(1)' })

    await usePublicSettingsStore.getState().refresh()

    expect(usePublicSettingsStore.getState().panel_url).toBe('https://alt.example')
  })

  it('verwirft eine ungültige Panel-Adresse aus dem Cache', () => {
    localStorage.setItem(
      'msm_cached_public_settings',
      JSON.stringify({ ...DEFAULT_PUBLIC_SETTINGS, panel_url: 'tauri.localhost' }),
    )

    usePublicSettingsStore.getState().initFromCache()

    expect(usePublicSettingsStore.getState().panel_url).toBe('')
  })

  it('lädt zuvor gespeicherte Einstellungen aus dem localStorage', () => {
    localStorage.setItem(
      'msm_cached_public_settings',
      JSON.stringify({
        calendar_enabled: false,
        notes_enabled: false,
        vault_enabled: false,
        social_enabled: false,
      }),
    )

    usePublicSettingsStore.getState().setSettings({
      calendar_enabled: false,
      notes_enabled: false,
      vault_enabled: false,
      social_enabled: false,
    })

    const state = usePublicSettingsStore.getState()
    expect(state.calendar_enabled).toBe(false)
    expect(state.notes_enabled).toBe(false)
    expect(state.vault_enabled).toBe(false)
    expect(state.social_enabled).toBe(false)
  })

  it('schreibt bei erfolgreichem refresh in den localStorage und aktualisiert State', async () => {
    vi.mocked(api).mockResolvedValueOnce({
      calendar_enabled: false,
      notes_enabled: true,
      vault_enabled: false,
      social_enabled: false,
    })

    await usePublicSettingsStore.getState().refresh()

    const state = usePublicSettingsStore.getState()
    expect(state.calendar_enabled).toBe(false)
    expect(state.notes_enabled).toBe(true)
    expect(state.vault_enabled).toBe(false)
    expect(state.social_enabled).toBe(false)

    const cached = JSON.parse(
      localStorage.getItem('msm_cached_public_settings') || '{}',
    )
    expect(cached.calendar_enabled).toBe(false)
    expect(cached.vault_enabled).toBe(false)
    expect(cached.social_enabled).toBe(false)
  })

  it('behält bei Netzwerkfehlern im Offline-Modus die gecachten Werte bei', async () => {
    usePublicSettingsStore.setState({
      ...DEFAULT_PUBLIC_SETTINGS,
      vault_enabled: false,
      social_enabled: false,
    })
    localStorage.setItem(
      'msm_cached_public_settings',
      JSON.stringify({
        ...DEFAULT_PUBLIC_SETTINGS,
        vault_enabled: false,
        social_enabled: false,
      }),
    )

    vi.mocked(api).mockRejectedValueOnce(new TypeError('Failed to fetch (Offline)'))

    await usePublicSettingsStore.getState().refresh()

    const state = usePublicSettingsStore.getState()
    expect(state.vault_enabled).toBe(false)
    expect(state.social_enabled).toBe(false)
    expect(state.error).toBe('Failed to fetch (Offline)')
  })

  it('uebernimmt die saisonalen Einstellungen aus der Public-API und cached sie', async () => {
    vi.mocked(api).mockResolvedValueOnce({
      seasonal: {
        enabled: false,
        halloween: { mode: 'on', start: '10-30T18:00', end: '11-02T02:00' },
        christmas: { mode: 'off', start: '12-20T00:00', end: '12-27T23:59' },
      },
    })

    await usePublicSettingsStore.getState().refresh()

    const state = usePublicSettingsStore.getState()
    expect(state.seasonal.enabled).toBe(false)
    expect(state.seasonal.halloween.mode).toBe('on')
    expect(state.seasonal.halloween.start).toBe('10-30T18:00')
    expect(state.seasonal.christmas.mode).toBe('off')

    const cached = JSON.parse(localStorage.getItem('msm_cached_public_settings') || '{}')
    expect(cached.seasonal.halloween.start).toBe('10-30T18:00')
  })

  it('behaelt die bisherige Saison, wenn eine aeltere API-Antwort sie nicht enthaelt', async () => {
    usePublicSettingsStore.setState({
      ...DEFAULT_PUBLIC_SETTINGS,
      seasonal: {
        enabled: false,
        halloween: { mode: 'off', start: '10-30T18:00', end: '11-02T02:00' },
        christmas: DEFAULT_SEASONAL_SETTINGS.christmas,
      },
    })
    vi.mocked(api).mockResolvedValueOnce({ calendar_enabled: false })

    await usePublicSettingsStore.getState().refresh()

    expect(usePublicSettingsStore.getState().seasonal.enabled).toBe(false)
    expect(usePublicSettingsStore.getState().seasonal.halloween.mode).toBe('off')
  })

  it('initFromCache aktualisiert den State synchron mit dem localStorage', () => {
    localStorage.setItem(
      'msm_cached_public_settings',
      JSON.stringify({
        ...DEFAULT_PUBLIC_SETTINGS,
        vault_enabled: false,
        notes_enabled: false,
      }),
    )

    usePublicSettingsStore.getState().initFromCache()

    const state = usePublicSettingsStore.getState()
    expect(state.vault_enabled).toBe(false)
    expect(state.notes_enabled).toBe(false)
    expect(state.calendar_enabled).toBe(true)
  })

  it('normalisiert Branding-Einstellungen im Cache mit sicheren Fallbacks', () => {
    localStorage.setItem(
      'msm_cached_public_settings',
      JSON.stringify({
        ...DEFAULT_PUBLIC_SETTINGS,
        branding: {
          name: '',
          custom_name: 'CloudForge',
          tagline: 'Hosting ohne Ballast',
          ai_name: 'ForgeBot',
          logo_mode: 'custom',
          season_logo_mode: 'custom',
          logo_url: '/api/settings/public/branding/logo/default?v=2',
          season_logos: {
            birthday: 'javascript:alert(1)',
            halloween: 'https://cdn.example.com/halloween.webp',
            christmas: null,
          },
        },
      }),
    )

    usePublicSettingsStore.getState().initFromCache()

    const { branding } = usePublicSettingsStore.getState()
    expect(branding.name).toBe('CloudForge')
    expect(branding.custom_name).toBe('CloudForge')
    expect(branding.tagline).toBe('Hosting ohne Ballast')
    expect(branding.ai_name).toBe('ForgeBot')
    expect(branding.logo_mode).toBe('custom')
    expect(branding.season_logo_mode).toBe('custom')
    expect(branding.logo_url).toBe('/api/settings/public/branding/logo/default?v=2')
    expect(branding.season_logos.birthday).toBeNull()
    expect(branding.season_logos.halloween).toBe('https://cdn.example.com/halloween.webp')
    expect(branding.season_logos.christmas).toBeNull()
  })

  it('lehnt unsichere Branding-Logo-URLs ab und faellt auf Standardwerte zurueck', () => {
    localStorage.setItem(
      'msm_cached_public_settings',
      JSON.stringify({
        ...DEFAULT_PUBLIC_SETTINGS,
        branding: {
          logo_mode: 'invalid',
          season_logo_mode: 'invalid',
          logo_url: 'javascript:alert(1)',
          season_logos: {
            birthday: 'data:text/html,<script>',
          },
        },
      }),
    )

    usePublicSettingsStore.getState().initFromCache()

    const { branding } = usePublicSettingsStore.getState()
    expect(branding.name).toBe(DEFAULT_PUBLIC_SETTINGS.branding.name)
    expect(branding.ai_name).toBe(DEFAULT_PUBLIC_SETTINGS.branding.ai_name)
    expect(branding.logo_mode).toBe('default')
    expect(branding.season_logo_mode).toBe('default')
    expect(branding.logo_url).toBeNull()
    expect(branding.season_logos.birthday).toBeNull()
  })
})

