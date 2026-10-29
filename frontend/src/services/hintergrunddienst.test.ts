/**
 * Der Dauerdienst auf Android: Ausweis anlegen, Dienst starten, widerrufen.
 *
 * Was hier schiefgehen kann, ist still: ein falscher Basispfad und der Dienst
 * verbindet sich nie; ein nicht widerrufener Ausweis bleibt nach dem
 * Ausschalten gültig; ein vergessener Mailbox-Stand macht den Dienst stumm.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const aufrufe = vi.hoisted(() => ({
  invoke: [] as { befehl: string; args?: Record<string, unknown> }[],
  api: [] as { pfad: string; methode: string; koerper: unknown }[],
  startScheitert: false,
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (befehl: string, args?: Record<string, unknown>) => {
    aufrufe.invoke.push({ befehl, args })
    if (befehl === 'dienst_starten' && aufrufe.startScheitert) throw new Error('Dienst startet nicht')
    if (befehl === 'dienst_stand') return { aktiv: true, akkuBefreit: false, benachrichtigungenErlaubt: true }
    return undefined
  },
}))

vi.mock('@/api/client', () => ({
  api: async (pfad: string, optionen?: { method?: string; body?: string }) => {
    aufrufe.api.push({
      pfad,
      methode: optionen?.method ?? 'GET',
      koerper: optionen?.body ? JSON.parse(optionen.body) : null,
    })
    if (pfad === '/notifications/channels') return { id: 7, token: 'a'.repeat(64) }
    return undefined
  },
}))

vi.mock('@/config/api', () => ({ getEffectiveApiUrl: () => 'https://panel.test' }))

import { setzeAngemeldetesKonto } from '@/lib/angemeldetesKonto'
import { ausschalten, dienstVerfuegbar, einschalten, stand } from './hintergrunddienst'

const ruhe = () => new Promise((r) => setTimeout(r, 0))

describe('hintergrunddienst', () => {
  beforeEach(() => {
    aufrufe.invoke.length = 0
    aufrufe.api.length = 0
    aufrufe.startScheitert = false
    localStorage.clear()
    setzeAngemeldetesKonto(1)
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)',
      configurable: true,
    })
    ;(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
  })

  it('legt den Ausweis mit der Sitzung an und startet den Dienst', async () => {
    const ok = await einschalten('Telefon')
    await ruhe()

    expect(ok).toBe(true)
    const anlegen = aufrufe.api.find((a) => a.methode === 'POST')
    expect(anlegen?.pfad).toBe('/notifications/channels')
    expect(anlegen?.koerper).toEqual({ label: 'Telefon' })

    const start = aufrufe.invoke.find((a) => a.befehl === 'dienst_starten')
    expect(start?.args).toMatchObject({
      ausweis: 'a'.repeat(64),
      basis: 'https://panel.test',
    })
    expect(localStorage.getItem('msm:hintergrundkanal')).toBe('7')
  })

  it('widerruft den Kanal, wenn der Dienst nicht startet', async () => {
    aufrufe.startScheitert = true
    const ok = await einschalten('Telefon')

    expect(ok).toBe(false)
    expect(localStorage.getItem('msm:hintergrundkanal')).toBeNull()
    expect(
      aufrufe.api.some((a) => a.pfad === '/notifications/channels/7' && a.methode === 'DELETE'),
    ).toBe(true)
  })

  it('schaltet den Dienst ab und widerruft den Ausweis', async () => {
    await einschalten('Telefon')
    aufrufe.invoke.length = 0
    aufrufe.api.length = 0

    await ausschalten()

    expect(aufrufe.invoke.map((a) => a.befehl)).toEqual(['dienst_stoppen'])
    expect(aufrufe.api).toEqual([
      { pfad: '/notifications/channels/7', methode: 'DELETE', koerper: null },
    ])
    expect(localStorage.getItem('msm:hintergrundkanal')).toBeNull()
  })

  it('liest den Stand aus Android, nicht aus dem Fenster', async () => {
    await expect(stand()).resolves.toEqual({
      aktiv: true,
      akkuBefreit: false,
      benachrichtigungenErlaubt: true,
    })
  })

  it('tut auf einem Rechner nichts', async () => {
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Windows NT 10.0)', configurable: true })

    expect(dienstVerfuegbar()).toBe(false)
    await expect(einschalten()).resolves.toBe(false)
    await ausschalten()

    expect(aufrufe.invoke).toEqual([])
  })
})
