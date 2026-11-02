import { describe, it, expect } from 'vitest';
import { aesGcmEncrypt } from '@msdis/shield/aead';
import { randomBytes } from '@msdis/shield/random';
import { deriveTestKey, bytesToBase64, base64ToBytes } from './test-fixture';
import { istTresorBackup, entschluesseleTresorBackup, VAULT_BACKUP_MAGIC } from './vaultBackup';

/** Baut eine .msmvault-Datei exakt wie `tresorBackup.ts` im Frontend. */
async function baueTresorBackup(
  eintraege: unknown,
  passwort: string,
  innen?: { art?: unknown; version?: unknown },
): Promise<Uint8Array> {
  const salt = randomBytes(32);
  const key = await deriveTestKey(passwort, salt);
  const klartext = new TextEncoder().encode(
    JSON.stringify({ art: 'msm-vault-backup', version: 1, ...innen, eintraege }),
  );
  const nonce = randomBytes(12);
  const chiffrat = await aesGcmEncrypt(key, nonce, klartext);
  const kopf = new TextEncoder().encode(`${VAULT_BACKUP_MAGIC} ${bytesToBase64(salt)}\n`);
  const frame = new Uint8Array(4 + nonce.length + chiffrat.length);
  new DataView(frame.buffer).setUint32(0, nonce.length + chiffrat.length);
  frame.set(nonce, 4);
  frame.set(chiffrat, 4 + nonce.length);
  const out = new Uint8Array(kopf.length + frame.length);
  out.set(kopf, 0);
  out.set(frame, kopf.length);
  return out;
}

describe('vaultBackup', () => {
  it('erkennt und entschlüsselt ein Tresor-Backup der Haupt-App', async () => {
    const daten = await baueTresorBackup([{ id: 'a', service: 'Mail', username: 'u' }], 'altes-passwort-123');
    expect(istTresorBackup(daten)).toBe(true);
    const gelesen = await entschluesseleTresorBackup(daten, 'altes-passwort-123');
    expect(gelesen).toEqual([{ id: 'a', service: 'Mail', username: 'u' }]);
  });

  it('falsches Passwort scheitert, Panel-Backup wird nicht als Tresor erkannt', async () => {
    const daten = await baueTresorBackup([{ id: 'a' }], 'altes-passwort-123');
    await expect(entschluesseleTresorBackup(daten, 'falsch-falsch-falsch')).rejects.toThrow();
    expect(istTresorBackup(new Uint8Array([0x1f, 0x8b, 1, 2, 3]))).toBe(false);
  });

  it('weist fremde Art und unbekannte Version ab, auch mit Einträgen', async () => {
    const passwort = 'altes-passwort-123';
    const fremd = await baueTresorBackup([{ id: 'a' }], passwort, { art: 'msm-panel-backup' });
    await expect(entschluesseleTresorBackup(fremd, passwort)).rejects.toThrow('not a vault backup');
    const neu = await baueTresorBackup([{ id: 'a' }], passwort, { version: 2 });
    await expect(entschluesseleTresorBackup(neu, passwort)).rejects.toThrow('not a vault backup');
    const ohne = await baueTresorBackup([{ id: 'a' }], passwort, { art: undefined, version: undefined });
    await expect(entschluesseleTresorBackup(ohne, passwort)).rejects.toThrow('not a vault backup');
  });

  it('entschlüsselt echten Test-Vektor aus tresorBackup (Cross-Package Kompatibilität)', async () => {
    const vectorB64 =
      'TVNNLVZBVUxULUJBQ0tVUC12MSBJYUM0YnpDaHpEdUJJcUphYllsd2cvcDZkUFFUWXh2OUFicEVGQzhER0pvPQoAAACVb27w64zYj7wLvA0hMo5nPcFjKeIqtc1BJESJCwQsAYBjhQv6L13xZjqSi74cZI3GdLzt+B/4l58DGGtl4mhSC7DvljHBE3LzHY0T9cZbjjqDmmTzrpqGtZeAPgktRqv2jSDgsxORjh5fHC3e9S/jFyk389gtIxnCZ1UlhSF/5iZYnKprQgM+a3rpZ1RIai7qYO9LAL8=';
    const daten = base64ToBytes(vectorB64);
    expect(istTresorBackup(daten)).toBe(true);
    const eintraege = await entschluesseleTresorBackup(daten, 'altes-passwort-123');
    expect(eintraege).toEqual([{ id: 'a', service: 'Mail' }]);
  });
});
