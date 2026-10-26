/**
 * Gruppen-Kryptografie im neuen Transport.
 *
 * Es gibt keinen separaten Gruppenschluessel mehr: der `chat_key` der Gruppe
 * schuetzt Nachrichten und den verschluesselten Gruppenblock. Die Einladungs-
 * karte traegt ihren eigenen Zufallsschluessel im Link.
 */

import { decryptString, encryptString } from '@msdis/shield/aead'
import { getE2eeChatKeys } from '@/api/social'
import { holeChatSchluessel, vergissChatSchluessel } from './chatKrypto'

export interface GruppenKontext {
  groupId: number
  mitglieder: readonly number[]
  eigeneId: number
  istEigentuemer?: boolean
  blindMailboxId?: string
}

function configAad(groupId: number): string {
  return `msm:groupconfig:${groupId}`
}

async function aktuellerSchluessel(groupId: number): Promise<CryptoKey> {
  const { latest_key_version } = await getE2eeChatKeys('group', groupId)
  if (!latest_key_version) throw new Error('Für diese Gruppe fehlt der Chat-Schlüssel.')
  return await holeChatSchluessel('group', groupId, latest_key_version)
}

export async function verschluesseleFuerGruppe(
  kontext: GruppenKontext,
  payload: string,
): Promise<string> {
  const key = await aktuellerSchluessel(kontext.groupId)
  return await encryptString(payload, key, configAad(kontext.groupId))
}

export async function entschluesseleGruppenUmschlag(
  groupId: number,
  umschlag: string,
): Promise<string> {
  const key = await aktuellerSchluessel(groupId)
  return await decryptString(umschlag, key, configAad(groupId))
}

/** Vergisst die Chat-Schlüssel einer verlassenen oder gelöschten Gruppe. */
export async function verwirfGruppenSchluessel(groupId: number): Promise<void> {
  vergissChatSchluessel('group', groupId)
}
