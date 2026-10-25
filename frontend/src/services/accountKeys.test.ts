import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Der Konto-Schluesselbund darf nie unter einem anderen Konto landen.
 *
 * Zwischen Abruf und Ablegen liegt ein Netzweg. Meldet sich in dieser Zeit ein
 * anderes Konto an, ist der gelieferte Bund fuer das vorige Konto. Er wird
 * verworfen, statt unter dem neuen Konto zu landen.
 */

const api = vi.hoisted(() => ({
  getE2eeAccount: vi.fn(async () => ({
    user_id: 1,
    public_key: '{"kty":"RSA"}',
    signing_public_key: '{"kty":"EC"}',
  })),
  getOwnE2eeAccountBundle: vi.fn(),
  publishE2eeAccount: vi.fn(async () => ({})),
  lookupE2eeAccounts: vi.fn(async () => ({ accounts: [] })),
  transferE2eeAccountBundle: vi.fn(async () => ({})),
}))

const geraet = vi.hoisted(() => ({
  eigenesGeraet: vi.fn(),
  geraetVeroeffentlichen: vi.fn(async () => ({})),
}))

const ablage = vi.hoisted(() => ({
  speichereKontoPaar: vi.fn(async () => ({ kennung: 'dev-1' })),
  kontoPaar: vi.fn(),
}))

const crypto = vi.hoisted(() => ({
  decryptE2eeHybrid: vi.fn(async () =>
    JSON.stringify({
      publicKeyJwk: '{"kty":"RSA"}',
      privateKeyJwk: '{"kty":"RSA","d":"x"}',
      signingPublicKeyJwk: '{"kty":"EC"}',
      signingPrivateKeyJwk: '{"kty":"EC","d":"y"}',
    }),
  ),
  encryptE2eeHybrid: vi.fn(async () => 'gepackt'),
  generateLocalE2eeKeyPair: vi.fn(),
}))

vi.mock('@/api/social', () => api)
vi.mock('./e2eeGeraet', () => geraet)
vi.mock('./geraet/geraeteAblage', () => ablage)
vi.mock('./e2eeCrypto', () => crypto)
vi.mock('./geraet/geraeteFreigabe', () => ({ geraetVeroeffentlichen: geraet.geraetVeroeffentlichen }))

import { setzeAngemeldetesKonto } from '@/lib/angemeldetesKonto'
import {
  ensureAccountKeys,
  KontoSchluesselNichtUebertragenError,
} from './accountKeys'

let aufloesen: (wert: unknown) => void = () => {}

beforeEach(() => {
  vi.clearAllMocks()
  setzeAngemeldetesKonto(1)
  geraet.eigenesGeraet.mockResolvedValue({
    kennung: 'dev-1',
    paar: { publicKeyJwk: '{"kty":"RSA"}', privateKeyJwk: '{"kty":"RSA","d":"x"}' },
    signaturPaar: { publicKeyJwk: '{"kty":"EC"}', privateKeyJwk: '{"kty":"EC","d":"y"}' },
  })
  api.getOwnE2eeAccountBundle.mockImplementation(
    () => new Promise((fertig) => { aufloesen = fertig }),
  )
})

describe('Konto-Schluesselbund', () => {
  it('verwirft einen Bund, der nach einem Kontowechsel eintrifft', async () => {
    const lauf = ensureAccountKeys()
    await vi.waitFor(() => expect(api.getOwnE2eeAccountBundle).toHaveBeenCalled())

    setzeAngemeldetesKonto(2)
    aufloesen({ encrypted_bundle: 'gepackt' })

    await expect(lauf).rejects.toBeInstanceOf(KontoSchluesselNichtUebertragenError)
    expect(ablage.speichereKontoPaar).not.toHaveBeenCalled()
  })
})
