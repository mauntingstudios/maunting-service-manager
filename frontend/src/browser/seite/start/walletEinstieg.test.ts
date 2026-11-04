import { beforeEach, describe, expect, it, vi } from 'vitest'

const tauri = vi.hoisted(() => ({
  pruefeBiometrieVerfuegbar: vi.fn(),
  verifiziereBiometrie: vi.fn(),
}))
vi.mock('@/desktop/tauri', () => tauri)

const biometric = vi.hoisted(() => ({
  checkStatus: vi.fn(),
  authenticate: vi.fn(),
}))
vi.mock('@tauri-apps/plugin-biometric', () => biometric)

const { passtZuWallet, walletOeffnenAnfragen, WALLET_EREIGNIS } = await import('./walletEinstieg')
const { useVaultStore } = await import('@/desktop/vault/vaultStore')
const { useToastStore } = await import('@/stores/toastStore')

describe('passtZuWallet', () => {
  it.each([
    ['wallet', true],
    ['Wallet öffnen', true],
    ['smartcard', true],
    ['Smart Card', true],
    ['maunting card', true],
    ['karte', true],
    ['Kreditkarte', true],
    ['card', true],
  ])('„%s“ meint das Wallet: %s', (text, erwartet) => {
    expect(passtZuWallet(text as string)).toBe(erwartet)
  })

  it.each([['wetter'], ['maunting pontis'], [''], ['   ']])('„%s“ meint es nicht', (text) => {
    expect(passtZuWallet(text as string)).toBe(false)
  })
})

describe('walletOeffnenAnfragen', () => {
  const ereignisse: string[] = []
  const horchen = (e: Event) => ereignisse.push(e.type)

  beforeEach(() => {
    ereignisse.length = 0
    window.addEventListener(WALLET_EREIGNIS, horchen)
    useVaultStore.setState({ isDeviceAuthorized: false })
    useToastStore.setState({ toasts: [] })
    Object.values(tauri).forEach((f) => f.mockReset())
    Object.values(biometric).forEach((f) => f.mockReset())
    tauri.pruefeBiometrieVerfuegbar.mockResolvedValue(true)
    tauri.verifiziereBiometrie.mockResolvedValue(true)
    biometric.checkStatus.mockResolvedValue({ isAvailable: true })
    biometric.authenticate.mockResolvedValue(undefined)
    return () => window.removeEventListener(WALLET_EREIGNIS, horchen)
  })

  it('bleibt ohne autorisiertes Gerät zu und gibt einen Hinweis', async () => {
    expect(await walletOeffnenAnfragen()).toBe('nichtAutorisiert')
    expect(ereignisse).toHaveLength(0)
    expect(tauri.pruefeBiometrieVerfuegbar).not.toHaveBeenCalled()
    const [meldung] = useToastStore.getState().toasts
    expect(meldung?.type).toBe('warning')
    expect(meldung?.message).toContain('nicht autorisiert')
  })

  it('öffnet nach Geräte-Auth über die Tauri-Brücke', async () => {
    useVaultStore.setState({ isDeviceAuthorized: true })
    expect(await walletOeffnenAnfragen()).toBe('offen')
    expect(tauri.verifiziereBiometrie).toHaveBeenCalledTimes(1)
    expect(biometric.checkStatus).not.toHaveBeenCalled()
    expect(ereignisse).toEqual([WALLET_EREIGNIS])
  })

  it('bleibt bei abgelehnter Geräte-Auth still zu', async () => {
    useVaultStore.setState({ isDeviceAuthorized: true })
    tauri.verifiziereBiometrie.mockResolvedValue(false)
    expect(await walletOeffnenAnfragen()).toBe('abgebrochen')
    expect(ereignisse).toHaveLength(0)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('fällt ohne Brücke auf plugin-biometric mit Geräte-PIN zurück', async () => {
    useVaultStore.setState({ isDeviceAuthorized: true })
    tauri.pruefeBiometrieVerfuegbar.mockResolvedValue(false)
    expect(await walletOeffnenAnfragen()).toBe('offen')
    expect(biometric.authenticate).toHaveBeenCalledWith(expect.any(String), { allowDeviceCredential: true })
    expect(ereignisse).toEqual([WALLET_EREIGNIS])
  })

  it('meldet, wenn das Gerät gar nicht fragen kann', async () => {
    useVaultStore.setState({ isDeviceAuthorized: true })
    tauri.pruefeBiometrieVerfuegbar.mockRejectedValue(new Error('kein Tauri'))
    biometric.checkStatus.mockResolvedValue({ isAvailable: false })
    expect(await walletOeffnenAnfragen()).toBe('nichtVerfuegbar')
    expect(ereignisse).toHaveLength(0)
    const [meldung] = useToastStore.getState().toasts
    expect(meldung?.type).toBe('warning')
    expect(meldung?.message).toContain('Gerätesperre')
  })

  it('nimmt einen Plugin-Abbruch als Nein, nicht als Fehler', async () => {
    useVaultStore.setState({ isDeviceAuthorized: true })
    tauri.pruefeBiometrieVerfuegbar.mockResolvedValue(false)
    biometric.authenticate.mockRejectedValue(new Error('User canceled'))
    expect(await walletOeffnenAnfragen()).toBe('abgebrochen')
    expect(ereignisse).toHaveLength(0)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })
})
