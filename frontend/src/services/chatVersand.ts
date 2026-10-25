/** Versandauftrag fuer ein beliebiges Ziel — auch fuer Weiterleitungen. */

import type { Versandauftrag } from '@/hooks/useKonversation'
import { ensureChatKeyVersion, verschluessleChatNutzlast } from './chatKrypto'

export interface ChatVersandZiel {
  chatType: 'direct' | 'group'
  chatId: number
  speicherId: string
  memberIds: number[]
  senderId: number
}

export async function baueChatVersand(
  ziel: ChatVersandZiel,
  payload: string,
  clientUuid: string,
): Promise<Versandauftrag[]> {
  const version = await ensureChatKeyVersion(ziel.chatType, ziel.chatId, ziel.memberIds)
  const nutzlast = JSON.parse(payload) as Record<string, unknown>
  const verschluesselt = await verschluessleChatNutzlast(
    ziel.chatType,
    ziel.chatId,
    clientUuid,
    ziel.senderId,
    version,
    nutzlast,
  )
  return [
    {
      blind_mailbox_id: ziel.speicherId,
      ciphertext_envelope: verschluesselt.encrypted_payload,
      client_uuid: clientUuid,
      chat_type: ziel.chatType,
      chat_id: String(ziel.chatId),
      key_version: version,
    },
  ]
}
