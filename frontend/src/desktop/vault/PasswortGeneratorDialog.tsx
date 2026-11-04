import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy, RefreshCw, ShieldCheck, Zap } from 'lucide-react'
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, ProgressBar, Slider, Switch } from '@maunting/ui'
import { toast } from '@/stores/toastStore'
import { generateSecurePassword } from './vaultCrypto'
import { passwortPunkte } from './vaultKennzahlen'

interface PasswortGeneratorDialogProps {
  offen: boolean
  onSchliessen: () => void
  onVerwenden: (passwort: string) => void
}

export function PasswortGeneratorDialog({ offen, onSchliessen, onVerwenden }: PasswortGeneratorDialogProps) {
  const { t } = useTranslation()
  const [laenge, setLaenge] = useState(20)
  const [symbole, setSymbole] = useState(true)
  const [passwort, setPasswort] = useState(() => generateSecurePassword(20, true))
  const [kopiert, setKopiert] = useState(false)

  useEffect(() => {
    if (!offen) return
    setPasswort(generateSecurePassword(laenge, symbole))
    setKopiert(false)
  }, [offen, laenge, symbole])

  const punkte = passwortPunkte(passwort)

  const neuErzeugen = () => {
    setPasswort(generateSecurePassword(laenge, symbole))
    setKopiert(false)
  }

  const kopieren = async () => {
    try {
      await navigator.clipboard.writeText(passwort)
      setKopiert(true)
      toast.success(t('mss.vault.generator.kopiert'))
      setTimeout(() => setKopiert(false), 1500)
    } catch {
      toast.error(t('mss.vault.kopierenFehlgeschlagen'))
    }
  }

  return (
    <Dialog open={offen} onOpenChange={(naechste) => !naechste && onSchliessen()}>
      <DialogContent className="max-w-lg">
        <DialogHeader className="px-5 py-4 pr-14">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20">
              <Zap className="h-4 w-4" />
            </div>
            <DialogTitle className="text-sm">{t('mss.vault.generator.titel')}</DialogTitle>
          </div>
        </DialogHeader>

        <div className="space-y-4 p-5">
          <div className="rounded-2xl border border-outline-variant/25 bg-surface-container-low/70 p-3.5">
            <div className="flex items-center justify-between gap-2">
              <p className="min-w-0 flex-1 break-all font-mono text-sm leading-relaxed text-on-surface select-all">
                {passwort}
              </p>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={neuErzeugen}
                  aria-label={t('mss.vault.generator.neu')}
                  className="flex h-8 w-8 items-center justify-center rounded-xl border border-outline-variant/20 bg-surface-container text-on-surface-variant transition-colors hover:border-primary/35 hover:text-primary"
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => void kopieren()}
                  aria-label={kopiert ? t('mss.vault.generator.kopiert') : t('mss.vault.generator.kopieren')}
                  className={`flex h-8 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-medium transition-colors ${
                    kopiert
                      ? 'border-status-success/35 bg-status-success/15 text-status-success'
                      : 'border-outline-variant/20 bg-surface-container text-on-surface hover:border-primary/35 hover:text-primary'
                  }`}
                >
                  {kopiert ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                  <span>{kopiert ? t('mss.vault.generator.kopiert') : t('mss.vault.generator.kopieren')}</span>
                </button>
              </div>
            </div>
            <ProgressBar value={punkte} className="mt-3" ariaLabel={t('mss.vault.dashboard.tresorSicherheit')} />
          </div>

          <Slider
            label={t('mss.vault.generator.laenge')}
            hint={String(laenge)}
            value={laenge}
            min={12}
            max={64}
            step={1}
            onValueChange={setLaenge}
          />

          <label className="flex items-center justify-between gap-3 rounded-xl border border-outline-variant/20 bg-surface-container-low/40 px-3.5 py-2.5 cursor-pointer">
            <span id="generator-symbole" className="text-sm text-on-surface">{t('mss.vault.generator.symbole')}</span>
            <Switch checked={symbole} onCheckedChange={setSymbole} aria-labelledby="generator-symbole" />
          </label>

          <p className="text-label-sm text-on-surface-variant">{t('mss.vault.generator.hinweis')}</p>
        </div>

        <DialogFooter className="flex flex-row items-center justify-between gap-2 px-5 py-3.5">
          <Button type="button" variant="ghost" size="sm" onClick={onSchliessen} className="whitespace-nowrap">
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              onVerwenden(passwort)
              onSchliessen()
            }}
            className="whitespace-nowrap"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            {t('mss.vault.generator.verwenden')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
