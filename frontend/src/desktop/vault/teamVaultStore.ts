/**
 * Team-Tresor Store (E2EE Zero-Knowledge für Teams / Familien).
 *
 * Seit 11/2026 gibt es kein geteiltes Team-Passwort mehr: Pro Team existiert
 * ein zufälliger Schlüssel (DEK), der pro Mitglied gegen dessen
 * E2EE-Konto-Identität verpackt auf dem Server liegt (`teamVaultKeys.ts`).
 * Entsperren heißt: eigener privater Tresor offen (die Karte steckt),
 * eigene Hülle holen, mit dem Konto-Schlüssel öffnen. Einstellungen
 * (Sperrfrist, Fensterwechsel, Leak-Prüfung, Biometrie) gelten zentral aus
 * dem persönlichen Tresor — dieser Store hält keine eigenen mehr.
 */

import { create } from 'zustand'
import i18n from '@/i18n'
import { still } from '@/lib/still'
import { teamsApi, type TeamVaultMutationItem, type TeamVaultStatusResponse, type TeamVaultSyncResult } from '@/api/teams'
import { SanitizedApiError } from '@/api/client'
import {
  base64ToBytes,
  decryptVaultEntry,
  encryptVaultEntry,
} from './vaultCrypto'
import { biometrieLoeschen } from '../tauri'
import { useVaultStore } from './vaultStore'
import { ensureAccountKeys, kontoOeffentlichViele, KontoSchluesselNichtUebertragenError } from '@/services/accountKeys'
import {
  erzeugeTeamSchluessel,
  teamSchluesselAuspacken,
  teamSchluesselVerpacken,
} from './teamVaultKeys'
import type { AutoSperrQuelle } from '@/services/autoSperre'
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
  /** Aktiver Schlüsselstand des DEK (steigt mit jeder Rotation). */
  keyVersion: number | null
  isInitialized: boolean
  isUnlocked: boolean
  isUnlocking: boolean
  needsRotation: boolean
  /** Entsperrt, aber keine eigene Hülle: wartet auf Freischaltung durch den Gründer. */
  needsSlot: boolean
  isOwner: boolean
  canAccessVault: boolean
  userKey: CryptoKey | null
  items: VaultItem[]
  serverRevision: number
  syncStatus: 'idle' | 'syncing' | 'error'
  error: string | null
  rotationState: string | null
  pendingBucketId: string | null
  lastActivityTime: number

  loadStatus: (teamId: number) => Promise<TeamVaultStatusResponse | null>
  recordActivity: () => void
  checkAutoLock: () => void

  setup: (teamId: number) => Promise<boolean>
  unlock: (teamId: number) => Promise<boolean>
  /**
   * Verpackt den DEK für alle Mitglieder mit Tresor-Zugriff (Upsert).
   * Gibt zurück, für wen verpackt und wer übersprungen wurde (noch keine
   * E2EE-Identität). Nur der Gründer ruft das auf.
   */
  huellenHinterlegen: (teamId: number, dek: Uint8Array, keyVersion: number) => Promise<{ verpackt: number; uebersprungen: string[] }>
  rotateVault: (teamId: number) => Promise<boolean>
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

/**
 * Räumt die Reste des geteilten Team-Passworts weg: eigene Sperrfrist,
 * eigenen Leak-Schalter und das eigene Biometrie-Fach samt Keyring-Eintrag.
 * Alles davon gilt seit 11/2026 zentral aus dem privaten Tresor.
 */
function altlastenAufraeumen(teamId: number): void {
  if (typeof localStorage === 'undefined') return
  const schluessel = [
    `mss_team_vault_auto_lock_${teamId}`,
    `mss_team_vault_lock_blur_${teamId}`,
    `mss_team_vault_leak_check_${teamId}`,
    `mss_team_vault_bio_${teamId}`,
  ]
  let hatteBio = false
  for (const k of schluessel) {
    if (k.endsWith(`_bio_${teamId}`) && localStorage.getItem(k) === 'true') hatteBio = true
    localStorage.removeItem(k)
  }
  if (hatteBio) {
    biometrieLoeschen(`team_vault_biometric_key_${teamId}`).catch((err: unknown) => {
      still(err, 'teamVaultStore:bioAltAufraeumen')
    })
  }
}

