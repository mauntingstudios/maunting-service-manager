import { afterEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'

const { oeffneBrowser } = vi.hoisted(() => ({ oeffneBrowser: vi.fn() }))

vi.mock('@/desktop/tauri', () => ({
  oeffneBrowser,
  pruefeBiometrieVerfuegbar: vi.fn(async () => false),
  verifiziereBiometrie: vi.fn(async () => false),
}))

vi.mock('@/api/client', () => ({
  api: vi.fn(async () => ({ vorgang: 'v1', zahl: 42, url: 'https://panel.example/bestaetigen#v1' })),
  isNetworkOrOfflineError: () => false,
}))

const { passkeyNachweis } = await import('./passkeyService')

/**
 * Der Passkey-Weg der App öffnet den Browser. Scheitert das, muss der Grund
 * sichtbar werden — bis 11/2026 zeigte die Karte nur „Fehler“, weil ein
 * Tauri-Befehl mit einem bloßen String ablehnt und der kein `.message` hat.
 */
describe('passkeyNachweis — Browser öffnen', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
    oeffneBrowser.mockReset()
  })

  it('nennt den Grund, wenn der Browser nicht aufgeht', async () => {
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
    oeffneBrowser.mockRejectedValueOnce('Command oeffne_browser not found')

    await expect(passkeyNachweis('device_pairing')).rejects.toThrow(
      i18n.t('auth.browserBestaetigung.openFailed', {
        grund: 'Command oeffne_browser not found',
      }),
    )
  })
})
