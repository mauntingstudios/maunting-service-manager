/**
 * Wohin weitergeleitet werden soll.
 *
 * **Am Telefon eine eigene Ansicht, kein Dialog.** Eine Liste mit Suchfeld und
 * Mehrfachauswahl braucht die volle Höhe; in einem Kästchen in der Mitte wäre
 * sie drei Zeilen hoch und läge bei offener Tastatur darunter. Der Senden-Knopf
 * klebt am unteren Rand, innerhalb der sicheren Fläche.
 *
 * Zuletzt genutzte Chats stehen oben, weil man meistens an dieselben zwei Leute
 * weiterleitet.
 *
 * Während ein Anhang neu hochgeladen wird, läuft ein Fortschritt: über Mobilfunk
 * dauert das spürbar, und ein Knopf, der einfach nicht mehr reagiert, sieht aus
 * wie ein Fehler.
 *
 * **Per Portal an `document.body`**, aus demselben Grund wie bei der
 * `TrefferListe`: im Chat-Ast hängend gäbe es sie ohne offenen Chat nicht, und
 * `Shell.tsx` kappt jedes `z-50` im Inhaltsbereich auf 10.
 */

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { Check, Forward, Search, Users, X } from 'lucide-react'

import { Avatar } from '@/components/app/Avatar'
import { Button, Input } from '@maunting/ui'
import type { Weiterleitungsziel } from '@/services/nachrichtWeiterleiten'

export interface WeiterleitenAnsichtProps {
  offen: boolean
  onSchliessen: () => void
  /** Alle möglichen Ziele, schon in der Reihenfolge „zuletzt genutzt zuerst". */
  ziele: readonly (Weiterleitungsziel & { avatarUrl?: string | null; istGruppe?: boolean })[]
  /** Wie viele Nachrichten mitgehen — steht im Knopf. */
  anzahlNachrichten: number
  onSenden: (gewaehlt: Weiterleitungsziel[]) => Promise<void>
  /** `null`, solange nichts läuft. */
  fortschritt: { gesamt: number; fertig: number } | null
}

export function WeiterleitenAnsicht({
  offen,
  onSchliessen,
  ziele,
  anzahlNachrichten,
  onSenden,
  fortschritt,
}: WeiterleitenAnsichtProps) {
  const { t } = useTranslation()
  const [suche, setSuche] = useState('')
  const [gewaehlt, setGewaehlt] = useState<string[]>([])
  const [laeuft, setLaeuft] = useState(false)

  const gefiltert = useMemo(() => {
    const s = suche.trim().toLowerCase()
    if (!s) return ziele
    return ziele.filter((z) => z.name.toLowerCase().includes(s))
  }, [ziele, suche])

  if (!offen || typeof document === 'undefined') return null

  const umschalten = (mid: string) =>
    setGewaehlt((v) => (v.includes(mid) ? v.filter((x) => x !== mid) : [...v, mid]))

  const senden = async () => {
    const auswahl = ziele.filter((z) => gewaehlt.includes(z.blindMailboxId))
    if (!auswahl.length || laeuft) return
    setLaeuft(true)
    try {
      await onSenden(auswahl)
      setGewaehlt([])
      setSuche('')
    } finally {
      setLaeuft(false)
    }
  }

  return createPortal(
    <div
      className="msm-modal-overlay animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && !laeuft) onSchliessen()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('messenger.forward')}
        className="msm-card relative w-full max-w-md overflow-hidden flex flex-col bg-surface-container-high/95 backdrop-blur-2xl border border-outline-variant/30 text-on-surface shadow-2xl"
      >
        <div className="p-6 border-b border-outline-variant/30 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-headline font-bold text-base tracking-tight text-on-surface flex items-center gap-2">
              <Forward className="h-4 w-4 text-primary shrink-0" />
              <span className="truncate">{t('messenger.forward')}</span>
            </h2>
            <p className="mt-1 text-xs text-on-surface-variant">
              {t('messenger.forwardCount', { count: anzahlNachrichten })}
            </p>
          </div>
          <button
            type="button"
            onClick={onSchliessen}
            className="text-on-surface-variant hover:text-on-surface p-1.5 rounded-lg hover:bg-surface-container transition-colors"
            aria-label={t('messenger.cancelForward')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 pt-4 pb-6 space-y-4">
          <Input
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
            placeholder={t('messenger.searchChatOrGroup')}
            prefix={<Search className="w-4 h-4" />}
            aria-label={t('messenger.searchTarget')}
          />

          <div className="max-h-72 overflow-y-auto space-y-1 pr-1">
            {gefiltert.length === 0 ? (
              <p className="py-8 text-center text-xs text-on-surface-variant">
                Kein Chat passt zu dieser Suche.
              </p>
            ) : (
              gefiltert.map((z) => {
                const an = gewaehlt.includes(z.blindMailboxId)
                return (
                  <button
                    key={z.blindMailboxId}
                    type="button"
                    onClick={() => umschalten(z.blindMailboxId)}
                    className={`w-full px-3 py-2 rounded-xl flex items-center gap-3 text-left transition-colors ${
                      an
                        ? 'bg-primary/15 border border-primary/30'
                        : 'border border-transparent hover:bg-surface-container-highest/70'
                    }`}
                    aria-pressed={an}
                  >
                    {z.istGruppe ? (
                      <span className="w-9 h-9 rounded-full bg-tertiary/20 flex items-center justify-center shrink-0">
                        <Users className="w-4 h-4 text-tertiary" />
                      </span>
                    ) : (
                      <Avatar src={z.avatarUrl ?? null} name={z.name} size="sm" className="w-9 h-9 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold text-on-surface">{z.name}</span>
                    <span
                      className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${
                        an ? 'bg-primary border-primary text-on-primary' : 'border-outline-variant/60 text-transparent'
                      }`}
                      aria-hidden="true"
                    >
                      <Check className="w-3 h-3" />
                    </span>
                  </button>
                )
              })
            )}
          </div>

          {fortschritt && fortschritt.gesamt > 0 && (
            <div className="space-y-1">
              <div className="flex justify-between text-label-sm text-on-surface-variant">
                <span>{t('messenger.reencrypting')}</span>
                <span className="tabular-nums">
                  {fortschritt.fertig} / {fortschritt.gesamt}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-surface-container-highest overflow-hidden">
                <div
                  className="h-full bg-primary transition-[width]"
                  style={{ width: `${Math.round((fortschritt.fertig / fortschritt.gesamt) * 100)}%` }}
                />
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-outline-variant/20">
            <Button type="button" variant="secondary" size="sm" onClick={onSchliessen} disabled={laeuft}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={gewaehlt.length === 0 || laeuft}
              onClick={() => void senden()}
              className="gap-1.5"
            >
              <Forward className="w-3.5 h-3.5" />
              <span>
                {laeuft
                  ? t('messenger.sending')
                  : gewaehlt.length === 0
                    ? t('messenger.chooseTarget')
                    : t('messenger.sendToChats', { count: gewaehlt.length })}
              </span>
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
