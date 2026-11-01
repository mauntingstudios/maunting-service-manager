/**
 * Team-Tresor Store (E2EE Zero-Knowledge für Teams / Familien).
 *
 * Verwaltet den Status, das gemeinsame Master-Passwort, die Schlüsselableitung
 * via Argon2id, Verschlüsselung via AES-GCM und den deterministischen Revisions-Sync
 * für den Tresor eines Teams.
 */

import { create } from 'zustand'
import i18n from '@/i18n'
import { teamsApi, type TeamVaultMutationItem, type TeamVaultSyncResult } from '@/api/teams'
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
import { ALBUM_HOECHSTENS, VAULT_TOMBSTONE_MARKER, type VaultItem } from './vaultEintrag'
import {
  angeheftet,
  blobLesen,
  dateiBlobs,
  dateiVorbereiten,
  offlineAnheften,
  offlineLoesen,
  uploadsFortsetzen,
  vorbereitungAbschliessen,
  VERSIONEN,
  type DateiVersion,
} from './tresorDateien'
import { bildAngaben } from './tresorBilder'
import { blobBasisSetzen, blobLoeschen, teamFuerBucketMerken } from './tresorBlobApi'
import { ablageLaden, blobsLesen, blobsSchreiben } from './tresorAblage'
import { blobSchluesselNeuWickeln, istBlobKopf } from './tresorDatei'

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
  rotationState: string | null
  pendingBucketId: string | null

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
  rotatePassword: (teamId: number, currentPassword: string, newPassword: string) => Promise<boolean>
  abortRotation: (teamId: number) => Promise<void>
  rollbackRotation: (teamId: number) => Promise<boolean>
  resetVault: (teamId: number, nachweis: Record<string, unknown>, bestaetigung: string) => Promise<void>
  lock: () => void
  syncWithServer: (teamId: number) => Promise<void>
  saveItem: (item: Partial<VaultItem>) => Promise<string>
  aendern: (id: string, aenderung: Partial<VaultItem> | ((frisch: VaultItem) => Partial<VaultItem> | undefined)) => Promise<void>
  trashItem: (id: string) => Promise<void>
  restoreItem: (id: string) => Promise<void>
  setArchived: (id: string, archiviert: boolean) => Promise<void>
  deleteItem: (id: string) => Promise<void>
  emptyTrash: () => Promise<void>
  toggleFavorite: (id: string) => Promise<void>
  markUsed: (id: string) => Promise<void>
  ordnerAnlegen: (name: string, ordner?: string) => Promise<string>
  dateiHinzufuegen: (datei: File, ordner?: string) => Promise<string>
  dateiErsetzen: (id: string, inhalt: Blob) => Promise<void>
  fassungZurueckholen: (id: string, originalId: string) => Promise<void>
  albumAnlegen: (name: string, eintraege: string[]) => Promise<string>
  albumAendern: (id: string, aenderung: { hinzu?: string[]; weg?: string[] }) => Promise<void>
  migriereBase64Datei: (item: VaultItem) => Promise<void>
}

