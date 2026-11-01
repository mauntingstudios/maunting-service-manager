/**
 * Team-Tresor Store (E2EE Zero-Knowledge für Teams / Familien).
 *
 * Verwaltet den Status, das gemeinsame Master-Passwort, die Schlüsselableitung
 * via Argon2id, Verschlüsselung via AES-GCM und den deterministischen Revisions-Sync
 * für den Tresor eines Teams.
 */

import { create } from 'zustand'
import i18n from '@/i18n'
import { teamsApi, type TeamVaultMutationItem } from '@/api/teams'
import {
  base64ToBytes,
  bytesToBase64,
  decryptVaultEntry,
  deriveVaultKeys,
  encryptVaultEntry,
  isBiometricsAvailable,
  promptBiometricVerification,
} from './vaultCrypto'
import {
  biometrieEntsperren,
  biometrieLoeschen,
  biometrieSpeichern,
  biometrieSpeicherFragtSelbst,
} from '../tauri'
import type { AutoSperrQuelle } from '@/services/autoSperre'
import { fillRandom } from '@msdis/shield/random'
import type { VaultItem } from './vaultEintrag'

export interface TeamVaultState {
  teamId: number | null
  bucketId: string | null
  salt: string | null
  isInitialized: boolean
  isUnlocked: boolean
  isUnlocking: boolean
  needsRotation: boolean
  isOwner: boolean
  userKey: CryptoKey | null
  items: VaultItem[]
  serverRevision: number
  syncStatus: 'idle' | 'syncing' | 'error'
  error: string | null
  hasHint: boolean | null

  // Einstellungen & Sicherheit
  autoLockMinutes: number
  lockOnWindowBlur: boolean
  leakCheckEnabled: boolean
  isBiometricsSupported: boolean
  isBiometricsEnabled: boolean
  lastActivityTime: number

  loadStatus: (teamId: number) => Promise<void>
  loadSettings: (teamId: number) => Promise<void>
  setAutoLockMinutes: (teamId: number, minutes: number) => void
  setLockOnWindowBlur: (teamId: number, enabled: boolean) => void
  setLeakCheckEnabled: (teamId: number, enabled: boolean) => void
  checkBiometricsSupport: (teamId: number) => Promise<boolean>
  enableBiometrics: (teamId: number, masterPassword: string) => Promise<boolean>
  disableBiometrics: (teamId: number) => Promise<void>
  unlockWithBiometrics: (teamId: number) => Promise<boolean>
  recordActivity: () => void
  checkAutoLock: () => void

  setup: (teamId: number, masterPassword: string, hint?: string) => Promise<boolean>
  saveHint: (teamId: number, hint: string) => Promise<void>
  checkHintStatus: (teamId: number) => Promise<boolean>
  requestHintEmail: (teamId: number) => Promise<{ ok: boolean; message: string }>
  unlock: (teamId: number, masterPassword: string) => Promise<boolean>
  rotatePassword: (teamId: number, newPassword: string) => Promise<boolean>
  resetVault: (teamId: number, nachweis: Record<string, unknown>, bestaetigung: string) => Promise<void>
  lock: () => void
  syncWithServer: (teamId: number) => Promise<void>
  saveItem: (item: Partial<VaultItem>) => Promise<string>
  trashItem: (id: string) => Promise<void>
  restoreItem: (id: string) => Promise<void>
  setArchived: (id: string, archiviert: boolean) => Promise<void>
  deleteItem: (id: string) => Promise<void>
  emptyTrash: () => Promise<void>
  toggleFavorite: (id: string) => Promise<void>
  markUsed: (id: string) => Promise<void>
  ordnerAnlegen: (name: string, ordner?: string) => Promise<string>
  dateiHinzufuegen: (datei: File, ordner?: string) => Promise<string>
}

