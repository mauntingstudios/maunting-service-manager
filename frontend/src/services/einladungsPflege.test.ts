// @vitest-environment node
/**
 * Die Einladungskarte fortschreiben.
 *
 * Bis 27.10.2026 bekam jede Kopie einen eigenen Zufallsschlüssel, der nur im
 * Link lebte. Wer später den Gruppennamen änderte, hatte den Schlüssel der
 * bereits versendeten Karte nicht — die Vorschau blieb stehen, und nach einer
 * zweiten Kopie war der alte Link sogar tot. Geprüft wird hier beides: ein
 * Schlüssel je Gruppe, und das Neuversiegeln nach einer Änderung.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const ablage = vi.hoisted(() => ({
  key: null as string | null,
  lesungArt: 'info' as 'info' | 'leer' | 'kein-schluessel',
  name: 'Serverteam',
  beschreibung: 'Wir bauen Dinge',
  logo: null as string | null,
  schreibfehler: null as Error | null,
}))

const karteSetzen = vi.hoisted(() => vi.fn(async () => ({ ok: true })))

vi.mock('@/services/e2eeCrypto', () => ({
  deriveGroupBlindMailboxId: async () => 'm'.repeat(32),
}))

vi.mock('@/api/social', () => ({ setzeEinladungsKarte: karteSetzen }))

vi.mock('./gruppenInfo', () => ({
  ladeGruppenInfo: async () =>
    ablage.lesungArt === 'info'
      ? {
          art: 'info',
          info: {
            v: 1,
            name: ablage.name,
            beschreibung: ablage.beschreibung,
            logo: ablage.logo,
            inviteKey: ablage.key,
          },
          revision: 3,
          vonKonto: 101,
          quelle: 'info',
        }
      : { art: ablage.lesungArt },
  aendereGruppenInfo: async (
    _kontext: unknown,
    _darf: unknown,
    aendere: (vorher: Record<string, unknown>) => Record<string, unknown>,
  ) => {
    if (ablage.schreibfehler) throw ablage.schreibfehler
    const neu = aendere({
      v: 1,
      name: ablage.name,
      beschreibung: ablage.beschreibung,
      logo: ablage.logo,
      inviteKey: ablage.key,
    })
    ablage.key = (neu.inviteKey as string | null) ?? ablage.key
    ablage.name = (neu.name as string | null) as unknown as string
    ablage.beschreibung = (neu.beschreibung as string | null) as unknown as string
    ablage.logo = (neu.logo as string | null) ?? null
    return { art: 'gespeichert', revision: 4 }
  },
}))

import { istEinladungsschluessel, lieseEinladungsKarte } from './einladungsKarte'
import { holeEinladungsschluessel, versiegleEinladungNeu } from './einladungsPflege'
import type { GruppenKontext } from './gruppenSchluessel'

const CODE = 'AbCd1234efGH'
const ICH = 101

function kontext(): GruppenKontext {
  return { groupId: 7, eigeneId: ICH, mitglieder: [ICH], blindMailboxId: 'm'.repeat(32) }
}

function gruppe(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    invite_code: CODE,
    members: [{ user_id: ICH }],
    role: 'owner',
    ...overrides,
  } as never
}

beforeEach(() => {
  ablage.key = null
  ablage.lesungArt = 'info'
  ablage.name = 'Serverteam'
  ablage.beschreibung = 'Wir bauen Dinge'
  ablage.logo = null
  ablage.schreibfehler = null
  karteSetzen.mockClear()
})

describe('Der Schlüssel einer Einladung', () => {
  it('nimmt den vorhandenen Schlüssel der Gruppe', async () => {
    const vorhanden = 'c'.repeat(64)
    ablage.key = vorhanden
    await expect(holeEinladungsschluessel(kontext())).resolves.toBe(vorhanden)
  })

  it('erzeugt beim ersten Teilen einen und legt ihn in den Info-Block', async () => {
    // Ohne diese Ablage hätte die zweite Kopie wieder einen neuen Schlüssel —
    // und die erste Karte wäre nach dem Überschreiben unlesbar.
    const erster = await holeEinladungsschluessel(kontext())
    expect(istEinladungsschluessel(erster)).toBe(true)
    expect(ablage.key).toBe(erster)

    const zweiter = await holeEinladungsschluessel(kontext())
    expect(zweiter).toBe(erster)
  })

  it('legt beim ersten Teilen keinen leeren Info-Block an', async () => {
    // Ein Block voller `null` heißt für jeden Leser „bewusst geleert“ — die
    // Gruppe verlöre ihren Namen, nur weil jemand einen Link kopiert hat.
    ablage.name = null as unknown as string
    ablage.beschreibung = null as unknown as string

    await holeEinladungsschluessel(kontext(), { name: 'Serverteam', beschreibung: 'Aus der Liste' })

    expect(ablage.name).toBe('Serverteam')
    expect(ablage.beschreibung).toBe('Aus der Liste')
    expect(istEinladungsschluessel(ablage.key)).toBe(true)
  })

  it('teilt trotzdem, wenn der Block nicht schreibbar ist', async () => {
    ablage.schreibfehler = new Error('kein Recht')
    const schluessel = await holeEinladungsschluessel(kontext())
    expect(istEinladungsschluessel(schluessel)).toBe(true)
    expect(ablage.key).toBeNull()
  })
})

describe('Karte nach einer Änderung', () => {
  it('versiegelt mit demselben Schlüssel neu, damit alte Links weiterlesen', async () => {
    ablage.key = 'd'.repeat(64)
    ablage.name = 'Neuer Name'
    ablage.beschreibung = 'Kurzfassung für die Vorschau'

    await expect(versiegleEinladungNeu(gruppe(), ICH)).resolves.toBe(true)

    expect(karteSetzen).toHaveBeenCalledTimes(1)
    const [, karte] = karteSetzen.mock.calls[0] as unknown as [number, string]
    await expect(lieseEinladungsKarte(karte, ablage.key, CODE)).resolves.toEqual({
      name: 'Neuer Name',
      beschreibung: 'Kurzfassung für die Vorschau',
      logo: null,
    })
  })

  it('erfindet keine Karte, wo nie eine geteilt wurde', async () => {
    await expect(versiegleEinladungNeu(gruppe(), ICH)).resolves.toBe(false)
    expect(karteSetzen).not.toHaveBeenCalled()
  })

  it('schreibt nichts ohne Einladungscode', async () => {
    ablage.key = 'e'.repeat(64)
    await expect(versiegleEinladungNeu(gruppe({ invite_code: null }), ICH)).resolves.toBe(false)
    expect(karteSetzen).not.toHaveBeenCalled()
  })
})
