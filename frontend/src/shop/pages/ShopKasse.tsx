import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ExternalLink, LogIn, ShieldCheck, UserPlus } from 'lucide-react'
import { Badge, Button, Dropdown, Spinner, Zustandsflaeche } from '@maunting/ui'
import {
  shopCatalogApi,
  shopOrderApi,
  type ShopCouponPreviewResponse,
  type ShopPublicPolicyDto,
} from '@/api/shop'
import { SanitizedApiError } from '@/api/client'
import { CaptchaWidget, captchaSperrt, type CaptchaStatus } from '@/components/app/CaptchaWidget'
import { still } from '@/lib/still'
import { useAuthStore } from '@/stores/authStore'
import { formatCpuLabel, formatEuro, preisAufschluesselung, RABATT_PROZENT } from '../preis'
import { standardKonfiguration, type KassenEntwurf, type LaufzeitMonate } from '../typen'
import { useShopKatalog } from '../useShopKatalog'

const EMAIL_MUSTER = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const APP_DEEPLINK_MUSTER = /^(maunting|msm):\/\/\S+$/i

export function ShopKasse() {
  const { spielId, addonId } = useParams()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { t, i18n } = useTranslation()
  const { tarifeFuer, addonFuer, loading } = useShopKatalog()
  const istAngemeldet = useAuthStore((s) => s.isAuthenticated)
  const user = useAuthStore((s) => s.user)

  const parsedAddonId = addonId ? Number(addonId) : null
  const istAddon = parsedAddonId !== null && Number.isFinite(parsedAddonId)
  const addon = istAddon && parsedAddonId ? addonFuer(parsedAddonId) : null

  const entwurf = (location.state as KassenEntwurf | null) ?? null
  const tarife = !istAddon && spielId ? tarifeFuer(spielId) : []
  const ausgewaehlt =
    tarife.find((tarif) => tarif.plan.id === entwurf?.tarifId) ?? tarife[0]
  const spiel = ausgewaehlt?.spiel
  const konfiguration =
    spiel && entwurf && entwurf.spielId === spiel.id
      ? entwurf.konfiguration
      : spiel
        ? standardKonfiguration(spiel)
        : null

  const queryCoupon = (searchParams.get('coupon') ?? '').trim().toUpperCase()
  const appReturn = (searchParams.get('app_return') ?? '').trim()

  const [addonMonate, setAddonMonate] = useState<LaufzeitMonate>(1)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [strasse, setStrasse] = useState('')
  const [plz, setPlz] = useState('')
  const [stadt, setStadt] = useState('')
  const [land, setLand] = useState('DE')
  const [gutscheinEingabe, setGutscheinEingabe] = useState(queryCoupon)
  const [gutscheinVorschau, setGutscheinVorschau] =
    useState<ShopCouponPreviewResponse | null>(null)
  const [gutscheinFehler, setGutscheinFehler] = useState('')
  const [gutscheinBusy, setGutscheinBusy] = useState(false)
  const [fehler, setFehler] = useState('')
  const [busy, setBusy] = useState(false)
  const [erfolg, setErfolg] = useState<string | null>(null)
  const [publicPolicy, setPublicPolicy] = useState<ShopPublicPolicyDto | null>(null)
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaStatus, setCaptchaStatus] = useState<CaptchaStatus>('disabled')
  const [captchaResetKey, setCaptchaResetKey] = useState(0)
  const istCheckoutCaptchaAktiv = Boolean(publicPolicy?.shop_checkout_captcha_enabled)

  useEffect(() => {
    let aktiv = true
    const fetchPolicy = shopCatalogApi.getPublicPolicy
    if (!fetchPolicy) return
    fetchPolicy()
      .then((policy) => {
        if (aktiv) setPublicPolicy(policy)
      })
      .catch((err) => {
        still(err, 'ShopKasse.getPublicPolicy')
      })
    return () => {
      aktiv = false
    }
  }, [])

  useEffect(() => {
    if (istAngemeldet && user?.email && !email) {
      setEmail(user.email)
    }
  }, [istAngemeldet, user?.email, email])

  const basisSumme = (() => {
    if (istAddon && addon) {
      const rabatt = RABATT_PROZENT[addonMonate]
      return Math.round(addon.price_cents * addonMonate * (1 - rabatt / 100))
    }
    if (spiel && konfiguration) {
      return preisAufschluesselung(
        spiel,
        konfiguration,
        publicPolicy?.subscription_discount_percent ?? 0,
      ).gesamtCent
    }
    return 0
  })()

  useEffect(() => {
    if (!queryCoupon || basisSumme <= 0) return
    const previewFn = shopCatalogApi.previewCoupon
    if (!previewFn) return
    let aktiv = true
    void previewFn({
      code: queryCoupon,
      kind: istAddon ? 'addon' : 'plan',
      plan_id: !istAddon && ausgewaehlt?.plan.id ? ausgewaehlt.plan.id : null,
      gross_cents: basisSumme,
    })
      .then((res) => {
        if (!aktiv) return
        if (res.valid) {
          setGutscheinVorschau(res)
          setGutscheinFehler('')
        } else {
          setGutscheinVorschau(null)
          setGutscheinFehler(res.reason || t('shop.kasse.gutscheinFehler'))
        }
      })
      .catch((err: unknown) => {
        still(err, 'shopKasse.queryCouponPreview')
      })
    return () => {
      aktiv = false
    }
  }, [queryCoupon, basisSumme, istAddon, ausgewaehlt?.plan.id, t])

  const hatProdukt = istAddon ? Boolean(addon) : Boolean(spiel && konfiguration)

  if (!hatProdukt) {
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
  const gutscheinAbzug = gutscheinVorschau?.valid ? gutscheinVorschau.discount_cents : 0
  const endSumme = Math.max(0, basisSumme - gutscheinAbzug)
  const zurueckLink = istAddon ? '/#shop-addons' : `/shop/${spiel!.id}`
  const redirectZiel = encodeURIComponent(`${location.pathname}${location.search}`)

  const gutscheinPruefen = async () => {
    const code = gutscheinEingabe.trim().toUpperCase()
    if (!code || gutscheinBusy) return
    const previewFn = shopCatalogApi.previewCoupon
    if (!previewFn) return
    setGutscheinBusy(true)
    setGutscheinFehler('')
    try {
      const planId = ausgewaehlt?.plan.id ?? null
      const res = await previewFn({
        code,
        kind: istAddon ? 'addon' : 'plan',
        plan_id: !istAddon && planId && planId > 0 ? planId : null,
        gross_cents: basisSumme,
      })
      if (res.valid) {
        setGutscheinVorschau(res)
      } else {
        setGutscheinVorschau(null)
        setGutscheinFehler(res.reason || t('shop.kasse.gutscheinFehler'))
      }
    } catch (err) {
      still(err, 'shopKasse.previewCoupon')
      setGutscheinVorschau(null)
      setGutscheinFehler(t('shop.kasse.gutscheinFehler'))
    } finally {
      setGutscheinBusy(false)
    }
  }

  const absenden = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !istAngemeldet) return

    if (!email.trim()) {
      setFehler(t('shop.kasse.emailFehlt'))
      return
    }
    if (!EMAIL_MUSTER.test(email.trim())) {
      setFehler(t('shop.kasse.emailUngueltig'))
      return
    }
    if (!name.trim() || !strasse.trim() || !plz.trim() || !stadt.trim()) {
      setFehler(t('shop.kasse.adresseFehlt'))
      return
    }
    if (istCheckoutCaptchaAktiv && captchaSperrt(captchaStatus)) {
      setFehler(t('shop.kasse.captchaFehlt'))
      return
    }

    setFehler('')
    setBusy(true)

    try {
      const billingMode = istAddon ? 'prepaid' : (konfiguration!.abrechnungsModus ?? 'prepaid')
      const baseOrderPayload = {
        months: istAddon
          ? addonMonate
          : billingMode === 'lifetime'
            ? (1 as const)
            : konfiguration!.laufzeitMonate,
        billing_mode: billingMode,
        ...(gutscheinVorschau?.valid ? { coupon_code: gutscheinVorschau.code } : {}),
        ...(istCheckoutCaptchaAktiv ? { captcha_token: captchaToken } : {}),
        buyer_name: name.trim(),
        buyer_street: strasse.trim(),
        buyer_postal_code: plz.trim(),
        buyer_city: stadt.trim(),
        buyer_country: land,
        buyer_email: email.trim(),
      }

      const order = await shopOrderApi.createOrder(
        istAddon && addon
          ? { ...baseOrderPayload, addon_id: addon.id }
          : {
              ...baseOrderPayload,
              plan_id: ausgewaehlt!.plan.id,
              ram_mb: konfiguration!.ramGb * 1024,
              cpu: konfiguration!.cpu,
              slots: konfiguration!.slots,
            },
      )

      try {
        const stripe = await shopOrderApi.checkout(
          order.id,
          appReturn ? { return_url: appReturn } : undefined,
        )
        window.location.assign(stripe.checkout_url)
        return
      } catch (error) {
        if (!(error instanceof SanitizedApiError) || error.status !== 409) {
          throw error
        }
      }
      const bezahlt = await shopOrderApi.payDemo(order.id)
      setErfolg(bezahlt.number)
    } catch (err) {
      still(err, 'shopKasse.absenden')
      if (istCheckoutCaptchaAktiv) {
        setCaptchaToken('')
        setCaptchaResetKey((prev) => prev + 1)
      }
      setFehler(err instanceof SanitizedApiError ? err.message : t('shop.kasse.fehler'))
    } finally {
      setBusy(false)
    }
  }

  if (erfolg) {
    return (
      <section className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
        <div
          role="status"
          className="msm-card rounded-2xl border border-primary/30 bg-surface-container-low/90 p-8 text-center"
        >
          <Badge variant="success">{t('shop.kasse.bezahltBadge')}</Badge>
          <h1 className="mt-4 font-headline text-2xl font-extrabold text-on-surface">
            {t('shop.kasse.erfolgEchtTitel')}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">
            {t('shop.kasse.erfolgEchtText')}
          </p>
          <p className="mt-4 font-mono text-sm text-primary">{erfolg}</p>
          <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
            {APP_DEEPLINK_MUSTER.test(appReturn) && (
              <a
                href={appReturn}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-on-primary"
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                {t('shop.kasse.zurueckApp')}
              </a>
            )}
            <Link
              to="/konto/bestellungen"
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-on-primary"
            >
              {t('shop.kasse.zurBestellung')}
            </Link>
            <Link
              to="/dashboard"
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-outline-variant/40 px-4 text-sm font-semibold text-on-surface"
            >
              {t('shop.kasse.zumPanel')}
            </Link>
            <Link
              to={zurueckLink}
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
        to={zurueckLink}
        className="inline-flex items-center gap-2 rounded-lg text-sm font-medium text-on-surface-variant hover:text-on-surface focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t('shop.kasse.zurueck')}
      </Link>

      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="info" className="gap-1">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              {t('shop.kasse.stripeSicherBadge')}
            </Badge>
            <h1 className="font-headline text-2xl font-extrabold text-on-surface">
              {t('shop.kasse.titel')}
            </h1>
          </div>

          {!istAngemeldet ? (
            <div className="msm-card space-y-4 rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 p-6">
              <h2 className="font-headline text-lg font-bold text-on-surface">
                {t('shop.kasse.anmeldungTitel')}
              </h2>
              <p className="text-sm leading-relaxed text-on-surface-variant">
                {t('shop.kasse.anmeldungText')}
              </p>
              <div className="flex flex-wrap gap-3">
                <Link
                  to={`/login?redirect=${redirectZiel}`}
                  className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-on-primary"
                >
                  <LogIn className="h-4 w-4" aria-hidden="true" />
                  {t('shop.kopf.anmelden')}
                </Link>
                <Link
                  to={`/register?redirect=${redirectZiel}`}
                  className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-outline-variant/40 px-4 text-sm font-semibold text-on-surface"
                >
                  <UserPlus className="h-4 w-4" aria-hidden="true" />
                  {t('shop.kopf.registrieren')}
                </Link>
              </div>
            </div>
          ) : (
            <form
              noValidate
              onSubmit={absenden}
              className="msm-card space-y-4 rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 p-5"
            >
              {istAddon && (
                <div className="space-y-2 border-b border-outline-variant/30 pb-4">
                  <span className="block text-sm font-semibold text-on-surface">
                    {t('shop.kasse.laufzeit')}
                  </span>
                  <div className="grid grid-cols-3 gap-2">
                    {([1, 3, 12] as LaufzeitMonate[]).map((monate) => (
                      <button
                        key={monate}
                        type="button"
                        onClick={() => setAddonMonate(monate)}
                        className={`rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
                          addonMonate === monate
                            ? 'border-primary/60 bg-primary/15 text-primary'
                            : 'border-outline-variant/40 bg-surface-container text-on-surface-variant hover:text-on-surface'
                        }`}
                      >
                        {t('shop.spiel.monate', { count: monate })}
                      </button>
                    ))}
                  </div>
                </div>
              )}

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

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <label htmlFor="kasse-name" className="block text-sm font-semibold text-on-surface">
                    {t('shop.kasse.name')}
                  </label>
                  <input
                    id="kasse-name"
                    autoComplete="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="msm-input w-full"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <label htmlFor="kasse-strasse" className="block text-sm font-semibold text-on-surface">
                    {t('shop.kasse.strasse')}
                  </label>
                  <input
                    id="kasse-strasse"
                    autoComplete="street-address"
                    value={strasse}
                    onChange={(event) => setStrasse(event.target.value)}
                    className="msm-input w-full"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="kasse-plz" className="block text-sm font-semibold text-on-surface">
                    {t('shop.kasse.plz')}
                  </label>
                  <input
                    id="kasse-plz"
                    autoComplete="postal-code"
                    value={plz}
                    onChange={(event) => setPlz(event.target.value)}
                    className="msm-input w-full"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="kasse-stadt" className="block text-sm font-semibold text-on-surface">
                    {t('shop.kasse.stadt')}
                  </label>
                  <input
                    id="kasse-stadt"
                    autoComplete="address-level2"
                    value={stadt}
                    onChange={(event) => setStadt(event.target.value)}
                    className="msm-input w-full"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <span className="block text-sm font-semibold text-on-surface">
                    {t('shop.kasse.land')}
                  </span>
                  <Dropdown
                    value={land}
                    onChange={setLand}
                    aria-label={t('shop.kasse.land')}
                    options={[
                      { value: 'DE', label: 'Deutschland' },
                      { value: 'AT', label: 'Österreich' },
                      { value: 'CH', label: 'Schweiz' },
                    ]}
                  />
                </div>
              </div>

              <p className="text-label-sm text-on-surface-variant">
                {t('shop.kasse.adresseHinweis')}
              </p>
              <p className="rounded-xl border border-outline-variant/30 bg-surface-container px-3.5 py-2.5 text-xs leading-relaxed text-on-surface-variant">
                {t('shop.kasse.zahlungsHinweis')}
              </p>

              <div className="rounded-xl border border-outline-variant/30 bg-surface-container/60 px-3.5 py-2.5 text-xs leading-relaxed text-on-surface-variant space-y-1">
                <p className="font-medium text-on-surface">
                  {istAddon || (konfiguration?.abrechnungsModus ?? 'prepaid') === 'prepaid'
                    ? t('shop.kasse.prepaidHinweis')
                    : konfiguration?.abrechnungsModus === 'lifetime'
                      ? t('shop.kasse.lifetimeHinweis')
                      : t('shop.kasse.aboHinweis')}
                </p>
                {(publicPolicy?.refund_guarantee_days ?? 0) > 0 && (
                  <p>
                    {t('shop.kasse.erstattungHinweis', { tage: publicPolicy!.refund_guarantee_days })}
                    {publicPolicy?.refund_policy_note ? ` ${publicPolicy.refund_policy_note}` : ''}
                  </p>
                )}
              </div>

              {istCheckoutCaptchaAktiv && (
                <div className="rounded-xl border border-outline-variant/30 bg-surface-container p-3.5">
                  <CaptchaWidget
                    scope="shop"
                    onVerify={setCaptchaToken}
                    onStatusChange={setCaptchaStatus}
                    resetKey={captchaResetKey}
                  />
                </div>
              )}

              {fehler && (
                <p role="alert" className="text-sm font-medium text-status-destructive">
                  {fehler}
                </p>
              )}

              <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
                {busy ? t('shop.kasse.laeuft') : t('shop.kasse.zahlen')}
              </Button>
            </form>
          )}
        </div>

        <aside className="msm-card space-y-4 rounded-2xl border border-outline-variant/30 bg-surface-container-low/90 p-5 lg:sticky lg:top-24 lg:self-start">
          <h2 className="font-headline text-lg font-bold text-on-surface">
            {t('shop.kasse.zusammenfassung')}
          </h2>

          {istAddon && addon ? (
            <>
              <p className="text-sm text-on-surface-variant">
                {addon.description || t('shop.addons.standardBeschreibung')}
              </p>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-on-surface-variant">{t('shop.kasse.produkt')}</dt>
                  <dd className="text-on-surface">{addon.name}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-on-surface-variant">{t('shop.kasse.laufzeit')}</dt>
                  <dd className="text-on-surface">
                    {t('shop.spiel.monate', { count: addonMonate })}
                  </dd>
                </div>
                {gutscheinVorschau?.valid && (
                  <div className="flex justify-between gap-3 text-status-success">
                    <dt>
                      {t('shop.kasse.gutscheinAbzug', { code: gutscheinVorschau.code })}
                    </dt>
                    <dd>-{formatEuro(gutscheinAbzug)}</dd>
                  </div>
                )}
              </dl>
            </>
          ) : (
            spiel &&
            konfiguration && (
              <>
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
                    <dd className="text-on-surface">{formatCpuLabel(konfiguration.cpu, sprache)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-on-surface-variant">{t('shop.kasse.slots')}</dt>
                    <dd className="text-on-surface">{konfiguration.slots}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-on-surface-variant">{t('shop.kasse.zahlungsartLabel')}</dt>
                    <dd className="text-on-surface">
                      {(konfiguration.abrechnungsModus ?? 'prepaid') === 'prepaid'
                        ? t('shop.konto.abos.typPrepaid')
                        : konfiguration.abrechnungsModus === 'lifetime'
                          ? t('shop.konto.abos.typLifetime')
                          : t('shop.konto.abos.typAbo')}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-on-surface-variant">{t('shop.kasse.laufzeit')}</dt>
                    <dd className="text-on-surface">
                      {konfiguration.abrechnungsModus === 'lifetime'
                        ? t('shop.preis.einmalig')
                        : t('shop.spiel.monate', { count: konfiguration.laufzeitMonate })}
                    </dd>
                  </div>
                  {gutscheinVorschau?.valid && (
                    <div className="flex justify-between gap-3 text-status-success">
                      <dt>
                        {t('shop.kasse.gutscheinAbzug', { code: gutscheinVorschau.code })}
                      </dt>
                      <dd>-{formatEuro(gutscheinAbzug)}</dd>
                    </div>
                  )}
                </dl>
              </>
            )
          )}

          {istAngemeldet && (
            <div className="space-y-2 border-t border-outline-variant/30 pt-3">
              <label
                htmlFor="kasse-gutschein"
                className="block text-xs font-semibold text-on-surface"
              >
                {t('shop.kasse.gutscheinLabel')}
              </label>
              <div className="flex gap-2">
                <input
                  id="kasse-gutschein"
                  value={gutscheinEingabe}
                  onChange={(event) =>
                    setGutscheinEingabe(event.target.value.toUpperCase())
                  }
                  placeholder={t('shop.kasse.gutscheinPlatzhalter')}
                  className="msm-input w-full"
                />
                {gutscheinVorschau?.valid ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setGutscheinVorschau(null)
                      setGutscheinEingabe('')
                    }}
                  >
                    {t('shop.kasse.gutscheinEntfernen')}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={gutscheinBusy || !gutscheinEingabe.trim()}
                    onClick={() => void gutscheinPruefen()}
                  >
                    {t('shop.kasse.gutscheinPruefen')}
                  </Button>
                )}
              </div>
              {gutscheinFehler && (
                <p className="text-xs text-status-destructive">{gutscheinFehler}</p>
              )}
            </div>
          )}

          <div className="border-t border-outline-variant/30 pt-3">
            <div className="flex items-end justify-between gap-3">
              <span className="text-sm font-semibold text-on-surface">
                {t('shop.kasse.summe')}
              </span>
              <span className="font-headline text-2xl font-extrabold tabular-nums text-primary">
                {formatEuro(endSumme)}
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
