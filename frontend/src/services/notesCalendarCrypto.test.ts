/**
 * Notizen und Kalender: Schluessel, Umschlag, Bindung.
 *
 * Der Schluessel reist seit dem Einheits-Transport im Konto-Schluesselbund;
 * eine eigene Geraete-Mailbox gibt es nicht mehr. Diese Probe haelt die
 * Kryptographie und die lokale Schluesselablage fest.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { setzeAngemeldetesKonto } from '@/lib/angemeldetesKonto'

const konto = vi.hoisted(() => ({ ensureAccountKeys: vi.fn(async () => ({})) }))
vi.mock('./accountKeys', () => konto)

import {
  clearNotesKeyCache,
  decryptCalendarField,
  decryptNoteContent,
  decryptNoteTitle,
  encryptCalendarField,
  encryptNoteContent,
  encryptNoteTitle,
  exportUserNotesKey,
  getOrCreateUserNotesKey,
  hasUserNotesKey,
  setUserNotesKey,
  syncNotesKeyToPairedDevices,
} from './notesCalendarCrypto'

const KONTO = 7

beforeEach(() => {
  setzeAngemeldetesKonto(KONTO)
  localStorage.clear()
  clearNotesKeyCache()
  vi.clearAllMocks()
})

describe('Notizenschluessel', () => {
  it('erzeugt und behaelt einen Schluessel je Konto', async () => {
    expect(hasUserNotesKey(KONTO)).toBe(false)
    const key = await getOrCreateUserNotesKey(KONTO)
    expect(key).toBeTruthy()
    expect(hasUserNotesKey(KONTO)).toBe(true)
    expect(exportUserNotesKey(KONTO)).toBeTruthy()

    clearNotesKeyCache()
    const wieder = await getOrCreateUserNotesKey(KONTO)
    expect(exportUserNotesKey(KONTO)).toBeTruthy()
    expect(wieder).toBeTruthy()
  })

  it('nimmt einen gelieferten Konto-Schluessel an', async () => {
    const roh = btoa(String.fromCharCode(...new Uint8Array(32).fill(5)))
    await setUserNotesKey(KONTO, roh)
    expect(exportUserNotesKey(KONTO)).toBe(roh)
    expect(hasUserNotesKey(KONTO)).toBe(true)
  })

  it('verschluesselt Titel und Inhalt mit eigenem Praefix und bindet die Notizkennung', async () => {
    const titel = await encryptNoteTitle('Streng vertraulich', 'note-1', undefined, KONTO)
    const inhalt = await encryptNoteContent('Nur fuer mich', 'note-1', undefined, KONTO)

    expect(titel.startsWith('sv-note-v1:')).toBe(true)
    expect(inhalt.startsWith('sv-note-v1:')).toBe(true)
    expect(await decryptNoteTitle(titel, 'note-1', undefined, KONTO)).toBe('Streng vertraulich')
    expect(await decryptNoteContent(inhalt, 'note-1', undefined, KONTO)).toBe('Nur fuer mich')
  })

  it('oeffnet eine Notiz nicht unter einer anderen Kennung', async () => {
    const titel = await encryptNoteTitle('Geheim', 'note-a', undefined, KONTO)
    await expect(decryptNoteTitle(titel, 'note-b', undefined, KONTO)).rejects.toThrow()
  })

  it('laesst Klartext-Altbestand unveraendert', async () => {
    expect(await decryptNoteTitle('alter Titel', 'note-1', undefined, KONTO)).toBe('alter Titel')
    expect(await decryptCalendarField('Berlin', 'event-1', 'location', undefined, KONTO)).toBe('Berlin')
  })

  it('verschluesselt Kalenderfelder mit eigener Bindung', async () => {
    const titel = await encryptCalendarField('Termin', 'event-1', 'title', undefined, KONTO)
    const ort = await encryptCalendarField('Berlin', 'event-1', 'location', undefined, KONTO)
    expect(titel.startsWith('sv-cal-v1:')).toBe(true)
    expect(await decryptCalendarField(titel, 'event-1', 'title', undefined, KONTO)).toBe('Termin')
    expect(await decryptCalendarField(ort, 'event-1', 'location', undefined, KONTO)).toBe('Berlin')
    await expect(decryptCalendarField(ort, 'event-1', 'title', undefined, KONTO)).rejects.toThrow()
  })

  it('sichert den Notizenschluessel im Konto-Bund statt in einer Geraete-Mailbox', async () => {
    await getOrCreateUserNotesKey(KONTO)
    expect(await syncNotesKeyToPairedDevices(KONTO)).toBe(1)
    expect(konto.ensureAccountKeys).toHaveBeenCalled()
  })

  it('meldet ohne eigenen Schluessel nichts zum Verteilen', async () => {
    expect(await syncNotesKeyToPairedDevices(KONTO)).toBe(0)
    expect(konto.ensureAccountKeys).not.toHaveBeenCalled()
  })
})
