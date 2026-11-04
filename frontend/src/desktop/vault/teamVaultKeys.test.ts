import { beforeAll, describe, expect, it } from 'vitest'

import { generateLocalE2eeKeyPair, encryptE2eeHybrid } from '@/services/e2eeCrypto'
import { bytesToBase64 } from '@msdis/shield/core'
import {
  erzeugeTeamSchluessel,
  teamSchluesselAuspacken,
  teamSchluesselVerpacken,
} from './teamVaultKeys'
import { decryptVaultEntry, encryptVaultEntry } from './vaultCrypto'

describe('teamVaultKeys', () => {
  // Einmal pro Datei: RSA-4096 kostet Sekunden, unter Volllauf-Last zu viel pro Test.
  let alice: { publicKeyJwk: string; privateKeyJwk: string }
  let bob: { publicKeyJwk: string; privateKeyJwk: string }

  beforeAll(async () => {
    alice = await generateLocalE2eeKeyPair()
    bob = await generateLocalE2eeKeyPair()
  })

  it('erzeugt Schlüssel mit 32 Bytes und blinder Bucket-Kennung', async () => {
    const { dek, schluessel, bucketId } = await erzeugeTeamSchluessel()
    expect(dek).toHaveLength(32)
    expect(bucketId).toMatch(/^[0-9a-f]{64}$/)
    // Der Schlüssel ver- und entschlüsselt Tresor-Einträge wie ein abgeleiteter.
    const chiffrat = await encryptVaultEntry({ service: 't', password: 'p' }, schluessel, 'e1')
    expect(await decryptVaultEntry(chiffrat, schluessel, 'e1')).toMatchObject({ service: 't' })
  })

  it('verpackt und öffnet den Schlüssel je Mitglied (Roundtrip)', async () => {
    const { dek, schluessel, bucketId } = await erzeugeTeamSchluessel()

    const huelleAlice = await teamSchluesselVerpacken(dek, alice.publicKeyJwk)
    const huelleBob = await teamSchluesselVerpacken(dek, bob.publicKeyJwk)
    expect(huelleAlice.startsWith('sv-e2ee-hybrid-v1:')).toBe(true)
    expect(huelleAlice).not.toBe(huelleBob)

    const beiAlice = await teamSchluesselAuspacken(huelleAlice, alice.privateKeyJwk)
    expect(beiAlice.bucketId).toBe(bucketId)
    // Alices Schlüssel öffnet, was der Original-Schlüssel versiegelt hat.
    const chiffrat = await encryptVaultEntry({ service: 't' }, schluessel, 'e1')
    expect(await decryptVaultEntry(chiffrat, beiAlice.schluessel, 'e1')).toMatchObject({ service: 't' })
    // Bobs Hülle öffnet Bob, nicht Alice.
    await expect(teamSchluesselAuspacken(huelleBob, alice.privateKeyJwk)).rejects.toThrow()
  })

  it('weist defekte Hüllen mit verständlichem Fehler ab', async () => {
    await expect(teamSchluesselAuspacken('kein-umschlag', alice.privateKeyJwk)).rejects.toThrow(
      'Schlüsselhülle lässt sich nicht öffnen.',
    )
    const { dek } = await erzeugeTeamSchluessel()
    const fremd = await teamSchluesselVerpacken(dek, bob.publicKeyJwk)
    await expect(teamSchluesselAuspacken(fremd, alice.privateKeyJwk)).rejects.toThrow(
      'Schlüsselhülle lässt sich nicht öffnen.',
    )
    const falschFormatiert = await encryptE2eeHybrid(JSON.stringify({ x: 1 }), alice.publicKeyJwk)
    await expect(teamSchluesselAuspacken(falschFormatiert, alice.privateKeyJwk)).rejects.toThrow(
      'Schlüsselhülle hat ein unbekanntes Format.',
    )
    const kurz = await encryptE2eeHybrid(
      JSON.stringify({ v: 1, dek: bytesToBase64(new Uint8Array(8)) }),
      alice.publicKeyJwk,
    )
    await expect(teamSchluesselAuspacken(kurz, alice.privateKeyJwk)).rejects.toThrow(
      'Schlüsselhülle ist beschädigt.',
    )
  })
})
