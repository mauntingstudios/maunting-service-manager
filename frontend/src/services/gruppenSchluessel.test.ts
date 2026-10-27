// @vitest-environment node
/**
 * Der Umschlag der Gruppenblöcke.
 *
 * Zwei Dinge sind hier festgemacht und fallen sonst stillschweigend aus:
 *
 * 1. **Das Format.** Der Server prüft `sv-e2ee-group-v1:<kennung>.<chiffrat>`
 * und weist alles andere mit 422 ab. Ein Block ohne diesen Kopf erreichte die
 * Datenbank nie — und damit auch kein Name, kein Bild und kein Hintergrund.
 * 2. **Die Trennung.** Der Chiffretext steht hinter der Kennung; wer nur die
 * Kennung sieht, weiß nichts über den Inhalt.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/api/social', () => ({
  getE2eeChatKeys: vi.fn(async () => ({ keys: [], latest_key_version: 1 })),
}))

vi.mock('./chatKrypto', () => ({
  holeChatSchluessel: vi.fn(async () => 'schluessel'),
  holeChatSchluesselRoh: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
  vergissChatSchluessel: vi.fn(),
}))

vi.mock('@msdis/shield/aead', () => ({
  encryptString: vi.fn(async (klartext: string, _key: unknown, aad: string) => `CT|${aad}|${klartext}`),
  decryptString: vi.fn(async (chiffrat: string) => {
    const teile = chiffrat.split('|')
    return teile.slice(2).join('|')
  }),
}))

vi.mock('@msdis/shield/integrity', () => ({
  sha256Hex: vi.fn(async () => '0123456789abcdef'),
}))

import {
  entschluesseleGruppenUmschlag,
  verschluesseleFuerGruppe,
  type GruppenKontext,
} from './gruppenSchluessel'

const KONTEXT: GruppenKontext = {
  groupId: 7,
  blindMailboxId: 'a'.repeat(64),
  eigeneId: 101,
  mitglieder: [101],
}

describe('Der Gruppenumschlag', () => {
  it('trägt Präfix, Schlüsselkennung und Chiffretext', async () => {
    const umschlag = await verschluesseleFuerGruppe(KONTEXT, '{"name":"Küche"}')

    expect(umschlag.startsWith('sv-e2ee-group-v1:')).toBe(true)
    const [, rest] = umschlag.split('sv-e2ee-group-v1:')
    const [kennung, ...chiffretext] = rest.split('.')
    expect(kennung).toBe('0123456789abcdef')
    expect(kennung).toMatch(/^[0-9a-f]{16}$/)
    expect(chiffretext.join('.')).toBe('CT|msm:groupconfig:7|{"name":"Küche"}')
  })

  it('öffnet denselben Block wieder', async () => {
    const umschlag = await verschluesseleFuerGruppe(KONTEXT, '{"name":"Küche"}')

    expect(await entschluesseleGruppenUmschlag(7, umschlag)).toBe('{"name":"Küche"}')
  })

  it('trennt die Blöcke über die AAD', async () => {
    // Derselbe Klartext unter anderer AAD ergibt einen anderen Chiffretext.
    const alsInfo = await verschluesseleFuerGruppe(KONTEXT, 'x', 'info')
    const alsConfig = await verschluesseleFuerGruppe(KONTEXT, 'x', 'config')

    expect(alsInfo).not.toBe(alsConfig)
  })
})
