/**
 * Der Wallet-Einstieg von Pontis: Suchleiste und Startseiten-Widget fragen
 * hier an, statt das Wallet selbst zu öffnen.
 *
 * Vor dem Öffnen stehen zwei Tore: Das Gerät muss autorisiert sein
 * (`isDeviceAuthorized` im Tresor-Speicher), und der Mensch davor bestätigt
 * sich am **Gerät** — Biometrie oder Geräte-PIN, nicht App-PIN. Die Abfrage
 * läuft über die Tauri-Brücke (`desktop/tauri.ts`); auf Android erlaubt sie
 * ausdrücklich auch die Bildschirmsperre (`allow_device_credential` in
 * `crates/schluesselfach/src/biometrie.rs`). Fehlt die Brücke (Web-Kontext),
 * fragt `plugin-biometric` direkt. Danach öffnet sich das bestehende
 * `SmartcardWalletModal` über dasselbe Ereignis wie in MSS — keine neue Krypto.
 */
import i18n from '@/i18n'
import { pruefeBiometrieVerfuegbar, verifiziereBiometrie } from '@/desktop/tauri'
import { useVaultStore } from '@/desktop/vault/vaultStore'
import { still } from '@/lib/still'
import { toast } from '@/stores/toastStore'

/** Dasselbe Ereignis, das die MSS-Hülle öffnet (`components/layout/Shell.tsx`). */
export const WALLET_EREIGNIS = 'msm:open-wallet'

/** Wonach jemand sucht, der das Wallet meint — deutsch wie englisch. */
const WALLET_BEGRIFFE = ['wallet', 'smartcard', 'smart card', 'maunting card', 'karte', 'card']

/** Meint dieser Suchtext das Wallet? Dann bekommt das Dropdown einen Eintrag. */
export function passtZuWallet(text: string): boolean {
  const frage = text.trim().toLowerCase()
  if (!frage) return false
  return WALLET_BEGRIFFE.some((begriff) => frage.includes(begriff))
}

export type WalletOeffnenErgebnis = 'offen' | 'nichtAutorisiert' | 'abgebrochen' | 'nichtVerfuegbar'

/**
 * Die Bestätigung am Gerät: `true` heißt bestätigt, `false` abgelehnt oder
 * abgebrochen, `null` heißt, dieses Gerät kann gar nicht fragen.
 */
async function geraetBestaetigen(nachricht: string): Promise<boolean | null> {
  try {
    if (await pruefeBiometrieVerfuegbar()) {
      return await verifiziereBiometrie(nachricht)
    }
  } catch (err) {
    still(err, 'walletEinstieg.biometrieBruecke')
  }
  try {
    const { authenticate, checkStatus } = await import('@tauri-apps/plugin-biometric')
    const stand = await checkStatus()
    if (!stand?.isAvailable) return null
    await authenticate(nachricht, { allowDeviceCredential: true })
    return true
  } catch (err) {
    // Ein Abbruch ist kein Fehler, nur ein Nein — still zurück, ohne Toast.
    const meldung = err instanceof Error ? err.message : String(err)
    if (/cancel|abbruch|abort|negativebutton/i.test(meldung)) return false
    still(err, 'walletEinstieg.pluginBiometric')
    return null
  }
}

/**
 * Fragt das Öffnen des Wallets an: erst Autorisierung, dann Geräte-Auth.
 * Nur bei beiden öffnet sich das Modal, sonst bleibt es zu und es gibt einen
 * Hinweis — außer bei Abbruch, der bleibt still.
 */
export async function walletOeffnenAnfragen(): Promise<WalletOeffnenErgebnis> {
  if (!useVaultStore.getState().isDeviceAuthorized) {
    toast.warning(i18n.t('browser.wallet.nichtAutorisiert'))
    return 'nichtAutorisiert'
  }
  const bestaetigt = await geraetBestaetigen(i18n.t('browser.wallet.bestaetigenTitel'))
  if (bestaetigt === null) {
    toast.warning(i18n.t('browser.wallet.keineGeraeteAuth'))
    return 'nichtVerfuegbar'
  }
  if (!bestaetigt) return 'abgebrochen'
  window.dispatchEvent(new Event(WALLET_EREIGNIS))
  return 'offen'
}
