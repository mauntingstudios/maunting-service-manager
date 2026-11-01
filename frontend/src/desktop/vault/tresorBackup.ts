/**
 * Verschlüsseltes Tresor-Backup vor einer Passwort-Rotation.
 *
 * Dateiformat (von der Recovery-App lesbar):
 *   Zeile 1: `MSM-VAULT-BACKUP-v1 <base64 Salt>`
 *   danach: Frames wie bei Panel-Backups `[4B Länge][12B Nonce][Ciphertext+Tag]`
 * KDF exakt wie die Recovery-App (Argon2id 128 MiB, 32 Byte), damit sie die
 * Datei mit dem alten Master-Passwort ohne Umbau öffnen kann.
 */

import { argon2idRaw, importAesGcmKey } from '@msdis/shield/kdf'
import { aesGcmDecrypt, aesGcmEncrypt } from '@msdis/shield/aead'
import { fillRandom } from '@msdis/shield/random'
import { base64ToBytes, bytesToBase64 } from './vaultCrypto'

export const BACKUP_MAGIC = 'MSM-VAULT-BACKUP-v1'
const FRAME_KLARTEXT = 1024 * 1024

async function backupKey(passwort: string, salt: Uint8Array): Promise<CryptoKey> {
  const roh = await argon2idRaw({
    password: passwort,
    salt,
    memorySize: 131072,
    iterations: 3,
    parallelism: 4,
    hashLength: 32,
  })
  try {
    return await importAesGcmKey(roh)
  } finally {
    roh.fill(0)
  }
}

export async function erstelleBackupBytes(
  eintraege: Record<string, unknown>[],
  altesPasswort: string,
): Promise<Uint8Array> {
  const salt = new Uint8Array(32)
  fillRandom(salt)
  const key = await backupKey(altesPasswort, salt)
  const klartext = new TextEncoder().encode(
    JSON.stringify({ art: 'msm-vault-backup', version: 1, erstellt_am: new Date().toISOString(), eintraege }),
  )
  const teile: Uint8Array[] = [new TextEncoder().encode(`${BACKUP_MAGIC} ${bytesToBase64(salt)}\n`)]
  for (let ab = 0; ab < klartext.length; ab += FRAME_KLARTEXT) {
    const nonce = new Uint8Array(12)
    fillRandom(nonce)
    const chiffrat = await aesGcmEncrypt(key, nonce, klartext.subarray(ab, ab + FRAME_KLARTEXT))
    const kopf = new Uint8Array(4)
    new DataView(kopf.buffer).setUint32(0, nonce.length + chiffrat.length)
    teile.push(kopf, nonce, chiffrat)
  }
  const gesamt = teile.reduce((n, t) => n + t.length, 0)
  const ergebnis = new Uint8Array(gesamt)
  let ab = 0
  for (const t of teile) {
    ergebnis.set(t, ab)
    ab += t.length
  }
  return ergebnis
}

export async function leseBackupBytes(
  daten: Uint8Array,
  passwort: string,
): Promise<Record<string, unknown>[]> {
  const zeilenende = daten.indexOf(0x0a)
  if (zeilenende < 0) throw new Error('Ungültiges Backup-Format')
  const kopf = new TextDecoder().decode(daten.subarray(0, zeilenende)).trim()
  const [magic, saltB64] = kopf.split(' ')
  if (magic !== BACKUP_MAGIC || !saltB64) throw new Error('Ungültiges Backup-Format')
  const key = await backupKey(passwort, base64ToBytes(saltB64))
  const teile: Uint8Array[] = []
  let ab = zeilenende + 1
  const sicht = new DataView(daten.buffer, daten.byteOffset, daten.byteLength)
  while (ab < daten.length) {
    if (ab + 4 > daten.length) throw new Error('Ungültiges Backup-Format')
    const laenge = sicht.getUint32(ab)
    ab += 4
    if (laenge < 12 || ab + laenge > daten.length) throw new Error('Ungültiges Backup-Format')
    teile.push(await aesGcmDecrypt(key, daten.subarray(ab, ab + 12), daten.subarray(ab + 12, ab + laenge)))
    ab += laenge
  }
  const gesamt = teile.reduce((n, t) => n + t.length, 0)
  const klartext = new Uint8Array(gesamt)
  let pos = 0
  for (const t of teile) {
    klartext.set(t, pos)
    pos += t.length
  }
  const parsed = JSON.parse(new TextDecoder().decode(klartext)) as { eintraege?: Record<string, unknown>[] }
  if (!Array.isArray(parsed.eintraege)) throw new Error('Ungültiges Backup-Format')
  return parsed.eintraege
}

/** Legt das Backup automatisch in `tresor-backups/` im App-Ordner ab (Rust). */
export async function speichereBackupImAppOrdner(bytes: Uint8Array, name: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('tresor_backup_speichern', { name, inhaltBase64: bytesToBase64(bytes) })
}

export function backupDateiname(art: 'team' | 'privat'): string {
  const zeit = new Date().toISOString().replace(/[:.]/g, '-')
  return `tresor-${art}-${zeit}.msmvault`
}
