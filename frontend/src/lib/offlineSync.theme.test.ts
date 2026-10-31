import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_PUBLIC_SETTINGS, usePublicSettingsStore } from '@/stores/publicSettingsStore'
import { handleIncomingSyncEvent } from './offlineSync'

describe('Saison-Echtzeitereignis', () => {
  it('lädt bei einem Theme-Wechsel die öffentlichen Einstellungen neu', () => {
    const refresh = vi.fn().mockResolvedValue(DEFAULT_PUBLIC_SETTINGS)
    const vorher = usePublicSettingsStore.getState().refresh
    usePublicSettingsStore.setState({ refresh })

    try {
      handleIncomingSyncEvent('sync', { entity: 'theme', action: 'changed' })
      expect(refresh).toHaveBeenCalledTimes(1)
    } finally {
      usePublicSettingsStore.setState({ refresh: vorher })
    }
  })
})