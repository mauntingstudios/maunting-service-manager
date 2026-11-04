/**
 * Gemeinsame Zwei-Phasen-Rotation für privaten und Team-Tresor.
 *
 * Reihenfolge (nie anders): Backup -> Prepare -> Staging beschreiben ->
 * durch Entschlüsseln verifizieren -> Commit. Der aktive Bucket wird vom
 * Server ab Prepare eingefroren und erst nach Commit + 7 Tagen gelöscht.
 * Schlägt Verifikation fehl, wird das Staging abgebrochen und nichts gelöscht.
 */

import { decryptVaultEntry, encryptVaultEntry } from './vaultCrypto'
import type { VaultItem } from './vaultEintrag'

export interface RotationMutation {
  id: string
  ciphertext: string
  revision: number
  is_deleted: boolean
}

export interface RotationSyncErgebnis {
  server_revision: number
  entries: { id: string; ciphertext: string; revision: number; is_deleted: boolean }[]
  has_more?: boolean
  conflicts?: unknown[]
}

export interface RotationTransport {
  prepare: (bucketId: string, salt?: string) => Promise<void>
  sync: (bucketId: string, mutations: RotationMutation[]) => Promise<RotationSyncErgebnis>
  commit: () => Promise<void>
  abort: () => Promise<void>
}

export type RotationPhase = 'backup' | 'prepared' | 'staging' | 'verifiziert' | 'committed' | 'abgebrochen'

const JOURNAL_PREFIX = 'mss_rotation_journal_'

export function rotationJournalLesen(scope: string): Record<string, unknown> | null {
  try {
    const roh = localStorage.getItem(`${JOURNAL_PREFIX}${scope}`)
    return roh ? (JSON.parse(roh) as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function rotationJournalSchreiben(scope: string, daten: Record<string, unknown> | null): void {
  try {
    if (daten === null) localStorage.removeItem(`${JOURNAL_PREFIX}${scope}`)
    else localStorage.setItem(`${JOURNAL_PREFIX}${scope}`, JSON.stringify(daten))
  } catch {}
}

export async function rotateVaultCore(opts: {
  scope: string
  items: VaultItem[]
  neuerKey: CryptoKey
  neueBucketId: string
  /** Nur privat: Der Team-Schlüssel ist zufällig, kein KDF-Produkt. */
  neuesSalt?: string
  transport: RotationTransport
  /**
   * Nur privat: Das Datei-Backup versiegelt das Passwort. Dem Team genügt
   * das siebentägige Rollback-Fenster des Alt-Buckets auf dem Server.
   */
  backup?: () => Promise<void>
  transformItem?: (item: VaultItem) => Promise<VaultItem>
  onPhase?: (phase: RotationPhase) => void
}): Promise<void> {
  const { transport } = opts
  // 1. Backup zuerst: schlägt es fehl, startet die Rotation gar nicht.
  await opts.backup?.()
  opts.onPhase?.('backup')
  rotationJournalSchreiben(opts.scope, {
    phase: 'backup',
    bucketId: opts.neueBucketId,
    salt: opts.neuesSalt,
    begonnen: Date.now(),
  })

  await transport.prepare(opts.neueBucketId, opts.neuesSalt)
  opts.onPhase?.('prepared')
  rotationJournalSchreiben(opts.scope, {
    phase: 'prepared',
    bucketId: opts.neueBucketId,
    salt: opts.neuesSalt,
    begonnen: Date.now(),
  })

  try {
    // 2. Staging beschreiben (Pakete à 100, wie der normale Sync).
    const mutationen: RotationMutation[] = []
    for (const rohItem of opts.items) {
      const item = opts.transformItem ? await opts.transformItem(rohItem) : rohItem
      mutationen.push({
        id: item.id,
        ciphertext: await encryptVaultEntry(item as unknown as Record<string, unknown>, opts.neuerKey, item.id),
        revision: item.revision ?? 0,
        // Papierkorb ist ein Flag im Umschlag, keine Server-Löschung.
        is_deleted: false,
      })
    }
    for (let ab = 0; ab < mutationen.length; ab += 100) {
      await transport.sync(opts.neueBucketId, mutationen.slice(ab, ab + 100))
    }
    opts.onPhase?.('staging')

    // 3. Verifizieren: alles zurücklesen und mit dem neuen Schlüssel öffnen.
    // Der Transport liefert dafür alle Einträge (seit Revision 0, inkl. Seiten).
    const gesehen = new Set<string>()
    const res = await transport.sync(opts.neueBucketId, [])
    for (const eintrag of res.entries) {
      if (eintrag.is_deleted) continue
      await decryptVaultEntry(eintrag.ciphertext, opts.neuerKey, eintrag.id)
      gesehen.add(eintrag.id)
    }
    const erwartet = new Set(opts.items.map((i) => i.id))
    // Alle Einträge (auch im Papierkorb) sind im Umschlag verschlüsselt und müssen im Staging lesbar sein.
    for (const id of erwartet) {
      if (!gesehen.has(id)) throw new Error(`Rotation-Verifikation fehlgeschlagen: Eintrag ${id} fehlt im neuen Bucket.`)
    }
    opts.onPhase?.('verifiziert')
    rotationJournalSchreiben(opts.scope, {
      phase: 'verifiziert',
      bucketId: opts.neueBucketId,
      salt: opts.neuesSalt,
      begonnen: Date.now(),
    })
  } catch (fehler) {
    // Abbruch: Staging verwerfen, aktiver Tresor bleibt unberührt.
    await transport.abort().catch(() => {})
    rotationJournalSchreiben(opts.scope, null)
    opts.onPhase?.('abgebrochen')
    throw fehler
  }

  // 4. Erst jetzt umschalten. Der alte Bucket bleibt 7 Tage (Server) bestehen.
  await transport.commit()
  rotationJournalSchreiben(opts.scope, null)
  opts.onPhase?.('committed')
}
