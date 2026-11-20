import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge, Zustandsflaeche } from '@maunting/ui'
import { shopApi } from '../../api/shopApi'
import type { PaymentMethod } from '../../api/types'

export function KontoZahlungsmethoden() {
  const { t } = useTranslation()
  const [methoden, setMethoden] = useState<PaymentMethod[] | null>(null)

  useEffect(() => {
    let aktiv = true
    void shopApi.listPaymentMethods().then((rows) => {
      if (aktiv) setMethoden(rows)
    })
    return () => {
      aktiv = false
    }
  }, [])

  if (methoden === null) {
    return <p className="text-sm text-on-surface-variant">{t('shop.konto.laedt')}</p>
  }

  if (methoden.length === 0) {
    return (
      <Zustandsflaeche
        art="leer"
        titel={t('shop.konto.zahlungsmethoden.leer')}
        text={t('shop.konto.zahlungsmethoden.leerText')}
      />
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-headline text-lg font-bold text-on-surface">
          {t('shop.konto.zahlungsmethoden.titel')}
        </h2>
        <Badge variant="warning">{t('shop.konto.demo')}</Badge>
      </div>
      {methoden.map((methode) => (
        <div
          key={methode.id}
          className="msm-card flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 p-4"
        >
          <div>
            <p className="font-headline text-sm font-semibold text-on-surface">
              {methode.bezeichnung}
            </p>
            <p className="mt-1 text-xs text-on-surface-variant">
              {methode.art === 'card' ? t('shop.konto.zahlungsmethoden.karte') : t('shop.konto.zahlungsmethoden.sepa')}
            </p>
          </div>
          {methode.standard && <Badge variant="info">{t('shop.konto.zahlungsmethoden.standard')}</Badge>}
        </div>
      ))}
      <p className="text-xs text-on-surface-variant">
        {t('shop.konto.zahlungsmethoden.stripeFolgt')}
      </p>
    </div>
  )
}
