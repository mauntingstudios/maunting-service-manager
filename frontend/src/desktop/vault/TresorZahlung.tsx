/**
 * Zahlungskarten und Bankkonten im Tresor. Nummer und IBAN stehen verdeckt
 * da; aufgedeckt wird je Eintrag für ein paar Sekunden, wie bei Passwörtern.
 */
import { useMemo, useState } from 'react'
import { Check, Copy, CreditCard, Eye, EyeOff, Landmark, Pencil, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge, Button, Kurzinfo, Zustandsflaeche } from '@maunting/ui'
import { toast } from '@/stores/toastStore'

import { fehlerText } from './tresorFehler'
import type { VaultItem } from './vaultEintrag'
import { useVaultStore } from './vaultStore'
import { ZahlungDialog, type ZahlungArt } from './ZahlungDialog'
import { ablaufText, istAbgelaufen, kartenmarke, nummerGruppiert, verdeckt, zahlungsmittel, type ZahlungAngaben } from './zahlung'

const AUFGEDECKT_MS = 5000

export function ZahlungSymbol({ zahlung, className }: { zahlung?: ZahlungAngaben; className?: string }) {
  const Symbol = zahlung?.art === 'konto' ? Landmark : CreditCard
  return <Symbol className={className} aria-hidden="true" />
}

export function TresorZahlung({ suche }: { suche: string }) {
  const { t } = useTranslation()
  const items = useVaultStore((s) => s.items)
  const liste = useMemo(() => zahlungsmittel(items, suche), [items, suche])
  const [dialog, setDialog] = useState<{ art: ZahlungArt; item?: VaultItem } | null>(null)
  const [offen, setOffen] = useState<string | null>(null)
  const [kopiert, setKopiert] = useState<string | null>(null)

  const aufdecken = (id: string) => {
    if (offen === id) return setOffen(null)
    setOffen(id)
    setTimeout(() => setOffen((jetzt) => (jetzt === id ? null : jetzt)), AUFGEDECKT_MS)
  }

  const kopieren = async (text: string, schluessel: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setKopiert(schluessel)
      setTimeout(() => setKopiert((jetzt) => (jetzt === schluessel ? null : jetzt)), 1500)
      toast.success(t('mss.vault.kopiert'))
    } catch {
      toast.error(t('mss.vault.kopierenFehlgeschlagen'))
    }
  }

  const wegwerfen = async (item: VaultItem) => {
    const vault = useVaultStore.getState()
    try {
      await vault.trashItem(item.id)
      toast.success(t('mss.vault.inPapierkorbGelegt'), {
        label: t('common.undo'),
        ausfuehren: () => void vault.restoreItem(item.id).catch((err) => toast.error(fehlerText(err, t('mss.vault.speichernFehlgeschlagen')))),
      })
    } catch (err) {
      toast.error(fehlerText(err, t('mss.vault.loeschenFehlgeschlagen')))
    }
  }

  const kopierKnopf = (text: string, schluessel: string, name: string) => (
    <Kurzinfo text={name}>
      <Button type="button" variant="ghost" size="icon" fingerziel aria-label={name} onClick={() => void kopieren(text, schluessel)}>
        {kopiert === schluessel ? <Check className="h-3.5 w-3.5 text-status-success" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
      </Button>
    </Kurzinfo>
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setDialog({ art: 'karte' })}>
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          {t('mss.vault.zahlung.karteNeu')}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setDialog({ art: 'konto' })}>
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          {t('mss.vault.zahlung.kontoNeu')}
        </Button>
      </div>

      {liste.length === 0 ? (
        <Zustandsflaeche art="leer" ansagen={!!suche.trim()} text={t(suche.trim() ? 'mss.vault.keineTreffer' : 'mss.vault.zahlung.leer')} />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2" aria-label={t('mss.vault.ansicht.zahlung')}>
          {liste.map((item) => {
            const z = item.zahlung
            const sichtbar = offen === item.id
            const wert = z.art === 'karte' ? z.nummer : z.iban
            const marke = z.art === 'karte' ? kartenmarke(z.nummer) : null
            const ablauf = z.art === 'karte' ? ablaufText(z) : ''
            return (
              <li
                key={item.id}
                className="flex flex-col justify-between gap-3 rounded-2xl border border-outline-variant/25 bg-gradient-to-br from-surface-container-high/90 to-surface-container p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/12 text-primary">
                      <ZahlungSymbol zahlung={z} className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-on-surface">{item.service}</p>
                      <p className="truncate text-label-sm text-on-surface-variant">
                        {marke ? t(`mss.vault.zahlung.marke.${marke}`) : z.art === 'konto' ? t('mss.vault.zahlung.art.konto') : t('mss.vault.zahlung.art.karte')}
                        {z.inhaber ? ` · ${z.inhaber}` : ''}
                      </p>
                    </div>
                  </div>
                  {z.art === 'karte' && istAbgelaufen(z) && <Badge variant="warning">{t('mss.vault.zahlung.abgelaufen')}</Badge>}
                </div>

                <div className="rounded-xl border border-outline-variant/15 bg-surface-container-low/80 px-3 py-2.5">
                  <p className="font-mono text-sm tracking-wider text-on-surface break-all">
                    {sichtbar ? (z.art === 'karte' ? nummerGruppiert(wert) : wert.replace(/(.{4})(?=.)/g, '$1 ')) : verdeckt(z)}
                  </p>
                  {(ablauf || (sichtbar && ((z.art === 'karte' && z.pruefnummer) || (z.art === 'konto' && z.bic)))) && (
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-label-sm text-on-surface-variant">
                      {ablauf && <span>{ablauf}</span>}
                      {sichtbar && z.art === 'karte' && z.pruefnummer && (
                        <span className="font-mono">
                          {t('mss.vault.zahlung.pruefnummerKurz')} {z.pruefnummer}
                        </span>
                      )}
                      {sichtbar && z.art === 'konto' && z.bic && <span className="font-mono">{z.bic}</span>}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between gap-1 border-t border-outline-variant/15 pt-1">
                  <div className="flex items-center gap-1">
                    <Kurzinfo text={t(sichtbar ? 'mss.vault.zahlung.verdecken' : 'mss.vault.zahlung.aufdecken')}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        fingerziel
                        aria-label={t(sichtbar ? 'mss.vault.zahlung.verdecken' : 'mss.vault.zahlung.aufdecken')}
                        aria-pressed={sichtbar}
                        onClick={() => aufdecken(item.id)}
                      >
                        {sichtbar ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                      </Button>
                    </Kurzinfo>
                    {kopierKnopf(wert, `wert-${item.id}`, t(z.art === 'karte' ? 'mss.vault.zahlung.nummerKopieren' : 'mss.vault.zahlung.ibanKopieren'))}
                  </div>
                  <div className="flex items-center gap-1">
                    <Kurzinfo text={t('common.edit')}>
                      <Button type="button" variant="ghost" size="icon" fingerziel aria-label={t('common.edit')} onClick={() => setDialog({ art: z.art, item })}>
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </Kurzinfo>
                    <Kurzinfo text={t('mss.vault.inPapierkorb')} seite="ende">
                      <Button type="button" variant="ghost" size="icon" fingerziel aria-label={t('mss.vault.inPapierkorb')} onClick={() => void wegwerfen(item)} className="text-status-destructive">
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </Kurzinfo>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {dialog && <ZahlungDialog key={dialog.item?.id ?? dialog.art} art={dialog.art} item={dialog.item} onSchliessen={() => setDialog(null)} />}
    </div>
  )
}
