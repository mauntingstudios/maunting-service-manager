import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import {
  INCIDENT_POLL_INTERVAL_MS,
  REMINDER_POLL_INTERVAL_MS,
  ServerIncidentNotifier,
} from './ServerIncidentNotifier'
import { useAuthStore } from '@/stores/authStore'
import { api } from '@/api/client'
import { loadCalendarEventsOfflineFirst } from '@/lib/offlineSync'

vi.mock('@/api/client', () => ({
  api: vi.fn().mockResolvedValue([]),
  getRateLimitRemainingMs: vi.fn(() => 0),
}))

vi.mock('@/lib/offlineSync', () => ({
  loadCalendarEventsOfflineFirst: vi.fn().mockResolvedValue({ events: [] }),
}))

vi.mock('@/lib/benachrichtigung', () => ({
  sendeGeraeteBenachrichtigung: vi.fn(),
  pruefeUndFrageGeraeteBerechtigung: vi.fn().mockResolvedValue(false),
}))

vi.mock('@/services/pushAbo', () => ({
  abonniere: vi.fn(),
  kuendige: vi.fn(),
}))

vi.mock('@/stores/messengerNotificationStore', () => ({
  chimeEntsperren: vi.fn(),
  useMessengerNotificationStore: {
    getState: () => ({
      syncBlockedFromBackend: vi.fn().mockResolvedValue(undefined),
      syncMailboxDirectoryFromBackend: vi.fn().mockResolvedValue(undefined),
      isBlocked: () => false,
      activeMailboxId: null,
    }),
  },
}))

vi.mock('@/services/messengerSperre', () => ({
  istGesperrt: () => false,
  useMessengerSperre: { getState: () => ({}) },
}))

vi.mock('@/services/benachrichtigung/chatMeldung', () => ({
  meldeChat: vi.fn(),
}))

vi.mock('@/stores/toastStore', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

describe('ServerIncidentNotifier (Paket 4A Polling-Reduktion)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    useAuthStore.setState({
      isAuthenticated: true,
      isLoading: false,
      user: {
        id: 1,
        username: 'tester',
        device_notifications: true,
        time_zone: 'Europe/Berlin',
      } as any,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('trennt Incident-Polling (20s) von Kalender-Erinnerungen (5 min) und reagiert sofort auf SSE-Kalender-Events', async () => {
    expect(INCIDENT_POLL_INTERVAL_MS).toBe(20_000)
    expect(REMINDER_POLL_INTERVAL_MS).toBe(300_000)

    const { unmount } = render(
      <MemoryRouter>
        <ServerIncidentNotifier />
      </MemoryRouter>,
    )

    await act(async () => {
      await Promise.resolve()
    })

    const apiMock = vi.mocked(api)
    const calMock = vi.mocked(loadCalendarEventsOfflineFirst)

    const countEndpoint = (path: string) =>
      apiMock.mock.calls.filter(([url]) => url === path).length

    expect(countEndpoint('/system/incident-alerts')).toBe(1)
    expect(countEndpoint('/calendar/due-reminders')).toBe(1)
    expect(calMock).toHaveBeenCalledTimes(1)

    // Nach 60 Sekunden: Incidents 3x häufiger, Kalender 0x zusätzlich!
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })

    expect(countEndpoint('/system/incident-alerts')).toBe(4)
    expect(countEndpoint('/calendar/due-reminders')).toBe(1)
    expect(calMock).toHaveBeenCalledTimes(1)

    // Erst nach vollen 300s (= 5 min) ein regulärer Reminder-Poll
    await act(async () => {
      await vi.advanceTimersByTimeAsync(240_000)
    })
    expect(countEndpoint('/calendar/due-reminders')).toBe(2)
    expect(calMock).toHaveBeenCalledTimes(2)

    // SSE-Kalender-Event löst sofortige Aktualisierung aus
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('msm:sync-event', { detail: { entity: 'calendar', action: 'updated' } }),
      )
      await Promise.resolve()
    })
    expect(countEndpoint('/calendar/due-reminders')).toBe(3)
    expect(calMock).toHaveBeenCalledTimes(3)

    unmount()
  })
})
