import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock } from 'lucide-react'
import { Button, Input, Spinner, Switch } from '@maunting/ui'
import { SanitizedApiError } from '@/api/client'
import {
  shopAdminOpsApi,
  type ShopLifecycleSettingsDto,
} from '@/api/shop'
import { still } from '@/lib/still'
import { toast } from '@/stores/toastStore'

const DEFAULT_SETTINGS: ShopLifecycleSettingsDto = {
  cancel_grace_days: 7,
  unpaid_auto_delete_enabled: true,
  unpaid_delete_days: 30,
  allow_customer_immediate_delete: true,
  dunning_reminder_days: [7, 4, 1],
}

function parseReminderList(raw: string): number[] {
  const seen = new Set<number>()
  for (const part of raw.split(/[\s,;]+/)) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const num = Number(trimmed)
    if (Number.isInteger(num) && num >= 1 && num <= 365) {
      seen.add(num)
    }
  }
  return Array.from(seen).sort((a, b) => b - a).slice(0, 10)
}

export function ShopLifecycleKarte() {
  const { t } = useTranslation()
  const [daten, setDaten] = useState<ShopLifecycleSettingsDto>(DEFAULT_SETTINGS)
  const [reminderInput, setReminderInput] = useState('7, 4, 1')
  const [laedt, setLaedt] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let aktiv = true
    void shopAdminOpsApi
      .getLifecycleSettings()
      .then((werte) => {
        if (!aktiv) return
        if (werte && typeof werte.cancel_grace_days === 'number') {
          setDaten(werte)
          setReminderInput((werte.dunning_reminder_days ?? []).join(', '))
        }
        setLaedt(false)
      })
      .catch((err: unknown) => {
        still(err, 'shopLifecycle.load')
        if (aktiv) setLaedt(false)
      })
    return () => {
      aktiv = false
    }
  }, [])

  const speichern = async () => {
    if (busy) return
    setBusy(true)
    const payload: ShopLifecycleSettingsDto = {
      ...daten,
      dunning_reminder_days: parseReminderList(reminderInput),
    }
    try {
      const gespeichert = await shopAdminOpsApi.updateLifecycleSettings(payload)
      setDaten(gespeichert)
      setReminderInput((gespeichert.dunning_reminder_days ?? []).join(', '))
      toast.success(t('settings.shop.lifecycle.gespeichert'))
    } catch (error) {
      toast.error(
        error instanceof SanitizedApiError
          ? error.message
          : t('settings.shop.lifecycle.fehler'),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="msm-card rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/15 text-primary">
            <Clock className="h-4 w-4" aria-hidden="true" />
          </span>
          <h3 className="font-headline text-base font-semibold text-on-surface">
            {t('settings.shop.lifecycle.titel')}
          </h3>
        </div>
        {laedt && <Spinner size="sm" />}
      </div>

      <p className="mt-3 text-sm leading-relaxed text-on-surface-variant">
        {t('settings.shop.lifecycle.text')}
      </p>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <label className="block space-y-1.5">
            <span className="block text-sm font-semibold text-on-surface">
              {t('settings.shop.lifecycle.cancelGraceDays')}
            </span>
            <Input
              type="number"
              min={0}
              max={365}
              value={String(daten.cancel_grace_days)}
              onChange={(e) =>
                setDaten((alt) => ({
                  ...alt,
                  cancel_grace_days: Math.max(0, Math.min(365, Number(e.target.value) || 0)),
                }))
              }
            />
          </label>
          <p className="text-xs text-on-surface-variant">
            {t('settings.shop.lifecycle.cancelGraceDaysHint')}
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="block space-y-1.5">
            <span className="block text-sm font-semibold text-on-surface">
              {t('settings.shop.lifecycle.unpaidDeleteDays')}
            </span>
            <Input
              type="number"
              min={1}
              max={365}
              disabled={!daten.unpaid_auto_delete_enabled}
              value={String(daten.unpaid_delete_days)}
              onChange={(e) =>
                setDaten((alt) => ({
                  ...alt,
                  unpaid_delete_days: Math.max(1, Math.min(365, Number(e.target.value) || 1)),
                }))
              }
            />
          </label>
          <p className="text-xs text-on-surface-variant">
            {t('settings.shop.lifecycle.unpaidDeleteDaysHint')}
          </p>
        </div>

        <div className="space-y-1.5 md:col-span-2">
          <label className="block space-y-1.5">
            <span className="block text-sm font-semibold text-on-surface">
              {t('settings.shop.lifecycle.dunningReminderDays')}
            </span>
            <Input
              value={reminderInput}
              onChange={(e) => setReminderInput(e.target.value)}
              placeholder="7, 4, 1"
            />
          </label>
          <p className="text-xs text-on-surface-variant">
            {t('settings.shop.lifecycle.dunningReminderDaysHint')}
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <div className="flex items-start gap-3">
          <Switch
            checked={daten.unpaid_auto_delete_enabled}
            onCheckedChange={(checked) =>
              setDaten((alt) => ({ ...alt, unpaid_auto_delete_enabled: checked }))
            }
            aria-label={t('settings.shop.lifecycle.unpaidAutoDelete')}
          />
          <div>
            <span className="block text-sm font-medium text-on-surface">
              {t('settings.shop.lifecycle.unpaidAutoDelete')}
            </span>
            <p className="text-xs text-on-surface-variant">
              {t('settings.shop.lifecycle.unpaidAutoDeleteHint')}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <Switch
            checked={daten.allow_customer_immediate_delete}
            onCheckedChange={(checked) =>
              setDaten((alt) => ({ ...alt, allow_customer_immediate_delete: checked }))
            }
            aria-label={t('settings.shop.lifecycle.allowCustomerImmediateDelete')}
          />
          <div>
            <span className="block text-sm font-medium text-on-surface">
              {t('settings.shop.lifecycle.allowCustomerImmediateDelete')}
            </span>
            <p className="text-xs text-on-surface-variant">
              {t('settings.shop.lifecycle.allowCustomerImmediateDeleteHint')}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <Button variant="primary" onClick={() => void speichern()} disabled={busy}>
          {t('settings.shop.lifecycle.speichern')}
        </Button>
      </div>
    </section>
  )
}
