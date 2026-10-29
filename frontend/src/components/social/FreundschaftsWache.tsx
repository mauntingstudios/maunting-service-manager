import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { melde } from '@/services/benachrichtigung/hub'
import { useAuthStore } from '@/stores/authStore'

interface FreundEreignis {
  type?: string
  melden?: boolean
  ereignis?: string
  request_id?: number
  from_user_id?: number
  from_username?: string
  friend_username?: string
}

function imVordergrund(): boolean {
  if (typeof document === 'undefined') return false
  return document.visibilityState === 'visible' && document.hasFocus()
}

/**
 * Die eine Stelle, die eine Freundschaftsanfrage im offenen Fenster meldet.
 *
 * Der Server waehlt bei `melden_markieren` genau einen Client je Konto. Was
 * hier mit `melden: false` ankommt, gehoert einem anderen Fenster oder dem
 * Android-Dienst; die Listen aktualisieren sich trotzdem ueber ihre eigenen
 * Zuhoerer. Der Toast traegt nur „Ansehen“: annehmen und ablehnen stehen
 * nebeneinander in der Karte, damit ein Klick nicht versehentlich bindet.
 */
export function FreundschaftsWache() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)

  useEffect(() => {
    if (!user?.id) return
    const eigeneId = user.id
    const schalterAn = user.device_notifications !== false
    const zeigen = () => {
      // Zuerst das offene Gespraech schliessen (falls der Messenger schon
      // laeuft), dann zur Liste. Auf anderen Seiten mountet der Messenger
      // erst durch die Navigation; die Karte steht dort ohnehin oben.
      window.dispatchEvent(new CustomEvent('msm:freundschaftsanfragen-zeigen'))
      navigate('/chat')
    }

    const handle = (event: Event) => {
      const detail = (event as CustomEvent<FreundEreignis>).detail
      if (!detail?.type?.startsWith('friend_')) return
      if (detail.melden === false) return

      if (detail.type === 'friend_request_received') {
        const name = detail.from_username || t('notifications.friendRequestUnknown')
        void melde(
          {
            art: 'freundschaft',
            schalterAn,
            absenderId: detail.from_user_id,
            eigeneId,
            fensterImVordergrund: imVordergrund(),
            meldenErlaubt: true,
          },
          {
            schluessel: detail.ereignis ?? `friend-request:${detail.request_id ?? detail.from_user_id}`,
            titel: t('notifications.friendRequestTitle'),
            text: t('notifications.friendRequestText', { name }),
            toastText: t('notifications.friendRequestToast', { name }),
            fristMs: 60_000,
            aktion: {
              label: t('notifications.friendRequestAction'),
              ausfuehren: zeigen,
            },
          },
        )
        return
      }

      if (detail.type === 'friend_request_accepted') {
        const name = detail.friend_username || t('notifications.friendRequestUnknown')
        void melde(
          {
            art: 'freundschaft',
            schalterAn,
            eigeneId,
            fensterImVordergrund: imVordergrund(),
            meldenErlaubt: true,
          },
          {
            schluessel: detail.ereignis ?? `friend-accepted:${detail.request_id ?? name}`,
            titel: t('notifications.friendRequestAcceptedTitle'),
            text: t('notifications.friendRequestAccepted', { name }),
            toastText: t('notifications.friendRequestAccepted', { name }),
            fristMs: 60_000,
            aktion: {
              label: t('notifications.friendRequestAction'),
              ausfuehren: zeigen,
            },
          },
        )
      }
    }

    window.addEventListener('msm:sync-event', handle)
    return () => window.removeEventListener('msm:sync-event', handle)
  }, [navigate, t, user?.id, user?.device_notifications])

  return null
}
