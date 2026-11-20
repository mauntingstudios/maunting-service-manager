import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import { Badge, Button, Spinner, Zustandsflaeche } from '@maunting/ui'
import { formatEuro, preisAufschluesselung } from '../preis'
import { standardKonfiguration } from '../typen'
import type { KassenEntwurf } from '../typen'
import { useShopKatalog } from '../useShopKatalog'

const EMAIL_MUSTER = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function ShopKasse() {
  const { spielId } = useParams()
  const location = useLocation()
  const { t, i18n } = useTranslation()
  const { tarifeFuer, loading } = useShopKatalog()
  const entwurf = (location.state as KassenEntwurf | null) ?? null
  const tarife = spielId ? tarifeFuer(spielId) : []
  const ausgewaehlt =
    tarife.find((tarif) => tarif.plan.id === entwurf?.tarifId) ?? tarife[0]
  const spiel = ausgewaehlt?.spiel
  const konfiguration =
    spiel && entwurf && entwurf.spielId === spiel.id
      ? entwurf.konfiguration
      : spiel
        ? standardKonfiguration(spiel)
        : null

  const [email, setEmail] = useState('')
  const [karte, setKarte] = useState('')
  const [fehler, setFehler] = useState('')
  const [busy, setBusy] = useState(false)
  const [erfolg, setErfolg] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [])

  if (!spiel || !konfiguration) {
    if (loading) {
      return (
        <section className="mx-auto flex max-w-3xl items-center justify-center gap-3 px-4 py-20 text-sm text-on-surface-variant">
          <Spinner size="sm" />
          {t('shop.spiel.laedt')}
        </section>
      )
    }
    return (
      <section className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
        <Zustandsflaeche
          art="fehler"
          titel={t('shop.spiel.nichtGefundenTitel')}
          text={t('shop.spiel.nichtGefundenText')}
        />
        <div className="mt-6 text-center">
          <Link to="/" className="text-sm font-semibold text-primary hover:underline">
            {t('shop.spiel.zurueck')}
          </Link>
        </div>
      </section>
    )
  }

  const sprache = i18n.language.startsWith('de') ? 'de' : 'en'
  const preis = preisAufschluesselung(spiel, konfiguration)

  const absenden = (event: FormEvent) => {
    event.preventDefault()
    if (busy) return

    if (!email.trim()) {
      setFehler(t('shop.kasse.emailFehlt'))
      return
    }
    if (!EMAIL_MUSTER.test(email.trim())) {
      setFehler(t('shop.kasse.emailUngueltig'))
      return
    }
    if (karte.replace(/\D/g, '').length < 12) {
      setFehler(t('shop.kasse.karteFehlt'))
      return
    }

    setFehler('')
    setBusy(true)
    timer.current = window.setTimeout(() => {
      const nummer = `MSM-DEMO-${Math.floor(100000 + Math.random() * 900000)}`
      setErfolg(nummer)
      setBusy(false)
    }, 700)
  }

  if (erfolg) {
    return (
      <section className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
        <div
          role="status"
          className="msm-card rounded-2xl border border-primary/30 bg-surface-container-low/90 p-8 text-center"
        >
          <Badge variant="warning">{t('shop.kasse.demoBadge')}</Badge>
          <h1 className="mt-4 font-headline text-2xl font-extrabold text-on-surface">
            {t('shop.kasse.erfolgTitel')}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">
            {t('shop.kasse.erfolgText')}
          </p>
          <p className="mt-4 font-mono text-sm text-primary">{erfolg}</p>
          <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
            <Link
              to="/dashboard"
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-on-primary"
            >
              {t('shop.kasse.zumPanel')}
            </Link>
            <Link
              to={`/shop/${spiel.id}`}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-outline-variant/40 px-4 text-sm font-semibold text-on-surface"
            >
              {t('shop.kasse.zurueck')}
            </Link>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
      <Link
        to={`/shop/${spiel.id}`}
        className="inline-flex items-center gap-2 rounded-lg text-sm font-medium text-on-surface-variant hover:text-on-surface focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t('shop.kasse.zurueck')}
      </Link>

      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="warning">{t('shop.kasse.demoBadge')}</Badge>
            <h1 className="font-headline text-2xl font-extrabold text-on-surface">
              {t('shop.kasse.titel')}
            </h1>
          </div>
          {!entwurf && (
            <p className="rounded-lg border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-xs text-on-surface-variant">
              {t('shop.kasse.fehltDaten')}
            </p>
          )}

          <form noValidate onSubmit={absenden} className="msm-card space-y-4 rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 p-5">
            <div className="space-y-1.5">
              <label htmlFor="kasse-email" className="block text-sm font-semibold text-on-surface">
                {t('shop.kasse.email')}
              </label>
              <input
                id="kasse-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={t('shop.kasse.emailPlatzhalter')}
                className="msm-input w-full"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="kasse-karte" className="block text-sm font-semibold text-on-surface">
                {t('shop.kasse.karte')}
              </label>
              <input
                id="kasse-karte"
                inputMode="numeric"
                autoComplete="cc-number"
                value={karte}
                onChange={(event) => setKarte(event.target.value)}
                placeholder={t('shop.kasse.kartePlatzhalter')}
                className="msm-input w-full"
              />
              <p className="text-label-sm text-on-surface-variant">
                {t('shop.kasse.karteHinweis')}
              </p>
            </div>

            {fehler && (
              <p role="alert" className="text-sm font-medium text-status-destructive">
                {fehler}
              </p>
            )}

            <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
              {busy ? t('shop.kasse.laeuft') : t('shop.kasse.zahlen')}
            </Button>
          </form>
        </div>

        <aside className="msm-card space-y-4 rounded-2xl border border-outline-variant/30 bg-surface-container-low/90 p-5 lg:sticky lg:top-24 lg:self-start">
          <h2 className="font-headline text-lg font-bold text-on-surface">
            {t('shop.kasse.zusammenfassung')}
          </h2>
          <p className="text-sm text-on-surface-variant">{spiel.beschreibung[sprache]}</p>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-on-surface-variant">{t('shop.kasse.spiel')}</dt>
              <dd className="text-on-surface">{spiel.name}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-on-surface-variant">{t('shop.kasse.ram')}</dt>
              <dd className="text-on-surface">{konfiguration.ramGb} GB</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-on-surface-variant">{t('shop.kasse.cpu')}</dt>
              <dd className="text-on-surface">{konfiguration.cpu}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-on-surface-variant">{t('shop.kasse.slots')}</dt>
              <dd className="text-on-surface">{konfiguration.slots}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-on-surface-variant">{t('shop.kasse.laufzeit')}</dt>
              <dd className="text-on-surface">
                {t('shop.spiel.monate', { count: konfiguration.laufzeitMonate })}
              </dd>
            </div>
          </dl>
          <div className="border-t border-outline-variant/30 pt-3">
            <div className="flex items-end justify-between gap-3">
              <span className="text-sm font-semibold text-on-surface">
                {t('shop.kasse.summe')}
              </span>
              <span className="font-headline text-2xl font-extrabold tabular-nums text-primary">
                {formatEuro(preis.gesamtCent)}
              </span>
            </div>
            <p className="mt-1 text-right text-label-sm text-on-surface-variant">
              {t('shop.preis.inklusiveSteuer')}
            </p>
          </div>
        </aside>
      </div>
    </section>
  )
}
