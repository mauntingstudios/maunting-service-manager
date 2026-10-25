/**
 * Chat-Schluessel und Nutzlasten des neuen Einheits-Transports.
 *
 * Eine Nachricht wird genau einmal mit AES-256-GCM unter dem symmetrischen
 * `chat_key` des Gespraechs verschluesselt. Der Schluessel liegt je Empfaenger
 * in `e2ee_chat_keys`, verpackt gegen dessen Konto-Schluessel. Der Absender
 * unterschreibt die Nutzlast mit dem Konto-ECDSA-Schluessel; die Empfaenger
 * pruefen die Unterschrift, bevor sie etwas anzeigen.
 */

import { decryptString, encryptString, importAesGcmRawKey } from '@msdis/shield/aead'
import { base64ToBytes, bytesToBase64 } from '@msdis/shield/core'
import { randomBytes } from '@msdis/shield/random'

import {
  getE2eeChatKeys,
  putE2eeChatKeys,
  type E2eeChatKeyItem,
} from '@/api/social'
import { decryptE2eeHybrid, encryptE2eeHybrid } from './e2eeCrypto'
import {
  ensureAccountKeys,
  kontoOeffentlichViele,
  pruefeKonto,
  signiereKonto,
} from './accountKeys'

export class ChatSchluesselFehltError extends Error {
  constructor() {
    super('Für dieses Gespräch fehlt der Chat-Schlüssel. Ein Mitglied muss ihn zustellen.')
    this.name = 'ChatSchluesselFehltError'
  }
}

export class ChatNutzlastUngueltigError extends Error {
  constructor() {
    super('Die Nachricht konnte nicht geprüft werden.')
    this.name = 'ChatNutzlastUngueltigError'
  }
}

const CHAT_KEY_BYTES = 32
const cache = new Map<string, CryptoKey>()
const rohCache = new Map<string, Uint8Array>()

function cacheId(chatType: 'direct' | 'group', chatId: number, version: number): string {
  return `${chatType}:${chatId}:${version}`
}

export function leereChatSchluesselCache(): void {
  for (const bytes of rohCache.values()) bytes.fill(0)
  rohCache.clear()
  cache.clear()
}

async function importiere(bytes: Uint8Array): Promise<CryptoKey> {
  return await importAesGcmRawKey(bytes, ['encrypt', 'decrypt'])
}

function aad(chatType: string, chatId: number, clientUuid: string, senderId: number): string {
  return `msm:msg:${chatType}:${chatId}:${clientUuid}:${senderId}`
}

function signaturDaten(
  chatType: string,
  chatId: number,
  clientUuid: string,
  senderId: number,
  roh: Record<string, unknown>,
): string {
  const felder = Object.keys(roh)
    .filter((name) => name !== 'sig' && roh[name] !== undefined)
    .sort()
    .map((name) => `${name}=${JSON.stringify(roh[name])}`)
  return `msm:chatmsg:v1:${chatType}:${chatId}:${clientUuid}:${senderId}:${felder.join('&')}`
}

async function schluesselAusAntwort(
  chatType: 'direct' | 'group',
  chatId: number,
  version: number,
  keys: E2eeChatKeyItem[],
): Promise<CryptoKey> {
  const id = cacheId(chatType, chatId, version)
  const vorhanden = cache.get(id)
  if (vorhanden) return vorhanden

  const eintrag = keys.find((k) => k.key_version === version)
  if (!eintrag) throw new ChatSchluesselFehltError()
  const meins = await ensureAccountKeys()
  if (!meins.kontoPaar) throw new ChatSchluesselFehltError()
  const base64 = await decryptE2eeHybrid(eintrag.encrypted_chat_key, meins.kontoPaar.privateKeyJwk)
  const bytes = base64ToBytes(base64)
  if (bytes.length !== CHAT_KEY_BYTES) throw new ChatSchluesselFehltError()
  const key = await importiere(bytes)
  rohCache.set(id, bytes)
  cache.set(id, key)
  return key
}

export async function holeChatSchluessel(
  chatType: 'direct' | 'group',
  chatId: number,
  version: number,
): Promise<CryptoKey> {
  const id = cacheId(chatType, chatId, version)
  const vorhanden = cache.get(id)
  if (vorhanden) return vorhanden
  const { keys } = await getE2eeChatKeys(chatType, chatId)
  return await schluesselAusAntwort(chatType, chatId, version, keys)
}

/**
 * Liefert die aktuelle Version, die dieses Geraet oeffnen kann. Fehlt sie,
 * wird die naechste Version angelegt (Gruppe: nur Owner/Admin).
 */
export async function ensureChatKeyVersion(
  chatType: 'direct' | 'group',
  chatId: number,
  memberIds: number[],
): Promise<number> {
  const { keys, latest_key_version } = await getE2eeChatKeys(chatType, chatId)
  const eigene = keys.map((k) => k.key_version)
  if (latest_key_version > 0 && eigene.includes(latest_key_version)) {
    return latest_key_version
  }
  const version = latest_key_version > 0 ? latest_key_version + 1 : 1
  await erzeugeChatSchluessel(chatType, chatId, memberIds, version)
  const nachher = await getE2eeChatKeys(chatType, chatId)
  if (!nachher.keys.some((k) => k.key_version === version)) {
    throw new ChatSchluesselFehltError()
  }
  return version
}

