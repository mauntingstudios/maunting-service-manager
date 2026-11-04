import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { teamsApi } from '@/api/teams'
import { SanitizedApiError } from '@/api/client'
import { useTeamVaultStore } from './teamVaultStore'
import { useVaultStore } from './vaultStore'
import { ensureAccountKeys, kontoOeffentlichViele } from '@/services/accountKeys'
import { generateLocalE2eeKeyPair } from '@/services/e2eeCrypto'
import { encryptVaultEntry } from './vaultCrypto'
import { teamSchluesselAuspacken } from './teamVaultKeys'
import { VAULT_TOMBSTONE_MARKER } from './vaultEintrag'

vi.mock('@/api/teams', () => ({
  teamsApi: {
    get: vi.fn(),
    getVaultStatus: vi.fn(),
    setupVault: vi.fn(),
    uploadKeyslots: vi.fn(),
    getOwnKeyslot: vi.fn(),
    rotationPrepare: vi.fn(),
    rotationCommit: vi.fn(),
    rotationAbort: vi.fn(),
    rotationRollback: vi.fn(),
    syncVault: vi.fn(),
  },
}))

vi.mock('./vaultStore', () => ({
  useVaultStore: { getState: vi.fn() },
}))

vi.mock('@/services/accountKeys', () => ({
  ensureAccountKeys: vi.fn(),
  kontoOeffentlichViele: vi.fn(),
}))

const persoenlich = { isUnlocked: true, autoLockMinutes: 15, lockOnWindowBlur: false }

