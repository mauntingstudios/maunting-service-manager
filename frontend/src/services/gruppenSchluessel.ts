/**
 * Gruppen-Kryptografie im neuen Transport.
 *
 * Es gibt keinen separaten Gruppenschluessel mehr: der `chat_key` der Gruppe
 * schuetzt Nachrichten und den verschluesselten Gruppenblock. Die Einladungs-
 * karte traegt ihren eigenen Zufallsschluessel im Link.
 */

import { decryptString, encryptString } from '@msdis/shield/aead'
import { sha256Hex } from '@msdis/shield/integrity'
import { getE2eeChatKeys } from '@/api/social'
import { holeChatSchluessel, holeChatSchluesselRoh, vergissChatSchluessel } from './chatKrypto'

export interface GruppenKontext {
  groupId: number
  mitglieder: readonly number[]
  eigeneId: number
  istEigentuemer?: boolean
  blindMailboxId?: string
}

/**
 * Wofür ein Umschlag gedacht ist. Die AAD trennt die drei Blöcke: ein
 * Rollenblock lässt sich nicht als Gruppeninfo ausgeben und eine Info nicht
 * als Hintergrund, selbst wenn derselbe Gruppenschlüssel beide öffnet.
 */
export type GruppenZweck = 'config' | 'info' | 'background'

function umschlagAad(groupId: number, zweck: GruppenZweck): string {
  return `msm:group${zweck}:${groupId}`
}

const GRUPPEN_PRAEFIX = 'sv-e2ee-group-v1:'

async function aktuellerSchluessel(groupId: number): Promise<CryptoKey> {
  const { latest_key_version } = await getE2eeChatKeys('group', groupId)
  if (!latest_key_version) throw new Error('Für diese Gruppe fehlt der Chat-Schlüssel.')
  return await holeChatSchluessel('group', groupId, latest_key_version)
}

/**
 * Die Kennung des Gruppenschlüssels: die ersten 16 Hexzeichen seines Hashes.
 * Sie muss im Umschlag stehen, weil der Server sie prüft; sie verrät ihm
 * nichts, weil sie allein am Schlüssel hängt, den er nie sieht.
 */
async function schluesselKennung(groupId: number): Promise<string> {
  const { latest_key_version } = await getE2eeChatKeys('group', groupId)
  if (!latest_key_version) throw new Error('Für diese Gruppe fehlt der Chat-Schlüssel.')
  const roh = await holeChatSchluesselRoh('group', groupId, latest_key_version)
  if (!roh) throw new Error('Für diese Gruppe fehlt der Chat-Schlüssel.')
  return (await sha256Hex(roh)).slice(0, 16)
}

export async function verschluesseleFuerGruppe(
  kontext: GruppenKontext,
  payload: string,
  zweck: GruppenZweck = 'config',
): Promise<string> {
  const key = await aktuellerSchluessel(kontext.groupId)
  const ciphertext = await encryptString(payload, key, umschlagAad(kontext.groupId, zweck))
  return `${GRUPPEN_PRAEFIX}${await schluesselKennung(kontext.groupId)}.${ciphertext}`
}

export async function entschluesseleGruppenUmschlag(
  groupId: number,
  umschlag: string,
  zweck: GruppenZweck = 'config',
): Promise<string> {
  const key = await aktuellerSchluessel(groupId)
  const ciphertext = umschlag.startsWith(GRUPPEN_PRAEFIX)
    ? umschlag.slice(GRUPPEN_PRAEFIX.length).split('.').slice(1).join('.')
    : umschlag
  return await decryptString(ciphertext, key, umschlagAad(groupId, zweck))
}

/** Vergisst die Chat-Schlüssel einer verlassenen oder gelöschten Gruppe. */
export async function verwirfGruppenSchluessel(groupId: number): Promise<void> {
  vergissChatSchluessel('group', groupId)
}