export const useTeamVaultStore = create<TeamVaultState>((set, get) => ({
  teamId: null,
  bucketId: null,
  salt: null,
  isInitialized: false,
  isUnlocked: false,
  isUnlocking: false,
  needsRotation: false,
  isOwner: false,
  userKey: null,
  items: [],
  serverRevision: 0,
  syncStatus: 'idle',
  error: null,
  hasHint: null,

  autoLockMinutes: 5,
  lockOnWindowBlur: false,
  leakCheckEnabled: true,
  isBiometricsSupported: false,
  isBiometricsEnabled: false,
  lastActivityTime: Date.now(),

  recordActivity: () => {
    set({ lastActivityTime: Date.now() })
  },

  checkAutoLock: () => {
    const { isUnlocked, autoLockMinutes, lastActivityTime } = get()
    if (!isUnlocked || autoLockMinutes <= 0) return
    const vergangenMs = Date.now() - lastActivityTime
    if (vergangenMs >= autoLockMinutes * 60 * 1000) {
      get().lock()
    }
  },

  loadSettings: async (teamId: number) => {
    if (typeof localStorage === 'undefined') return
    const rawAutoLock = localStorage.getItem(`mss_team_vault_auto_lock_${teamId}`)
    const autoLockMinutes = rawAutoLock !== null ? Number(rawAutoLock) : 5
    const lockOnWindowBlur = localStorage.getItem(`mss_team_vault_lock_blur_${teamId}`) === 'true'
    const leakCheckEnabled = localStorage.getItem(`mss_team_vault_leak_check_${teamId}`) !== 'false'
    const isBiometricsEnabled = localStorage.getItem(`mss_team_vault_bio_${teamId}`) === 'true'

    const isBiometricsSupported = await isBiometricsAvailable()
    set({
      autoLockMinutes,
      lockOnWindowBlur,
      leakCheckEnabled,
      isBiometricsSupported,
      isBiometricsEnabled: isBiometricsSupported && isBiometricsEnabled,
    })
  },

  setAutoLockMinutes: (teamId: number, minutes: number) => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`mss_team_vault_auto_lock_${teamId}`, String(minutes))
    }
    set({ autoLockMinutes: minutes })
  },

  setLockOnWindowBlur: (teamId: number, enabled: boolean) => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`mss_team_vault_lock_blur_${teamId}`, String(enabled))
    }
    set({ lockOnWindowBlur: enabled })
  },

  setLeakCheckEnabled: (teamId: number, enabled: boolean) => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`mss_team_vault_leak_check_${teamId}`, String(enabled))
    }
    set({ leakCheckEnabled: enabled })
  },

  checkBiometricsSupport: async (teamId: number) => {
    const supported = await isBiometricsAvailable()
    const enabled = typeof localStorage !== 'undefined'
      ? localStorage.getItem(`mss_team_vault_bio_${teamId}`) === 'true'
      : false
    set({ isBiometricsSupported: supported, isBiometricsEnabled: supported && enabled })
    return supported
  },

  enableBiometrics: async (teamId: number, masterPassword: string) => {
    try {
      const isAvailable = await isBiometricsAvailable()
      if (!isAvailable) return false

      let { salt, bucketId } = get()
      if (!salt || !bucketId) {
        await get().loadStatus(teamId)
        salt = get().salt
        bucketId = get().bucketId
      }
      if (!salt || !bucketId) return false

      const saltBytes = base64ToBytes(salt)
      const { bucketId: derivedBucket } = await deriveVaultKeys(masterPassword, saltBytes)
      if (derivedBucket.toLowerCase() !== bucketId.toLowerCase()) {
        return false
      }

      if (!(await biometrieSpeicherFragtSelbst())) {
        const verified = await promptBiometricVerification(i18n.t('teams.vaultUnlock'))
        if (!verified) return false
      }

      await biometrieSpeichern(masterPassword, `team_vault_biometric_key_${teamId}`)
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(`mss_team_vault_bio_${teamId}`, 'true')
      }
      set({ isBiometricsEnabled: true })
      return true
    } catch {
      return false
    }
  },

  disableBiometrics: async (teamId: number) => {
    try {
      await biometrieLoeschen(`team_vault_biometric_key_${teamId}`)
    } catch {}
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`mss_team_vault_bio_${teamId}`, 'false')
    }
    set({ isBiometricsEnabled: false })
  },

  unlockWithBiometrics: async (teamId: number) => {
    set({ isUnlocking: true, error: null })
    try {
      const isAvailable = await isBiometricsAvailable()
      if (!isAvailable) {
        set({ isUnlocking: false, error: 'Biometrie nicht verfügbar' })
        return false
      }
      const masterPassword = await biometrieEntsperren(i18n.t('teams.vaultUnlock'), `team_vault_biometric_key_${teamId}`)
      if (!masterPassword) {
        set({ isUnlocking: false })
        return false
      }
      return await get().unlock(teamId, masterPassword)
    } catch (err: unknown) {
      set({ isUnlocking: false, error: err instanceof Error ? err.message : 'Entsperren fehlgeschlagen' })
      return false
    } finally {
      set({ isUnlocking: false })
    }
  },

  loadStatus: async (teamId: number) => {
    try {
      const res = await teamsApi.getVaultSalt(teamId)
      await get().loadSettings(teamId)
      set((state) => ({
        teamId,
        isInitialized: res.is_setup,
        salt: res.salt,
        bucketId: res.bucket_id,
        needsRotation: res.needs_rotation,
        isOwner: res.is_owner,
        hasHint: res.has_hint ?? false,
        // Wenn das Team wechselt und vorher ein anderer Tresor offen war:
        ...(state.teamId !== teamId ? { isUnlocked: false, userKey: null, items: [], serverRevision: 0 } : {}),
      }))
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : 'Fehler beim Laden des Team-Tresors' })
    }
  },

  setup: async (teamId: number, masterPassword: string, hint?: string) => {
    try {
      const saltBytes = new Uint8Array(32)
      fillRandom(saltBytes)
      const salt = bytesToBase64(saltBytes)
      const { userKey, bucketId } = await deriveVaultKeys(masterPassword, saltBytes)

      const trimmedHint = hint?.trim() || undefined
      await teamsApi.setupVault(teamId, { bucket_id: bucketId, salt, hint: trimmedHint })
      set({
        teamId,
        bucketId,
        salt,
        isInitialized: true,
        isUnlocked: true,
        needsRotation: false,
        hasHint: !!trimmedHint,
        userKey,
        items: [],
        serverRevision: 0,
        error: null,
      })
      return true
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : 'Fehler beim Einrichten des Team-Tresors' })
      return false
    }
  },

  saveHint: async (teamId: number, hint: string) => {
    if (!hint.trim()) return
    try {
      await teamsApi.setVaultHint(teamId, hint.trim())
      set({ hasHint: true })
    } catch {
      throw new Error(i18n.t('mss.vault.hinweisSpeichernFehlgeschlagen'))
    }
  },

  checkHintStatus: async (teamId: number) => {
    try {
      const res = await teamsApi.getVaultHintStatus(teamId)
      const has = !!res.has_hint
      set({ hasHint: has })
      return has
    } catch {
      return false
    }
  },

  requestHintEmail: async (teamId: number): Promise<{ ok: boolean; message: string }> => {
    try {
      const res = await teamsApi.requestVaultHint(teamId)
      return { ok: true, message: res.message || i18n.t('mss.vault.hinweisGesendet') }
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('429')) {
        return { ok: false, message: '' }
      }
      return { ok: false, message: i18n.t('mss.vault.hinweisAnfordernFehler') }
    }
  },

  unlock: async (teamId: number, masterPassword: string) => {
    const { salt, bucketId } = get()
    if (!salt || !bucketId) {
      await get().loadStatus(teamId)
    }
    const currentSalt = get().salt
    const currentBucket = get().bucketId
    if (!currentSalt || !currentBucket) {
      set({ error: 'Team-Tresor ist noch nicht eingerichtet' })
      return false
    }

    try {
      const saltBytes = base64ToBytes(currentSalt)
      const { userKey, bucketId: derivedBucket } = await deriveVaultKeys(masterPassword, saltBytes)

      if (derivedBucket.toLowerCase() !== currentBucket.toLowerCase()) {
        set({ error: 'Falsches Master-Passwort' })
        return false
      }

      set({
        teamId,
        userKey,
        isUnlocked: true,
        error: null,
      })
      await get().syncWithServer(teamId)
      return true
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : 'Fehler beim Entsperren des Team-Tresors' })
      return false
    }
  },

  rotatePassword: async (teamId: number, newPassword: string) => {
    const { items, userKey } = get()
    if (!userKey) return false

    try {
      const newSaltBytes = new Uint8Array(32)
      fillRandom(newSaltBytes)
      const newSalt = bytesToBase64(newSaltBytes)
      const { userKey: newUserKey, bucketId: newBucketId } = await deriveVaultKeys(newPassword, newSaltBytes)

      // Bestehende Einträge mit dem neuen Schlüssel neu verschlüsseln
      const mutations: TeamVaultMutationItem[] = []
      for (const item of items) {
        const ciphertext = await encryptVaultEntry(item as unknown as Record<string, unknown>, newUserKey, item.id)
        mutations.push({
          id: item.id,
          ciphertext,
          revision: item.revision,
          is_deleted: Boolean(item.trashedAt),
        })
      }

      await teamsApi.rotateVault(teamId, { bucket_id: newBucketId, salt: newSalt })

      // Mutationen in den neuen Bucket syncen
      await teamsApi.syncVault(teamId, {
        bucket_id: newBucketId,
        since_revision: 0,
        mutations,
      })

      set({
        salt: newSalt,
        bucketId: newBucketId,
        userKey: newUserKey,
        needsRotation: false,
        error: null,
      })
      await get().syncWithServer(teamId)
      return true
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : 'Fehler beim Rotieren des Master-Passworts' })
      return false
    }
  },

  resetVault: async (teamId: number, nachweis: Record<string, unknown>, bestaetigung: string) => {
    await teamsApi.resetVault(teamId, {
      ...nachweis,
      confirmation: bestaetigung,
    })
    set({
      isInitialized: false,
      isUnlocked: false,
      userKey: null,
      bucketId: null,
      salt: null,
      needsRotation: false,
      hasHint: false,
      items: [],
      serverRevision: 0,
      error: null,
    })
  },

  lock: () => {
    set({
      isUnlocked: false,
      userKey: null,
      items: [],
      serverRevision: 0,
      error: null,
    })
  },

  syncWithServer: async (teamId: number) => {
    const { bucketId, userKey, serverRevision } = get()
    if (!bucketId || !userKey) return

    set({ syncStatus: 'syncing' })
    try {
      const res = await teamsApi.syncVault(teamId, {
        bucket_id: bucketId,
        since_revision: serverRevision,
      })

      const map = new Map(get().items.map((i) => [i.id, i]))
      for (const entry of res.entries) {
        if (entry.is_deleted) {
          map.delete(entry.id)
        } else {
          try {
            const entschluesselt = await decryptVaultEntry(entry.ciphertext, userKey, entry.id)
            map.set(entry.id, {
              ...(entschluesselt as unknown as VaultItem),
              id: entry.id,
              revision: entry.revision,
            })
          } catch (decErr) {
            console.error('Konnte Team-Tresor Eintrag nicht entschlüsseln:', decErr)
          }
        }
      }

      set({
        items: Array.from(map.values()),
        serverRevision: res.server_revision,
        syncStatus: 'idle',
      })
    } catch (err: unknown) {
      set({ syncStatus: 'error', error: err instanceof Error ? err.message : 'Sync-Fehler' })
    }
  },

  saveItem: async (item: Partial<VaultItem>) => {
    const { teamId, bucketId, userKey, items } = get()
    if (!teamId || !bucketId || !userKey) throw new Error('Team-Tresor ist gesperrt')

    const id = item.id || crypto.randomUUID()
    const now = Date.now()
    const existing = items.find((i) => i.id === id)
    const revision = (existing?.revision || 0) + 1

    const vollstaendig: VaultItem = {
      service: '',
      username: '',
      password: '',
      ...existing,
      ...item,
      id,
      revision,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    }

    const ciphertext = await encryptVaultEntry(vollstaendig as unknown as Record<string, unknown>, userKey, id)
    const mutation: TeamVaultMutationItem = {
      id,
      ciphertext,
      revision,
      is_deleted: Boolean(vollstaendig.trashedAt),
    }

    const res = await teamsApi.syncVault(teamId, {
      bucket_id: bucketId,
      since_revision: get().serverRevision,
      mutations: [mutation],
    })

    set((state) => ({
      items: [...state.items.filter((i) => i.id !== id), vollstaendig],
      serverRevision: res.server_revision,
    }))
    return id
  },

  deleteItem: async (id: string) => {
    const { teamId, bucketId, userKey, items } = get()
    if (!teamId || !bucketId || !userKey) throw new Error('Team-Tresor ist gesperrt')

    const existing = items.find((i) => i.id === id)
    if (!existing) return

    const now = Date.now()
    const trashed: VaultItem = {
      ...existing,
      trashedAt: now,
      updatedAt: now,
      revision: existing.revision + 1,
    }

    const ciphertext = await encryptVaultEntry(trashed as unknown as Record<string, unknown>, userKey, id)
    const mutation: TeamVaultMutationItem = {
      id,
      ciphertext,
      revision: trashed.revision,
      is_deleted: true,
    }

    const res = await teamsApi.syncVault(teamId, {
      bucket_id: bucketId,
      since_revision: get().serverRevision,
      mutations: [mutation],
    })

    set((state) => ({
      items: state.items.filter((i) => i.id !== id),
      serverRevision: res.server_revision,
    }))
  },

  trashItem: async (id: string) => {
    const existing = get().items.find((i) => i.id === id)
    if (!existing) return
    await get().saveItem({ ...existing, trashedAt: Date.now() })
  },

  restoreItem: async (id: string) => {
    const { items, saveItem } = get()
    const existing = items.find((i) => i.id === id)
    if (!existing) return
    const restored = { ...existing }
    delete restored.trashedAt
    await saveItem(restored)
  },

  setArchived: async (id: string, archiviert: boolean) => {
    const existing = get().items.find((i) => i.id === id)
    if (!existing) return
    const updated = { ...existing }
    if (archiviert) {
      updated.archivedAt = Date.now()
    } else {
      delete updated.archivedAt
    }
    await get().saveItem(updated)
  },

  emptyTrash: async () => {
    const imPapierkorb = get().items.filter((i) => i.trashedAt)
    for (const item of imPapierkorb) {
      await get().deleteItem(item.id)
    }
  },

  toggleFavorite: async (id: string) => {
    const existing = get().items.find((i) => i.id === id)
    if (!existing) return
    await get().saveItem({ ...existing, isFavorite: !existing.isFavorite })
  },

  markUsed: async (id: string) => {
    const existing = get().items.find((i) => i.id === id)
    if (!existing) return
    await get().saveItem({ ...existing, lastUsedAt: Date.now() })
  },

  ordnerAnlegen: async (name: string, ordner?: string) => {
    return await get().saveItem({
      service: name,
      category: 'ordner',
      ordner,
    })
  },

  dateiHinzufuegen: async (datei: File, ordner?: string) => {
    // Speichert Metadaten und Base64-Daten für den Team-Tresor
    const reader = new FileReader()
    const base64 = await new Promise<string>((resolve, reject) => {
      reader.onload = () => {
        const res = reader.result as string
        const kommateil = res.indexOf(',')
        resolve(kommateil !== -1 ? res.substring(kommateil + 1) : res)
      }
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(datei)
    })

    return await get().saveItem({
      service: datei.name,
      category: 'datei',
      ordner,
      extra: {
        base64,
        size: datei.size,
        type: datei.type,
      },
    })
  },
}))

export const teamTresorAutoSperrQuelle: AutoSperrQuelle = {
  istEntsperrt: () => useTeamVaultStore.getState().isUnlocked,
  istBeschaeftigt: () => useTeamVaultStore.getState().isUnlocking,
  sperrtBeiFensterwechsel: () => useTeamVaultStore.getState().lockOnWindowBlur,
  merkeAktivitaet: () => useTeamVaultStore.getState().recordActivity(),
  pruefeFrist: () => {
    useTeamVaultStore.getState().checkAutoLock()
  },
  sperre: () => useTeamVaultStore.getState().lock(),
}

