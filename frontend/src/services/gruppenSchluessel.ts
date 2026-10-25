/**
 * Gruppen-Kryptografie im neuen Transport.
 *
 * Es gibt keinen separaten Gruppenschluessel mehr: der `chat_key` der Gruppe
 * schuetzt Nachrichten und den verschluesselten Gruppenblock. Die alten
 * Funktionen bleiben als schmale Fassade, damit Rechte-Dialog, Namensspeicher
 * und PIN-Umstellung nicht zwei Krypto-Pfade kennen.
 */

import { decryptString, encryptString } from '@msdis/shield/aead'
import { getE2eeChatKeys } from '@/api/social'
import { holeChatSchluessel } from './chatKrypto'

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

/** Der Gruppenbestand liegt nicht mehr in einer eigenen IndexedDB. */
export async function schreibeGruppenBestandNeu(): Promise<number> {
  return 0
}

export function leereAntwortSperren(): void {}
export function leereGeraeteStand(): void {}
export function leereUmzuege(): void {}
export function abonniereBekannteGespraeche(..._args: unknown[]): void {}
export async function holeGeraeteSteuerung(..._args: unknown[]): Promise<number> {
  return 0
}
export async function verteileOffeneZustellungenAller(..._args: unknown[]): Promise<number> {
  return 0
}
export function umgezogeneMailbox(mailbox: string): string {
  return mailbox
}

export async function gruppenGeheimnis(..._args: any[]): Promise<null> {
  return null
}

export async function verwirfGruppenSchluessel(..._args: any[]): Promise<void> {
  // Der Chat-Schluessel wird zentral in `chatKrypto` verwaltet.
}

export async function dmZiele(..._args: any[]): Promise<{ lesen: string[]; senden: string; nachweis: string | null }> {
  return { lesen: [], senden: '', nachweis: null }
}
