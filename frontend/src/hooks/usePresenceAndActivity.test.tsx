import { act, renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  getOwnPresence: vi.fn(async () => ({ status: 'online', manual_status: 'auto', device_type: 'web' })),
  setPresenceStatus: vi.fn(async () => ({ status: 'online', manual_status: 'auto', device_type: 'web' })),
  sendPresenceSession: vi.fn(async () => ({ status: 'online', manual_status: 'auto', device_type: 'web' })),
  endPresenceSession: vi.fn(async () => ({ status: 'offline', manual_status: 'auto', device_type: 'web' })),
  recordActivityTime: vi.fn(async () => ({ ok: true })),
}))

vi.mock('@/api/social', () => api)

vi.mock('@/services/praesenz/sitzung', () => ({
  clientErkennen: () => 'web',
  plattformErkennen: () => 'web',
  geraeteKennung: () => 'geraet-test',
}))

import { usePresenceAndActivity } from './usePresenceAndActivity'
import { useAuthStore } from '@/stores/authStore'

function starte() {
  return renderHook(() => usePresenceAndActivity(true, true), {
    wrapper: ({ children }) => <MemoryRouter initialEntries={['/chat']}>{children}</MemoryRouter>,
  })
}

/** Der zuletzt gemeldete Zustand dieses Geraets. */
function letzteSitzung() {
  const aufrufe = api.sendPresenceSession.mock.calls
  return aufrufe[aufrufe.length - 1]?.[0] as
    | { zustand: string; activity_key: string; vorn: boolean }
    | undefined
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-28T10:00:00.000Z'))
  vi.clearAllMocks()
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: 1, username: 'alpha' } as never,
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('usePresenceAndActivity', () => {
  it('meldet beim Öffnen eine Sitzung mit Aktivität', async () => {
    starte()
    await act(async () => {})

    expect(api.sendPresenceSession).toHaveBeenCalled()
    expect(letzteSitzung()).toMatchObject({
      zustand: 'online',
      activity_key: 'chat',
      vorn: true,
    })
  })

  it('hält sich mit einem Lebenszeichen alle 45 Sekunden online', async () => {
    starte()
    await act(async () => {})
    api.sendPresenceSession.mockClear()

    await act(async () => {
      vi.advanceTimersByTime(45_000)
    })

    expect(api.sendPresenceSession).toHaveBeenCalledTimes(1)
    expect(letzteSitzung()?.zustand).toBe('online')
  })

  it('wird nach fünf Minuten Ruhe abwesend und bei Eingabe wieder online', async () => {
    starte()
    await act(async () => {})

    await act(async () => {
      vi.advanceTimersByTime(300_000)
    })
    expect(letzteSitzung()?.zustand).toBe('away')

    await act(async () => {
      window.dispatchEvent(new Event('keydown'))
      await Promise.resolve()
    })
    expect(letzteSitzung()?.zustand).toBe('online')
  })

  it('lässt eine manuelle Wahl stehen', async () => {
    const { result } = starte()
    await act(async () => {})

    await act(async () => {
      await result.current.changeStatus('away')
    })
    expect(api.setPresenceStatus).toHaveBeenCalledWith('away')
    expect(result.current.status).toBe('away')

    // Keine Eingabe hebt ein manuelles „abwesend“ auf.
    await act(async () => {
      window.dispatchEvent(new Event('keydown'))
      vi.advanceTimersByTime(60_000)
      await Promise.resolve()
    })
    expect(letzteSitzung()?.zustand).toBe('away')
  })

  it('meldet Unsichtbar an den Server, ohne die Sitzung zu verstecken', async () => {
    const { result } = starte()
    await act(async () => {})

    await act(async () => {
      await result.current.changeStatus('invisible')
    })

    expect(api.setPresenceStatus).toHaveBeenCalledWith('invisible')
    // Die Sitzung läuft weiter; den Schleier zieht der Server.
    expect(api.sendPresenceSession).toHaveBeenCalled()
  })
})
