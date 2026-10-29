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
import { raeumeAlleChats } from '@/services/nachrichtVerfall'
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
      const msg = (detail?.message ?? detail) as Record<string, unknown>
      const senderId = Number(msg.sender_user_id ?? msg.sender_id ?? 0)
      if (!senderId || senderId === userId) return
      const istGruppe = String(msg.chat_type ?? '') === 'group'
      const mailbox = istGruppe
        ? `group:${Number(msg.chat_id ?? 0)}`
        : `direct:peer:${senderId}`
      meldeChat({
        mailbox,
        senderId,
        clientUuid: (msg.client_uuid as string | null) ?? null,
        istGruppe,
        meldenErlaubt: detail?.melden !== false,
        t,
      })

      // Nur die Meldung. Die Zustellquittung entsteht zentral in
      // `ServerIncidentNotifier`, sobald der Chiffretext geprüft ist.
    }
    window.addEventListener('msm:sync-event', handle)
    return () => window.removeEventListener('msm:sync-event', handle)
  }, [userId, gesperrt, t])

  /**
   * Abgelaufene Nachrichten wegräumen, auch ohne offenen Messenger.
   *
   * Der Durchgang auf der Messenger-Seite sieht nur die Chats, die jemand
   * öffnet. Wer die App offen hat und in einem anderen Bereich arbeitet, ließe
   * eine „nach 24 Stunden verschwundene“ Nachricht auf der Platte liegen. Diese
   * Wache hängt in allen drei Hüllen genau dann, wenn der Messenger zu ist.
   */
  useEffect(() => {
    if (!userId || gesperrt) return
    let aktiv = true
    let laeuft = false

    const raeume = async () => {
      if (!aktiv || laeuft) return
      laeuft = true
      try {
        await raeumeAlleChats()
      } catch {
        // Ein gesperrter oder fehlender Bestand ist kein Fehler; der nächste
        // Anlass versucht es erneut.
      } finally {
        laeuft = false
      }
    }
    const beiSichtbarkeit = () => {
      if (document.visibilityState === 'visible') void raeume()
    }

    void raeume()
    const takt = window.setInterval(() => void raeume(), 300_000)
    window.addEventListener('online', raeume)
    document.addEventListener('visibilitychange', beiSichtbarkeit)
    return () => {
      aktiv = false
      window.clearInterval(takt)
      window.removeEventListener('online', raeume)
      document.removeEventListener('visibilitychange', beiSichtbarkeit)
    }
  }, [userId, gesperrt])

  return null
}
