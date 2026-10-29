import { beforeEach, describe, expect, it, vi } from 'vitest'

const konto = vi.hoisted(() => ({ wert: 1 as number | null }))
const geraete = vi.hoisted(() => ({ liste: [] as any[], fehler: null as unknown }))
const api = vi.hoisted(() => ({ getOwnE2eeAccountBundle: vi.fn(), senden: vi.fn() }))

vi.mock('@/lib/angemeldetesKonto', () => ({ angemeldetesKonto: () => konto.wert }))
vi.mock('@/api/social', () => ({ getOwnE2eeAccountBundle: api.getOwnE2eeAccountBundle }))
vi.mock('./accountKeys', () => ({ sendeKontoSchluesselAnGeraet: api.senden }))
vi.mock('./geraet/geraeteVerzeichnis', () => ({
  geraeteVon: vi.fn(async () => {
    if (geraete.fehler) throw geraete.fehler
    return geraete.liste
  }),
}))

import { stosseKontoBundNachholenAn } from './kontoBundNachholen'

beforeEach(() => {
  vi.clearAllMocks()
  konto.wert = 1
  geraete.fehler = null
  geraete.liste = []
  api.senden.mockResolvedValue(undefined)
})

describe('kontoBundNachholen', () => {
  it('holt den Bund nur für ein freigegebenes Gerät, dem er fehlt', async () => {
    geraete.liste = [
      { device_id: 'd1', public_key: 'pk1', is_approved: true },
      { device_id: 'd2', public_key: 'pk2', is_approved: true },
      { device_id: 'd3', public_key: 'pk3', is_approved: false },
    ]
    api.getOwnE2eeAccountBundle.mockImplementation(async (id: string) => {
      if (id === 'd1') throw { status: 404 }
      return { bundle: true }
    })

    await stosseKontoBundNachholenAn()

    expect(api.senden).toHaveBeenCalledTimes(1)
    expect(api.senden).toHaveBeenCalledWith({ device_id: 'd1', public_key: 'pk1' })
  })

  it('überschreibt einen vorhandenen Bund nicht', async () => {
    geraete.liste = [{ device_id: 'd1', public_key: 'pk1', is_approved: true }]
    api.getOwnE2eeAccountBundle.mockResolvedValue({ bundle: true })

    await stosseKontoBundNachholenAn()

    expect(api.senden).not.toHaveBeenCalled()
  })

  it('bricht nach einem Kontowechsel ab, statt den alten Bund zu senden', async () => {
    geraete.liste = [
      { device_id: 'd1', public_key: 'pk1', is_approved: true },
      { device_id: 'd2', public_key: 'pk2', is_approved: true },
    ]
    api.getOwnE2eeAccountBundle.mockImplementation(async () => {
      konto.wert = 2
      throw { status: 404 }
    })

    await stosseKontoBundNachholenAn()

    expect(api.senden).not.toHaveBeenCalled()
  })

  it('bleibt ohne angemeldetes Konto still', async () => {
    konto.wert = null
    await stosseKontoBundNachholenAn()
    expect(api.getOwnE2eeAccountBundle).not.toHaveBeenCalled()
  })
})
