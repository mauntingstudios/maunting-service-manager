/**
 * Tresor-Backups (`.msmvault`) aus der Passwort-Rotation der Haupt-App.
 *
 * Format: Kopfzeile `MSM-VAULT-BACKUP-v1 <base64 Salt>`, danach dieselben
 * Frames wie bei Panel-Backups. Entschlüsselung nutzt `deriveKey` und
 * `decryptFrames` aus `decrypt.ts` — ein Format, eine Implementierung.
 */

import { deriveKey, decryptFrames } from './decrypt';

export const VAULT_BACKUP_MAGIC = 'MSM-VAULT-BACKUP-v1';

function base64ToBytes(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function istTresorBackup(daten: Uint8Array): boolean {
  const kopf = new TextDecoder().decode(daten.subarray(0, Math.min(daten.length, 128)));
  return kopf.startsWith(`${VAULT_BACKUP_MAGIC} `);
}

export async function entschluesseleTresorBackup(
  daten: Uint8Array,
  passwort: string,
): Promise<Record<string, unknown>[]> {
  const zeilenende = daten.indexOf(0x0a);
  if (zeilenende < 0) throw new Error('Invalid frame format: missing vault header');
  const kopf = new TextDecoder().decode(daten.subarray(0, zeilenende)).trim();
  const [magic, saltB64] = kopf.split(' ');
  if (magic !== VAULT_BACKUP_MAGIC || !saltB64) {
    throw new Error('Invalid frame format: bad vault header');
  }
  const key = await deriveKey(passwort, base64ToBytes(saltB64));
  const teile: Uint8Array[] = [];
  let gesamt = 0;
  for await (const teil of decryptFrames(daten.subarray(zeilenende + 1), key)) {
    teile.push(teil);
    gesamt += teil.length;
  }
  const klartext = new Uint8Array(gesamt);
  let pos = 0;
  for (const teil of teile) {
    klartext.set(teil, pos);
    pos += teil.length;
  }
  const parsed = JSON.parse(new TextDecoder().decode(klartext)) as {
    art?: unknown;
    version?: unknown;
    eintraege?: Record<string, unknown>[];
  };
  // Der innere Kopf entscheidet, was das ist: ein fremdes JSON mit
  // `eintraege`-Liste (falsche Art, unbekannte Version) ist kein Backup.
  if (parsed.art !== 'msm-vault-backup' || parsed.version !== 1) {
    throw new Error('Invalid frame format: not a vault backup');
  }
  if (!Array.isArray(parsed.eintraege)) {
    throw new Error('Invalid frame format: no entries in vault backup');
  }
  return parsed.eintraege;
}
