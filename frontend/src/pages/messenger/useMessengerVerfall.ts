import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import type { TFunction } from 'i18next'
import { getChatEphemeral, setChatEphemeral, type ChatGroupItem } from '@/api/social'
import type { ChatMessage } from '@/components/social/ChatMessageBubble'
import type { ChatContact } from '@/components/social/sidebar/ConversationListItem'
import type { useMessengerKern } from '@/hooks/useMessengerKern'
import { sessionChatCache } from '@/services/klartextSpeicher'
import {
  faelligeZeilen,
  raeumeAlleChats,
  raeumeVerfalleneZeilen,
  setzeVerfallsfrist,
  stufenDativ,
  verfallStand,
} from '@/services/nachrichtVerfall'
import { vergissMailbox } from '@/services/verlaufSuche'
import { istAbweisung } from '@/services/wirkungTypen'
import { toast } from '@/stores/toastStore'

type KernErgebnis = ReturnType<typeof useMessengerKern>

interface Optionen {
  t: TFunction
  currentUserId: number
  blindMailboxId: string
  chatType: KernErgebnis['konversation']['chatType']
  chatId: KernErgebnis['konversation']['chatId']
  activeContact: ChatContact | null
  activeGroup: ChatGroupItem | null
  messengerGesperrt: boolean
  messages: ChatMessage[]
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>
  verfallSekunden: number
  setVerfallSekunden: Dispatch<SetStateAction<number>>
  sendeWirkung: KernErgebnis['sendeWirkung']
  zeigeSystemzeile: KernErgebnis['zeigeSystemzeile']
}

/**
 * Verwaltung verschwindender Nachrichten: Fristabfrage, Umstellung mit Outbox-Fallback,
 * Echtzeit-Übernahme sowie Aufräumen fälliger lokaler und entfernter Nachrichten.
 */