export const useTeamVaultStore = create<TeamVaultState>((set, get) => ({
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

  recordActivity: () => {
    set({ lastActivityTime: Date.now() })
  },

  checkAutoLock: () => {
    const { isUnlocked, lastActivityTime } = get()
    if (!isUnlocked) return
    // Der Team-Tresor folgt der Karte: Ist der private Tresor zu, ist er es auch.
    const persoenlich = useVaultStore.getState()
    if (!persoenlich.isUnlocked) {
      get().lock()
      return
    }
    // Die Frist kommt zentral aus dem privaten Tresor.
    if (persoenlich.autoLockMinutes <= 0) return
    const vergangenMs = Date.now() - lastActivityTime
    if (vergangenMs >= persoenlich.autoLockMinutes * 60 * 1000) {
      get().lock()
    }
  },

  loadStatus: async (teamId: number) => {
    try {
      const res = await teamsApi.getVaultStatus(teamId)
      if (res.bucket_id) teamFuerBucketMerken(res.bucket_id, teamId)
      if (res.pending_bucket_id) teamFuerBucketMerken(res.pending_bucket_id, teamId)
      altlastenAufraeumen(teamId)
      set((state) => ({
        teamId,
        isInitialized: res.is_setup,
        // Solange entsperrt, gehören Schlüsselstand und Bucket dem DEK im
        // Speicher — nicht dem Serverstand. So erkennt die Ansicht, wenn
        // anderswo rotiert wurde, ohne den offenen Tresor zu zerreißen.
        ...(state.isUnlocked && state.teamId === teamId
          ? {}
          : { keyVersion: res.key_version, bucketId: res.bucket_id }),
        needsRotation: res.needs_rotation,
        isOwner: res.is_owner,
        canAccessVault: res.can_access_vault ?? true,
        rotationState: res.rotation_state ?? null,
        pendingBucketId: res.pending_bucket_id ?? null,
        // Wenn das Team wechselt und vorher ein anderer Tresor offen war:
        ...(state.teamId !== teamId ? { isUnlocked: false, userKey: null, items: [], serverRevision: 0, needsSlot: false } : {}),
      }))
      return res
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : 'Fehler beim Laden des Team-Tresors' })
      return null
    }
  },

  setup: async (teamId: number) => {
    try {
      // Die Karte steckt: Ohne offenen privaten Tresor gibt es keinen Team-Tresor.
      if (!useVaultStore.getState().isUnlocked) {
        set({ error: i18n.t('teams.vaultBrauchtKarte') })
        return false
      }
      let geraet: Awaited<ReturnType<typeof ensureAccountKeys>>
      try {
        geraet = await ensureAccountKeys()
      } catch (err) {
        if (err instanceof KontoSchluesselNichtUebertragenError) {
          set({ error: i18n.t('teams.vaultBrauchtSchluesselUebertragung') })
          return false
        }
        throw err
      }
      if (!geraet.kontoPaar) {
        set({ error: i18n.t('messenger.accountKeyMissing') })
        return false
      }
      const { dek, schluessel, bucketId } = await erzeugeTeamSchluessel()
      try {
        await teamsApi.setupVault(teamId, { bucket_id: bucketId })
        teamFuerBucketMerken(bucketId, teamId)
        await get().huellenHinterlegen(teamId, dek, 1)
        try {
          await teamsApi.getOwnKeyslot(teamId)
        } catch {
          // Die eigene Hülle liegt nicht: Ohne sie sperrt sich der Gründer
          // mit dem frischen Tresor selbst aus. Der Tresor ist leer (niemand
          // konnte je entsperren), also zurücksetzen und neu anfangen.
          set({ error: i18n.t('teams.vaultSetupUnvollstaendig') })
          return false
        }
        set({
          teamId,
          bucketId,
          keyVersion: 1,
          isInitialized: true,
          isUnlocked: true,
          needsRotation: false,
          needsSlot: false,
          userKey: schluessel,
          items: [],
          serverRevision: 0,
          error: null,
        })
        blobBasisSetzen(teamId)
        await ablageLaden(bucketId).catch(() => {})
        return true
      } finally {
        dek.fill(0)
      }
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : 'Fehler beim Einrichten des Team-Tresors' })
      return false
    }
  },

  huellenHinterlegen: async (teamId: number, dek: Uint8Array, keyVersion: number) => {
    // Alle Mitglieder bekommen eine Hülle — auch ohne Tresor-Recht: Lesen
    // sperrt der Server (Sync, Blobs und Slot-Abruf sind getrennt verriegelt).
    // Dafür ist eine spätere Rechtevergabe sofort wirksam, ohne Rotation.
    const detail = await teamsApi.get(teamId)
    const mitglieder = detail.members ?? []
    const oeffentlich = await kontoOeffentlichViele(mitglieder.map((m) => m.user_id))
    const slots: { user_id: number; wrapped_dek: string }[] = []
    const uebersprungen: string[] = []
    for (const m of mitglieder) {
      const konto = oeffentlich.get(m.user_id)
      if (!konto) {
        // Noch keine E2EE-Identität (nie im Messenger gewesen): Die nächste
        // Rotation holt die Hülle nach, sobald die Identität existiert.
        uebersprungen.push(m.username)
        continue
      }
      slots.push({ user_id: m.user_id, wrapped_dek: await teamSchluesselVerpacken(dek, konto.public_key) })
    }
    if (slots.length > 0) {
      await teamsApi.uploadKeyslots(teamId, { key_version: keyVersion, slots })
    }
    return { verpackt: slots.length, uebersprungen }
  },

  unlock: async (teamId: number) => {
    // Die Karte steckt: Ohne offenen privaten Tresor öffnet auch der Team-Tresor nicht.
    if (!useVaultStore.getState().isUnlocked) {
      set({ error: i18n.t('teams.vaultBrauchtKarte') })
      return false
    }
    set({ isUnlocking: true, error: null, needsSlot: false })
    try {
      await get().loadStatus(teamId)
      const stand = get()
      if (!stand.isInitialized || !stand.bucketId) {
        set({ isUnlocking: false, error: 'Team-Tresor ist noch nicht eingerichtet' })
        return false
      }
      if (!stand.canAccessVault) {
        set({ isUnlocking: false, error: i18n.t('teams.vaultKeinZugriff') })
        return false
      }
      let slot: { key_version: number; wrapped_dek: string }
      try {
        slot = await teamsApi.getOwnKeyslot(teamId)
      } catch (err) {
        // Nur 404 heißt „noch nicht freigeschaltet“ — alles andere (Netz,
        // Server) ist ein echter Fehler und läuft in die äußere Behandlung.
        if (err instanceof SanitizedApiError && err.status === 404) {
          set({ isUnlocking: false, needsSlot: true })
          return false
        }
        throw err
      }
      let geraet: Awaited<ReturnType<typeof ensureAccountKeys>>
      try {
        geraet = await ensureAccountKeys()
      } catch (err) {
        if (err instanceof KontoSchluesselNichtUebertragenError) {
          set({ isUnlocking: false, error: i18n.t('teams.vaultBrauchtSchluesselUebertragung') })
          return false
        }
        throw err
      }
      if (!geraet.kontoPaar) {
        set({ isUnlocking: false, error: i18n.t('messenger.accountKeyMissing') })
        return false
      }
      const { schluessel, bucketId: abgeleitet } = await teamSchluesselAuspacken(
        slot.wrapped_dek,
        geraet.kontoPaar.privateKeyJwk,
      )
      if (abgeleitet.toLowerCase() !== stand.bucketId.toLowerCase()) {
        set({ isUnlocking: false, error: i18n.t('teams.vaultHuellePasstNicht') })
        return false
      }

      teamFuerBucketMerken(stand.bucketId, teamId)

      // Cached Blobs vorab entschlüsseln für sofortige Anzeige
      const gespeicherte = blobsLesen(stand.bucketId)
      const vorabItems: VaultItem[] = []
      for (const b of gespeicherte) {
        if (b.is_deleted) continue
        try {
          const dec = await decryptVaultEntry(b.ciphertext, schluessel, b.id)
          if (dec && dec[VAULT_TOMBSTONE_MARKER] !== true) {
            vorabItems.push({ ...(dec as unknown as VaultItem), id: b.id, revision: b.revision })
          }
        } catch {}
      }

      set({
        teamId,
        userKey: schluessel,
        keyVersion: slot.key_version,
        bucketId: stand.bucketId,
        isUnlocked: true,
        isUnlocking: false,
        needsSlot: false,
        items: vorabItems,
        error: null,
      })
      blobBasisSetzen(teamId)
      await ablageLaden(stand.bucketId).catch(() => {})
      await get().syncWithServer(teamId)
      return true
    } catch (err: unknown) {
      set({ isUnlocking: false, error: err instanceof Error ? err.message : 'Fehler beim Entsperren des Team-Tresors' })
      return false
    }
  },

  rotateVault: async (teamId: number) => {
    const { items, userKey, bucketId } = get()
    if (!userKey || !bucketId || !useVaultStore.getState().isUnlocked) return false

    try {
      // Eine hängende Vorbereitung (z. B. nach Absturz) trägt einen verlorenen
      // Schlüssel: Der DEK liegt nirgends, also Abbruch und von vorn. Der
      // Abbruch ohne Vorbereitung ist ein harmloser Nullauf.
      await teamsApi.rotationAbort(teamId).catch(() => {})
      const { rotationJournalSchreiben } = await import('./vaultRotation')
      rotationJournalSchreiben(`team-${teamId}`, null)

      const status = await teamsApi.getVaultStatus(teamId)
      const naechsterStand = (status.key_version ?? 1) + 1
      const neu = await erzeugeTeamSchluessel()
      try {
        const { rotateVaultCore } = await import('./vaultRotation')
        await rotateVaultCore({
          scope: `team-${teamId}`,
          items,
          neuerKey: neu.schluessel,
          neueBucketId: neu.bucketId,
          // Kein Salt (kein KDF-Produkt), kein Datei-Backup (Rollback-Fenster genügt).
          transformItem: async (item) => {
            // Blob-Schluessel auf den neuen Team-Schluessel umwickeln; Chunks bleiben.
            if (!item.datei) return item
            const wickeln = async (kopf: unknown) =>
              istBlobKopf(kopf) ? blobSchluesselNeuWickeln(kopf, userKey, neu.schluessel, item.id) : kopf
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
            prepare: async (b) => {
              await teamsApi.rotationPrepare(teamId, { bucket_id: b })
              // Erst weiter, wenn die Hüllen für den neuen Stand liegen —
              // sonst sperrt der Commit die Mitglieder aus. Scheitert das,
              // bricht der Kern ab und raeumt das Staging wieder weg.
              await get().huellenHinterlegen(teamId, neu.dek, naechsterStand)
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

        teamFuerBucketMerken(neu.bucketId, teamId)
        try { await ablageLaden(neu.bucketId) } catch (err) { still(err, 'teamVaultStore:ablageLaden') }

        set({
          bucketId: neu.bucketId,
          keyVersion: naechsterStand,
          userKey: neu.schluessel,
          needsRotation: false,
          rotationState: 'committed',
          pendingBucketId: null,
          serverRevision: 0,
          error: null,
        })
        await get().syncWithServer(teamId)
        return true
      } finally {
        neu.dek.fill(0)
      }
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : 'Fehler beim Erneuern des Team-Schlüssels' })
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
      keyVersion: null,
      needsRotation: false,
      needsSlot: false,
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
  // Zentral aus dem privaten Tresor: eine Einstellung für beide.
  sperrtBeiFensterwechsel: () => useVaultStore.getState().lockOnWindowBlur,
  merkeAktivitaet: () => useTeamVaultStore.getState().recordActivity(),
  pruefeFrist: () => {
    useTeamVaultStore.getState().checkAutoLock()
  },
  sperre: () => useTeamVaultStore.getState().lock(),
}

