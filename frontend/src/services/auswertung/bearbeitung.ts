/** Bearbeiten-Steuerpakete. */

import type { Lesung } from '@/hooks/useKonversation'
import { editMessageInLocalStore } from '../messengerLocalStore'
import type { Bezugstafel } from '../nachrichtBezug'
import type { UrheberVon } from './typen'

export async function verarbeiteBearbeitung(
  parsed: Record<string, any>,
  umschlag: Lesung['env'],
  urheberVon: UrheberVon,
  aenderungen: Bezugstafel<{ newText: string; editedAt: string }>,
): Promise<boolean> {
  if (parsed.type !== 'edit_message' && parsed.action !== 'edit_message') return false
  const newText = parsed.new_text ?? parsed.text
  if (newText !== undefined) {
    const urheber = await urheberVon(parsed.actor_id ?? parsed.sender_id)
    if (urheber === null) {
      console.warn('[Messenger] Dropping edit packet with forged actor_id:', parsed.actor_id)
      return true
    }
    const editedAt = String(parsed.edited_at || umschlag.created_at || new Date().toISOString())
    aenderungen.merke(
      parsed,
      {
        newText: String(newText),
        editedAt,
      },
      urheber,
    )

    const targetUuid = parsed.target_client_uuid || parsed.target_uuid
    if (targetUuid) {
      void editMessageInLocalStore(umschlag.blind_mailbox_id, String(targetUuid), String(newText)).catch(() => {})
    }
  }
  return true
}