export function useMessengerVerfall({
  t,
  currentUserId,
  blindMailboxId,
  chatType,
  chatId,
  activeContact,
  activeGroup,
  messengerGesperrt,
  messages,
  setMessages,
  verfallSekunden,
  setVerfallSekunden,
  sendeWirkung,
  zeigeSystemzeile,
}: Optionen) {
  const [verfallOffen, setVerfallOffen] = useState(false)
  const [verfallVon, setVerfallVon] = useState<number | null>(null)

  useEffect(() => {
    if (!chatType || !chatId) {
      setVerfallVon(null)
      return
    }
    let aktiv = true
    getChatEphemeral(chatType, chatId)
      .then((stand) => {
        if (!aktiv) return
        setVerfallVon(stand.ephemeral_enabled_by_user_id)
        setVerfallSekunden(stand.ephemeral_ttl_seconds)
      })
      .catch(() => {})
    return () => {
      aktiv = false
    }
  }, [chatType, chatId, setVerfallSekunden])

  const verfallVonAnderem = verfallVon !== null && verfallVon !== currentUserId
  const gruppenVerfallsrecht = Boolean(activeGroup?.can_set_disappearing_messages)
  const gruppenOwner =
    Boolean(activeGroup) &&
    (activeGroup?.owner_user_id === currentUserId || activeGroup?.role === 'owner')
  const darfVerfallStellen = activeGroup
    ? verfallVonAnderem
      ? gruppenOwner || gruppenVerfallsrecht
      : gruppenOwner || activeGroup.role === 'admin' || gruppenVerfallsrecht
    : !verfallVonAnderem

  const verfallVonName =
    verfallVon === null
      ? ''
      : verfallVon === currentUserId
        ? t('messenger.retentionYou')
        : activeContact?.userId === verfallVon
          ? activeContact.username
          : (activeGroup?.members ?? []).find((m) => Number(m.user_id) === verfallVon)?.username ||
            t('messenger.thisContact')

  const handleVerfallWaehlen = async (sekunden: number) => {
    if (!blindMailboxId || sekunden === verfallSekunden) {
      setVerfallOffen(false)
      return
    }
    if (!darfVerfallStellen) {
      setVerfallOffen(false)
      toast.error(t('messenger.retentionNoRight'))
      return
    }
    const vorher = verfallStand(blindMailboxId)
    const jetzt = new Date().toISOString()
    setVerfallSekunden(sekunden)
    setzeVerfallsfrist(blindMailboxId, sekunden, jetzt)
    setVerfallOffen(false)
    setVerfallVon(sekunden > 0 ? currentUserId : null)
    try {
      if (chatType && chatId) {
        await setChatEphemeral(chatType, chatId, sekunden)
      }
      zeigeSystemzeile(
        sekunden > 0
          ? t('messenger.retentionSetSelf', {
              name: t('messenger.retentionYou'),
              frist: stufenDativ(sekunden, t),
            })
          : t('messenger.retentionOffSelf', { name: t('messenger.retentionYou') }),
      )
    } catch (fehler) {
      const zuruecknehmen = () => {
        setVerfallSekunden(vorher.sekunden)
        setzeVerfallsfrist(blindMailboxId, vorher.sekunden, vorher.stand || jetzt)
        setVerfallVon(vorher.sekunden > 0 ? verfallVon : null)
      }
      if (istAbweisung(fehler)) {
        zuruecknehmen()
        toast.error(t('messenger.actionRejected'))
        return
      }
      try {
        await sendeWirkung({
          typ: 'retention',
          felder: {
            type: 'retention',
            dauer: sekunden,
            sekunden,
            actor_id: currentUserId,
            zeitpunkt: jetzt,
          },
          ruecknahme: {
            art: 'verfall',
            mailbox: blindMailboxId,
            vorher: { sekunden: vorher.sekunden, stand: vorher.stand },
            nachher: { sekunden, stand: jetzt },
          },
        })
      } catch (zweite) {
        zuruecknehmen()
        if (istAbweisung(zweite)) toast.error(t('messenger.actionRejected'))
      }
    }
  }

  // Abgelaufene Zeilen im offenen Chat wegräumen.
  useEffect(() => {
    if (!blindMailboxId) return
    let aktiv = true

    const raeumeAuf = async () => {
      const faellig = faelligeZeilen(messages)
      if (!faellig.length || !aktiv) return
      await raeumeVerfalleneZeilen(blindMailboxId, faellig)
      if (!aktiv) return
      const weg = new Set(faellig.map((m) => m.id))
      setMessages((prev) => {
        const uebrig = prev.filter((m) => !weg.has(m.id))
        sessionChatCache.set(blindMailboxId, uebrig.slice(-80))
        return uebrig
      })
      vergissMailbox(blindMailboxId)
    }

    void raeumeAuf()
    const takt = window.setInterval(() => void raeumeAuf(), 60_000)
    return () => {
      aktiv = false
      window.clearInterval(takt)
    }
  }, [blindMailboxId, messages, setMessages])

  // Derselbe Durchgang über die Chats, die gerade nicht offen sind.
  useEffect(() => {
    if (messengerGesperrt) return
    void raeumeAlleChats().catch(() => {})
    const takt = window.setInterval(() => void raeumeAlleChats().catch(() => {}), 300_000)
    return () => window.clearInterval(takt)
  }, [messengerGesperrt])

  /** Der Gegenüber hat die Verfallfrist gestellt: Stand + Systemzeile übernehmen. */
  const handleEphemeral = useCallback(
    (detail: { ephemeral_ttl_seconds?: number; ephemeral_enabled_by_user_id?: number | null }) => {
      const ttl = Number(detail.ephemeral_ttl_seconds || 0)
      const von = detail.ephemeral_enabled_by_user_id ?? null
      const unveraendert = ttl === verfallSekunden && von === verfallVon
      setVerfallSekunden(ttl)
      setVerfallVon(von)
      if (blindMailboxId) {
        setzeVerfallsfrist(blindMailboxId, ttl, new Date().toISOString())
      }
      if (unveraendert) return
      const name =
        von === null
          ? t('messenger.thisContact')
          : von === currentUserId
            ? t('messenger.retentionYou')
            : activeContact?.userId === von
              ? activeContact.username
              : (activeGroup?.members ?? []).find((m) => Number(m.user_id) === von)?.username ||
                t('messenger.thisContact')
      zeigeSystemzeile(
        ttl > 0
          ? t('messenger.retentionSetOther', { name, frist: stufenDativ(ttl, t) })
          : t('messenger.retentionOffOther', { name }),
        `verfall-${ttl}-${von ?? 'niemand'}`,
      )
    },
    [
      activeContact,
      activeGroup,
      blindMailboxId,
      currentUserId,
      setVerfallSekunden,
      t,
      verfallSekunden,
      verfallVon,
      zeigeSystemzeile,
    ],
  )

  return {
    verfallOffen,
    setVerfallOffen,
    verfallVonAnderem,
    darfVerfallStellen,
    verfallVonName,
    handleVerfallWaehlen,
    handleEphemeral,
  }
}
