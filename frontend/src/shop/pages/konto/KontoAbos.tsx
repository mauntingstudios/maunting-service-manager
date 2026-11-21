import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Badge, Button, Zustandsflaeche } from '@maunting/ui'
import { shopApi } from '../../api/shopApi'
import type { Entitlement, Subscription } from '../../api/types'
import { formatEuro } from '../../preis'

export function KontoAbos() {
  const { t } = useTranslation()
  const [abos, setAbos] = useState<{ subscriptions: Subscription[]; entitlements: Entitlement[] } | null>(null)
  const [bestaetigeAboId, setBestaetigeAboId] = useState<string | null>(null)
  const [laufendAboId, setLaufendAboId] = useState<string | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)

  useEffect(() => {
    let aktiv = true
    void Promise.all([shopApi.listSubscriptions(), shopApi.listEntitlements()])
      .then(([subscriptions, entitlements]) => {
        if (aktiv) setAbos({ subscriptions, entitlements })
      })
      .catch(() => {
        if (aktiv) setAbos({ subscriptions: [], entitlements: [] })
      })
    return () => {
      aktiv = false
    }
  }, [])

  async function kuendigenAusfuehren(aboId: string) {
    setFehler(null)
    setLaufendAboId(aboId)
    try {
      const aktualisiert = await shopApi.cancelSubscription(aboId)
      setAbos((prev) =>
        prev
          ? {
              ...prev,
              subscriptions: prev.subscriptions.map((s) =>
                s.id === aboId ? aktualisiert : s,
              ),
            }
          : prev,
      )
      setBestaetigeAboId(null)
    } catch {
      setFehler(t('shop.konto.abos.kuendigenFehler'))
    } finally {
      setLaufendAboId(null)
    }
  }

  if (abos === null) {
    return <p className="text-sm text-on-surface-variant">{t('shop.konto.laedt')}</p>
  }

  if (abos.subscriptions.length === 0 && abos.entitlements.length === 0) {
    return (
      <Zustandsflaeche
        art="leer"
        titel={t('shop.konto.abos.leer')}
        text={t('shop.konto.abos.leerText')}
      />
    )
  }

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <h2 className="font-headline text-lg font-bold text-on-surface">
          {t('shop.konto.abos.titel')}
        </h2>
        {fehler && (
          <p role="alert" className="text-sm text-status-destructive">
            {fehler}
          </p>
        )}
        {abos.subscriptions.map((abo) => (
          <div
            key={abo.id}
            className="msm-card flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 p-4"
          >
            <div>
              <p className="font-headline text-sm font-semibold text-on-surface">{abo.bezeichnung}</p>
              <p className="mt-1 text-xs text-on-surface-variant">
                {t('shop.konto.abos.naechsteZahlung', { datum: abo.naechsteZahlung })}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {abo.cancelAtPeriodEnd && abo.status !== 'cancelled' && (
                <Badge variant="warning">
                  {t('shop.konto.abos.kuendigungVorgemerkt')}
                </Badge>
              )}
              <Badge variant={abo.status === 'active' ? 'success' : abo.status === 'past_due' ? 'warning' : 'default'}>
                {abo.status === 'active'
                  ? t('shop.konto.status.aboActive')
                  : abo.status === 'past_due'
                    ? t('shop.konto.status.aboPastDue')
                    : t('shop.konto.status.aboCancelled')}
              </Badge>
              <span className="font-headline text-sm font-bold tabular-nums text-primary">
                {formatEuro(abo.preisCent)}
              </span>
              {abo.status !== 'cancelled' && !abo.cancelAtPeriodEnd && (
                bestaetigeAboId === abo.id ? (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={laufendAboId === abo.id}
                      onClick={() => void kuendigenAusfuehren(abo.id)}
                    >
                      {t('shop.konto.abos.kuendigenBestaetigen')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={laufendAboId === abo.id}
                      onClick={() => setBestaetigeAboId(null)}
                    >
                      {t('shop.konto.abos.abbrechen')}
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setFehler(null)
                      setBestaetigeAboId(abo.id)
                    }}
                  >
                    {t('shop.konto.abos.kuendigen')}
                  </Button>
                )
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <h2 className="font-headline text-lg font-bold text-on-surface">
          {t('shop.konto.abos.entitlements')}
        </h2>
        {abos.entitlements.map((entitlement) => (
          <div
            key={entitlement.id}
            className="msm-card flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 p-4"
          >
            <div>
              <p className="font-headline text-sm font-semibold text-on-surface">
                {entitlement.bezeichnung}
              </p>
              <p className="mt-1 text-xs text-on-surface-variant">
                {entitlement.art === 'server'
                  ? t('shop.konto.abos.artServer')
                  : entitlement.art === 'rolle'
                    ? t('shop.konto.abos.artRolle')
                    : t('shop.konto.abos.artAddon')}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {entitlement.art === 'server' &&
                entitlement.serverId != null &&
                entitlement.status === 'active' && (
                  <Link
                    to={`/servers/${entitlement.serverId}`}
                    className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
                  >
                    {t('shop.konto.abos.serverOeffnen')}
                  </Link>
                )}
              {entitlement.status === 'active' &&
                entitlement.provisioningStatus === 'failed' && (
                  <Badge variant="destructive">
                    {t('shop.konto.abos.bereitstellungFehlgeschlagen')}
                  </Badge>
                )}
              <Badge
                variant={
                  entitlement.status === 'active'
                    ? 'success'
                    : entitlement.status === 'suspended'
                      ? 'warning'
                      : 'default'
                }
              >
                {entitlement.status === 'active'
                  ? t('shop.konto.status.entitlementActive')
                  : entitlement.status === 'suspended'
                    ? t('shop.konto.status.entitlementSuspended')
                    : t('shop.konto.status.entitlementRevoked')}
              </Badge>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
