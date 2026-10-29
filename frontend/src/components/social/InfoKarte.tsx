import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Info, MessageSquare, Phone, Save, Trash2, Video } from 'lucide-react'

import { getOwnInfo, setOwnInfo, type UserInfoSichtbarkeit } from '@/api/social'
import { ProfilKopf } from '@/components/social/ProfilKopf'
import { Button, Dropdown, Input, Textarea, buttonClasses, type DropdownOption } from '@/Singra/UI'
import { useAuthStore } from '@/stores/authStore'
import { toast } from '@/stores/toastStore'

/**
 * Der freiwillige Info-Text (wie bei WhatsApp).
 *
 * Eine Karte für Web, MSS und Pontis: Text mit Vorschlägen, Sichtbarkeit
 * (Freunde / Öffentlich / Niemand) und Frist (1 Stunde bis für immer). Der
 * Server setzt Sichtbarkeit und Ablauf durch; hier steht nur die Auswahl.
 *
 * Bewusst ohne eigenen Zustand im Aufrufer: wer die Karte einbaut, muss nichts
 * über die Info wissen. Die Vorschau zeigt denselben Profilkopf, den andere
 * sehen — mit dem echten Namen und Bild, aber mit erfundenen Aktionen.
 */

const SICHTBARKEITEN: UserInfoSichtbarkeit[] = ['friends', 'public', 'nobody']

const DAUER_WERTE: Record<string, number> = {
  h1: 3600,
  h8: 8 * 3600,
  d1: 86_400,
  d2: 2 * 86_400,
  w1: 7 * 86_400,
}

/** Vorschläge mit Emoji; der Text kommt aus i18n und landet so im Feld. */
const VORSCHLAEGE = [
  { key: 'available', emoji: '☕' },
  { key: 'busy', emoji: '🔴' },
  { key: 'meeting', emoji: '📅' },
  { key: 'away', emoji: '🚶' },
  { key: 'night', emoji: '🌙' },
  { key: 'sleep', emoji: '😴' },
  { key: 'work', emoji: '💼' },
  { key: 'travel', emoji: '✈️' },
  { key: 'sport', emoji: '🏋️' },
] as const

export const INFO_MAX_ZEICHEN = 139

