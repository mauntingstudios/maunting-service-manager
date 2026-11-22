import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Badge, Button, Input, Zustandsflaeche } from '@maunting/ui'
import { SanitizedApiError } from '@/api/client'
import { shopApi } from '../../api/shopApi'
import type {
  Entitlement,
  Subscription,
  SubscriptionDeletionMode,
} from '../../api/types'
import { formatEuro } from '../../preis'

export function KontoAbos() {
  const { t } = useTranslation()
  const [abos, setAbos] = useState<{ subscriptions: Subscription[]; entitlements: Entitlement[] } | null>(null)
  const [bestaetigeAboId, setBestaetigeAboId] = useState<string | null>(null)
  const [deletionMode, setDeletionMode] = useState<SubscriptionDeletionMode>('grace_period')
  const [confirmServerName, setConfirmServerName] = useState('')
  const [laufendAboId, setLaufendAboId] = useState<string | null>(null)
  const [purgeEntId, setPurgeEntId] = useState<string | null>(null)
  const [purgeConfirmName, setPurgeConfirmName] = useState('')
  const [laufendPurgeId, setLaufendPurgeId] = useState<string | null>(null)
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

  async function kuendigenAusfuehren(abo: Subscription) {
    setFehler(null)
    setLaufendAboId(abo.id)
    try {
      const aktualisiert = await shopApi.cancelSubscription(
        abo.id,
        deletionMode === 'grace_period'
          ? undefined
          : {
              deletionMode,
              confirmServerName: confirmServerName.trim() || undefined,
            },
      )
      setAbos((prev) =>
        prev
          ? {
              ...prev,
              subscriptions: prev.subscriptions.map((s) =>
                s.id === abo.id ? aktualisiert : s,
              ),
              entitlements:
                deletionMode === 'immediate' && abo.serverEntitlementId != null
                  ? prev.entitlements.map((e) =>
                      e.id === String(abo.serverEntitlementId)
                        ? {
                            ...e,
                            status: 'revoked',
                            serverId: undefined,
                            provisioningStatus: 'purged',
                            purgeAfter: null,
                            canCustomerPurgeNow: false,
                          }
                        : e,
                    )
                  : prev.entitlements,
            }
          : prev,
      )
      setBestaetigeAboId(null)
      setDeletionMode('grace_period')
      setConfirmServerName('')
    } catch (err) {
      setFehler(
        err instanceof SanitizedApiError
          ? err.message
          : t('shop.konto.abos.kuendigenFehler'),
      )
    } finally {
      setLaufendAboId(null)
    }
  }

  async function entitlementSofortLoeschen(ent: Entitlement) {
    setFehler(null)
    setLaufendPurgeId(ent.id)
    try {
      const aktualisiert = await shopApi.purgeEntitlementNow(
        ent.id,
        purgeConfirmName.trim(),
      )
      setAbos((prev) =>
        prev
          ? {
              ...prev,
              entitlements: prev.entitlements.map((e) =>
                e.id === ent.id ? aktualisiert : e,
              ),
            }
          : prev,
      )
      setPurgeEntId(null)
      setPurgeConfirmName('')
    } catch (err) {
      setFehler(
        err instanceof SanitizedApiError
          ? err.message
          : t('shop.konto.abos.sofortLoeschenFehler'),
      )
    } finally {
      setLaufendPurgeId(null)
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
        {abos.subscriptions.map((abo) => {
          const confirmMismatch =
            deletionMode === 'immediate' &&
            Boolean(abo.serverName) &&
            confirmServerName.trim() !== abo.serverName?.trim()
          return (
            <div
              key={abo.id}
              className="msm-card space-y-3 rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-headline text-sm font-semibold text-on-surface">{abo.bezeichnung}</p>
                  <p className="mt-1 text-xs text-on-surface-variant">
                    {t('shop.konto.abos.naechsteZahlung', { datum: abo.naechsteZahlung })}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {abo.cancelAtPeriodEnd && abo.status !== 'cancelled' && (
                    <Badge variant="warning">
                      {abo.deleteServerOnEnd
                        ? t('shop.konto.abos.sofortLoeschungZumLaufzeitende')
                        : t('shop.konto.abos.kuendigungVorgemerkt')}
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
                  {abo.status !== 'cancelled' && !abo.cancelAtPeriodEnd && bestaetigeAboId !== abo.id && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setFehler(null)
                        setDeletionMode('grace_period')
                        setConfirmServerName('')
                        setBestaetigeAboId(abo.id)
                      }}
                    >
                      {t('shop.konto.abos.kuendigen')}
                    </Button>
                  )}
                </div>
              </div>

              {abo.status !== 'cancelled' && !abo.cancelAtPeriodEnd && bestaetigeAboId === abo.id && (
                <div className="space-y-3 rounded-xl border border-outline-variant/30 bg-surface-container p-3">
                  <div className="space-y-2 text-xs text-on-surface">
                    <label className="flex cursor-pointer items-start gap-2">
                      <input
                        type="radio"
                        name={`cancel-mode-${abo.id}`}
                        checked={deletionMode === 'grace_period'}
                        onChange={() => {
                          setDeletionMode('grace_period')
                          setConfirmServerName('')
                        }}
                      />
                      <span>
                        <span className="block font-semibold">{t('shop.konto.abos.modusGrace')}</span>
                        <span className="text-on-surface-variant">{t('shop.konto.abos.modusGraceHinweis')}</span>
                      </span>
                    </label>
                    <label className="flex cursor-pointer items-start gap-2">
                      <input
                        type="radio"
                        name={`cancel-mode-${abo.id}`}
                        checked={deletionMode === 'end_of_period_immediate'}
                        onChange={() => {
                          setDeletionMode('end_of_period_immediate')
                          setConfirmServerName('')
                        }}
                      />
                      <span className="font-semibold">{t('shop.konto.abos.modusEndOfPeriod')}</span>
                    </label>
                    {abo.canImmediateDelete && abo.serverName && (
                      <label className="flex cursor-pointer items-start gap-2">
                        <input
                          type="radio"
                          name={`cancel-mode-${abo.id}`}
                          checked={deletionMode === 'immediate'}
                          onChange={() => setDeletionMode('immediate')}
                        />
                        <span>
                          <span className="block font-semibold text-status-destructive">
                            {t('shop.konto.abos.modusImmediate')}
                          </span>
                          <span className="text-on-surface-variant">
                            {t('shop.konto.abos.modusImmediateHinweis')}
                          </span>
                        </span>
                      </label>
                    )}
                  </div>

                  {deletionMode === 'immediate' && abo.serverName && (
                    <div className="space-y-2 rounded-lg border border-status-destructive/30 bg-status-destructive/10 p-2.5 text-xs">
                      <p className="text-status-destructive">
                        {t('shop.konto.abos.sofortLoeschenWarnung')}
                      </p>
                      <label className="block space-y-1">
                        <span className="block font-medium text-on-surface">
                          {t('shop.konto.abos.serverNameBestaetigenLabel', {
                            name: abo.serverName,
                          })}
                        </span>
                        <Input
                          value={confirmServerName}
                          onChange={(e) => setConfirmServerName(e.target.value)}
                          placeholder={abo.serverName}
                          aria-label={t('shop.konto.abos.serverNameBestaetigenLabel', {
                            name: abo.serverName,
                          })}
                        />
                      </label>
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={laufendAboId === abo.id || confirmMismatch}
                      onClick={() => void kuendigenAusfuehren(abo)}
                    >
                      {t('shop.konto.abos.kuendigenBestaetigen')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={laufendAboId === abo.id}
                      onClick={() => {
                        setBestaetigeAboId(null)
                        setDeletionMode('grace_period')
                        setConfirmServerName('')
                      }}
                    >
                      {t('shop.konto.abos.abbrechen')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="space-y-3">
        <h2 className="font-headline text-lg font-bold text-on-surface">
          {t('shop.konto.abos.entitlements')}
        </h2>
        {abos.entitlements.map((entitlement) => {
          const isPurged =
            entitlement.provisioningStatus === 'purged' || Boolean(entitlement.purgedAt)
          const purgeDateLabel = entitlement.purgeAfter
            ? entitlement.purgeAfter.slice(0, 10)
            : null
          const purgeNameMismatch =
            Boolean(entitlement.serverName) &&
            purgeConfirmName.trim() !== entitlement.serverName?.trim()
          return (
            <div
              key={entitlement.id}
              className="msm-card space-y-3 rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
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
                  {purgeDateLabel && !isPurged && (
                    <p
                      className={
                        entitlement.purgeReason === 'unpaid'
                          ? 'mt-1 text-xs text-status-warning'
                          : 'mt-1 text-xs text-on-surface-variant'
                      }
                    >
                      {entitlement.purgeReason === 'unpaid'
                        ? t('shop.konto.abos.zahlungsfristBis', { datum: purgeDateLabel })
                        : t('shop.konto.abos.loeschungAm', { datum: purgeDateLabel })}
                    </p>
                  )}
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
                  {entitlement.status === 'suspended' &&
                    entitlement.purgeReason === 'unpaid' && (
                      <Link
                        to="/konto/zahlungsmethoden"
                        className="rounded-lg border border-status-warning/40 bg-status-warning/10 px-3 py-1 text-xs font-medium text-status-warning transition-colors hover:bg-status-warning/20"
                      >
                        {t('shop.konto.abos.zahlungsmethodePruefen')}
                      </Link>
                    )}
                  {entitlement.canCustomerPurgeNow &&
                    entitlement.serverName &&
                    purgeEntId !== entitlement.id && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => {
                          setFehler(null)
                          setPurgeConfirmName('')
                          setPurgeEntId(entitlement.id)
                        }}
                      >
                        {t('shop.konto.abos.jetztSofortLoeschen')}
                      </Button>
                    )}
                  {entitlement.status === 'active' &&
                    entitlement.provisioningStatus === 'failed' && (
                      <Badge variant="destructive">
                        {t('shop.konto.abos.bereitstellungFehlgeschlagen')}
                      </Badge>
                    )}
                  {isPurged && (
                    <Badge variant="default">
                      {t('shop.konto.abos.endgueltigGeloescht')}
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

              {purgeEntId === entitlement.id && entitlement.serverName && (
                <div className="space-y-2 rounded-xl border border-status-destructive/30 bg-status-destructive/10 p-3 text-xs">
                  <p className="text-status-destructive">
                    {t('shop.konto.abos.sofortLoeschenWarnung')}
                  </p>
                  <label className="block space-y-1">
                    <span className="block font-medium text-on-surface">
                      {t('shop.konto.abos.serverNameBestaetigenLabel', {
                        name: entitlement.serverName,
                      })}
                    </span>
                    <Input
                      value={purgeConfirmName}
                      onChange={(e) => setPurgeConfirmName(e.target.value)}
                      placeholder={entitlement.serverName}
                      aria-label={t('shop.konto.abos.serverNameBestaetigenLabel', {
                        name: entitlement.serverName,
                      })}
                    />
                  </label>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={laufendPurgeId === entitlement.id || purgeNameMismatch}
                      onClick={() => void entitlementSofortLoeschen(entitlement)}
                    >
                      {t('shop.konto.abos.sofortLoeschenBestaetigen')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={laufendPurgeId === entitlement.id}
                      onClick={() => {
                        setPurgeEntId(null)
                        setPurgeConfirmName('')
                      }}
                    >
                      {t('shop.konto.abos.abbrechen')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