describe('teamVaultStore', () => {
  let besitzer: { publicKeyJwk: string; privateKeyJwk: string }
  let mitglied: { publicKeyJwk: string; privateKeyJwk: string }

  beforeAll(async () => {
    besitzer = await generateLocalE2eeKeyPair()
    mitglied = await generateLocalE2eeKeyPair()
  })

  const mitglieder = [
    { user_id: 7, username: 'gruen', role: 'owner', can_access_vault: true },
    { user_id: 9, username: 'blau', role: 'member', can_access_vault: true },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    persoenlich.isUnlocked = true
    persoenlich.autoLockMinutes = 15
    vi.mocked(useVaultStore.getState).mockReturnValue(persoenlich as never)
    vi.mocked(ensureAccountKeys).mockResolvedValue({
      kontoPaar: { publicKeyJwk: besitzer.publicKeyJwk, privateKeyJwk: besitzer.privateKeyJwk },
    } as never)
    vi.mocked(teamsApi.get).mockResolvedValue({ members: mitglieder } as never)
    vi.mocked(kontoOeffentlichViele).mockResolvedValue(
      new Map([
        [7, { user_id: 7, public_key: besitzer.publicKeyJwk, signing_public_key: '' }],
        [9, { user_id: 9, public_key: mitglied.publicKeyJwk, signing_public_key: '' }],
      ]) as never,
    )
    vi.mocked(teamsApi.uploadKeyslots).mockResolvedValue({ status: 'ok', count: 2 })
    vi.mocked(teamsApi.getOwnKeyslot).mockResolvedValue({ key_version: 1, wrapped_dek: 'sv-e2ee-hybrid-v1:setup' })
    useTeamVaultStore.setState({
      teamId: null,
      bucketId: null,
      keyVersion: null,
      isInitialized: false,
      isUnlocked: false,
      isUnlocking: false,
      needsRotation: false,
      needsSlot: false,
      isOwner: false,
      canAccessVault: true,
      userKey: null,
      items: [],
      serverRevision: 0,
      syncStatus: 'idle',
      error: null,
      rotationState: null,
      pendingBucketId: null,
      lastActivityTime: Date.now(),
    })
  })

  it('lädt den Status eines nicht eingerichteten Team-Tresors', async () => {
    vi.mocked(teamsApi.getVaultStatus).mockResolvedValue({
      is_setup: false,
      bucket_id: null,
      key_version: null,
      needs_rotation: false,
      is_owner: true,
    })

    const status = await useTeamVaultStore.getState().loadStatus(42)

    expect(status?.is_setup).toBe(false)
    const state = useTeamVaultStore.getState()
    expect(state.teamId).toBe(42)
    expect(state.isInitialized).toBe(false)
    expect(state.isOwner).toBe(true)
    expect(state.keyVersion).toBeNull()
  })

  it('verweigert Setup und Unlock bei gesperrtem Privattresor (Karte steckt nicht)', async () => {
    persoenlich.isUnlocked = false

    expect(await useTeamVaultStore.getState().setup(42)).toBe(false)
    expect(teamsApi.setupVault).not.toHaveBeenCalled()
    expect(useTeamVaultStore.getState().error).toMatch(/persönlichen Tresor/)

    expect(await useTeamVaultStore.getState().unlock(42)).toBe(false)
    expect(teamsApi.getOwnKeyslot).not.toHaveBeenCalled()
  })

  it('richtet ein und verpackt den Schlüssel pro Mitglied (echter Roundtrip)', async () => {
    vi.mocked(teamsApi.setupVault).mockResolvedValue({ status: 'ok' })

    const ok = await useTeamVaultStore.getState().setup(42)

    expect(ok).toBe(true)
    const state = useTeamVaultStore.getState()
    expect(state.isInitialized).toBe(true)
    expect(state.isUnlocked).toBe(true)
    expect(state.keyVersion).toBe(1)
    expect(state.userKey).not.toBeNull()
    expect(teamsApi.setupVault).toHaveBeenCalledWith(42, { bucket_id: state.bucketId })
    expect(teamsApi.uploadKeyslots).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ key_version: 1, slots: expect.any(Array) }),
    )
    // Beide Hüllen öffnen sich mit dem jeweils eigenen Konto-Schlüssel zum selben Tresor.
    const hochgeladen = vi.mocked(teamsApi.uploadKeyslots).mock.calls[0][1].slots
    expect(hochgeladen).toHaveLength(2)
    for (const [slot, paar] of [
      [hochgeladen.find((s) => s.user_id === 7)!, besitzer],
      [hochgeladen.find((s) => s.user_id === 9)!, mitglied],
    ] as const) {
      const geoeffnet = await teamSchluesselAuspacken(slot.wrapped_dek, paar.privateKeyJwk)
      expect(geoeffnet.bucketId).toBe(state.bucketId)
    }
  })

  it('öffnet per eigener Hülle und meldet needsSlot ohne Freischaltung', async () => {
    vi.mocked(teamsApi.setupVault).mockResolvedValue({ status: 'ok' })
    await useTeamVaultStore.getState().setup(42)
    const huelle = vi.mocked(teamsApi.uploadKeyslots).mock.calls[0][1].slots.find((s) => s.user_id === 7)!
    const bucketId = useTeamVaultStore.getState().bucketId
    useTeamVaultStore.getState().lock()
    vi.mocked(teamsApi.getVaultStatus).mockResolvedValue({
      is_setup: true,
      bucket_id: bucketId,
      key_version: 1,
      needs_rotation: false,
      is_owner: true,
      can_access_vault: true,
    })
    vi.mocked(teamsApi.syncVault).mockResolvedValue({ server_revision: 0, entries: [], has_more: false })
    vi.mocked(teamsApi.getOwnKeyslot).mockResolvedValue({ key_version: 1, wrapped_dek: huelle.wrapped_dek })

    expect(await useTeamVaultStore.getState().unlock(42)).toBe(true)
    expect(useTeamVaultStore.getState().isUnlocked).toBe(true)
    expect(useTeamVaultStore.getState().needsSlot).toBe(false)

    // Ohne Hülle (404 des Servers) wartet das Mitglied auf den Gründer.
    useTeamVaultStore.getState().lock()
    vi.mocked(teamsApi.getOwnKeyslot).mockRejectedValue(new SanitizedApiError('nichts', { status: 404 }))
    expect(await useTeamVaultStore.getState().unlock(42)).toBe(false)
    expect(useTeamVaultStore.getState().needsSlot).toBe(true)

    // Andere Fehler (Netz, Server) sind keine fehlende Freischaltung.
    vi.mocked(teamsApi.getOwnKeyslot).mockRejectedValue(new SanitizedApiError('kaputt', { status: 500 }))
    expect(await useTeamVaultStore.getState().unlock(42)).toBe(false)
    expect(useTeamVaultStore.getState().needsSlot).toBe(false)
    expect(useTeamVaultStore.getState().error).toBeTruthy()
  })

  it('bricht das Setup ab, wenn die eigene Hülle danach fehlt', async () => {
    vi.mocked(teamsApi.setupVault).mockResolvedValue({ status: 'ok' })
    vi.mocked(teamsApi.getOwnKeyslot).mockRejectedValue(new SanitizedApiError('nichts', { status: 404 }))

    expect(await useTeamVaultStore.getState().setup(42)).toBe(false)
    expect(useTeamVaultStore.getState().isUnlocked).toBe(false)
    expect(useTeamVaultStore.getState().error).toMatch(/unvollständig/)
  })

  it('weist eine Hülle ab, die nicht zu diesem Tresor gehört', async () => {
    vi.mocked(teamsApi.setupVault).mockResolvedValue({ status: 'ok' })
    await useTeamVaultStore.getState().setup(42)
    const bucketId = useTeamVaultStore.getState().bucketId
    // Hülle eines ANDEREN (frischen) Schlüssels, verpackt für den Besitzer.
    const { teamSchluesselVerpacken, erzeugeTeamSchluessel } = await import('./teamVaultKeys')
    const fremd = await erzeugeTeamSchluessel()
    const fremdeHuelle = await teamSchluesselVerpacken(fremd.dek, besitzer.publicKeyJwk)
    useTeamVaultStore.getState().lock()
    vi.mocked(teamsApi.getVaultStatus).mockResolvedValue({
      is_setup: true,
      bucket_id: bucketId,
      key_version: 1,
      needs_rotation: false,
      is_owner: true,
      can_access_vault: true,
    })
    vi.mocked(teamsApi.getOwnKeyslot).mockResolvedValue({ key_version: 1, wrapped_dek: fremdeHuelle })

    expect(await useTeamVaultStore.getState().unlock(42)).toBe(false)
    expect(useTeamVaultStore.getState().error).toMatch(/passt nicht/)
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

  it('folgt der Karte: Privattresor zu heißt Team-Tresor zu', async () => {
    vi.mocked(teamsApi.setupVault).mockResolvedValue({ status: 'ok' })
    await useTeamVaultStore.getState().setup(42)
    expect(useTeamVaultStore.getState().isUnlocked).toBe(true)

    persoenlich.isUnlocked = false
    useTeamVaultStore.getState().checkAutoLock()
    expect(useTeamVaultStore.getState().isUnlocked).toBe(false)
  })

  it('nutzt die zentrale Sperrfrist aus dem privaten Tresor', async () => {
    vi.mocked(teamsApi.setupVault).mockResolvedValue({ status: 'ok' })
    await useTeamVaultStore.getState().setup(42)
    useTeamVaultStore.setState({ lastActivityTime: Date.now() - 20 * 60_000 })

    persoenlich.autoLockMinutes = 15
    useTeamVaultStore.getState().checkAutoLock()
    expect(useTeamVaultStore.getState().isUnlocked).toBe(false)
  })

  it('ignoriert eine Löschung ohne Tombstone-Beweis und einen Revisions-Rückschritt', async () => {
    vi.mocked(teamsApi.setupVault).mockResolvedValue({ status: 'ok' })
    await useTeamVaultStore.getState().setup(42)
    const key = useTeamVaultStore.getState().userKey!
    const lebendig = await encryptVaultEntry({ service: 'Mail', username: 'u', password: 'p' }, key, 'e1')
    useTeamVaultStore.setState({
      items: [{ id: 'e1', service: 'Mail', username: 'u', password: 'p', createdAt: 0, updatedAt: 0, revision: 5 }],
      serverRevision: 5,
    })

    // Server behauptet Löschung, Umschlag ist aber ein normaler Eintrag.
    vi.mocked(teamsApi.syncVault).mockResolvedValue({
      server_revision: 6,
      has_more: false,
      entries: [{ id: 'e1', ciphertext: lebendig, revision: 6, is_deleted: true, updated_at: '' }],
    })
    await useTeamVaultStore.getState().syncWithServer(42)
    expect(useTeamVaultStore.getState().items.map((i) => i.id)).toEqual(['e1'])

    // Ältere Revision darf den neueren Stand nicht ersetzen.
    const alt = await encryptVaultEntry({ service: 'Alt', username: '', password: '' }, key, 'e1')
    vi.mocked(teamsApi.syncVault).mockResolvedValue({
      server_revision: 6,
      has_more: false,
      entries: [{ id: 'e1', ciphertext: alt, revision: 3, is_deleted: false, updated_at: '' }],
    })
    await useTeamVaultStore.getState().syncWithServer(42)
    expect(useTeamVaultStore.getState().items[0].service).toBe('Mail')
  })

  it('befolgt eine Löschung mit Tombstone-Beweis im Umschlag', async () => {
    vi.mocked(teamsApi.setupVault).mockResolvedValue({ status: 'ok' })
    await useTeamVaultStore.getState().setup(42)
    const key = useTeamVaultStore.getState().userKey!
    const grab = await encryptVaultEntry({ [VAULT_TOMBSTONE_MARKER]: true, deletedAt: 1, updatedAt: 1 }, key, 'e1')
    useTeamVaultStore.setState({
      items: [{ id: 'e1', service: 'Mail', username: 'u', password: 'p', createdAt: 0, updatedAt: 0, revision: 5 }],
      serverRevision: 5,
    })
    vi.mocked(teamsApi.syncVault).mockResolvedValue({
      server_revision: 6,
      has_more: false,
      entries: [{ id: 'e1', ciphertext: grab, revision: 6, is_deleted: true, updated_at: '' }],
    })
    await useTeamVaultStore.getState().syncWithServer(42)
    expect(useTeamVaultStore.getState().items).toEqual([])
  })

  it('legt ein Album an und ändert dessen Einträge', async () => {
    vi.mocked(teamsApi.setupVault).mockResolvedValue({ status: 'ok' })
    vi.mocked(teamsApi.syncVault).mockResolvedValue({ server_revision: 2, entries: [], has_more: false })

    await useTeamVaultStore.getState().setup(42)
    const albumId = await useTeamVaultStore.getState().albumAnlegen('Urlaub 2026', ['img-1', 'img-2'])

    const album = useTeamVaultStore.getState().items.find((i) => i.id === albumId)
    expect(album).toBeDefined()
    expect(album?.service).toBe('Urlaub 2026')
    expect(album?.category).toBe('album')
    expect(album?.album?.eintraege).toEqual(['img-1', 'img-2'])

    // Ändern: img-1 entfernen, img-3 hinzufügen
    await useTeamVaultStore.getState().albumAendern(albumId, { hinzu: ['img-3'], weg: ['img-1'] })

    const aktualisiert = useTeamVaultStore.getState().items.find((i) => i.id === albumId)
    expect(aktualisiert?.album?.eintraege).toEqual(['img-2', 'img-3'])
  })

  it('ändert Einträge atomar über aendern', async () => {
    vi.mocked(teamsApi.setupVault).mockResolvedValue({ status: 'ok' })
    vi.mocked(teamsApi.syncVault).mockResolvedValue({ server_revision: 2, entries: [], has_more: false })

    await useTeamVaultStore.getState().setup(42)
    const id = await useTeamVaultStore.getState().saveItem({ service: 'Vorher', username: 'user1' })

    await useTeamVaultStore.getState().aendern(id, (frisch) => ({
      service: `${frisch.service} Nachher`,
    }))

    const geaendert = useTeamVaultStore.getState().items.find((i) => i.id === id)
    expect(geaendert?.service).toBe('Vorher Nachher')
  })

  it('wirft einen Fehler und synchronisiert neu bei Konflikt auf einem Eintrag', async () => {
    vi.mocked(teamsApi.setupVault).mockResolvedValue({ status: 'ok' })
    await useTeamVaultStore.getState().setup(42)

    // Bei saveItem meldet der Server einen Konflikt auf 'e1'
    vi.mocked(teamsApi.syncVault)
      .mockResolvedValueOnce({
        server_revision: 3,
        entries: [],
        has_more: false,
        conflicts: ['e1'],
      })
      .mockResolvedValueOnce({
        server_revision: 3,
        entries: [],
        has_more: false,
      })

    await expect(
      useTeamVaultStore.getState().saveItem({ id: 'e1', service: 'Test' }),
    ).rejects.toThrow('Konflikt: Eintrag wurde zwischenzeitlich geändert. Neueste Fassung wurde geladen.')

    // saveItem mit Konflikt(1) + automatisches syncWithServer(2)
    expect(teamsApi.syncVault).toHaveBeenCalledTimes(2)
  })

  it('erneuert Schlüssel und Hüllen ohne Nachweis und ohne Passwort', async () => {
    vi.mocked(teamsApi.setupVault).mockResolvedValue({ status: 'ok' })
    await useTeamVaultStore.getState().setup(42)
    const alterBucket = useTeamVaultStore.getState().bucketId
    vi.mocked(teamsApi.getVaultStatus).mockResolvedValue({
      is_setup: true,
      bucket_id: alterBucket,
      key_version: 1,
      needs_rotation: true,
      is_owner: true,
    })
    vi.mocked(teamsApi.syncVault).mockResolvedValue({ server_revision: 1, entries: [], has_more: false })
    vi.mocked(teamsApi.rotationAbort).mockResolvedValue({ status: 'ok' })
    vi.mocked(teamsApi.rotationPrepare).mockResolvedValue({ status: 'ok' })
    vi.mocked(teamsApi.rotationCommit).mockResolvedValue({ status: 'ok' })

    const ok = await useTeamVaultStore.getState().rotateVault(42)

    expect(ok).toBe(true)
    expect(teamsApi.rotationPrepare).toHaveBeenCalledWith(42, { bucket_id: expect.any(String) })
    expect(teamsApi.rotationCommit).toHaveBeenCalledWith(42)
    // Hüllen für Stand 2 liegen für beide Mitglieder vor dem Commit.
    const v2 = vi.mocked(teamsApi.uploadKeyslots).mock.calls.filter((c) => c[1].key_version === 2)
    expect(v2).toHaveLength(1)
    expect(v2[0][1].slots).toHaveLength(2)
    const state = useTeamVaultStore.getState()
    expect(state.keyVersion).toBe(2)
    expect(state.bucketId).not.toBe(alterBucket)
    expect(state.needsRotation).toBe(false)
    // Die neue Hülle des Mitglieds öffnet den neuen Tresor.
    const slotBlau = v2[0][1].slots.find((s) => s.user_id === 9)!
    const geoeffnet = await teamSchluesselAuspacken(slotBlau.wrapped_dek, mitglied.privateKeyJwk)
    expect(geoeffnet.bucketId).toBe(state.bucketId)
  })
})
