import { useCallback, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from './Dialog'

export const DRITTANBIETER_HINWEIS_STORAGE_KEY = 'msb:drittanbieter_datenschutz'

export interface DrittanbieterHinweisStatus {
  dismissed: boolean
  snoozedUntil?: number
  at: string
}

export function istDrittanbieterHinweisBestaetigt(
  storageKey = DRITTANBIETER_HINWEIS_STORAGE_KEY,
  now = Date.now(),
): boolean {
  if (typeof window === 'undefined') return false
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return false
    const parsed = JSON.parse(raw) as Partial<DrittanbieterHinweisStatus>
    if (parsed.dismissed === true) return true
    if (typeof parsed.snoozedUntil === 'number' && parsed.snoozedUntil > now) {
      return true
    }
    return false
  } catch {
    return false
  }
}

export function bestaetigeDrittanbieterHinweis(
  nieWieder: boolean,
  storageKey = DRITTANBIETER_HINWEIS_STORAGE_KEY,
): void {
  if (typeof window === 'undefined') return
  try {
    const status: DrittanbieterHinweisStatus = {
      dismissed: nieWieder,
      snoozedUntil: nieWieder ? undefined : Date.now() + 24 * 60 * 60 * 1000,
      at: new Date().toISOString(),
    }
    window.localStorage.setItem(storageKey, JSON.stringify(status))
  } catch {
    /* localStorage eventuell deaktiviert */
  }
}

export interface ThirdPartyPrivacyDialogProps {
  open: boolean
  onConfirm: (nieWieder: boolean) => void
  onCancel: () => void
  storageKey?: string
}

export function ThirdPartyPrivacyDialog({
  open,
  onConfirm,
  onCancel,
  storageKey = DRITTANBIETER_HINWEIS_STORAGE_KEY,
}: ThirdPartyPrivacyDialogProps) {
  const { t } = useTranslation()
  const titleId = useId()
  const checkboxId = useId()
  const [nieWieder, setNieWieder] = useState(false)

  const handleConfirm = useCallback(() => {
    bestaetigeDrittanbieterHinweis(nieWieder, storageKey)
    onConfirm(nieWieder)
  }, [nieWieder, onConfirm, storageKey])

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
      <DialogContent className="w-full max-w-lg p-0 overflow-hidden rounded-2xl border border-outline-variant/30 shadow-2xl flex flex-col max-h-[85vh]">
        <div className="flex items-start gap-3.5 px-6 pt-6 pb-2 shrink-0">
          <div className="rounded-xl bg-primary/15 p-2.5 text-primary shrink-0 mt-0.5">
            <ShieldAlert className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-label-sm uppercase tracking-wider text-primary font-semibold mb-1">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              <span>{t('browser.drittanbieterHinweis.eyebrow')}</span>
            </div>
            <DialogTitle id={titleId} className="text-title-md sm:text-title-lg font-headline text-on-surface">
              {t('browser.drittanbieterHinweis.titel')}
            </DialogTitle>
            <DialogDescription className="mt-1.5 text-body-sm leading-relaxed text-on-surface-variant">
              {t('browser.drittanbieterHinweis.beschreibung')}
            </DialogDescription>
          </div>
        </div>

        <div className="px-6 py-2 overflow-y-auto flex-1 space-y-3.5 msb-dialog-scroll">
          <ul className="space-y-2 text-body-sm leading-relaxed text-on-surface-variant">
            <li className="flex items-start gap-2.5">
              <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0 mt-2" aria-hidden="true" />
              <p>{t('browser.drittanbieterHinweis.telegram')}</p>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0 mt-2" aria-hidden="true" />
              <p>{t('browser.drittanbieterHinweis.discord')}</p>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0 mt-2" aria-hidden="true" />
              <p>{t('browser.drittanbieterHinweis.instagram')}</p>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0 mt-2" aria-hidden="true" />
              <p>{t('browser.drittanbieterHinweis.whatsapp')}</p>
            </li>
          </ul>

          <p className="text-body-sm leading-relaxed text-on-surface-variant">
            {t('browser.drittanbieterHinweis.fazit')}
          </p>

          <div className="pt-2">
            <label
              htmlFor={checkboxId}
              className="flex items-center gap-2.5 cursor-pointer text-body-sm font-medium text-on-surface select-none"
            >
              <Checkbox
                id={checkboxId}
                checked={nieWieder}
                onCheckedChange={setNieWieder}
              />
              <span>{t('browser.drittanbieterHinweis.nichtMehrAnzeigen')}</span>
            </label>
          </div>
        </div>

        <div className="px-6 pb-6 pt-3 border-t border-outline-variant/20 bg-transparent flex flex-col-reverse sm:flex-row items-center sm:justify-end gap-2.5 shrink-0">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t('browser.drittanbieterHinweis.abbrechen')}
          </Button>
          <Button variant="primary" size="sm" autoFocus onClick={handleConfirm}>
            {t('browser.drittanbieterHinweis.fortfahren')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
