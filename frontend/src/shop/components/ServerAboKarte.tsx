import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Users } from 'lucide-react'
import { Badge, Button, Spinner, Zustandsflaeche } from '@maunting/ui'
import {
  shopOrderApi,
  type ShopServerPlayersDto,
  type ShopServerSubscriptionDto,
} from '@/api/shop'
import { useHasPermission } from '@/hooks/useHasPermission'
import { still } from '@/lib/still'
import { formatEuro } from '../preis'

interface ServerAboKarteProps {
  serverId: number
}

export function ServerAboKarte({ serverId }: ServerAboKarteProps) {
  const { t } = useTranslation()
  const canEditSlots =
    useHasPermission('shop.write') || useHasPermission('panel.settings.write')
  const [daten, setDaten] = useState<ShopServerSubscriptionDto | null>(null)
  const [spieler, setSpieler] = useState<ShopServerPlayersDto | null>(null)
  const [laedt, setLaedt] = useState(true)
  const [fehler, setFehler] = useState(false)
  const [slotEingabe, setSlotEingabe] = useState('')
  const [slotBusy, setSlotBusy] = useState(false)
  const [slotStatus, setSlotStatus] = useState('')
  const [slotWarnung, setSlotWarnung] = useState(false)
  const [pauseBusy, setPauseBusy] = useState(false)
  const [pauseFehler, setPauseFehler] = useState('')

  useEffect(() => {
    let aktiv = true
    setLaedt(true)
    setFehler(false)
    setSlotStatus('')
    setSlotWarnung(false)

    void shopOrderApi
      .getServerSubscription(serverId)
      .then((res) => {
        if (!aktiv) return
        setDaten(res)
        setSlotEingabe(res.slots ? String(res.slots) : '')
        setLaedt(false)
      })
      .catch((err: unknown) => {
        still(err, 'serverAboKarte.subscription')
        if (!aktiv) return
        setFehler(true)
        setLaedt(false)
      })

    if (shopOrderApi.getServerPlayers) {
      void shopOrderApi
        .getServerPlayers(serverId)
        .then((res) => {
          if (aktiv) setSpieler(res)
        })
        .catch((err: unknown) => {
          still(err, 'serverAboKarte.players')
          if (aktiv) setSpieler(null)
        })
    }

    return () => {
      aktiv = false
    }
  }, [serverId])

  if (laedt) {
    return (
      <section className="msm-card flex items-center gap-3 rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 p-5">
        <Spinner size="sm" />
        <span className="text-sm text-on-surface-variant">{t('shop.konto.laedt')}</span>
      </section>
    )
  }

  if (fehler) {
    return (
      <Zustandsflaeche
        art="fehler"
        titel={t('shop.serverAbo.titel')}
        text={t('shop.serverAbo.ladefehler')}
      />
    )
  }

  if (!daten || !daten.has_subscription) {
    return (
      <Zustandsflaeche
        art="leer"
        titel={t('shop.serverAbo.keinesTitel')}
        text={t('shop.serverAbo.keinesText')}
      />
    )
  }

  const abo = daten.subscription
  const ent = daten.entitlement
  const status = abo?.status ?? ent?.status ?? 'active'
  const zielSlots = Number(slotEingabe)
  const istDowngrade =
    daten.slots !== null && Number.isInteger(zielSlots) && zielSlots > 0 && zielSlots < daten.slots

  const slotsSpeichern = async () => {
    if (!Number.isInteger(zielSlots) || zielSlots < 1 || zielSlots > 1000 || slotBusy) return
    const updateFn = shopOrderApi.updateServerSlots
    if (!updateFn) return
    setSlotBusy(true)
    setSlotStatus('')
    setSlotWarnung(false)
    try {
      const res = await updateFn(serverId, zielSlots)
      setDaten((vorher) => (vorher ? { ...vorher, slots: res.slots } : vorher))
      setSlotEingabe(String(res.slots))
      setSlotWarnung(res.downgrade_warning)
      setSlotStatus(
        res.restart_required
          ? t('shop.serverAbo.slotsNeustart')
          : t('shop.serverAbo.slotsGespeichert'),
      )
    } catch (err) {
      still(err, 'serverAboKarte.updateSlots')
      setSlotStatus(t('shop.serverAbo.slotsFehler'))
    } finally {
      setSlotBusy(false)
    }
  }

  const togglePause = async () => {
    if (!ent || pauseBusy) return
    const fn = ent.paused_at ? shopOrderApi.resumeEntitlement : shopOrderApi.pauseEntitlement
    if (!fn) return
    setPauseBusy(true)
    setPauseFehler('')
    try {
      const updated = await fn(ent.id)
      setDaten((vorher) => (vorher ? { ...vorher, entitlement: updated } : vorher))
    } catch (err) {
      still(err, 'serverAboKarte.togglePause')
      setPauseFehler(t('shop.konto.abos.pauseFehler'))
    } finally {
      setPauseBusy(false)
    }
  }

  return (
    <section className="msm-card space-y-4 rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-headline text-lg font-bold text-on-surface">
            {t('shop.serverAbo.titel')}
          </h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            {t('shop.serverAbo.untertitel', { id: serverId })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {spieler?.online && spieler.players !== null && (
            <Badge
              variant={spieler.slot_exceeded ? 'warning' : 'info'}
              className="gap-1 tabular-nums"
            >
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              {t('shop.serverAbo.liveSpieler', {
                aktiv: spieler.players,
                max: spieler.booked_slots ?? spieler.max_players ?? daten.slots ?? '—',
              })}
            </Badge>
          )}
          {abo?.billing_mode === 'lifetime' && (
            <Badge variant="info">{t('shop.konto.abos.typLifetime')}</Badge>
          )}
          {ent?.paused_at && (
            <Badge variant="warning">{t('shop.konto.abos.pausiertStatus')}</Badge>
          )}
          {abo?.cancel_at_period_end && abo.status !== 'cancelled' && (
            <Badge variant="warning">{t('shop.konto.abos.kuendigungVorgemerkt')}</Badge>
          )}
          <Badge
            variant={
              status === 'active'
                ? 'success'
                : status === 'past_due' || status === 'suspended'
                  ? 'warning'
                  : 'default'
            }
          >
            {status === 'active'
              ? t('shop.konto.status.aboActive')
              : status === 'past_due'
                ? t('shop.konto.status.aboPastDue')
                : status === 'suspended'
                  ? t('shop.konto.status.entitlementSuspended')
                  : t('shop.konto.status.aboCancelled')}
          </Badge>
        </div>
      </div>

      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-outline-variant/30 bg-surface-container p-3">
          <dt className="text-xs text-on-surface-variant">{t('shop.serverAbo.tarif')}</dt>
          <dd className="mt-1 text-sm font-semibold text-on-surface">
            {abo?.name ?? ent?.label ?? t('shop.serverAbo.tarifName')}
          </dd>
        </div>
        <div className="rounded-xl border border-outline-variant/30 bg-surface-container p-3">
          <dt className="text-xs text-on-surface-variant">{t('shop.serverAbo.ressourcen')}</dt>
          <dd className="mt-1 text-sm font-semibold text-on-surface">
            {daten.ram_mb ? `${Math.round(daten.ram_mb / 1024)} GB RAM` : '—'}
            {daten.slots ? ` · ${daten.slots} Slots` : ''}
          </dd>
        </div>
        <div className="rounded-xl border border-outline-variant/30 bg-surface-container p-3">
          <dt className="text-xs text-on-surface-variant">{t('shop.serverAbo.naechsteZahlung')}</dt>
          <dd className="mt-1 text-sm font-semibold text-on-surface">
            {abo
              ? abo.billing_mode === 'lifetime'
                ? t('shop.konto.abos.lebenslangGueltig')
                : `${abo.current_period_end.slice(0, 10)} · ${formatEuro(abo.monthly_gross_cents)}`
              : '—'}
          </dd>
        </div>
      </dl>

      {canEditSlots && daten.slots !== null && (
        <div className="space-y-2 rounded-xl border border-outline-variant/30 bg-surface-container p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label
              htmlFor={`server-slots-${serverId}`}
              className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant"
            >
              {t('shop.serverAbo.slotsAnpassen')}
            </label>
            <div className="flex items-center gap-2">
              <input
                id={`server-slots-${serverId}`}
                type="number"
                min={1}
                max={1000}
                value={slotEingabe}
                onChange={(e) => setSlotEingabe(e.target.value)}
                className="msm-input w-24 text-right tabular-nums"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={slotBusy || !Number.isInteger(zielSlots) || zielSlots < 1 || zielSlots > 1000}
                onClick={() => void slotsSpeichern()}
              >
                {t('shop.serverAbo.slotsSpeichern')}
              </Button>
            </div>
          </div>
          {(istDowngrade || slotWarnung) && (
            <p className="flex items-center gap-1.5 text-xs text-status-warning">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t('shop.serverAbo.slotsDowngradeWarnung')}
            </p>
          )}
          {slotStatus && <p className="text-xs text-primary">{slotStatus}</p>}
        </div>
      )}

      {pauseFehler && <p className="text-xs text-status-destructive">{pauseFehler}</p>}

      <div className="flex flex-wrap gap-2">
        {ent && ent.status === 'active' && (
          <>
            <Link
              to={`/servers/${serverId}?action=switch`}
              className="inline-flex min-h-9 items-center rounded-lg border border-outline-variant/40 px-3 text-sm font-semibold text-on-surface hover:bg-surface-container-high"
            >
              {t('shop.konto.abos.spielWechseln')}
            </Link>
            {typeof shopOrderApi.pauseEntitlement === 'function' &&
              typeof shopOrderApi.resumeEntitlement === 'function' && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={pauseBusy}
                onClick={() => void togglePause()}
              >
                {ent.paused_at
                  ? t('shop.konto.abos.fortsetzen')
                  : t('shop.konto.abos.pausieren')}
              </Button>
            )}
          </>
        )}
        <Link
          to="/konto/abos"
          className="inline-flex min-h-9 items-center rounded-lg border border-outline-variant/40 px-3 text-sm font-semibold text-on-surface hover:bg-surface-container-high"
        >
          {t('shop.serverAbo.aboAnsehen')}
        </Link>
        <Link
          to="/konto/rechnungen"
          className="inline-flex min-h-9 items-center rounded-lg border border-outline-variant/40 px-3 text-sm font-semibold text-on-surface hover:bg-surface-container-high"
        >
          {t('shop.konto.nav.rechnungen')}
        </Link>
      </div>
    </section>
  )
}
