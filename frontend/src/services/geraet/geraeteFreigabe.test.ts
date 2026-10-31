import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resetEigeneGeraete: vi.fn(async () => ({ ok: true, removed: 1 })),
  putEigenesGeraet: vi.fn(async () => ({
    device_id: 'geraet-1',
    public_key: 'pub',
    signing_public_key: 'sig',
    is_approved: true,
    approval_signature: 'freigabe',
  })),
  loescheKontoPaar: vi.fn(async () => undefined),
  loescheVerzeichnis: vi.fn(),
  leereKontoCache: vi.fn(),
  neueKontoIdentitaet: vi.fn(async () => ({})),
  leereChatSchluesselCache: vi.fn(),
  clearLocalMessengerStore: vi.fn(async () => undefined),
  leereKlartextSpeicher: vi.fn(),
  leereGespraeche: vi.fn(),
  leereGruppenNamen: vi.fn(),
}))

vi.mock('@/api/social', () => ({
  resetEigeneGeraete: mocks.resetEigeneGeraete,
  putEigenesGeraet: mocks.putEigenesGeraet,
}))

vi.mock('./geraeteAblage', () => ({
  meinKonto: () => 1,
  eigenesGeraet: async () => ({
    kennung: 'geraet-1',
    paar: { publicKeyJwk: 'pub', privateKeyJwk: 'priv' },
    signaturPaar: { publicKeyJwk: 'sig', privateKeyJwk: 'spriv' },
  }),
  loescheKontoPaar: mocks.loescheKontoPaar,
}))

vi.mock('../accountKeys', () => ({
  leereKontoCache: mocks.leereKontoCache,
  neueKontoIdentitaet: mocks.neueKontoIdentitaet,
}))
vi.mock('../chatKrypto', () => ({ leereChatSchluesselCache: mocks.leereChatSchluesselCache }))
vi.mock('./geraeteVerzeichnis', () => ({ vergessenGeraete: mocks.loescheVerzeichnis }))
vi.mock('./geraeteVertrauen', () => ({
  setzeEigeneFreigabe: vi.fn(),
  freigabeDaten: vi.fn(async () => 'daten'),
  entfernenDaten: vi.fn(async () => 'daten'),
}))
vi.mock('../absenderSignatur', () => ({ signiere: vi.fn(async () => 'signatur') }))
vi.mock('../geraeteBezeichnung', () => ({
  STANDARD_BEZEICHNUNG: 'Web-Frontend',
  geraeteBezeichnung: () => 'Web-Frontend',
}))
vi.mock('../messengerLocalStore', () => ({
  clearLocalMessengerStore: mocks.clearLocalMessengerStore,
}))
vi.mock('../klartextSpeicher', () => ({ leereKlartextSpeicher: mocks.leereKlartextSpeicher }))
vi.mock('../gespraechsListe', () => ({ leereGespraeche: mocks.leereGespraeche }))
vi.mock('../gruppenName', () => ({ leereGruppenNamen: mocks.leereGruppenNamen }))

import { geraeteZuruecksetzen } from './geraeteFreigabe'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('geraeteZuruecksetzen', () => {
  it('setzt den Server zurueck, erzeugt eine neue Identitaet und raeumt lokal auf', async () => {
    await geraeteZuruecksetzen('geheim')

    expect(mocks.resetEigeneGeraete).toHaveBeenCalledWith('geheim')
    expect(mocks.loescheKontoPaar).toHaveBeenCalledWith(1)
    expect(mocks.neueKontoIdentitaet).toHaveBeenCalled()
    expect(mocks.clearLocalMessengerStore).toHaveBeenCalled()
    expect(mocks.leereKlartextSpeicher).toHaveBeenCalled()
    expect(mocks.leereGespraeche).toHaveBeenCalled()
    expect(mocks.leereGruppenNamen).toHaveBeenCalled()
  })
})
