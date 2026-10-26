/**
 * Die Konto-Identitaet des Messengers.
 *
 * Jeder Mensch hat genau ein RSA-OAEP- und ein ECDSA-Paar. Der private Teil
 * liegt versiegelt in der Geraetezeile und wird beim Freigeben eines weiteren
 * Geraets gegen dessen Geraeteschluessel verpackt. Damit oeffnet jedes
 * autorisierte Geraet jeden Chat-Schluessel, auch fuer Nachrichten von vor
 * Jahren; es gibt keinen Sitzungsfaden mehr, der beim Geraetewechsel reisst.
 */

import { decryptE2eeHybrid, encryptE2eeHybrid, generateLocalE2eeKeyPair } from './e2eeCrypto'
import { erzeugeSignaturPaar, pruefe, signiere } from './absenderSignatur'
import { eigenesGeraet, type EigenesGeraet } from './e2eeGeraet'
import { speichereKontoPaar } from './geraet/geraeteAblage'
import { geraetVeroeffentlichen } from './geraet/geraeteFreigabe'
import {
  getE2eeAccount,
  getOwnE2eeAccountBundle,
  lookupE2eeAccounts,
  publishE2eeAccount,
  transferE2eeAccountBundle,
  type E2eeAccountItem,
} from '@/api/social'
import { angemeldetesKonto } from '@/lib/angemeldetesKonto'

export class KontoSchluesselFehltError extends Error {
  constructor() {
    super('Für dieses Konto ist noch kein E2EE-Identitätsschlüssel hinterlegt.')
    this.name = 'KontoSchluesselFehltError'
  }
}

export class KontoSchluesselNichtUebertragenError extends Error {
  constructor() {
    super('Dieses Gerät hat den Konto-Schlüssel noch nicht erhalten. Ein freigegebenes Gerät muss ihn übertragen.')
    this.name = 'KontoSchluesselNichtUebertragenError'
  }
}

interface KontoBundle {
  publicKeyJwk: string
  privateKeyJwk: string
  signingPublicKeyJwk: string
  signingPrivateKeyJwk: string
  /** Der Notizenschluessel, damit ein neues Geraet sofort alle Notizen liest. */
  notesKey?: string
}

const accountCache = new Map<number, { item: E2eeAccountItem; at: number }>()
const ACCOUNT_CACHE_MS = 5 * 60_000
const laufendeSicherstellungen = new Map<number, Promise<EigenesGeraet>>()

function statusVon(fehler: unknown): number | null {
  const status = (fehler as { status?: unknown } | null)?.status
  return typeof status === 'number' ? status : null
}

export function leereKontoCache(): void {
  accountCache.clear()
}

async function bundleAus(geraet: EigenesGeraet): Promise<KontoBundle> {
  if (!geraet.kontoPaar || !geraet.kontoSignaturPaar) {
    throw new KontoSchluesselNichtUebertragenError()
  }
  // Vor dem await festhalten: waehrend des Imports kann ein Kontowechsel
  // stattfinden, und der Notizenschluessel darf nicht am falschen Konto landen.
  const konto = angemeldetesKonto()
  let notesKey: string | undefined
  try {
    if (konto) {
      const { exportUserNotesKey } = await import('./notesCalendarCrypto')
      notesKey = exportUserNotesKey(Number(konto)) ?? undefined
    }
  } catch {
    // Ohne Notizenschluessel reist der Bund ohne ihn; das Geraet fragt spaeter.
  }
  return {
    publicKeyJwk: geraet.kontoPaar.publicKeyJwk,
    privateKeyJwk: geraet.kontoPaar.privateKeyJwk,
    signingPublicKeyJwk: geraet.kontoSignaturPaar.publicKeyJwk,
    signingPrivateKeyJwk: geraet.kontoSignaturPaar.privateKeyJwk,
    ...(notesKey ? { notesKey } : {}),
  }
}