/**
 * Legt die naechste Chat-Schluesselversion an, wenn dieses Geraet sie erzeugen
 * darf. Der Aufrufer nennt die aktuelle Mitgliederliste; der Server prueft sie
 * gegen seine eigene Liste.
 */
export async function erzeugeChatSchluessel(
  chatType: 'direct' | 'group',
  chatId: number,
  memberIds: number[],
  keyVersion: number,
): Promise<void> {
  const { keys: vorhanden } = await getE2eeChatKeys(chatType, chatId)
  if (vorhanden.some((k) => k.key_version === keyVersion)) return

  const meins = await ensureAccountKeys()
  if (!meins.kontoPaar) throw new ChatSchluesselFehltError()
  const roh = randomBytes(CHAT_KEY_BYTES)
  try {
    const base64 = bytesToBase64(roh)
    const accounts = await kontoOeffentlichViele(memberIds)
    const rows: { user_id: number; encrypted_chat_key: string }[] = []
    for (const uid of [...new Set(memberIds.map(Number))]) {
      const account = accounts.get(uid)
      if (!account) throw new ChatSchluesselFehltError()
      rows.push({
        user_id: uid,
        encrypted_chat_key: await encryptE2eeHybrid(
          base64,
          account.public_key,
          meins.kontoPaar.publicKeyJwk,
        ),
      })
    }
    try {
      await putE2eeChatKeys({ chat_type: chatType, chat_id: chatId, key_version: keyVersion, keys: rows })
    } catch (fehler) {
      // Ein anderes Geraet war schneller. Seine Schluessel gelten.
      if ((fehler as { status?: number })?.status !== 409) throw fehler
    }
  } finally {
    roh.fill(0)
  }
}

export interface ChatNutzlast {
  encrypted_payload: string
  key_version: number
  client_uuid: string
}

export async function verschluessleChatNutzlast(
  chatType: 'direct' | 'group',
  chatId: number,
  clientUuid: string,
  senderId: number,
  keyVersion: number,
  nutzlast: Record<string, unknown>,
): Promise<ChatNutzlast> {
  const key = await holeChatSchluessel(chatType, chatId, keyVersion)
  const roh: Record<string, unknown> = {
    ...nutzlast,
    chat_type: chatType,
    chat_id: chatId,
    client_uuid: clientUuid,
    sender_id: senderId,
    von_konto: senderId,
  }
  const sig = await signiereKonto(signaturDaten(chatType, chatId, clientUuid, senderId, roh))
  const mitSig = { ...roh, sig }
  const encrypted = await encryptString(
    JSON.stringify(mitSig),
    key,
    aad(chatType, chatId, clientUuid, senderId),
  )
  return { encrypted_payload: encrypted, key_version: keyVersion, client_uuid: clientUuid }
}

export async function entpackeChatNutzlast(
  chatType: 'direct' | 'group',
  chatId: number,
  clientUuid: string,
  senderId: number,
  keyVersion: number,
  encryptedPayload: string,
): Promise<Record<string, unknown>> {
  const key = await holeChatSchluessel(chatType, chatId, keyVersion)
  let roh: Record<string, unknown>
  try {
    const klartext = await decryptString(
      encryptedPayload,
      key,
      aad(chatType, chatId, clientUuid, senderId),
    )
    const parsed = JSON.parse(klartext)
    if (!parsed || typeof parsed !== 'object') throw new ChatNutzlastUngueltigError()
    roh = parsed as Record<string, unknown>
  } catch {
    throw new ChatNutzlastUngueltigError()
  }
  const sig = typeof roh.sig === 'string' ? roh.sig : ''
  if (!sig) throw new ChatNutzlastUngueltigError()
  if (Number(roh.von_konto) !== Number(senderId)) throw new ChatNutzlastUngueltigError()
  if (String(roh.client_uuid || '') !== clientUuid) throw new ChatNutzlastUngueltigError()
  if (String(roh.chat_type || '') !== chatType || Number(roh.chat_id) !== Number(chatId)) {
    throw new ChatNutzlastUngueltigError()
  }
  if (!(await pruefeKonto(signaturDaten(chatType, chatId, clientUuid, senderId, roh), sig, senderId))) {
    throw new ChatNutzlastUngueltigError()
  }
  return roh
}

function reaktionAad(messageId: number, userId: number): string {
  return `msm:reaction:${messageId}:${userId}`
}

export async function verschluessleReaktion(
  chatType: 'direct' | 'group',
  chatId: number,
  keyVersion: number,
  messageId: number,
  userId: number,
  emoji: string,
): Promise<string> {
  const key = await holeChatSchluessel(chatType, chatId, keyVersion)
  return await encryptString(emoji, key, reaktionAad(messageId, userId))
}

export async function entpackeReaktion(
  chatType: 'direct' | 'group',
  chatId: number,
  keyVersion: number,
  messageId: number,
  userId: number,
  encryptedReaction: string,
): Promise<string | null> {
  try {
    const key = await holeChatSchluessel(chatType, chatId, keyVersion)
    const text = await decryptString(encryptedReaction, key, reaktionAad(messageId, userId))
    return text || null
  } catch {
    return null
  }
}
