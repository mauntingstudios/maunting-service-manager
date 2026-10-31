import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_PUBLIC_SETTINGS, usePublicSettingsStore } from '@/stores/publicSettingsStore'
import { DEFAULT_SEASONAL_SETTINGS } from './typen'
import { SaisonDeko } from './SaisonDeko'

describe('useSaison', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-31T20:00:00'))
    usePublicSettingsStore.setState({
      ...DEFAULT_PUBLIC_SETTINGS,
      seasonal: DEFAULT_SEASONAL_SETTINGS,
      isLoading: false,
      error: null,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    delete document.documentElement.dataset.season
  })

  it('setzt data-season, solange Halloween im Fenster liegt', () => {
    const { unmount } = render(<SaisonDeko />)
    expect(document.documentElement.dataset.season).toBe('halloween')
    unmount()
  })

  it('bleibt ohne Kopplung im Standard-Design', () => {
    const { unmount } = render(<SaisonDeko gekoppelt={false} />)
    expect(document.documentElement.dataset.season).toBeUndefined()
    unmount()
  })

  it('entfernt das Attribut, wenn die Saisons abgeschaltet sind', () => {
    usePublicSettingsStore.setState({
      ...DEFAULT_PUBLIC_SETTINGS,
      seasonal: { ...DEFAULT_SEASONAL_SETTINGS, enabled: false },
    })
    const { unmount } = render(<SaisonDeko />)
    expect(document.documentElement.dataset.season).toBeUndefined()
    unmount()
  })

  it('schaltet am naechsten Takt um, ohne die Seite neu zu laden', () => {
    const { unmount } = render(<SaisonDeko />)
    expect(document.documentElement.dataset.season).toBe('halloween')

    act(() => {
      vi.setSystemTime(new Date('2026-11-01T06:01:00'))
      vi.advanceTimersByTime(60_000)
    })

    expect(document.documentElement.dataset.season).toBeUndefined()
    unmount()
  })
})
