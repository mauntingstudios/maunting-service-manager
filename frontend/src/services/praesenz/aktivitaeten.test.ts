import { describe, expect, it } from 'vitest'

import { aktivitaetFuerPfad, aktivitaetText, aktivitaetTextKey } from './aktivitaeten'

const t = (schluessel: string) => schluessel

describe('Aktivitaeten', () => {
  it('ordnet die Seiten ihren Schluesseln zu', () => {
    expect(aktivitaetFuerPfad('/ai').key).toBe('ki')
    expect(aktivitaetFuerPfad('/chat?groupId=12').key).toBe('chat')
    expect(aktivitaetFuerPfad('/servers/7').key).toBe('server')
    expect(aktivitaetFuerPfad('/kalender').key).toBe('kalender')
    expect(aktivitaetFuerPfad('/notizen').key).toBe('notizen')
    expect(aktivitaetFuerPfad('/tresor').key).toBe('tresor')
    expect(aktivitaetFuerPfad('/einstellungen/sicherheit').key).toBe('einstellungen')
  })

  it('faellt fuer Unbekanntes auf das Panel zurueck', () => {
    expect(aktivitaetFuerPfad('/irgendwas').key).toBe('panel')
    expect(aktivitaetFuerPfad('/').key).toBe('panel')
  })

  it('liefert nur fuer bekannte Schluessel einen Text', () => {
    expect(aktivitaetText('chat', t)).toBe('presence.aktivitaet.chat')
    expect(aktivitaetText('panel', t)).toBe('presence.aktivitaet.panel')
    expect(aktivitaetText('erfunden', t)).toBeNull()
    expect(aktivitaetText(null, t)).toBeNull()
    expect(aktivitaetTextKey(undefined)).toBeNull()
  })
})
