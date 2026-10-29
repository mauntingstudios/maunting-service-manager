// @vitest-environment node
/**
 * Gruppeninfo und geteilter Hintergrund: zwei Blöcke, zwei AADs, eine Revision.
 *
 * Die Kryptografie ist auch hier nachgebildet; echt ist die Unterschrift. Die
 * Ablage hält sich an dieselbe Regel wie der Server: genau eine Revision
 * weiter, sonst 409. Der Altbestand (Name im Rollenblock) wird nachgestellt,
 * weil er der Grund für den Fallback ist.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { erzeugeSignaturPaar, type SignaturPaar } from './absenderSignatur'

interface TestGeraet {
  kennung: string
  konto: number
  paar: SignaturPaar
}

let ich: TestGeraet
const verzeichnis = new Map<string, string>()
let kannUnterschreiben = true
let schluesselFehlt = false

vi.mock('./e2eeGeraet', () => ({
  eigenesGeraet: async () => {
    if (!kannUnterschreiben) throw new Error('verschlossen')
    return {
      kennung: ich.kennung,
      paar: { publicKeyJwk: '{}', privateKeyJwk: '{}' },
      signaturPaar: ich.paar,
    }
  },
  signaturSchluesselVon: async (konto: number, geraet: string) =>
    verzeichnis.get(`${konto}:${geraet}`) ?? null,
}))

vi.mock('./gruppenSchluessel', () => ({
  verschluesseleFuerGruppe: async (
    _kontext: unknown,
    klartext: string,
    zweck = 'config',
  ) => `sv-e2ee-group-v1:testkey.${zweck}.${btoa(unescape(encodeURIComponent(klartext)))}`,
  entschluesseleGruppenUmschlag: async (
    _groupId: number,
    umschlag: string,
    zweck = 'config',
  ) => {
    if (schluesselFehlt) throw new Error('kein Schluessel')
    const teile = umschlag.split('.')
    if (teile[1] !== zweck) throw new Error('falsche AAD')
    const rumpf = teile.slice(2).join('.')
    if (!rumpf) throw new Error('leer')
    return decodeURIComponent(escape(atob(rumpf)))
  },
}))

const ablage = vi.hoisted(() => ({
  info: null as { blob: string; revision: number } | null,
  hintergrund: null as { blob: string; revision: number; mime: string | null } | null,
  alt: null as Record<string, unknown> | null,
  altRevision: 0,
}))

vi.mock('@/api/social', () => ({
  getGroupInfo: async () =>
    ablage.info
      ? { group_id: 1, blob: ablage.info.blob, revision: ablage.info.revision, updated_at: '' }
      : null,
  putGroupInfo: async (_groupId: number, blob: string, erwartet: number) => {
    const aktuell = ablage.info?.revision ?? 0
    if (erwartet !== aktuell) {
      const fehler = new Error('Konflikt') as Error & { status: number }
      fehler.status = 409
      throw fehler
    }
    ablage.info = { blob, revision: aktuell + 1 }
    return {
      group_id: 1,
      blob,
      revision: ablage.info.revision,
      updated_at: '',
    }
  },
  getGroupBackground: async () =>
    ablage.hintergrund
      ? {
          group_id: 1,
          blob: ablage.hintergrund.blob,
          revision: ablage.hintergrund.revision,
          mime: ablage.hintergrund.mime,
          size_bytes: ablage.hintergrund.blob.length,
          updated_at: '',
        }
      : null,
  putGroupBackground: async (
    _groupId: number,
    blob: string,
    erwartet: number,
    mime: string | null,
  ) => {
    const aktuell = ablage.hintergrund?.revision ?? 0
    if (erwartet !== aktuell) {
      const fehler = new Error('Konflikt') as Error & { status: number }
      fehler.status = 409
      throw fehler
    }
    ablage.hintergrund = { blob, revision: aktuell + 1, mime }
    return {
      group_id: 1,
      blob,
      revision: ablage.hintergrund.revision,
      mime,
      size_bytes: blob.length,
      updated_at: '',
    }
  },
}))

vi.mock('./gruppenKonfig', () => ({
  ladeGruppenzustand: async () =>
    ablage.alt
      ? {
          art: 'zustand',
          zustand: ablage.alt,
          revision: ablage.altRevision,
          vonKonto: 101,
        }
      : { art: 'leer' },
}))

import {
  aendereGruppenInfo,
  HINTERGRUND_FORMAT,
  INFO_FORMAT,
  ladeGruppenHintergrund,
  ladeGruppenInfo,
  schreibeGruppenHintergrund,
  schreibeGruppenInfo,
  type GruppenInfo,
} from './gruppenInfo'
import type { GruppenKontext } from './gruppenSchluessel'

const ANNA = 101
const MAILBOX = 'm'.repeat(32)

const KONTEXT: GruppenKontext = {
  groupId: 1,
  blindMailboxId: MAILBOX,
  eigeneId: ANNA,
  mitglieder: [ANNA],
}

const DARF = (konto: number) => konto === ANNA

function info(overrides: Partial<GruppenInfo> = {}): GruppenInfo {
  return {
    v: INFO_FORMAT,
    name: 'Küchenplanung',
    beschreibung: 'Wer bringt was',
    logo: null,
    inviteKey: null,
    ...overrides,
  }
}

function legeInfoAb(nutzlast: Record<string, unknown>, revision = 1): void {
  const klartext = JSON.stringify(nutzlast)
  ablage.info = {
    blob: `sv-e2ee-group-v1:testkey.info.${btoa(unescape(encodeURIComponent(klartext)))}`,
    revision,
  }
}

function legeHintergrundAb(nutzlast: Record<string, unknown>, revision = 1): void {
  const klartext = JSON.stringify(nutzlast)
  ablage.hintergrund = {
    blob: `sv-e2ee-group-v1:testkey.background.${btoa(unescape(encodeURIComponent(klartext)))}`,
    revision,
    mime: 'image/webp',
  }
}

beforeEach(async () => {
  verzeichnis.clear()
  ablage.info = null
  ablage.hintergrund = null
  ablage.alt = null
  ablage.altRevision = 0
  kannUnterschreiben = true
  schluesselFehlt = false
  const paar = await erzeugeSignaturPaar()
  ich = { kennung: 'geraet-anna', konto: ANNA, paar }
  verzeichnis.set(`${ANNA}:geraet-anna`, paar.publicKeyJwk)
})

describe('Gruppeninfo', () => {
  it('behält den Einladungsschlüssel beim Speichern der Allgemeinangaben', async () => {
    // Ohne dieses Feld verlöre jedes Speichern von Name, Beschreibung oder Logo
    // den Schlüssel der bereits versendeten Einladung — und deren Vorschau
    // bliebe für immer auf dem alten Stand.
    const schluessel = 'a'.repeat(64)
    await schreibeGruppenInfo(KONTEXT, info({ inviteKey: schluessel }), 0)

    const geaendert = await aendereGruppenInfo(KONTEXT, DARF, (vorher) => ({
      ...vorher,
      name: 'Neuer Name',
    }))
    expect(geaendert).toMatchObject({ art: 'gespeichert' })

    await expect(ladeGruppenInfo(KONTEXT, DARF)).resolves.toMatchObject({
      art: 'info',
      info: { name: 'Neuer Name', inviteKey: schluessel },
    })
  })

  it('löscht den Schlüssel nicht, wenn ein Aufrufer ihn gar nicht kennt', async () => {
    const schluessel = 'b'.repeat(64)
    await schreibeGruppenInfo(KONTEXT, info({ inviteKey: schluessel }), 0)

    await aendereGruppenInfo(KONTEXT, DARF, (vorher) => ({
      ...vorher,
      logo: 'data:image/webp;base64,AAAA',
      inviteKey: null,
    }))

    await expect(ladeGruppenInfo(KONTEXT, DARF)).resolves.toMatchObject({
      art: 'info',
      info: { inviteKey: schluessel },
    })
  })

  it('schreibt einen Schlüssel, der keiner ist, gar nicht erst hinein', async () => {
    await schreibeGruppenInfo(KONTEXT, info({ inviteKey: 'A'.repeat(64) }), 0)
    await expect(ladeGruppenInfo(KONTEXT, DARF)).resolves.toMatchObject({
      art: 'info',
      info: { inviteKey: null },
    })
  })

  it('schreibt und liest Name, Beschreibung und Logo', async () => {
    const geschrieben = await schreibeGruppenInfo(KONTEXT, info(), 0)
    expect(geschrieben).toEqual({ art: 'gespeichert', revision: 1 })

    const gelesen = await ladeGruppenInfo(KONTEXT, DARF)
    expect(gelesen).toMatchObject({
      art: 'info',
      info: { name: 'Küchenplanung', beschreibung: 'Wer bringt was', logo: null },
      revision: 1,
      quelle: 'info',
    })
  })

  it('leert ein Feld, das ausdrücklich null ist', async () => {
    await schreibeGruppenInfo(KONTEXT, info({ beschreibung: null }), 0)
    const gelesen = await ladeGruppenInfo(KONTEXT, DARF)
    expect(gelesen.art).toBe('info')
    if (gelesen.art === 'info') expect(gelesen.info.beschreibung).toBeNull()
  })

  it('fällt ohne eigenen Block auf den alten Rollenblock zurück', async () => {
    ablage.alt = { v: 1, name: 'Altbestand', beschreibung: 'aus dem Rollenblock', logo: null, rollen: [], zuordnung: {} }
    ablage.altRevision = 4

    const gelesen = await ladeGruppenInfo(KONTEXT, DARF)
    expect(gelesen).toMatchObject({
      art: 'info',
      info: { name: 'Altbestand', beschreibung: 'aus dem Rollenblock' },
      revision: 0,
      quelle: 'config',
    })
  })

  it('nimmt den neuen Block auch dann, wenn er alle Felder auf null setzt', async () => {
    ablage.alt = { v: 1, name: 'Altbestand', beschreibung: null, logo: null, rollen: [], zuordnung: {} }
    await schreibeGruppenInfo(KONTEXT, info({ name: null, beschreibung: null }), 0)

    const gelesen = await ladeGruppenInfo(KONTEXT, DARF)
    expect(gelesen.art).toBe('info')
    if (gelesen.art === 'info') {
      expect(gelesen.info.name).toBeNull()
      expect(gelesen.quelle).toBe('info')
    }
  })

  it('schreibt beim Altbestand mit Revision 0, nicht mit der Revision des Rollenblocks', async () => {
    ablage.alt = { v: 1, name: 'Altbestand', beschreibung: null, logo: null, rollen: [], zuordnung: {} }
    ablage.altRevision = 9

    const ergebnis = await aendereGruppenInfo(KONTEXT, DARF, (vorher) => ({
      ...vorher,
      name: 'Neu',
    }))

    expect(ergebnis).toEqual({ art: 'gespeichert', revision: 1 })
    expect(ablage.info?.revision).toBe(1)
  })

  it('meldet einen Konflikt, statt zu überschreiben', async () => {
    await schreibeGruppenInfo(KONTEXT, info({ name: 'Erster' }), 0)
    const zweiter = await schreibeGruppenInfo(KONTEXT, info({ name: 'Zweiter' }), 0)
    expect(zweiter).toEqual({ art: 'konflikt' })

    const gelesen = await ladeGruppenInfo(KONTEXT, DARF)
    expect(gelesen.art).toBe('info')
    if (gelesen.art === 'info') expect(gelesen.info.name).toBe('Erster')
  })

  it('schreibt nicht ohne Unterschrift', async () => {
    kannUnterschreiben = false
    expect(await schreibeGruppenInfo(KONTEXT, info(), 0)).toEqual({
      art: 'nicht-unterschreibbar',
    })
  })

  it('weist eine fremde Unterschrift ab', async () => {
    legeInfoAb({ v: INFO_FORMAT, name: 'Untergeschoben', von_konto: 999, von_geraet: 'x', sig: 'fake' })
    expect((await ladeGruppenInfo(KONTEXT, DARF)).art).toBe('unbefugt')
  })

  it('überschreibt einen Block, den niemand prüfen kann', async () => {
    // Ein Block mit einer Signatur, die niemand nachprüfen kann, wäre sonst
    // für alle Zeit vorhanden: die Gruppe behielte ihren alten Namen und
    // liesse sich nicht mehr ändern.
    legeInfoAb({ v: INFO_FORMAT, name: 'Alt', von_konto: 999, von_geraet: 'fremd', sig: 'kaputt' })

    const ergebnis = await aendereGruppenInfo(KONTEXT, DARF, (vorher) => ({
      ...vorher,
      name: 'Neu',
    }))

    expect(ergebnis.art).toBe('gespeichert')
    const gelesen = await ladeGruppenInfo(KONTEXT, DARF)
    expect(gelesen.art).toBe('info')
    if (gelesen.art === 'info') expect(gelesen.info.name).toBe('Neu')
  })

  it('meldet einen fehlenden Schlüssel', async () => {
    await schreibeGruppenInfo(KONTEXT, info(), 0)
    schluesselFehlt = true
    expect((await ladeGruppenInfo(KONTEXT, DARF)).art).toBe('kein-schluessel')
  })
})

describe('Geteilter Gruppenhintergrund', () => {
  it('schreibt und liest Vorlage, Abdunkelung und Bild', async () => {
    const geschrieben = await schreibeGruppenHintergrund(
      KONTEXT,
      { v: HINTERGRUND_FORMAT, preset: 'sterne', dim: 40, bild: null },
      0,
      'image/webp',
    )
    expect(geschrieben).toEqual({ art: 'gespeichert', revision: 1 })

    const gelesen = await ladeGruppenHintergrund(KONTEXT, DARF)
    expect(gelesen).toMatchObject({
      art: 'hintergrund',
      hintergrund: { preset: 'sterne', dim: 40, bild: null },
      revision: 1,
    })
    expect(ablage.hintergrund?.mime).toBe('image/webp')
  })

  it('begrenzt die Abdunkelung auf 0 bis 100', async () => {
    await schreibeGruppenHintergrund(
      KONTEXT,
      { v: HINTERGRUND_FORMAT, preset: 'raster', dim: 420, bild: null },
      0,
      null,
    )
    const gelesen = await ladeGruppenHintergrund(KONTEXT, DARF)
    expect(gelesen.art).toBe('hintergrund')
    if (gelesen.art === 'hintergrund') expect(gelesen.hintergrund.dim).toBe(100)
  })

  it('trennt die AAD von der Gruppeninfo', async () => {
    await schreibeGruppenInfo(KONTEXT, info(), 0)
    // Denselben Umschlag als Hintergrund lesen: die AAD passt nicht.
    ablage.hintergrund = { blob: ablage.info!.blob, revision: 1, mime: null }
    expect((await ladeGruppenHintergrund(KONTEXT, DARF)).art).toBe('kein-schluessel')
  })

  it('meldet einen Konflikt, statt zu überschreiben', async () => {
    await schreibeGruppenHintergrund(
      KONTEXT,
      { v: HINTERGRUND_FORMAT, preset: 'erster', dim: 25, bild: null },
      0,
      null,
    )
    const zweiter = await schreibeGruppenHintergrund(
      KONTEXT,
      { v: HINTERGRUND_FORMAT, preset: 'zweiter', dim: 25, bild: null },
      0,
      null,
    )
    expect(zweiter).toEqual({ art: 'konflikt' })
  })

  it('liefert leer, solange die Gruppe keinen Hintergrund hat', async () => {
    expect(await ladeGruppenHintergrund(KONTEXT, DARF)).toEqual({ art: 'leer' })
  })
})