async function holeBundleVomServer(geraet: EigenesGeraet): Promise<EigenesGeraet> {
  // Das Konto vor dem Netzabruf festhalten. Nach jedem await kann ein anderes
  // Konto angemeldet sein; dann gehoert dieser Bund nicht mehr hierher.
  const konto = Number(angemeldetesKonto())
  if (!Number.isFinite(konto) || konto <= 0) throw new KontoSchluesselFehltError()
  let antwort
  try {
    antwort = await getOwnE2eeAccountBundle(geraet.kennung)
  } catch (fehler) {
    if (statusVon(fehler) === 404) throw new KontoSchluesselNichtUebertragenError()
    throw fehler
  }
  const klartext = await decryptE2eeHybrid(antwort.encrypted_bundle, geraet.paar.privateKeyJwk)
  const bundle = JSON.parse(klartext) as KontoBundle
  if (
    typeof bundle.publicKeyJwk !== 'string' ||
    typeof bundle.privateKeyJwk !== 'string' ||
    typeof bundle.signingPublicKeyJwk !== 'string' ||
    typeof bundle.signingPrivateKeyJwk !== 'string'
  ) {
    throw new KontoSchluesselNichtUebertragenError()
  }
  if (Number(angemeldetesKonto()) !== konto) {
    throw new KontoSchluesselNichtUebertragenError()
  }
  const geraetMitSchluessel = await speichereKontoPaar(
    konto,
    { publicKeyJwk: bundle.publicKeyJwk, privateKeyJwk: bundle.privateKeyJwk },
    { publicKeyJwk: bundle.signingPublicKeyJwk, privateKeyJwk: bundle.signingPrivateKeyJwk },
  )
  if (typeof bundle.notesKey === 'string' && bundle.notesKey) {
    try {
      const { setUserNotesKey } = await import('./notesCalendarCrypto')
      if (Number(angemeldetesKonto()) !== konto) throw new KontoSchluesselNichtUebertragenError()
      await setUserNotesKey(konto, bundle.notesKey)
    } catch {
      // Der Konto-Schluessel ist wichtiger als der Notizenschluessel.
    }
  }
  return geraetMitSchluessel
}

function verlangeSelbesKonto(kontoId: number): void {
  if (angemeldetesKonto() !== kontoId) throw new KontoSchluesselFehltError()
}

async function tuSicherstellen(kontoId: number): Promise<EigenesGeraet> {
  await geraetVeroeffentlichen().catch(() => null)
  verlangeSelbesKonto(kontoId)
  let geraet = await eigenesGeraet()
  verlangeSelbesKonto(kontoId)

  // Hat dieses Gerät den Konto-Schlüssel schon? Dann nur den Bund für dieses
  // Gerät aktuell halten (nach einer Neuinstallation kann er fehlen).
  if (geraet.kontoPaar && geraet.kontoSignaturPaar) {
    try {
      const bundle = await bundleAus(geraet)
      const verschluesselt = await encryptE2eeHybrid(
        JSON.stringify(bundle),
        geraet.paar.publicKeyJwk,
      )
      verlangeSelbesKonto(kontoId)
      await publishE2eeAccount({
        device_id: geraet.kennung,
        public_key: bundle.publicKeyJwk,
        signing_public_key: bundle.signingPublicKeyJwk,
        encrypted_bundle: verschluesselt,
      })
    } catch (fehler) {
      const status = statusVon(fehler)
      if (status === 403) throw new KontoSchluesselNichtUebertragenError()
      // 409 heißt: der Server hat eine andere Konto-Identitaet. Dann gilt
      // seine, und dieses Gerät muss den Bund von einem Geschwister holen.
      if (status !== 409) throw fehler
      verlangeSelbesKonto(kontoId)
      geraet = await holeBundleVomServer(geraet)
    }
    accountCache.clear()
    verlangeSelbesKonto(kontoId)
    return geraet
  }

  // Kein lokaler Konto-Schlüssel: existiert auf dem Server schon einer?
  let vorhanden: E2eeAccountItem | null = null
  try {
    vorhanden = await getE2eeAccount(kontoId)
  } catch (fehler) {
    if (statusVon(fehler) !== 404) throw fehler
  }
  verlangeSelbesKonto(kontoId)
  if (vorhanden) {
    geraet = await holeBundleVomServer(geraet)
    accountCache.set(kontoId, { item: vorhanden, at: Date.now() })
    verlangeSelbesKonto(kontoId)
    return geraet
  }

  // Erstes Gerät: Konto-Identitaet erzeugen und veröffentlichen.
  const kontoPaar = await generateLocalE2eeKeyPair()
  const kontoSignatur = await erzeugeSignaturPaar()
  verlangeSelbesKonto(kontoId)
  geraet = await speichereKontoPaar(kontoId, kontoPaar, kontoSignatur)
  const bundle = await bundleAus(geraet)
  const verschluesselt = await encryptE2eeHybrid(JSON.stringify(bundle), geraet.paar.publicKeyJwk)
  verlangeSelbesKonto(kontoId)
  await publishE2eeAccount({
    device_id: geraet.kennung,
    public_key: bundle.publicKeyJwk,
    signing_public_key: bundle.signingPublicKeyJwk,
    encrypted_bundle: verschluesselt,
  })
  accountCache.set(kontoId, {
    item: {
      user_id: kontoId,
      public_key: bundle.publicKeyJwk,
      signing_public_key: bundle.signingPublicKeyJwk,
    },
    at: Date.now(),
  })
  verlangeSelbesKonto(kontoId)
  return geraet
}

