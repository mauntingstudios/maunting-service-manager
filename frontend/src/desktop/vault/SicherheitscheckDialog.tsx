import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ShieldAlert, ShieldCheck, WifiOff } from 'lucide-react'
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, ProgressBar } from '@maunting/ui'
import { checkPasswordLeak, isLeakCheckEnabled, leakCheckGewaehlt, MIN_LEAK_CHECK_PASSWORD_LENGTH } from './leakChecker'
import type { VaultItem } from './vaultEintrag'

export interface SicherheitscheckErgebnis {
  geprueft: number
  gefunden: number
}

interface SicherheitscheckDialogProps {
  offen: boolean
  onSchliessen: () => void
  eintraege: VaultItem[]
  onFertig: (ergebnis: SicherheitscheckErgebnis) => void
}

const ZUGLEICH = 3

type Lage = 'aus' | 'offline' | 'leer' | 'laeuft' | 'fertig'

export function SicherheitscheckDialog({ offen, onSchliessen, eintraege, onFertig }: SicherheitscheckDialogProps) {
  const { t } = useTranslation()
  const [lage, setLage] = useState<Lage>('leer')
  const [geprueft, setGeprueft] = useState(0)
  const [treffer, setTreffer] = useState<{ item: VaultItem; count: number }[]>([])
  const laufRef = useRef(0)

  const zuPruefen = eintraege.filter((item) => item.password.length >= MIN_LEAK_CHECK_PASSWORD_LENGTH)

  useEffect(() => {
    if (!offen) return
    const lauf = ++laufRef.current
    setTreffer([])
    setGeprueft(0)

    if (!leakCheckGewaehlt()) {
      setLage('aus')
      return
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setLage('offline')
      return
    }
    if (!isLeakCheckEnabled()) {
      setLage('aus')
      return
    }
    if (zuPruefen.length === 0) {
      setLage('leer')
      return
    }

    setLage('laeuft')
    let naechster = 0
    let erledigt = 0
    let wirklichGeprueft = 0
    let gefunden = 0
    const gefundene: { item: VaultItem; count: number }[] = []

    const arbeiter = async () => {
      while (laufRef.current === lauf) {
        const index = naechster++
        if (index >= zuPruefen.length) return
        const item = zuPruefen[index]
        const ergebnis = await checkPasswordLeak(item.password)
        if (laufRef.current !== lauf) return
        if (!ergebnis.checked) {
          // Ein einzelner Fehlversuch sagt nichts über das Passwort. Er zählt
          // nicht als geprüft, sonst behauptete die Zahl „0 Treffer“.
          erledigt += 1
          setGeprueft(erledigt)
          continue
        }
        erledigt += 1
        wirklichGeprueft += 1
        if (ergebnis.isLeaked) {
          gefunden += 1
          gefundene.push({ item, count: ergebnis.count })
          setTreffer([...gefundene])
        }
        setGeprueft(erledigt)
      }
    }

    void Promise.all(Array.from({ length: Math.min(ZUGLEICH, zuPruefen.length) }, arbeiter)).then(() => {
      if (laufRef.current !== lauf) return
      // Kein einziger Aufruf kam durch (Netz weg, Dienst antwortet nicht):
      // dann ist nichts geprüft, und die Übersicht behauptet auch nichts.
      if (wirklichGeprueft === 0) {
        setLage('offline')
        return
      }
      setLage('fertig')
      onFertig({ geprueft: wirklichGeprueft, gefunden })
    })

    return () => {
      laufRef.current += 1
    }
    // Die Liste wird beim Öffnen einmal gelesen; ein Sync während des Laufs
    // startet keinen zweiten Lauf.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offen])

  const gesamt = zuPruefen.length

  return (
    <Dialog open={offen} onOpenChange={(naechste) => !naechste && onSchliessen()}>
      <DialogContent className="max-w-md">
        <DialogHeader className="px-5 py-4 pr-14">
          <div className="flex items-center gap-2.5">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-xl ${
                lage === 'fertig' && treffer.length === 0 ? 'bg-status-success/15 text-status-success' : 'bg-status-warning/15 text-status-warning'
              }`}
            >
              {lage === 'fertig' && treffer.length === 0 ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
            </div>
            <DialogTitle className="text-sm">{t('mss.vault.dashboard.sicherheitscheck')}</DialogTitle>
          </div>
        </DialogHeader>

        <div className="space-y-3 p-5">
          {lage === 'aus' && <p className="text-sm text-on-surface-variant">{t('mss.vault.dashboard.sicherheitscheckAus')}</p>}
          {lage === 'offline' && (
            <p className="flex items-center gap-2 text-sm text-on-surface-variant">
              <WifiOff className="h-4 w-4 shrink-0" />
              {t('mss.vault.dashboard.sicherheitscheckOffline')}
            </p>
          )}
          {lage === 'leer' && <p className="text-sm text-on-surface-variant">{t('mss.vault.dashboard.sicherheitscheckKeine')}</p>}

          {lage === 'laeuft' && (
            <>
              <p className="text-sm text-on-surface" role="status">
                {t('mss.vault.dashboard.sicherheitscheckLaeuft', { geprueft, gesamt })}
              </p>
              <ProgressBar value={gesamt ? Math.round((geprueft / gesamt) * 100) : 0} ariaLabel={t('mss.vault.dashboard.sicherheitscheck')} />
            </>
          )}

          {lage === 'fertig' && (
            <p className="text-sm text-on-surface" role="status">
              {t('mss.vault.dashboard.sicherheitscheckFertig', { geprueft })}
            </p>
          )}

          {treffer.length > 0 && (
            <ul className="divide-y divide-outline-variant/25 overflow-hidden rounded-xl border border-status-destructive/30 bg-status-destructive/5">
              {treffer.map(({ item, count }) => (
                <li key={item.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="min-w-0 truncate text-sm text-on-surface">{item.service}</span>
                  <span className="shrink-0 text-label-sm text-status-destructive">
                    {t('mss.vault.leckGefunden', { count, anzahl: count.toLocaleString() })}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {lage === 'fertig' && treffer.length === 0 && (
            <p className="flex items-center gap-2 rounded-xl border border-status-success/30 bg-status-success/5 px-3 py-2 text-sm text-status-success">
              <ShieldCheck className="h-4 w-4 shrink-0" />
              {t('mss.vault.dashboard.lecksKeine')}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" size="sm" onClick={onSchliessen}>
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
