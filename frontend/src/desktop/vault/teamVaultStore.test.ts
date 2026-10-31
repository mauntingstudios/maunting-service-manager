import { beforeEach, describe, expect, it, vi } from 'vitest'
import { teamsApi } from '@/api/teams'
import { useTeamVaultStore } from './teamVaultStore'

vi.mock('@/api/teams', () => ({
  teamsApi: {
    getVaultSalt: vi.fn(),
    setupVault: vi.fn(),
    rotateVault: vi.fn(),
    syncVault: vi.fn(),
  },
}))

describe('teamVaultStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useTeamVaultStore.setState({
      teamId: null,
      bucketId: null,
      salt: null,
      isInitialized: false,
      isUnlocked: false,
      needsRotation: false,
      isOwner: false,
      userKey: null,
      items: [],
      serverRevision: 0,
      syncStatus: 'idle',
      error: null,
    })
  })

  it('lädt den Status eines nicht eingerichteten Team-Tresors', async () => {
    vi.mocked(teamsApi.getVaultSalt).mockResolvedValue({
      is_setup: false,
      salt: null,
      bucket_id: null,
      needs_rotation: false,
      is_owner: true,
    })

    await useTeamVaultStore.getState().loadStatus(42)

    const state = useTeamVaultStore.getState()
    expect(state.teamId).toBe(42)
    expect(state.isInitialized).toBe(false)
    expect(state.isOwner).toBe(true)
    expect(state.salt).toBeNull()
  })

  it('richtet den Team-Tresor erfolgreich ein', async () => {
    vi.mocked(teamsApi.setupVault).mockResolvedValue({ status: 'ok' })

    const ok = await useTeamVaultStore.getState().setup(42, 'SuperSecretMasterPassword123!')

    expect(ok).toBe(true)
    const state = useTeamVaultStore.getState()
    expect(state.teamId).toBe(42)
    expect(state.isInitialized).toBe(true)
    expect(state.isUnlocked).toBe(true)
    expect(state.userKey).not.toBeNull()
    expect(teamsApi.setupVault).toHaveBeenCalledWith(42, expect.objectContaining({
      salt: expect.any(String),
      bucket_id: expect.any(String),
    }))
  })

  it('sperrt den Team-Tresor und leert sensible Daten', () => {
    useTeamVaultStore.setState({
      isUnlocked: true,
      userKey: {} as CryptoKey,
      items: [{ id: '1', service: 'Test', username: '', password: '', createdAt: 0, updatedAt: 0, revision: 1 }],
    })

    useTeamVaultStore.getState().lock()

    const state = useTeamVaultStore.getState()
    expect(state.isUnlocked).toBe(false)
    expect(state.userKey).toBeNull()
    expect(state.items).toEqual([])
  })
})
