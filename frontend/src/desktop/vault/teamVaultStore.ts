/**
 * Team-Tresor Store (E2EE Zero-Knowledge für Teams / Familien).
 *
 * Verwaltet den Status, das gemeinsame Master-Passwort, die Schlüsselableitung
 * via Argon2id, Verschlüsselung via AES-GCM und den deterministischen Revisions-Sync
 * für den Tresor eines Teams.
 */

import { create } from 'zustand'
import { teamsApi, type TeamVaultMutationItem } from '@/api/teams'
import {
  base64ToBytes,
  bytesToBase64,
  decryptVaultEntry,
  deriveVaultKeys,
  encryptVaultEntry,
} from './vaultCrypto'
import { fillRandom } from '@msdis/shield/random'
import type { VaultItem } from './vaultEintrag'

export interface TeamVaultState {
  teamId: number | null
  bucketId: string | null
  salt: string | null
  isInitialized: boolean
  isUnlocked: boolean
  needsRotation: boolean
  isOwner: boolean
  userKey: CryptoKey | null
  items: VaultItem[]
  serverRevision: number
  syncStatus: 'idle' | 'syncing' | 'error'
  error: string | null

  loadStatus: (teamId: number) => Promise<void>
  setup: (teamId: number, masterPassword: string) => Promise<boolean>
  unlock: (teamId: number, masterPassword: string) => Promise<boolean>
  rotatePassword: (teamId: number, newPassword: string) => Promise<boolean>
  lock: () => void
  syncWithServer: (teamId: number) => Promise<void>
  saveItem: (item: Partial<VaultItem>) => Promise<string>
  deleteItem: (id: string) => Promise<void>
  restoreItem: (id: string) => Promise<void>
  ordnerAnlegen: (name: string, ordner?: string) => Promise<string>
  dateiHinzufuegen: (datei: File, ordner?: string) => Promise<string>
}

export const useTeamVaultStore = create<TeamVaultState>((set, get) => ({
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

  loadStatus: async (teamId: number) => {
    try {
      const res = await teamsApi.getVaultSalt(teamId)
      set((state) => ({
        teamId,
        isInitialized: res.is_setup,
        salt: res.salt,
        bucketId: res.bucket_id,
        needsRotation: res.needs_rotation,
        isOwner: res.is_owner,
        // Wenn das Team wechselt und vorher ein anderer Tresor offen war:
        ...(state.teamId !== teamId ? { isUnlocked: false, userKey: null, items: [], serverRevision: 0 } : {}),
      }))
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : 'Fehler beim Laden des Team-Tresors' })
    }
  },

  setup: async (teamId: number, masterPassword: string) => {
    try {
      const saltBytes = new Uint8Array(32)
      fillRandom(saltBytes)
      const salt = bytesToBase64(saltBytes)
      const { userKey, bucketId } = await deriveVaultKeys(masterPassword, saltBytes)

      await teamsApi.setupVault(teamId, { bucket_id: bucketId, salt })
      set({
        teamId,
        bucketId,
        salt,
        isInitialized: true,
        isUnlocked: true,
        needsRotation: false,
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

  restoreItem: async (id: string) => {
    const { items, saveItem } = get()
    const existing = items.find((i) => i.id === id)
    if (!existing) return
    const restored = { ...existing }
    delete restored.trashedAt
    await saveItem(restored)
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
