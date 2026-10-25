/**
 * Pontis meldet neue Nachrichten auch dann, wenn der Messenger zu ist.
 *
 * Der Echtzeitkanal läuft am Konto, nicht mehr an einer Geräte-Mailbox. Ein
 * `message_created`-Ereignis trägt Absender und Gespräch; fuer die Meldung
 * reicht das, ohne den Chiffretext zu oeffnen. Was der Nutzer im Chat sieht,
 * entschluesselt weiterhin erst die Messenger-Seite mit dem Chat-Schluessel.
 */

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { meldeChat } from '@/services/benachrichtigung/chatMeldung'
import { resolveIdentity, type E2eeIdentity } from '@/services/e2eeIdentity'
import { istGesperrt, useMessengerSperre } from '@/services/messengerSperre'
import { useMessengerSync } from '@/hooks/useMessengerSync'
import { useAuthStore } from '@/stores/authStore'
import { eigenesGeraet } from '@/services/e2eeGeraet'
import { messengerSocket } from '@/services/messengerSocket'

export function MessengerHintergrund() {
  const { t } = useTranslation()
  const userId = useAuthStore((s) => s.user?.id)
  const gesperrt = useMessengerSperre(istGesperrt)
  const [identitaet, setIdentitaet] = useState<E2eeIdentity | null>(null)

  useEffect(() => {
    setIdentitaet(null)
    if (!userId || gesperrt) return
    let aktiv = true
    resolveIdentity(userId)
      .then((next) => {
        if (aktiv) setIdentitaet(next)
      })
      .catch(() => {})
    eigenesGeraet()
      .then((g) => {
        if (aktiv && g?.kennung) messengerSocket.connect(g.kennung)
      })
      .catch(() => {})
    return () => {
      aktiv = false
    }
  }, [userId, gesperrt])

  const partnerActivityTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useMessengerSync({
    blindMailboxId: '', leseMailboxen: [], currentUserId: userId ?? 0,
    geraeteMeldungen: identitaet?.state ?? null, loadMessages: async () => {},
    setGroups: () => {}, setActiveGroup: () => {}, setPartnerActivity: () => {},
    partnerActivityTimeoutRef,
  })

  useEffect(() => {
    if (!userId || gesperrt) return
    const handle = (e: Event) => {
      const detail = (e as CustomEvent<Record<string, unknown>>).detail
      const typ = String(detail?.type ?? '')
      if (typ !== 'message_created' && typ !== 'new_message') return
      const senderId = Number(detail?.sender_user_id ?? detail?.sender_id ?? 0)
      if (!senderId || senderId === userId) return
      const istGruppe = detail?.chat_type === 'group'
      const mailbox = istGruppe
        ? `group:${Number(detail?.chat_id ?? 0)}`
        : `direct:peer:${senderId}`
      meldeChat({
        mailbox,
        senderId,
        clientUuid: (detail?.client_uuid as string | null) ?? null,
        istGruppe,
        t,
      })
    }
    window.addEventListener('msm:sync-event', handle)
    return () => window.removeEventListener('msm:sync-event', handle)
  }, [userId, gesperrt, t])

  return null
}
