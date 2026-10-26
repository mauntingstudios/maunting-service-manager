import { beforeEach, describe, expect, it, vi } from 'vitest'

const lager = vi.hoisted(() => ({
  auftraege: [] as any[],
  lade: vi.fn(async () => lager.auftraege),
  schreibe: vi.fn(async (auftrag: any) => {
    lager.auftraege = lager.auftraege.map((a) => (a.id === auftrag.id ? auftrag : a))
  }),
  entferne: vi.fn(async (id: string) => {
    lager.auftraege = lager.auftraege.filter((a) => a.id !== id)
  }),
  medienLoeschen: vi.fn(async () => {}),
}))
const konto = vi.hoisted(() => ({ wert: 1 as number | null }))
const api = vi.hoisted(() => ({
  deleteChatMessage: vi.fn(),
  loescheChatMedium: vi.fn(),
}))

vi.mock('@/lib/angemeldetesKonto', () => ({ angemeldetesKonto: () => konto.wert }))
vi.mock('@/api/social', () => ({
  deleteChatMessage: api.deleteChatMessage,
  loescheChatMedium: api.loescheChatMedium,
}))
vi.mock('./messengerLocalStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./messengerLocalStore')>()),
  ladeLoeschAuftraege: lager.lade,
  schreibeLoeschauftrag: lager.schreibe,
  loescheLoeschauftrag: lager.entferne,
  loescheMedium: lager.medienLoeschen,
}))

import { setzeLoeschMelder, stosseLoeschungenAn, type LoeschGrund } from './loeschAuftraege'

function auftrag(overrides: Record<string, unknown> = {}) {
  return {
    id: 'box:uuid-1',
    mailbox: 'box',
    chatType: 'direct' as const,
    chatId: 7,
    clientUuid: 'uuid-1',
    nachrichtId: 11,
    medien: [{ mediaId: 'm1', mailbox: 'box', absenderId: 2 }],
    fremd: false,
    versuche: 0,
    naechsterVersuch: 0,
    angelegtAm: 1,
    ...overrides,
  }
}

let gemeldet: { grund: LoeschGrund; medien: number }[] = []

beforeEach(() => {
  vi.clearAllMocks()
  lager.auftraege = []
  lager.schreibe.mockImplementation(async (a: any) => {
    lager.auftraege = lager.auftraege.map((x) => (x.id === a.id ? a : x))
  })
  lager.entferne.mockImplementation(async (id: string) => {
    lager.auftraege = lager.auftraege.filter((x) => x.id !== id)
  })
  konto.wert = 1
  api.deleteChatMessage.mockResolvedValue(undefined)
  api.loescheChatMedium.mockResolvedValue(undefined)
  gemeldet = []
  setzeLoeschMelder((_a, grund, medien) => gemeldet.push({ grund, medien }))
})

describe('loeschAuftraege', () => {
  it('löscht Serverkopie und Blob und meldet erledigt', async () => {
    lager.auftraege = [auftrag()]
    await stosseLoeschungenAn()

    expect(api.deleteChatMessage).toHaveBeenCalledWith('uuid-1')
    expect(lager.medienLoeschen).toHaveBeenCalledWith('m1')
    expect(api.loescheChatMedium).toHaveBeenCalledWith('m1')
    expect(lager.auftraege).toHaveLength(0)
    expect(gemeldet).toEqual([{ grund: 'erledigt', medien: 0 }])
  })

  it('meldet einen fremden Blob als geblieben und wiederholt ihn nicht', async () => {
    lager.auftraege = [auftrag()]
    api.loescheChatMedium.mockRejectedValue({ status: 403 })
    await stosseLoeschungenAn()

    expect(lager.auftraege).toHaveLength(0)
    expect(gemeldet).toEqual([{ grund: 'medienGeblieben', medien: 1 }])
  })

  it('lässt Netzfehler offen und schreibt Versuch und Rückzug fort', async () => {
    lager.auftraege = [auftrag()]
    api.deleteChatMessage.mockRejectedValue({ status: 503 })
    vi.spyOn(Date, 'now').mockReturnValue(1_000)

    await stosseLoeschungenAn()

    expect(lager.auftraege).toHaveLength(1)
    expect(lager.auftraege[0].versuche).toBe(1)
    expect(lager.auftraege[0].naechsterVersuch).toBe(31_000)
    expect(gemeldet).toEqual([])
  })

  it('gibt nach einem endgültigen Fehler auf und meldet ihn', async () => {
    lager.auftraege = [auftrag()]
    api.deleteChatMessage.mockRejectedValue({ status: 403 })
    await stosseLoeschungenAn()

    expect(lager.auftraege).toHaveLength(0)
    expect(gemeldet).toEqual([{ grund: 'aufgegeben', medien: 0 }])
  })

  it('gibt nach sechs Versuchen auf', async () => {
    lager.auftraege = [auftrag({ versuche: 5 })]
    api.deleteChatMessage.mockRejectedValue({ status: 503 })
    await stosseLoeschungenAn()

    expect(lager.auftraege).toHaveLength(0)
    expect(gemeldet).toEqual([{ grund: 'aufgegeben', medien: 0 }])
  })

  it('bricht nach einem Kontowechsel ab, statt mit fremder Sitzung zu löschen', async () => {
    lager.auftraege = [auftrag({ id: 'box:a', clientUuid: 'a' }), auftrag({ id: 'box:b', clientUuid: 'b' })]
    api.deleteChatMessage.mockImplementation(async () => {
      konto.wert = 2
    })
    await stosseLoeschungenAn()

    expect(api.deleteChatMessage).toHaveBeenCalledTimes(1)
    expect(lager.auftraege.map((a) => a.id)).toEqual(['box:b'])
  })
})
