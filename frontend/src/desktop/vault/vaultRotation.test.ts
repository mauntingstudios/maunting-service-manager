import { describe, it, expect, vi } from 'vitest'
import { deriveVaultKeys, bytesToBase64, base64ToBytes } from './vaultCrypto'
import { rotateVaultCore, type RotationTransport } from './vaultRotation'
import { erstelleBackupBytes, leseBackupBytes } from './tresorBackup'
import type { VaultItem } from './vaultEintrag'

vi.mock('../tauri', () => ({
  pruefeBiometrieVerfuegbar: vi.fn().mockResolvedValue(false),
  verifiziereBiometrie: vi.fn().mockResolvedValue(false),
  biometrieSpeicherVerfuegbar: vi.fn().mockResolvedValue(false),
}))

const SALT = new Uint8Array(32).fill(7)

function item(id: string): VaultItem {
  return { id, service: `svc-${id}`, username: 'u', password: 'p', revision: 1, createdAt: 1, updatedAt: 1 } as VaultItem
}

function fakeTransport(opts: { failVerify?: boolean } = {}) {
  const staging = new Map<string, { id: string; ciphertext: string; revision: number; is_deleted: boolean }>()
  const calls: string[] = []
  const transport: RotationTransport = {
    prepare: async () => { calls.push('prepare') },
    sync: async (_b, mutationen) => {
      calls.push('sync')
      for (const m of mutationen) staging.set(m.id, { ...m })
      if (mutationen.length === 0) {
        const entries = [...staging.values()]
        if (opts.failVerify && entries.length > 0) entries[0] = { ...entries[0], ciphertext: 'sv-vault-v2:kaputt' }
        return { server_revision: entries.length, entries }
      }
      return { server_revision: staging.size, entries: [] }
    },
    commit: async () => { calls.push('commit') },
    abort: async () => { calls.push('abort') },
  }
  return { transport, calls, staging }
}

describe('rotateVaultCore', () => {
  it('Backup -> Prepare -> Staging -> Verify -> Commit, in dieser Reihenfolge', async () => {
    const alt = await deriveVaultKeys('altes-passwort-123', SALT)
    const neu = await deriveVaultKeys('neues-passwort-123', SALT)
    const { transport, calls, staging } = fakeTransport()
    const order: string[] = []
    const origPrepare = transport.prepare
    transport.prepare = async (...a) => { order.push('prepare'); return origPrepare(...a) }

    await rotateVaultCore({
      scope: 'test',
      items: [item('a'), item('b')],
      neuerKey: neu.userKey,
      neueBucketId: neu.bucketId,
      neuesSalt: bytesToBase64(SALT),
      transport,
      backup: async () => { order.push('backup') },
    })

    expect(order[0]).toBe('backup')
    expect(order[1]).toBe('prepare')
    expect(calls).toContain('commit')
    expect(calls).not.toContain('abort')
    expect(staging.size).toBe(2)
    void alt
  })

  it('Bei kaputtem Staging: Abort statt Commit (kein Datenverlust-Pfad)', async () => {
    const neu = await deriveVaultKeys('neues-passwort-123', SALT)
    const { transport, calls } = fakeTransport({ failVerify: true })
    await expect(
      rotateVaultCore({
        scope: 'test',
        items: [item('a')],
        neuerKey: neu.userKey,
        neueBucketId: neu.bucketId,
        neuesSalt: bytesToBase64(SALT),
        transport,
        backup: async () => {},
      }),
    ).rejects.toThrow()
    expect(calls).toContain('abort')
    expect(calls).not.toContain('commit')
  })

  it('Backup-Fehler startet die Rotation gar nicht', async () => {
    const neu = await deriveVaultKeys('neues-passwort-123', SALT)
    const { transport, calls } = fakeTransport()
    await expect(
      rotateVaultCore({
        scope: 'test',
        items: [item('a')],
        neuerKey: neu.userKey,
        neueBucketId: neu.bucketId,
        neuesSalt: bytesToBase64(SALT),
        transport,
        backup: async () => { throw new Error('kein Platz') },
      }),
    ).rejects.toThrow('kein Platz')
    expect(calls).toEqual([])
  })
})

