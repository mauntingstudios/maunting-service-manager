import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, UserRoundPlus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  acceptFriendRequest,
  declineFriendRequest,
  getFriendRequests,
  type FriendItem,
} from '@/api/social'
import { Avatar, Button, Kurzinfo } from '@/Singra/UI'
import { toast } from '@/stores/toastStore'

/**
 * Der eine Ort fuer eingehende Freundschaftsanfragen.
 *
 * Er steht in der Messenger-Seitenleiste und damit in Web, MSS und Pontis
 * gleich. Die Karte erscheint nur, solange etwas offen ist; Annehmen und
 * Ablehnen stehen nebeneinander, damit der Toast nur „Ansehen“ anbieten muss.
 */
export function FreundschaftsanfragenKarte() {
  const { t } = useTranslation()
  const [incoming, setIncoming] = useState<FriendItem[]>([])
  const [busyId, setBusyId] = useState<number | null>(null)
  const lauf = useRef(0)

  const laden = useCallback(async () => {
    const meiner = ++lauf.current
    try {
      const daten = await getFriendRequests()
      if (meiner !== lauf.current) return
      setIncoming(daten.incoming)
    } catch {
      // Der 15-Sekunden-Takt der Kontakte holt es nach; die Karte soll bei
      // einem Netzfehler nicht verschwinden oder flackern.
    }
  }, [])

  useEffect(() => {
    void laden()
    const handle = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: string }>).detail
      if (!detail?.type?.startsWith('friend_')) return
      void laden()
    }
    window.addEventListener('msm:sync-event', handle)
    return () => {
      window.removeEventListener('msm:sync-event', handle)
      lauf.current++
    }
  }, [laden])

  const entscheiden = async (anfrage: FriendItem, annehmen: boolean) => {
    setBusyId(anfrage.id)
    try {
      if (annehmen) await acceptFriendRequest(anfrage.id)
      else await declineFriendRequest(anfrage.id)
      toast.success(
        t(annehmen ? 'social.contacts.requestAccepted' : 'social.contacts.requestDeclined'),
      )
    } catch (fehler) {
      toast.error(
        fehler instanceof Error && fehler.message
          ? fehler.message
          : t(annehmen ? 'social.contacts.requestAcceptFailed' : 'social.contacts.requestDeclineFailed'),
      )
    } finally {
      setBusyId(null)
      await laden()
    }
  }

  if (incoming.length === 0) return null

  return (
    <section
      id="freundschaftsanfragen"
      aria-labelledby="freundschaftsanfragen-titel"
      className="shrink-0 mx-2 mb-1 rounded-xl border border-status-warning/30 bg-surface-container-high/60 p-2"
    >
      <div className="flex items-center gap-1.5 px-1 pb-1.5 text-label-sm font-semibold uppercase tracking-wider text-status-warning">
        <UserRoundPlus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span id="freundschaftsanfragen-titel">
          {t('social.contacts.pendingRequests', { count: incoming.length })}
        </span>
      </div>
      <ul className="max-h-48 space-y-1.5 overflow-y-auto pr-0.5">
        {incoming.map((anfrage) => (
          <li key={anfrage.id} className="flex items-center gap-2 px-1">
            <Avatar src={anfrage.avatar_url} name={anfrage.username} size="sm" />
            <span className="min-w-0 flex-1 truncate text-xs font-semibold text-on-surface">
              {anfrage.username}
            </span>
            <Kurzinfo text={t('social.contacts.accept')} seite="ende">
              <Button
                type="button"
                variant="primary"
                size="sm"
                aria-label={`${t('social.contacts.accept')}: ${anfrage.username}`}
                disabled={busyId === anfrage.id}
                onClick={() => void entscheiden(anfrage, true)}
                className="max-sm:min-h-11"
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </Kurzinfo>
            <Kurzinfo text={t('social.contacts.decline')} seite="ende">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`${t('social.contacts.decline')}: ${anfrage.username}`}
                disabled={busyId === anfrage.id}
                onClick={() => void entscheiden(anfrage, false)}
                className="max-sm:min-h-11 text-status-destructive hover:bg-status-destructive/10"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </Kurzinfo>
          </li>
        ))}
      </ul>
    </section>
  )
}
