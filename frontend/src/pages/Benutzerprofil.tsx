import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { ArrowLeft, Clock, EyeOff, MessageSquare, Phone, UserPlus, Video } from 'lucide-react'

import { getFriends, getProfile, sendFriendRequest, type PublicProfileResponse } from '@/api/social'
import { SanitizedApiError } from '@/api/client'
import { FunkenAbzeichen } from '@/components/social/FunkenBadge'
import { Meilensteine } from '@/components/social/Meilensteine'
import { Nutzungszeit } from '@/components/social/Nutzungszeit'
import { ProfilKopf } from '@/components/social/ProfilKopf'
import { Spinner } from '@/components/ui/Spinner'
import { Button, Kurzinfo } from '@/Singra/UI'
import { useAuthStore } from '@/stores/authStore'
import { useCallStore } from '@/stores/useCallStore'
import { useFunkenStore } from '@/stores/funkenStore'
import { toast } from '@/stores/toastStore'

type Stand =
  | { art: 'laedt' }
  | { art: 'da'; profil: PublicProfileResponse }
  | { art: 'verborgen' }
  | { art: 'fehler' }

/**
 * Das Profil eines anderen Kontos: Name, Bild, seit wann dabei, Status,
 * Funken, Nutzungszeit und Errungenschaften — dazu Chat und Anruf.
 *
 * Was hier steht, entscheidet der Server nach der Profil-Sichtbarkeit des
 * Kontos. Darf man es nicht sehen (privat, nur Freunde, blockiert), antwortet
 * er wie für ein Konto, das es nicht gibt, und die Seite sagt auch nicht mehr.
 */
