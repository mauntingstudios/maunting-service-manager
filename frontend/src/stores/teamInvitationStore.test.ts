import { describe, expect, it, vi } from 'vitest'

import { api } from '@/api/client'
import { useTeamInvitationStore } from './teamInvitationStore'

vi.mock('@/api/client', async (importOriginal) => {
  const echt = await importOriginal<typeof import('@/api/client')>()
  return { ...echt, api: vi.fn(async () => []) }
})

describe('teamInvitationStore', () => {
  it('zählt offene Einladungen und teilt parallele Abrufe', async () => {
    const abruf = vi.mocked(api).mockResolvedValue([
      { team_id: 1, team_name: 'A', invited_by_username: null, invited_at: '2026-10-01T10:00:00Z' },
      { team_id: 2, team_name: 'B', invited_by_username: null, invited_at: '2026-10-01T10:00:00Z' },
    ])
    useTeamInvitationStore.getState().zuruecksetzen()

    await Promise.all([
      useTeamInvitationStore.getState().laden(),
      useTeamInvitationStore.getState().laden(),
    ])

    expect(abruf).toHaveBeenCalledTimes(1)
    expect(useTeamInvitationStore.getState().count).toBe(2)
  })

  it('fällt bei einem Fehler auf null zurück', async () => {
    vi.mocked(api).mockRejectedValueOnce(new Error('offline'))
    await useTeamInvitationStore.getState().laden()
    expect(useTeamInvitationStore.getState().count).toBe(0)
  })
})
