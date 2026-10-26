// @vitest-environment node
/**
 * Die verschlüsselte Einladungskarte.
 *
 * Die Krypto ist hier **echt** — AES-256-GCM aus DIS —, weil genau sie der
 * Gegenstand ist. Der Schlüssel ist ein eigener Zufallswert und reist nur im
 * Fragment des Links.
 */

import { describe, expect, it } from 'vitest'

import {
  EINLADUNG_PREFIX,
  baueEinladungsKarte,
  erzeugeEinladungsschluessel,
  istEinladungsschluessel,
  lieseEinladungsKarte,
  mitSchluessel,
  schluesselAusLink,
} from './einladungsKarte'

const CODE = 'AbCd1234efGH'
const INHALT = { name: 'Serverteam', beschreibung: 'Wir bauen Dinge', logo: null }

describe('Der Einladungsschlüssel', () => {
  it('ist ein zufälliger Wert aus 64 Hexzeichen', () => {
    const schluessel = erzeugeEinladungsschluessel()
    expect(schluessel).toMatch(/^[0-9a-f]{64}$/)
    expect(istEinladungsschluessel(schluessel)).toBe(true)
    expect(erzeugeEinladungsschluessel()).not.toBe(schluessel)
  })

  it('weist kaputte Werte ab', () => {
    expect(istEinladungsschluessel('')).toBe(false)
    expect(istEinladungsschluessel('A'.repeat(64))).toBe(false)
    expect(istEinladungsschluessel('a'.repeat(63))).toBe(false)
  })
})

describe('Karte bauen und lesen', () => {
  it('geht auf und zurück', async () => {
    const schluessel = erzeugeEinladungsschluessel()
    const karte = await baueEinladungsKarte(schluessel, CODE, INHALT)
    expect(karte.startsWith(EINLADUNG_PREFIX)).toBe(true)

    const gelesen = await lieseEinladungsKarte(karte, schluessel, CODE)
    expect(gelesen).toEqual({ name: 'Serverteam', beschreibung: 'Wir bauen Dinge', logo: null })
  })

  it('trägt den Klartext nicht im Umschlag', async () => {
    const karte = await baueEinladungsKarte(
      erzeugeEinladungsschluessel(),
      CODE,
      INHALT,
    )
    expect(karte).not.toContain('Serverteam')
    expect(karte).not.toContain('Wir bauen Dinge')
  })

  it('bleibt mit dem falschen Schlüssel zu', async () => {
    const karte = await baueEinladungsKarte(
      erzeugeEinladungsschluessel(),
      CODE,
      INHALT,
    )
    expect(
      await lieseEinladungsKarte(karte, erzeugeEinladungsschluessel(), CODE),
    ).toBeNull()
  })

  it('bleibt unter einem fremden Einladungscode zu', async () => {
    const schluessel = erzeugeEinladungsschluessel()
    const karte = await baueEinladungsKarte(schluessel, CODE, INHALT)
    expect(await lieseEinladungsKarte(karte, schluessel, 'ZzZz9999yYyY')).toBeNull()
  })

  it('wird nach einem Codewechsel unlesbar', async () => {
    const schluessel = erzeugeEinladungsschluessel()
    const alt = await baueEinladungsKarte(schluessel, CODE, INHALT)
    const neuerCode = 'NeuerCode123'

    expect(await lieseEinladungsKarte(alt, schluessel, neuerCode)).toBeNull()
    const neu = await baueEinladungsKarte(schluessel, neuerCode, INHALT)
    expect((await lieseEinladungsKarte(neu, schluessel, neuerCode))?.name).toBe('Serverteam')
  })

  it('antwortet auf jeden Fehlgrund gleich', async () => {
    const schluessel = erzeugeEinladungsschluessel()
    expect(await lieseEinladungsKarte(null, schluessel, CODE)).toBeNull()
    expect(await lieseEinladungsKarte('irgendwas', schluessel, CODE)).toBeNull()
    expect(await lieseEinladungsKarte(`${EINLADUNG_PREFIX}kaputt`, schluessel, CODE)).toBeNull()
    expect(await lieseEinladungsKarte(`${EINLADUNG_PREFIX}abc`, 'kein-schluessel', CODE)).toBeNull()
  })

  it('verwirft ein Logo, das kein Bild ist', async () => {
    const schluessel = erzeugeEinladungsschluessel()
    const boese = await baueEinladungsKarte(schluessel, CODE, {
      name: 'Gruppe',
      logo: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    })
    const gelesen = await lieseEinladungsKarte(boese, schluessel, CODE)

    expect(gelesen?.name).toBe('Gruppe')
    expect(gelesen?.logo).toBeNull()
  })

  it('nimmt ein echtes Bild als Logo an', async () => {
    const echt = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=='
    const schluessel = erzeugeEinladungsschluessel()
    const karte = await baueEinladungsKarte(schluessel, CODE, { name: 'Gruppe', logo: echt })
    const gelesen = await lieseEinladungsKarte(karte, schluessel, CODE)

    expect(gelesen?.logo).toBe(echt)
  })

  it('verträgt eine Gruppe ohne Namen und ohne Logo', async () => {
    const schluessel = erzeugeEinladungsschluessel()
    const karte = await baueEinladungsKarte(schluessel, CODE, {})
    expect(await lieseEinladungsKarte(karte, schluessel, CODE)).toEqual({
      name: null,
      beschreibung: null,
      logo: null,
    })
  })
})

describe('Der Schlüssel im Link', () => {
  it('hängt hinter der Raute', () => {
    const schluessel = erzeugeEinladungsschluessel()
    const link = mitSchluessel(`https://panel.test/chat/join/${CODE}`, schluessel)

    expect(link).toBe(`https://panel.test/chat/join/${CODE}#k=${schluessel}`)
    expect(new URL(link).pathname).toBe(`/chat/join/${CODE}`)
    expect(new URL(link).search).toBe('')
  })

  it('wird aus einem Link wieder herausgelesen', () => {
    const schluessel = erzeugeEinladungsschluessel()
    const link = mitSchluessel(`https://panel.test/chat/join/${CODE}`, schluessel)

    expect(schluesselAusLink(link)).toBe(schluessel)
    expect(schluesselAusLink(`https://panel.test/chat/join/${CODE}`)).toBeNull()
    expect(schluesselAusLink('#k=zukurz')).toBeNull()
  })
})