const migrierendeDateien = new Set<string>()

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
  rotationState: null,
  pendingBucketId: null,

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
      if (res.bucket_id) teamFuerBucketMerken(res.bucket_id, teamId)
      if (res.pending_bucket_id) teamFuerBucketMerken(res.pending_bucket_id, teamId)
      await get().loadSettings(teamId)
      set((state) => ({
        teamId,
        isInitialized: res.is_setup,
        salt: res.salt,
        bucketId: res.bucket_id,
        needsRotation: res.needs_rotation,
        isOwner: res.is_owner,
        hasHint: res.has_hint ?? false,
        rotationState: res.rotation_state ?? null,
        pendingBucketId: res.pending_bucket_id ?? null,
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
      teamFuerBucketMerken(bucketId, teamId)
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
      blobBasisSetzen(teamId)
      await ablageLaden(bucketId).catch(() => {})
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

      teamFuerBucketMerken(currentBucket, teamId)

      // Cached Blobs vorab entschlüsseln für sofortige Anzeige
      const gespeicherte = blobsLesen(currentBucket)
      const vorabItems: VaultItem[] = []
      for (const b of gespeicherte) {
        if (b.is_deleted) continue
        try {
          const dec = await decryptVaultEntry(b.ciphertext, userKey, b.id)
          if (dec && dec[VAULT_TOMBSTONE_MARKER] !== true) {
            vorabItems.push({ ...(dec as unknown as VaultItem), id: b.id, revision: b.revision })
          }
        } catch {}
      }

      set({
        teamId,
        userKey,
        isUnlocked: true,
        items: vorabItems,
        error: null,
      })
      blobBasisSetzen(teamId)
      await ablageLaden(currentBucket).catch(() => {})
      await get().syncWithServer(teamId)
      return true
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : 'Fehler beim Entsperren des Team-Tresors' })
      return false
    }
  },

  rotatePassword: async (teamId: number, currentPassword: string, newPassword: string) => {
    const { items, userKey, salt, bucketId } = get()
    if (!userKey || !salt || !bucketId) return false

    try {
      // Aktuelles Passwort prüfen (Bucket muss übereinstimmen) — zugleich
      // das Passwort, mit dem das Vorab-Backup versiegelt wird.
      const saltBytesAlt = base64ToBytes(salt)
      const { bucketId: altBucket } = await deriveVaultKeys(currentPassword, saltBytesAlt)
      if (altBucket.toLowerCase() !== bucketId.toLowerCase()) {
        set({ error: 'Falsches aktuelles Master-Passwort' })
        return false
      }

      const { rotateVaultCore } = await import('./vaultRotation')
      const { erstelleBackupBytes, speichereBackupImAppOrdner, backupDateiname } = await import('./tresorBackup')

      // Fortsetzen: serverseitig vorbereitete Rotation mit denselben Werten.
      const status = await teamsApi.getVaultSalt(teamId)
      let newSalt: string
      let newSaltBytes: Uint8Array
      let newBucketId: string
      let newUserKey: CryptoKey
      if (status.rotation_state === 'prepared' && status.pending_bucket_id && status.pending_salt) {
        newSalt = status.pending_salt
        newSaltBytes = base64ToBytes(newSalt)
        const abgeleitet = await deriveVaultKeys(newPassword, newSaltBytes)
        newBucketId = status.pending_bucket_id
        if (abgeleitet.bucketId.toLowerCase() !== newBucketId.toLowerCase()) {
          set({ error: 'Neues Passwort passt nicht zur vorbereiteten Rotation' })
          return false
        }
        newUserKey = abgeleitet.userKey
      } else {
        newSaltBytes = new Uint8Array(32)
        fillRandom(newSaltBytes)
        newSalt = bytesToBase64(newSaltBytes)
        const abgeleitet = await deriveVaultKeys(newPassword, newSaltBytes)
        newBucketId = abgeleitet.bucketId
        newUserKey = abgeleitet.userKey
      }

      await rotateVaultCore({
        scope: `team-${teamId}`,
        items,
        neuerKey: newUserKey,
        neueBucketId: newBucketId,
        neuesSalt: newSalt,
        backup: async () => {
          const bytes = await erstelleBackupBytes(
            items as unknown as Record<string, unknown>[],
            currentPassword,
          )
          await speichereBackupImAppOrdner(bytes, backupDateiname('team'))
        },
        transformItem: async (item) => {
          // Blob-Schluessel auf den neuen Tresor-Schluessel umwickeln; Chunks bleiben.
          if (!item.datei) return item
          const wickeln = async (kopf: unknown) =>
            istBlobKopf(kopf) ? blobSchluesselNeuWickeln(kopf, userKey, newUserKey, item.id) : kopf
          const datei = { ...item.datei }
          datei.original = (await wickeln(datei.original)) as typeof datei.original
          if (datei.vorschau) datei.vorschau = (await wickeln(datei.vorschau)) as typeof datei.vorschau
          if (datei.miniatur) datei.miniatur = (await wickeln(datei.miniatur)) as typeof datei.miniatur
          if (datei.frueher) {
            const frueher = []
            for (const f of datei.frueher) {
              const kopf = { ...f }
              kopf.original = (await wickeln(kopf.original)) as typeof kopf.original
              if (kopf.vorschau) kopf.vorschau = (await wickeln(kopf.vorschau)) as typeof kopf.vorschau
              if (kopf.miniatur) kopf.miniatur = (await wickeln(kopf.miniatur)) as typeof kopf.miniatur
              frueher.push(kopf)
            }
            datei.frueher = frueher as typeof datei.frueher
          }
          return { ...item, datei }
        },
        transport: {
          prepare: async (b, s) => {
            if (status.rotation_state !== 'prepared') {
              await teamsApi.rotationPrepare(teamId, { bucket_id: b, salt: s })
            }
          },
          sync: async (b, mutationen) => {
            if (mutationen.length > 0) {
              const res = await teamsApi.syncVault(teamId, {
                bucket_id: b,
                since_revision: 0,
                mutations: mutationen,
              })
              return res
            }
            // Alles lesen (Seiten über server_revision).
            const alle: TeamVaultSyncResult['entries'] = []
            let seit = 0
            for (;;) {
              const res = await teamsApi.syncVault(teamId, { bucket_id: b, since_revision: seit })
              alle.push(...res.entries)
              seit = res.server_revision
              if (!res.has_more) return { server_revision: seit, entries: alle, has_more: false }
            }
          },
          commit: async () => {
            await teamsApi.rotationCommit(teamId)
          },
          abort: async () => {
            await teamsApi.rotationAbort(teamId)
          },
        },
      })

      // Biometrie zeigt sonst weiter aufs alte Passwort.
      try {
        if (get().isBiometricsEnabled) {
          await biometrieSpeichern(newPassword, `team_vault_biometric_key_${teamId}`)
        }
      } catch {
        try { await biometrieLoeschen(`team_vault_biometric_key_${teamId}`) } catch {}
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(`mss_team_vault_bio_${teamId}`, 'false')
        }
        set({ isBiometricsEnabled: false })
      }

      teamFuerBucketMerken(newBucketId, teamId)
      try { await ablageLaden(newBucketId) } catch {}

      set({
        salt: newSalt,
        bucketId: newBucketId,
        userKey: newUserKey,
        needsRotation: false,
        rotationState: 'committed',
        pendingBucketId: null,
        serverRevision: 0,
        error: null,
      })
      await get().syncWithServer(teamId)
      return true
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : 'Fehler beim Rotieren des Master-Passworts' })
      return false
    }
  },

  abortRotation: async (teamId: number) => {
    try {
      await teamsApi.rotationAbort(teamId)
    } finally {
      const { rotationJournalSchreiben } = await import('./vaultRotation')
      rotationJournalSchreiben(`team-${teamId}`, null)
      set({ rotationState: null, pendingBucketId: null })
    }
  },

  rollbackRotation: async (teamId: number) => {
    try {
      await teamsApi.rotationRollback(teamId)
      set({ rotationState: null, pendingBucketId: null, isUnlocked: false, userKey: null, items: [] })
      await get().loadStatus(teamId)
      return true
    } catch {
      return false
    }
  },

  resetVault: async (teamId: number, nachweis: Record<string, unknown>, bestaetigung: string) => {
    blobBasisSetzen(null)
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
    blobBasisSetzen(null)
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
      const map = new Map(get().items.map((i) => [i.id, i]))
      const gespeicherte = new Map(blobsLesen(bucketId).map((b) => [b.id, b]))
      let aktuelleRevision = serverRevision
      let hasMore = true

      while (hasMore) {
        const res = await teamsApi.syncVault(teamId, {
          bucket_id: bucketId,
          since_revision: aktuelleRevision,
        })

        for (const entry of res.entries) {
          // Revisions-Rückschritt: ein älterer Serverstand ersetzt keinen neueren.
          const bekannt = map.get(entry.id)
          if (bekannt && typeof bekannt.revision === 'number' && entry.revision < bekannt.revision) {
            console.warn(`Team-Tresor-Sync: Revisions-Rückschritt für ${entry.id} ignoriert.`)
            continue
          }
          // Löschungen nur mit Tombstone-Beweis im Umschlag (wie privat seit dem Audit).
          let entschluesselt: Record<string, unknown> | null = null
          try {
            entschluesselt = await decryptVaultEntry(entry.ciphertext, userKey, entry.id)
          } catch {
            entschluesselt = null
          }
          const istGrab = entschluesselt?.[VAULT_TOMBSTONE_MARKER] === true
          if (entry.is_deleted || istGrab) {
            if (istGrab) {
              map.delete(entry.id)
            } else {
              console.warn(`Team-Tresor-Sync: unbelegte Löschung für ${entry.id} ignoriert.`)
            }
            continue
          }
          if (!entschluesselt) {
            console.error(`Konnte Team-Tresor Eintrag ${entry.id} nicht entschlüsseln.`)
            continue
          }
          map.set(entry.id, {
            ...(entschluesselt as unknown as VaultItem),
            id: entry.id,
            revision: entry.revision,
          })
        }

        for (const entry of res.entries) {
          gespeicherte.set(entry.id, {
            id: entry.id,
            ciphertext: entry.ciphertext,
            revision: entry.revision,
            is_deleted: entry.is_deleted,
          })
        }

        aktuelleRevision = res.server_revision
        hasMore = !!res.has_more
      }

      blobsSchreiben(bucketId, Array.from(gespeicherte.values()))

      set({
        items: Array.from(map.values()),
        serverRevision: aktuelleRevision,
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
      // Papierkorb ist ein Flag im Umschlag, keine Löschung. Gelöscht wird
      // ausschließlich über deleteItem mit Tombstone-Beweis.
      is_deleted: false,
    }

    const res = await teamsApi.syncVault(teamId, {
      bucket_id: bucketId,
      since_revision: get().serverRevision,
      mutations: [mutation],
    })

    // Konflikt: ein anderes Mitglied war schneller. Serverstand holen statt
    // lokal so zu tun, als wäre gespeichert worden.
    if (Array.isArray(res.conflicts) && res.conflicts.includes(id)) {
      await get().syncWithServer(teamId)
      throw new Error('Konflikt: Eintrag wurde zwischenzeitlich geändert. Neueste Fassung wurde geladen.')
    }

    const aktuelleBlobs = blobsLesen(bucketId).filter((b) => b.id !== id)
    blobsSchreiben(bucketId, [...aktuelleBlobs, { id, ciphertext, revision, is_deleted: false }])

    set((state) => ({
      items: [...state.items.filter((i) => i.id !== id), vollstaendig],
      serverRevision: res.server_revision,
    }))
    return id
  },

  aendern: async (id: string, aenderung: Partial<VaultItem> | ((frisch: VaultItem) => Partial<VaultItem> | undefined)) => {
    const frisch = get().items.find((i) => i.id === id)
    if (!frisch) return
    const ergebnis = typeof aenderung === 'function' ? aenderung(frisch) : aenderung
    if (!ergebnis) return
    await get().saveItem({ ...frisch, ...ergebnis })
  },

  deleteItem: async (id: string) => {
    const { teamId, bucketId, userKey, items } = get()
    if (!teamId || !bucketId || !userKey) throw new Error('Team-Tresor ist gesperrt')

    const existing = items.find((i) => i.id === id)
    if (!existing) return

    if (existing.datei) {
      blobBasisSetzen(teamId)
      const blobs = dateiBlobs(existing.datei)
      for (const b of blobs) {
        blobLoeschen(bucketId, b.id, b.loeschen).catch(() => {})
        void offlineLoesen(b.id)
      }
    }

    const now = Date.now()
    // Endgültiges Löschen trägt seinen Beweis im Umschlag (Tombstone-Marker),
    // wie im privaten Tresor. `is_deleted` allein löscht nirgendwo mehr.
    const grab = {
      [VAULT_TOMBSTONE_MARKER]: true,
      deletedAt: now,
      updatedAt: now,
    }
    const ciphertext = await encryptVaultEntry(grab, userKey, id)
    const trashed: VaultItem = {
      ...existing,
      trashedAt: now,
      updatedAt: now,
      revision: existing.revision + 1,
    }
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

    const aktuelleBlobs = blobsLesen(bucketId).filter((b) => b.id !== id)
    blobsSchreiben(bucketId, [...aktuelleBlobs, { id, ciphertext, revision: mutation.revision, is_deleted: true }])

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
    const { teamId, userKey, bucketId } = get()
    if (!teamId || !userKey || !bucketId) throw new Error(i18n.t('mss.vault.errors.locked'))
    blobBasisSetzen(teamId)
    const id = window.crypto.randomUUID()
    const { vorschau, miniatur, ...bild } = await bildAngaben(datei)
    const angaben = await dateiVorbereiten(datei, userKey, bucketId, id, () => get().userKey !== userKey, { vorschau, miniatur })
    try {
      if (get().userKey !== userKey) throw new Error(i18n.t('mss.vault.errors.locked'))
      await get().saveItem({ id, service: datei.name, category: 'datei', datei: { ...angaben, ...bild }, ordner })
    } finally {
      vorbereitungAbschliessen(angaben)
    }
    void uploadsFortsetzen(bucketId)
    return id
  },

  dateiErsetzen: async (id: string, inhalt: Blob) => {
    const { teamId, userKey, bucketId } = get()
    if (!teamId || !userKey || !bucketId) throw new Error(i18n.t('mss.vault.errors.locked'))
    blobBasisSetzen(teamId)
    const alt = get().items.find((i) => i.id === id)
    if (!alt?.datei) throw new Error(i18n.t('mss.vault.dateien.oeffnenFehler'))
    const { vorschau, miniatur, ...bild } = await bildAngaben(inhalt)
    const warAngeheftet = (await angeheftet([alt.datei.original.id])).size > 0
    const neu = await dateiVorbereiten(inhalt, userKey, bucketId, id, () => get().userKey !== userKey, {
      vorschau,
      miniatur,
      original: warAngeheftet ? 'immer' : undefined,
    })
    try {
      if (get().userKey !== userKey) throw new Error(i18n.t('mss.vault.errors.locked'))
      let gefunden = false
      let loeschBlobs: { id: string; loeschen: string }[] = []
      await get().aendern(id, (jetzt) => {
        if (!jetzt.datei) throw new Error(i18n.t('mss.vault.dateien.oeffnenFehler'))
        gefunden = true
        const { frueher = [], ...bisher } = jetzt.datei
        const versionen: DateiVersion[] = [
          { typ: bisher.typ, ersetzt: Date.now(), original: bisher.original, vorschau: bisher.vorschau, miniatur: bisher.miniatur },
          ...frueher,
        ]
        const weg = versionen.slice(VERSIONEN).flatMap((v) => [v.original, v.vorschau, v.miniatur])
        loeschBlobs = weg.map((k) => ({ id: k.id, loeschen: k.loeschen }))
        return {
          datei: {
            ...bisher,
            ...bild,
            typ: inhalt.type || bisher.typ,
            geaendert: Date.now(),
            original: neu.original,
            vorschau: neu.vorschau,
            miniatur: neu.miniatur,
            frueher: versionen.slice(0, VERSIONEN),
          },
        }
      })
      if (!gefunden) throw new Error(i18n.t('mss.vault.dateien.oeffnenFehler'))
      for (const b of loeschBlobs) {
        blobLoeschen(bucketId, b.id, b.loeschen).catch(() => {})
      }
      if (warAngeheftet) {
        await offlineAnheften(neu.original, id, userKey)
        await offlineLoesen(alt.datei.original.id)
      }
    } finally {
      vorbereitungAbschliessen(neu)
    }
    void uploadsFortsetzen(bucketId)
  },

  fassungZurueckholen: async (id: string, originalId: string) => {
    const { userKey, teamId } = get()
    if (!userKey || !teamId) throw new Error(i18n.t('mss.vault.errors.locked'))
    blobBasisSetzen(teamId)
    const fassung = get().items.find((i) => i.id === id)?.datei?.frueher?.find((v) => v.original.id === originalId)
    if (!fassung) throw new Error(i18n.t('mss.vault.dateien.oeffnenFehler'))
    const inhalt = await blobLesen(fassung.original, id, userKey, fassung.typ)
    await get().dateiErsetzen(id, inhalt)
  },

  albumAnlegen: async (name: string, eintraege: string[]) => {
    const liste = [...new Set(eintraege)]
    if (liste.length > ALBUM_HOECHSTENS) throw new Error(i18n.t('mss.vault.fotos.albumVoll', { max: ALBUM_HOECHSTENS }))
    const id = window.crypto.randomUUID()
    await get().saveItem({ id, service: name, category: 'album', album: { eintraege: liste } })
    return id
  },

  albumAendern: async (id: string, { hinzu = [], weg = [] }: { hinzu?: string[]; weg?: string[] }) => {
    await get().aendern(id, (album) => {
      if (album.category !== 'album') return undefined
      const raus = new Set(weg)
      const liste = [...new Set([...(album.album?.eintraege ?? []), ...hinzu])].filter((e) => !raus.has(e))
      if (liste.length > ALBUM_HOECHSTENS) throw new Error(i18n.t('mss.vault.fotos.albumVoll', { max: ALBUM_HOECHSTENS }))
      return { album: { eintraege: liste } }
    })
  },

  migriereBase64Datei: async (item: VaultItem) => {
    const { teamId, userKey, bucketId } = get()
    if (!teamId || !userKey || !bucketId || !item.extra?.base64) return
    if (migrierendeDateien.has(item.id)) return
    migrierendeDateien.add(item.id)
    blobBasisSetzen(teamId)
    const base64Str = item.extra.base64 as string
    const bytes = base64ToBytes(base64Str)
    try {
      const mimeType = (item.extra.type as string) || 'application/octet-stream'
      const dateiBlob = new Blob([bytes as unknown as BlobPart], { type: mimeType })
      const { vorschau, miniatur, ...bild } = await bildAngaben(dateiBlob)
      const angaben = await dateiVorbereiten(dateiBlob, userKey, bucketId, item.id, () => get().userKey !== userKey, { vorschau, miniatur })
      try {
        if (get().userKey !== userKey) return
        const updatedExtra = { ...item.extra }
        delete updatedExtra.base64
        await get().saveItem({
          ...item,
          datei: { ...angaben, ...bild },
          extra: Object.keys(updatedExtra).length > 0 ? updatedExtra : undefined,
        })
      } finally {
        vorbereitungAbschliessen(angaben)
      }
      void uploadsFortsetzen(bucketId)
    } finally {
      migrierendeDateien.delete(item.id)
      bytes.fill(0)
    }
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

