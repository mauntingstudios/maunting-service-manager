// @vitest-environment node
/**
 * Der Umschlag der Gruppenblöcke.
 *
 * Zwei Dinge sind hier festgemacht und fallen sonst stillschweigend aus:
 *
 * 1. **Das Format.** Der Server prüft `sv-e2ee-group-v1:<kennung>.<chiffrat>`
 *    und weist alles andere mit 422 ab. Ein Block ohne diesen Kopf erreichte die
 *    Datenbank nie — und damit auch kein Name, kein Bild und kein Hintergrund.
 * 2. **Der Schlüsselstand.** Die Kennung im Kopf gehört zu der Version, unter
 *    der geschrieben wurde. Nach einer Drehung muss ein alter Block weiterhin
 *    lesbar bleiben; ihn mit der neuesten Version zu öffnen war der Fehler vom
 *    28.10.2026.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ getE2eeChatKeys: vi.fn() }))
const krypto = vi.hoisted(() => ({
  holeChatSchluessel: vi.fn(),
  holeChatSchluesselRoh: vi.fn(),
  vergissChatSchluessel: vi.fn(),
}))
const aead = vi.hoisted(() => ({ encryptString: vi.fn(), decryptString: vi.fn() }))
const hash = vi.hoisted(() => ({ sha256Hex: vi.fn() }))

vi.mock('@/api/social', () => api)
vi.mock('./chatKrypto', () => krypto)
vi.mock('@msdis/shield/aead', () => aead)
vi.mock('@msdis/shield/integrity', () => hash)

import {
  brauchtNeueGruppenVersion,
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

function versionen(...werte: number[]) {
  return {
    keys: werte.map((key_version) => ({ key_version })),
    latest_key_version: werte[werte.length - 1] ?? 0,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  api.getE2eeChatKeys.mockResolvedValue(versionen(1))
  krypto.holeChatSchluessel.mockImplementation(async (_art, _id, version) => ({ version }))
  krypto.holeChatSchluesselRoh.mockImplementation(async (_art, _id, version) => new Uint8Array([version]))
  hash.sha256Hex.mockImplementation(async (roh: Uint8Array) => String(roh[0]).padStart(16, '0'))
  aead.encryptString.mockImplementation(
    async (klartext: string, key: { version: number }, aad: string) => `CT|v${key.version}|${aad}|${klartext}`,
  )
  aead.decryptString.mockImplementation(
    async (chiffrat: string, key: { version: number }, aad: string) => {
      const [marke, version, chiffratAad, ...rest] = chiffrat.split('|')
      if (marke !== 'CT' || version !== `v${key.version}` || chiffratAad !== aad) {
        throw new Error('falscher Schluessel')
      }
      return rest.join('|')
    },
  )
})

describe('Der Gruppenumschlag', () => {
  it('trägt Präfix, Schlüsselkennung und Chiffretext', async () => {
    const umschlag = await verschluesseleFuerGruppe(KONTEXT, '{"name":"Küche"}')

    expect(umschlag.startsWith('sv-e2ee-group-v1:')).toBe(true)
    const [, rest] = umschlag.split('sv-e2ee-group-v1:')
    const [kennung, ...chiffretext] = rest.split('.')
    expect(kennung).toBe('0000000000000001')
    expect(kennung).toMatch(/^[0-9a-f]{16}$/)
    expect(chiffretext.join('.')).toBe('CT|v1|msm:groupconfig:7|{"name":"Küche"}')
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

  it('öffnet einen Block der alten Version, nachdem die Gruppe gedreht hat', async () => {
    const alt = await verschluesseleFuerGruppe(KONTEXT, '{"name":"Küche"}')
    api.getE2eeChatKeys.mockResolvedValue(versionen(1, 2))

    expect(await entschluesseleGruppenUmschlag(7, alt)).toBe('{"name":"Küche"}')
  })

  it('nimmt für einen Block ohne Kopf die neueste Version', async () => {
    api.getE2eeChatKeys.mockResolvedValue(versionen(1, 2))

    expect(await entschluesseleGruppenUmschlag(7, 'CT|v2|msm:groupconfig:7|alt')).toBe('alt')
  })

  it('scheitert, wenn keine gehaltene Version zur Kennung passt', async () => {
    api.getE2eeChatKeys.mockResolvedValue(versionen(1, 2))

    await expect(
      entschluesseleGruppenUmschlag(7, `sv-e2ee-group-v1:ffffffffffffffff.CT|v1|msm:groupconfig:7|x`),
    ).rejects.toThrow('falscher Schluessel')
  })
})

describe('Dreht ein Gerät den Gruppenschlüssel?', () => {
  it('dreht nicht, wenn sich die Mitgliederliste nicht geändert hat', () => {
    expect(brauchtNeueGruppenVersion('["1","2"]', '["1","2"]', true)).toBe(false)
  })

  it('dreht nicht, wenn ein frisches Gerät die aktuelle Version schon hat', () => {
    // Neuer Browser, kein Merker, aber der Konto-Schlüssel öffnet Version 2.
    expect(brauchtNeueGruppenVersion(null, '["1","2"]', true)).toBe(false)
  })

  it('dreht, wenn ein frisches Gerät die aktuelle Version nicht öffnen kann', () => {
    expect(brauchtNeueGruppenVersion(null, '["1","2"]', false)).toBe(true)
  })

  it('dreht nach einer Mitgliederänderung auf einem Gerät mit Merker', () => {
    expect(brauchtNeueGruppenVersion('["1"]', '["1","2"]', true)).toBe(true)
  })
})