/** Stellt sicher, dass dieses Gerät den Konto-Schlüssel hat. */
export function ensureAccountKeys(): Promise<EigenesGeraet> {
  const kontoId = angemeldetesKonto()
  if (!kontoId) return Promise.reject(new KontoSchluesselFehltError())
  const laufend = laufendeSicherstellungen.get(kontoId)
  if (laufend) return laufend
  let versprechen: Promise<EigenesGeraet>
  versprechen = tuSicherstellen(kontoId)
    .then((geraet) => {
      // Zwischen letzter Prüfung und Rückgabe kann die Sitzung gewechselt
      // haben; fremde Schlüssel gehören nicht in den neuen Aufrufer.
      if (angemeldetesKonto() !== kontoId) throw new KontoSchluesselFehltError()
      return geraet
    })
    .finally(() => {
      // Nur den eigenen Eintrag entfernen. Ein Lauf für ein anderes Konto darf
      // den Latch dieses Kontos nicht löschen.
      if (laufendeSicherstellungen.get(kontoId) === versprechen) {
        laufendeSicherstellungen.delete(kontoId)
      }
    })
  laufendeSicherstellungen.set(kontoId, versprechen)
  return versprechen
}

/** Öffentliche Konto-Identität eines beliebigen Kontos. */
export async function kontoOeffentlich(userId: number): Promise<E2eeAccountItem> {
  const jetzt = Date.now()
  const cached = accountCache.get(userId)
  if (cached && jetzt - cached.at < ACCOUNT_CACHE_MS) return cached.item
  const item = await getE2eeAccount(userId)
  accountCache.set(userId, { item, at: jetzt })
  return item
}

export async function kontoOeffentlichViele(userIds: number[]): Promise<Map<number, E2eeAccountItem>> {
  const fehlend = [...new Set(userIds.map(Number).filter((id) => id > 0))]
  const jetzt = Date.now()
  const out = new Map<number, E2eeAccountItem>()
  for (const id of fehlend) {
    const cached = accountCache.get(id)
    if (cached && jetzt - cached.at < ACCOUNT_CACHE_MS) {
      out.set(id, cached.item)
      fehlend.splice(fehlend.indexOf(id), 1)
    }
  }
  if (fehlend.length > 0) {
    const { accounts } = await lookupE2eeAccounts(fehlend)
    for (const account of accounts) {
      accountCache.set(account.user_id, { item: account, at: jetzt })
      out.set(account.user_id, account)
    }
  }
  return out
}

/** Unterschreibt mit dem Konto-ECDSA-Schlüssel. */
export async function signiereKonto(daten: string): Promise<string> {
  const geraet = await ensureAccountKeys()
  if (!geraet.kontoSignaturPaar) throw new KontoSchluesselNichtUebertragenError()
  return await signiere(daten, geraet.kontoSignaturPaar.privateKeyJwk)
}

/** Prüft eine Konto-Signatur gegen den veröffentlichten Schlüssel. */
export async function pruefeKonto(
  daten: string,
  signatur: string,
  userId: number,
): Promise<boolean> {
  try {
    const account = await kontoOeffentlich(userId)
    return await pruefe(daten, signatur, account.signing_public_key)
  } catch {
    return false
  }
}

/**
 * Verpackt den Konto-Schlüssel für ein frisch freigegebenes Gerät.
 *
 * Wird nach der Freigabe aufgerufen. Der Server sieht nur Chiffrat; das neue
 * Gerät kann ihn mit seinem eigenen privaten Geräteschlüssel öffnen.
 */
export async function sendeKontoSchluesselAnGeraet(geraet: {
  device_id: string
  public_key: string
}): Promise<void> {
  const meins = await ensureAccountKeys()
  const bundle = await bundleAus(meins)
  const verschluesselt = await encryptE2eeHybrid(JSON.stringify(bundle), geraet.public_key)
  try {
    await transferE2eeAccountBundle(geraet.device_id, verschluesselt, meins.kennung)
  } catch (fehler) {
    // 409 heißt: das Ziel hat den Bund schon. Das ist ein Erfolg, kein Fehler.
    if (statusVon(fehler) === 409) return
    throw fehler
  }
}