describe('tresorBackup', () => {
  it('Roundtrip mit altem Passwort, falsches Passwort scheitert', async () => {
    const bytes = await erstelleBackupBytes([{ id: 'a', service: 'Mail' }], 'altes-passwort-123')
    const gelesen = await leseBackupBytes(bytes, 'altes-passwort-123')
    expect(gelesen).toEqual([{ id: 'a', service: 'Mail' }])
    await expect(leseBackupBytes(bytes, 'falsches-passwort-123')).rejects.toThrow()
  })

  it('weist fremde Art und unbekannte Version ab, auch mit Einträgen', async () => {
    const { argon2idRaw, importAesGcmKey } = await import('@msdis/shield/kdf')
    const { aesGcmEncrypt } = await import('@msdis/shield/aead')
    const { BACKUP_MAGIC } = await import('./tresorBackup')
    const passwort = 'altes-passwort-123'
    async function mitKopf(kopf: Record<string, unknown>): Promise<Uint8Array> {
      const salt = new Uint8Array(32)
      crypto.getRandomValues(salt)
      const roh = await argon2idRaw({
        password: passwort,
        salt,
        memorySize: 131072,
        iterations: 3,
        parallelism: 4,
        hashLength: 32,
      })
      const key = await importAesGcmKey(roh)
      const klartext = new TextEncoder().encode(JSON.stringify({ ...kopf, eintraege: [{ id: 'a' }] }))
      const nonce = new Uint8Array(12)
      crypto.getRandomValues(nonce)
      const chiffrat = await aesGcmEncrypt(key, nonce, klartext)
      const einleitung = new TextEncoder().encode(`${BACKUP_MAGIC} ${bytesToBase64(salt)}\n`)
      const rahmen = new Uint8Array(4 + nonce.length + chiffrat.length)
      new DataView(rahmen.buffer).setUint32(0, nonce.length + chiffrat.length)
      rahmen.set(nonce, 4)
      rahmen.set(chiffrat, 4 + nonce.length)
      const out = new Uint8Array(einleitung.length + rahmen.length)
      out.set(einleitung, 0)
      out.set(rahmen, einleitung.length)
      return out
    }
    await expect(
      leseBackupBytes(await mitKopf({ art: 'msm-panel-backup', version: 1 }), passwort),
    ).rejects.toThrow('Ungültiges Backup-Format')
    await expect(
      leseBackupBytes(await mitKopf({ art: 'msm-vault-backup', version: 2 }), passwort),
    ).rejects.toThrow('Ungültiges Backup-Format')
    await expect(leseBackupBytes(await mitKopf({}), passwort)).rejects.toThrow('Ungültiges Backup-Format')
  })

  it('entschlüsselt statischen Test-Vektor (Cross-Package mit Recovery)', async () => {
    const vectorB64 =
      'TVNNLVZBVUxULUJBQ0tVUC12MSBJYUM0YnpDaHpEdUJJcUphYllsd2cvcDZkUFFUWXh2OUFicEVGQzhER0pvPQoAAACVb27w64zYj7wLvA0hMo5nPcFjKeIqtc1BJESJCwQsAYBjhQv6L13xZjqSi74cZI3GdLzt+B/4l58DGGtl4mhSC7DvljHBE3LzHY0T9cZbjjqDmmTzrpqGtZeAPgktRqv2jSDgsxORjh5fHC3e9S/jFyk389gtIxnCZ1UlhSF/5iZYnKprQgM+a3rpZ1RIai7qYO9LAL8='
    const gelesen = await leseBackupBytes(base64ToBytes(vectorB64), 'altes-passwort-123')
    expect(gelesen).toEqual([{ id: 'a', service: 'Mail' }])
  })
})