export function InfoKarte({ className = '' }: { className?: string }) {
  const { t, i18n } = useTranslation()
  const ich = useAuthStore((s) => s.user)

  const [laedt, setLaedt] = useState(true)
  const [speichert, setSpeichert] = useState(false)
  const [text, setText] = useState('')
  const [sichtbarkeit, setSichtbarkeit] = useState<UserInfoSichtbarkeit>('friends')
  const [dauer, setDauer] = useState('forever')
  const [stunden, setStunden] = useState('1')
  const [ablauf, setAblauf] = useState<string | null>(null)
  const [geladen, setGeladen] = useState<{ text: string; sichtbarkeit: string; dauer: string; stunden: string } | null>(
    null,
  )

  useEffect(() => {
    let aktiv = true
    getOwnInfo()
      .then((info) => {
        if (!aktiv) return
        if (!info) {
          setGeladen({ text: '', sichtbarkeit: 'friends', dauer: 'forever', stunden: '1' })
          setAblauf(null)
          return
        }
        // Auch eine fremde Antwort wird geprüft: fehlt ein Feld, bleibt die
        // Karte bedienbar statt das ganze Profil abzureißen.
        const textWert = typeof info.text === 'string' ? info.text : ''
        const sichtbarkeitWert: UserInfoSichtbarkeit = SICHTBARKEITEN.includes(
          info.visibility as UserInfoSichtbarkeit,
        )
          ? (info.visibility as UserInfoSichtbarkeit)
          : 'friends'
        // Die ursprüngliche Dauer kennt der Server nicht mehr, nur den Ablauf.
        // Für die Auswahl nehmen wir die verbleibende Zeit in Stunden.
        const rest = info.expires_at
          ? Math.max(1, Math.ceil((Date.parse(info.expires_at) - Date.now()) / 3_600_000))
          : 0
        const gewaehlt = rest > 0 ? 'custom' : 'forever'
        setText(textWert)
        setSichtbarkeit(sichtbarkeitWert)
        setDauer(gewaehlt)
        setStunden(rest > 0 ? String(rest) : '1')
        setAblauf(info.expires_at ?? null)
        setGeladen({
          text: textWert,
          sichtbarkeit: sichtbarkeitWert,
          dauer: gewaehlt,
          stunden: rest > 0 ? String(rest) : '1',
        })
      })
      .catch(() => {})
      .finally(() => {
        if (aktiv) setLaedt(false)
      })
    return () => {
      aktiv = false
    }
  }, [])

  const sekunden = useMemo(() => {
    if (dauer === 'forever') return 0
    if (dauer === 'custom') {
      const wert = Math.round(Number(stunden))
      if (!Number.isFinite(wert) || wert <= 0) return -1
      return Math.min(wert, 365 * 24) * 3600
    }
    return DAUER_WERTE[dauer] ?? 0
  }, [dauer, stunden])

  const geaendert =
    geladen !== null &&
    (text.trim() !== geladen.text ||
      sichtbarkeit !== geladen.sichtbarkeit ||
      dauer !== geladen.dauer ||
      (dauer === 'custom' && stunden !== geladen.stunden))

  const sichtbarkeitOptionen: DropdownOption[] = SICHTBARKEITEN.map((wert) => ({
    value: wert,
    label: t(`social.info.visibility.${wert}`),
  }))

  const dauerOptionen: DropdownOption[] = [
    { value: 'h1', label: t('social.info.duration.h1') },
    { value: 'h8', label: t('social.info.duration.h8') },
    { value: 'd1', label: t('social.info.duration.d1') },
    { value: 'd2', label: t('social.info.duration.d2') },
    { value: 'w1', label: t('social.info.duration.w1') },
    { value: 'custom', label: t('social.info.duration.custom') },
    { value: 'forever', label: t('social.info.duration.forever') },
  ]

  const speichern = async () => {
    if (speichert || sekunden < 0) return
    setSpeichert(true)
    try {
      const gespeichert = await setOwnInfo({
        text: text.trim(),
        visibility: sichtbarkeit,
        dauer_sekunden: sekunden,
      })
      setAblauf(gespeichert?.expires_at ?? null)
      setGeladen({
        text: text.trim().slice(0, INFO_MAX_ZEICHEN),
        sichtbarkeit,
        dauer,
        stunden,
      })
      toast.success(gespeichert ? t('social.info.saved') : t('social.info.removed'))
    } catch {
      toast.error(t('social.info.failed'))
    } finally {
      setSpeichert(false)
    }
  }

  const entfernen = async () => {
    if (speichert) return
    setSpeichert(true)
    try {
      await setOwnInfo({ text: '', visibility: sichtbarkeit, dauer_sekunden: 0 })
      setText('')
      setAblauf(null)
      setDauer('forever')
      setGeladen({ text: '', sichtbarkeit, dauer: 'forever', stunden: '1' })
      toast.success(t('social.info.removed'))
    } catch {
      toast.error(t('social.info.failed'))
    } finally {
      setSpeichert(false)
    }
  }

  const restText = ablauf ? ablaufText(ablauf, t) : t('social.info.forever')
  const seit = ich?.created_at ? new Date(ich.created_at) : null
  const vorschauSeit = seit && !Number.isNaN(seit.getTime())
    ? seit.toLocaleDateString(i18n.language, { month: 'long', year: 'numeric' })
    : null

  const vorschauAktionen = (
    <>
      <span className={buttonClasses('primary', 'sm', 'pointer-events-none')} aria-hidden="true">
        <MessageSquare className="h-4 w-4" />
        <span>{t('social.profile.chat')}</span>
      </span>
      <span className={buttonClasses('secondary', 'sm', 'pointer-events-none')} aria-hidden="true">
        <Phone className="h-4 w-4" />
        <span>{t('social.profile.call')}</span>
      </span>
      <span className={buttonClasses('secondary', 'icon', 'pointer-events-none')} aria-hidden="true">
        <Video className="h-4 w-4" />
      </span>
    </>
  )

  return (
    <section className={`msm-card p-4 sm:p-5 ${className}`} aria-labelledby="info-karte-titel">
      <div className="flex items-center gap-2">
        <Info className="h-5 w-5 text-primary" aria-hidden="true" />
        <h2 id="info-karte-titel" className="font-headline text-title-lg font-semibold text-on-surface">
          {t('social.info.title')}
        </h2>
      </div>
      <p className="mt-1 text-sm text-on-surface-variant">{t('social.info.description')}</p>

      {laedt ? (
        <p className="mt-4 text-sm text-on-surface-variant">{t('common.loading')}</p>
      ) : (
        <div className="mt-4 grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,20rem),1fr))]">
          <div className="min-w-0 space-y-3">
            <Textarea
              value={text}
              maxLength={INFO_MAX_ZEICHEN}
              rows={3}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('social.info.placeholder')}
              aria-label={t('social.info.fieldLabel')}
            />
            <div className="flex flex-wrap items-center gap-1.5">
              {VORSCHLAEGE.map(({ key, emoji }) => {
                const vorschlag = `${emoji} ${t(`social.info.suggestion.${key}`)}`
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setText(vorschlag.slice(0, INFO_MAX_ZEICHEN))}
                    className="rounded-full border border-outline-variant/40 bg-surface-container-high/60 px-2.5 py-1 text-label-sm text-on-surface-variant transition-colors hover:border-primary/40 hover:text-primary"
                  >
                    {vorschlag}
                  </button>
                )
              })}
              <span className="ml-auto text-label-sm tabular-nums text-on-surface-variant/70">
                {text.length}/{INFO_MAX_ZEICHEN}
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="info-sichtbarkeit" className="mb-1.5 block text-label-sm uppercase tracking-wider text-on-surface-variant">
                  {t('social.info.visibility.label')}
                </label>
                <Dropdown
                  id="info-sichtbarkeit"
                  value={sichtbarkeit}
                  onChange={(wert) => setSichtbarkeit(wert as UserInfoSichtbarkeit)}
                  options={sichtbarkeitOptionen}
                  aria-label={t('social.info.visibility.label')}
                />
              </div>
              <div>
                <label htmlFor="info-dauer" className="mb-1.5 block text-label-sm uppercase tracking-wider text-on-surface-variant">
                  {t('social.info.duration.label')}
                </label>
                <Dropdown
                  id="info-dauer"
                  value={dauer}
                  onChange={setDauer}
                  options={dauerOptionen}
                  aria-label={t('social.info.duration.label')}
                />
              </div>
            </div>

            {dauer === 'custom' && (
              <div className="max-w-[12rem]">
                <label htmlFor="info-stunden" className="mb-1.5 block text-label-sm uppercase tracking-wider text-on-surface-variant">
                  {t('social.info.duration.customLabel')}
                </label>
                <Input
                  id="info-stunden"
                  type="number"
                  min={1}
                  max={8760}
                  value={stunden}
                  onChange={(e) => setStunden(e.target.value)}
                  aria-label={t('social.info.duration.customLabel')}
                />
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" onClick={() => void speichern()} disabled={speichert || !geaendert || sekunden < 0}>
                <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {speichert ? t('common.saving') : t('social.info.save')}
              </Button>
              {geladen?.text ? (
                <Button type="button" variant="secondary" onClick={() => void entfernen()} disabled={speichert}>
                  <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  {t('social.info.remove')}
                </Button>
              ) : null}
            </div>
          </div>

          <div className="min-w-0">
            <div className="rounded-xl border border-outline-variant/30 bg-surface-container-high/40 p-3">
              <p className="text-label-sm uppercase tracking-wider text-on-surface-variant/70">
                {t('social.info.preview')}
              </p>
              <p className="mt-1 text-xs text-on-surface-variant">{t('social.info.previewHint')}</p>
              <div
                className="pointer-events-none mt-3 select-none rounded-xl border border-outline-variant/30 bg-surface-container-low p-3"
                aria-hidden="true"
              >
                <ProfilKopf
                  username={ich?.username ?? ''}
                  avatarUrl={ich?.avatar_url}
                  status="online"
                  presence={{ client: 'web', device_type: 'web', activity_key: null }}
                  infoText={text.trim() || t('social.info.previewEmpty')}
                  infoVerborgen={sichtbarkeit === 'nobody'}
                  memberSince={vorschauSeit}
                  istFreund
                  funke={null}
                  actions={vorschauAktionen}
                  titleId="info-vorschau-name"
                  titleTag="h2"
                  kompakt
                />
              </div>
              <p className="mt-2 text-label-sm text-on-surface-variant">{restText}</p>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

/** „Läuft ab in 3 Stunden“ / „Gilt für immer“ — grob, aber verständlich. */
function ablaufText(ablauf: string, t: (schluessel: string, werte?: Record<string, unknown>) => string): string {
  const rest = Date.parse(ablauf) - Date.now()
  if (!Number.isFinite(rest) || rest <= 0) return t('social.info.forever')
  const minuten = Math.max(1, Math.round(rest / 60_000))
  if (minuten < 60) return t('social.info.expiresMinutes', { count: minuten })
  const stunden = Math.round(minuten / 60)
  if (stunden < 48) return t('social.info.expiresHours', { count: stunden })
  return t('social.info.expiresDays', { count: Math.round(stunden / 24) })
}
