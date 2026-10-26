import { useCallback, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
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
      <DialogContent className="w-full max-w-lg p-5 sm:p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start gap-3.5">
          <div className="rounded-lg bg-primary/10 p-2.5 text-primary shrink-0 mt-0.5">
            <ShieldAlert className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <DialogHeader>
              <div className="flex items-center gap-1.5 text-label-sm uppercase tracking-wider text-on-surface-variant font-medium mb-1">
                <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                <span>{t('browser.drittanbieterHinweis.eyebrow')}</span>
              </div>
              <DialogTitle id={titleId} className="text-title-md sm:text-title-lg font-headline text-on-surface">
                {t('browser.drittanbieterHinweis.titel')}
              </DialogTitle>
              <DialogDescription className="mt-2 text-body-sm leading-relaxed text-on-surface-variant">
                {t('browser.drittanbieterHinweis.beschreibung')}
              </DialogDescription>
            </DialogHeader>

            <div className="mt-3.5 space-y-2 rounded-lg border border-outline-variant/30 bg-surface-container-high/40 p-3 text-body-sm leading-relaxed text-on-surface-variant">
              <div className="flex items-start gap-2">
                <span className="font-semibold text-primary shrink-0">•</span>
                <p>{t('browser.drittanbieterHinweis.telegram')}</p>
              </div>
              <div className="flex items-start gap-2">
                <span className="font-semibold text-primary shrink-0">•</span>
                <p>{t('browser.drittanbieterHinweis.discord')}</p>
              </div>
              <div className="flex items-start gap-2">
                <span className="font-semibold text-primary shrink-0">•</span>
                <p>{t('browser.drittanbieterHinweis.instagram')}</p>
              </div>
              <div className="flex items-start gap-2">
                <span className="font-semibold text-primary shrink-0">•</span>
                <p>{t('browser.drittanbieterHinweis.whatsapp')}</p>
              </div>
            </div>

            <p className="mt-3 text-body-sm leading-relaxed text-on-surface-variant">
              {t('browser.drittanbieterHinweis.fazit')}
            </p>

            <div className="mt-4 pt-3 border-t border-outline-variant/30">
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
        </div>

        <DialogFooter className="mt-4 pt-4 border-t border-outline-variant/30 flex-col-reverse sm:flex-row gap-2 sm:justify-end">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t('browser.drittanbieterHinweis.abbrechen')}
          </Button>
          <Button variant="primary" size="sm" autoFocus onClick={handleConfirm}>
            {t('browser.drittanbieterHinweis.fortfahren')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
