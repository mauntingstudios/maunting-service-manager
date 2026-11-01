import { beforeEach, describe, expect, it, vi } from 'vitest'
import { teamsApi } from '@/api/teams'
import { useTeamVaultStore } from './teamVaultStore'

vi.mock('@/api/teams', () => ({
  teamsApi: {
    getVaultSalt: vi.fn(),
    setupVault: vi.fn(),
    rotateVault: vi.fn(),
    syncVault: vi.fn(),
    getVaultHintStatus: vi.fn(),
    setVaultHint: vi.fn(),
    requestVaultHint: vi.fn(),
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

  it('richtet den Team-Tresor mit Passwort-Hinweis ein', async () => {
    vi.mocked(teamsApi.setupVault).mockResolvedValue({ status: 'ok' })

    const ok = await useTeamVaultStore.getState().setup(42, 'SuperSecretMasterPassword123!', 'Lieblingshaustier')

    expect(ok).toBe(true)
    const state = useTeamVaultStore.getState()
    expect(state.hasHint).toBe(true)
    expect(teamsApi.setupVault).toHaveBeenCalledWith(42, expect.objectContaining({
      salt: expect.any(String),
      bucket_id: expect.any(String),
      hint: 'Lieblingshaustier',
    }))
  })

  it('hinterlegt den Passwort-Hinweis nachträglich', async () => {
    vi.mocked(teamsApi.setVaultHint).mockResolvedValue({ status: 'ok' })

    await useTeamVaultStore.getState().saveHint(42, 'Geburtsstadt')

    expect(teamsApi.setVaultHint).toHaveBeenCalledWith(42, 'Geburtsstadt')
    expect(useTeamVaultStore.getState().hasHint).toBe(true)
  })

  it('prüft den Status des Passwort-Hinweises', async () => {
    vi.mocked(teamsApi.getVaultHintStatus).mockResolvedValue({
      has_hint: true,
      last_requested_at: null,
      can_request: true,
      cooldown_seconds_remaining: 0,
    })

    const has = await useTeamVaultStore.getState().checkHintStatus(42)

    expect(has).toBe(true)
    expect(useTeamVaultStore.getState().hasHint).toBe(true)
  })

  it('fordert den Passwort-Hinweis per E-Mail an', async () => {
    vi.mocked(teamsApi.requestVaultHint).mockResolvedValue({ status: 'ok', message: 'E-Mail gesendet' })

    const res = await useTeamVaultStore.getState().requestHintEmail(42)

    expect(res.ok).toBe(true)
    expect(res.message).toBe('E-Mail gesendet')
    expect(teamsApi.requestVaultHint).toHaveBeenCalledWith(42)
  })
})
