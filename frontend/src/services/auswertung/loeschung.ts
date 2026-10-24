/** Löschen-Steuerpakete. */

import type { Lesung } from '@/hooks/useKonversation'
import { deleteMessageFromLocalStore } from '../messengerLocalStore'
import type { Bezugstafel } from '../nachrichtBezug'
import type { UrheberVon } from './typen'

export async function verarbeiteLoeschung(
  parsed: Record<string, any>,
  umschlag: Lesung['env'],
  urheberVon: UrheberVon,
  loeschungen: Bezugstafel<{ deletedAt: string }>,
): Promise<boolean> {
  if (parsed.type !== 'delete_message' && parsed.action !== 'delete_message') return false
  const urheber = await urheberVon(parsed.actor_id ?? parsed.sender_id)
  if (urheber === null) {
    console.warn('[Messenger] Dropping delete packet with forged actor_id:', parsed.actor_id)
    return true
  }
  const deletedAt = String(parsed.deleted_at || umschlag.created_at || new Date().toISOString())
  loeschungen.merke(
    parsed,
    {
      deletedAt,
    },
    urheber,
  )

  const targetUuid = parsed.target_client_uuid || parsed.target_uuid
  if (targetUuid) {
    void deleteMessageFromLocalStore(umschlag.blind_mailbox_id, String(targetUuid)).catch(() => {})
  }

  return true
}