export function Benutzerprofil() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { userId } = useParams()
  const { pathname } = useLocation()
  const ich = useAuthStore((s) => s.user?.id)
  const [stand, setStand] = useState<Stand>({ art: 'laedt' })
  const [anfrageGesendet, setAnfrageGesendet] = useState(false)

  /*
   * Pontis rendert die Oberfläche in einem MemoryRouter ohne `<Routes>`: die
   * Seite bekommt dort keinen Routenparameter, und `useParams()` ist leer. Bis
   * 27.10.2026 hieß das „Profil nicht verfügbar“ — obwohl die Adresse
   * `/user/7` längst dastand. Der Pfad trägt dieselbe Angabe, also wird sie
   * dort gelesen, wo der Router sie nicht liefert.
   */
  const ausPfad = /^\/user\/(\d+)(?:\/|$)/.exec(pathname)?.[1] ?? null
  const id = Number(userId ?? ausPfad)
  const gueltig = Number.isSafeInteger(id) && id > 0

  const lade = useCallback(async () => {
    if (!gueltig) {
      setStand({ art: 'verborgen' })
      return
    }
    setStand({ art: 'laedt' })
    try {
      setStand({ art: 'da', profil: await getProfile(id) })
    } catch (err) {
      setStand(err instanceof SanitizedApiError && err.status === 404 ? { art: 'verborgen' } : { art: 'fehler' })
    }
  }, [gueltig, id])

  useEffect(() => {
    setAnfrageGesendet(false)
    void lade()
  }, [lade])

  // Info und Praesenz kommen als Ereignis, sobald sie sich fuer andere
  // sichtbar aendern. Ohne diesen Zuhoerer blieb das offene Profil stehen,
  // bis jemand die Seite neu lud.
  useEffect(() => {
    const beiEreignis = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          type?: string
          friend_id?: number | string
          info?: { text?: string; expires_at?: string | null; updated_at?: string | null } | null
          presence?: PublicProfileResponse['presence']
        }>
      ).detail
      if (!detail || Number(detail.friend_id) !== id) return

      if (detail.type === 'friend_info_updated') {
        setStand((alt) => {
          if (alt.art !== 'da') return alt
          if (detail.info === null) return { art: 'da', profil: { ...alt.profil, info: null } }
          if (!detail.info) return alt
          return {
            art: 'da',
            profil: {
              ...alt.profil,
              info: {
                text: detail.info.text ?? '',
                visibility: 'friends',
                expires_at: detail.info.expires_at ?? null,
                updated_at: detail.info.updated_at ?? null,
              },
            },
          }
        })
      } else if (detail.type === 'friend_presence_updated' && detail.presence) {
        setStand((alt) =>
          alt.art === 'da' ? { art: 'da', profil: { ...alt.profil, presence: detail.presence } } : alt,
        )
      }
    }

    window.addEventListener('msm:sync-event', beiEreignis)
    return () => window.removeEventListener('msm:sync-event', beiEreignis)
  }, [id])

  // Der Funke braucht den Beginn der Freundschaft. Wer direkt über einen Link
  // kommt, war vielleicht weder im Messenger noch in der Freundesliste.
  const istFreund = stand.art === 'da' && Boolean(stand.profil.is_friend)
  useEffect(() => {
    if (!istFreund || useFunkenStore.getState().freunde[id]) return
    void getFriends()
      .then((liste) =>
        useFunkenStore.getState().setzeFreunde(
          liste
            .filter((f) => f.status === 'accepted')
            .map((f) => ({ userId: Number(f.user_id ?? f.id), seit: f.created_at })),
        ),
      )
      .catch(() => {})
  }, [istFreund, id])

  if (stand.art === 'laedt') {
    return (
      <div className="flex justify-center py-16">
        <Spinner size="md" />
      </div>
    )
  }

  if (stand.art !== 'da') {
    const verborgen = stand.art === 'verborgen'
    return (
      <div className="mx-auto max-w-md py-16 text-center space-y-4">
        <EyeOff className="mx-auto h-10 w-10 text-on-surface-variant/60" aria-hidden="true" />
        <h1 className="font-headline text-title-lg font-semibold text-on-surface">
          {verborgen ? t('social.profile.unavailableTitle') : t('social.profile.loadFailed')}
        </h1>
        {verborgen && <p className="text-sm text-on-surface-variant">{t('social.profile.unavailableHint')}</p>}
        <div className="flex justify-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-1.5">
            <ArrowLeft className="h-4 w-4" />
            <span>{t('common.back')}</span>
          </Button>
          {!verborgen && (
            <Button variant="secondary" size="sm" onClick={() => void lade()}>
              {t('common.retry')}
            </Button>
          )}
        </div>
      </div>
    )
  }

  const { profil } = stand
  const selbst = profil.user_id === ich
  const status = profil.presence?.status === 'invisible' ? 'offline' : profil.presence?.status
  // Nur ein Tag, ohne Zeitzone: als Ortszeit lesen, sonst rutscht er westlich
  // von Greenwich auf den Vortag.
  const dabeiSeit = profil.member_since
    ? new Date(`${profil.member_since}T00:00:00`).toLocaleDateString(i18n.language, { month: 'long', year: 'numeric' })
    : null
  const stats = profil.stats
  const erfolge = profil.achievements ?? []

  const anrufen = async (art: 'audio' | 'video') => {
    try {
      await useCallStore.getState().initiateCall(
        { userId: profil.user_id, username: profil.username, avatarUrl: profil.avatar_url },
        art,
      )
    } catch (err: unknown) {
      toast.error(err instanceof Error && err.message ? err.message : t('messenger.callStartFailedSingle'))
    }
  }

  const freundHinzufuegen = async () => {
    try {
      const res = await sendFriendRequest(profil.username)
      toast.success(res.message || t('social.contacts.requestSent'))
      setAnfrageGesendet(true)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('social.contacts.requestSendFailed'))
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 pb-8">
      <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-1.5 -ml-2">
        <ArrowLeft className="h-4 w-4" />
        <span>{t('common.back')}</span>
      </Button>

      <section className="msm-card p-6" aria-labelledby="profil-name">
        <ProfilKopf
          username={profil.username}
          avatarUrl={profil.avatar_url}
          status={status}
          presence={profil.presence}
          infoText={profil.info?.text}
          memberSince={dabeiSeit}
          istFreund={istFreund}
          selbst={selbst}
          funke={istFreund ? <FunkenAbzeichen partnerId={profil.user_id} name={profil.username} /> : null}
          titleId="profil-name"
          actions={!selbst ? (
            <>
              <Button size="sm" onClick={() => navigate(`/chat?userId=${profil.user_id}`)} className="gap-1.5">
                <MessageSquare className="h-4 w-4" />
                <span>{t('social.profile.chat')}</span>
              </Button>
              {/* Anrufen dürfen nur Freunde; der Server lehnt alles andere ab. */}
              {istFreund ? (
                <>
                  <Button variant="secondary" size="sm" onClick={() => void anrufen('audio')} className="gap-1.5">
                    <Phone className="h-4 w-4" />
                    <span>{t('social.profile.call')}</span>
                  </Button>
                  <Kurzinfo text={t('messenger.videoCall')} seite="ende">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void anrufen('video')}
                      aria-label={t('messenger.videoCall')}
                    >
                      <Video className="h-4 w-4" />
                    </Button>
                  </Kurzinfo>
                </>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void freundHinzufuegen()}
                  disabled={anfrageGesendet}
                  className="gap-1.5"
                >
                  <UserPlus className="h-4 w-4" />
                  <span>{anfrageGesendet ? t('social.profile.requestSent') : t('messenger.sendFriendRequest')}</span>
                </Button>
              )}
            </>
          ) : null}
        />
      </section>

      <section className="msm-card p-6" aria-labelledby="profil-zeit">
        <div className="flex items-center gap-2 mb-4">
          <Clock className="h-5 w-5 text-secondary" aria-hidden="true" />
          <h2 id="profil-zeit" className="font-headline text-title-lg font-semibold text-on-surface">
            {t('social.profile.activityTitle')}
          </h2>
        </div>
        <Nutzungszeit stats={stats} />
      </section>

      <Meilensteine
        key={profil.user_id}
        achievements={erfolge}
        freigeschaltet={stats?.unlocked_achievements ?? erfolge.filter((a) => a.unlocked).length}
        gesamt={stats?.total_achievements ?? erfolge.length}
        punkte={stats?.earned_points ?? 0}
        titel={t('social.profile.achievementsTitle')}
        startFilter={erfolge.some((a) => a.unlocked) ? 'unlocked' : 'all'}
      />
    </div>
  )
}
