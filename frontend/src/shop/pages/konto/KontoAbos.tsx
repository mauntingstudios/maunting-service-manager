import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Badge, Button, Input, Zustandsflaeche } from '@maunting/ui'
import { SanitizedApiError } from '@/api/client'
import { shopApi } from '../../api/shopApi'
import type {
  Entitlement,
  GraceBackup,
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
  const [extendingAboId, setExtendingAboId] = useState<string | null>(null)
  const [verlaengertInfo, setVerlaengertInfo] = useState<string | null>(null)
  const [openBackupsEntId, setOpenBackupsEntId] = useState<string | null>(null)
  const [backupsByEnt, setBackupsByEnt] = useState<Record<string, GraceBackup[]>>({})
  const [backupsLoadingId, setBackupsLoadingId] = useState<string | null>(null)
  const [backupsErrorId, setBackupsErrorId] = useState<string | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)

  const neuladen = async () => {
    const [subscriptions, entitlements] = await Promise.all([
      shopApi.listSubscriptions(),
      shopApi.listEntitlements(),
    ])
    setAbos({ subscriptions, entitlements })
  }

  async function verlaengernAusfuehren(abo: Subscription) {
    if (!shopApi.extendSubscription || extendingAboId) return
    setFehler(null)
    setVerlaengertInfo(null)
    setExtendingAboId(abo.id)
    try {
      const ergebnis = await shopApi.extendSubscription(abo.id, 1)
      if (ergebnis.checkoutUrl) {
        window.location.assign(ergebnis.checkoutUrl)
        return
      }
      await neuladen()
      setVerlaengertInfo(t('shop.konto.abos.verlaengertErfolg'))
    } catch (error) {
      setFehler(
        error instanceof SanitizedApiError
          ? error.message
          : t('shop.konto.abos.verlaengernFehler'),
      )
    } finally {
      setExtendingAboId(null)
    }
  }

  async function toggleBackups(entId: string) {
    if (openBackupsEntId === entId) {
      setOpenBackupsEntId(null)
      return
    }
    setOpenBackupsEntId(entId)
    if (backupsByEnt[entId] || !shopApi.listEntitlementBackups) return
    setBackupsErrorId(null)
    setBackupsLoadingId(entId)
    try {
      const rows = await shopApi.listEntitlementBackups(entId)
      setBackupsByEnt((prev) => ({ ...prev, [entId]: rows }))
    } catch {
      setBackupsErrorId(entId)
    } finally {
      setBackupsLoadingId(null)
    }
  }

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
        {verlaengertInfo && (
          <p role="status" className="text-sm text-status-success">
            {verlaengertInfo}
          </p>
        )}
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
                  <Badge variant="default">
                    {(abo.billingMode ?? 'subscription') === 'prepaid'
                      ? t('shop.konto.abos.typPrepaid')
                      : t('shop.konto.abos.typAbo')}
                  </Badge>
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
                  {abo.status !== 'cancelled' &&
                    (abo.billingMode === 'prepaid' || abo.cancelAtPeriodEnd) &&
                    shopApi.extendSubscription && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={extendingAboId === abo.id}
                        onClick={() => void verlaengernAusfuehren(abo)}
                      >
                        {extendingAboId === abo.id
                          ? t('shop.konto.abos.verlaengernLaeuft')
                          : t('shop.konto.abos.verlaengern')}
                      </Button>
                    )}
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
                  {entitlement.art === 'server' &&
                    entitlement.serverId != null &&
                    !isPurged &&
                    shopApi.listEntitlementBackups && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void toggleBackups(entitlement.id)}
                      >
                        {openBackupsEntId === entitlement.id
                          ? t('shop.konto.abos.weltBackupsSchliessen')
                          : t('shop.konto.abos.weltBackupsLaden')}
                      </Button>
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

              {openBackupsEntId === entitlement.id && (
                <div className="space-y-2 rounded-xl border border-outline-variant/30 bg-surface-container p-3 text-xs">
                  {backupsLoadingId === entitlement.id ? (
                    <p className="text-on-surface-variant">{t('common.loading')}</p>
                  ) : backupsErrorId === entitlement.id ? (
                    <p role="alert" className="text-status-destructive">
                      {t('shop.konto.abos.weltBackupsFehler')}
                    </p>
                  ) : (backupsByEnt[entitlement.id] ?? []).filter((b) => b.downloadable).length === 0 ? (
                    <p className="text-on-surface-variant">{t('shop.konto.abos.weltBackupsLeer')}</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {(backupsByEnt[entitlement.id] ?? [])
                        .filter((b) => b.downloadable)
                        .map((backup) => (
                          <li key={backup.id} className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-medium text-on-surface">
                              {backup.name}
                              {backup.sizeMb != null ? ` (${backup.sizeMb} MB)` : ''}
                            </span>
                            {shopApi.entitlementBackupDownloadUrl && (
                              <a
                                href={shopApi.entitlementBackupDownloadUrl(entitlement.id, backup.id)}
                                download
                                className="rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/20"
                              >
                                {t('shop.konto.abos.weltBackupHerunterladen')}
                              </a>
                            )}
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              )}

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
