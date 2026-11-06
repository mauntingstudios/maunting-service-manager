import { useEffect, useMemo, useState } from 'react'
import { Check, Flame, Loader2, Search, X, Zap } from 'lucide-react'
import { Avatar } from '@/components/app/Avatar'
import { Button, Input } from '@maunting/ui'
import type { ChatContact } from '@/components/social/sidebar/ConversationListItem'

interface FunkenEmpfaengerModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  fotoDataUrl: string | null
  kontakte: ChatContact[]
  funkenPartnerIds?: number[]
  onSenden: (empfaengerUserIds: number[]) => Promise<void>
  sendet?: boolean
}

/**
 * Snapchat-Style Empfängerauswahl für Funken-Snapshots.
 * Erlaubt das blitzschnelle Auswählen und Abarbeiten von Streak-Partnern.
 */
export function FunkenEmpfaengerModal({
  open,
  onOpenChange,
  fotoDataUrl,
  kontakte,
  funkenPartnerIds = [],
  onSenden,
  sendet = false,
}: FunkenEmpfaengerModalProps) {
  const [suche, setSuche] = useState('')
  const [ausgewaehlt, setAusgewaehlt] = useState<Set<number>>(new Set())

  // Initial alle bestehenden Funken-Partner vorselektieren
  useEffect(() => {
    if (open) {
      if (funkenPartnerIds.length > 0) {
        setAusgewaehlt(new Set(funkenPartnerIds))
      } else {
        setAusgewaehlt(new Set())
      }
      setSuche('')
    }
  }, [open, funkenPartnerIds])

  // ESC-Taste schließt den Dialog
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !sendet) onOpenChange(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, sendet, onOpenChange])

  const gefiltert = useMemo(() => {
    const q = suche.trim().toLowerCase()
    if (!q) return kontakte
    return kontakte.filter((k) => (k.username || '').toLowerCase().includes(q))
  }, [kontakte, suche])

  const toggleAuswahl = (userId: number) => {
    setAusgewaehlt((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  const toggleAlleFunkenPartner = () => {
    if (ausgewaehlt.size === funkenPartnerIds.length && funkenPartnerIds.length > 0) {
      setAusgewaehlt(new Set())
    } else {
      setAusgewaehlt(new Set(funkenPartnerIds))
    }
  }

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="funken-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-md animate-fade-in"
    >
      <div
        className="fixed inset-0"
        onClick={() => !sendet && onOpenChange(false)}
        aria-hidden="true"
      />

      <div className="relative w-full max-w-md rounded-3xl border border-white/15 bg-black/85 backdrop-blur-2xl shadow-2xl p-4 sm:p-5 flex flex-col max-h-[85vh] z-10 text-white animate-scale-in">
        {/* Kopfbereich */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-full bg-status-warning/20 border border-status-warning/40 flex items-center justify-center text-status-warning shadow-sm">
              <Zap className="w-5 h-5 fill-status-warning" />
            </div>
            <div>
              <h2 id="funken-modal-title" className="text-base font-bold text-white">
                Funken senden
              </h2>
              <p className="text-xs text-white/60">Wähle deine Kontakte oder Funken-Partner</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={sendet}
            className="p-1.5 rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Schließen"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Foto-Vorschau */}
        {fotoDataUrl && (
          <div className="my-3 relative rounded-2xl overflow-hidden h-28 w-full border border-white/10 bg-black/40 flex items-center justify-center shrink-0">
            <img src={fotoDataUrl} alt="Vorschau" className="w-full h-full object-cover opacity-90" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent flex items-end p-2.5">
              <span className="text-xs font-semibold text-white/90 flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-status-warning fill-status-warning" />
                Augenblick bereit zum Versenden
              </span>
            </div>
          </div>
        )}

        {/* Schnellauswahl & Suche */}
        <div className="space-y-2 mb-2 shrink-0">
          {funkenPartnerIds.length > 0 && (
            <div className="flex items-center justify-between px-1">
              <button
                type="button"
                onClick={toggleAlleFunkenPartner}
                className="text-xs font-semibold text-primary hover:text-primary-hover flex items-center gap-1 transition-colors"
              >
                <Flame className="w-3.5 h-3.5 text-status-warning" />
                <span>
                  {ausgewaehlt.size === funkenPartnerIds.length && funkenPartnerIds.length > 0
                    ? 'Auswahl aufheben'
                    : `Alle Funken-Partner (${funkenPartnerIds.length}) auswählen`}
                </span>
              </button>
              <span className="text-xs text-white/50">{ausgewaehlt.size} ausgewählt</span>
            </div>
          )}

          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
            <Input
              value={suche}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSuche(e.target.value)}
              placeholder="Freunde suchen..."
              className="text-xs pl-8 h-8 rounded-full bg-white/5 border-white/10 text-white placeholder:text-white/40 focus:border-primary/50 transition-all"
            />
          </div>
        </div>

        {/* Scrollbare Kontaktliste */}
        <div className="flex-1 overflow-y-auto space-y-1 pr-1 msm-ohne-rollbalken min-h-[140px]">
          {gefiltert.length === 0 ? (
            <p className="py-8 text-center text-xs text-white/50">Keine Freunde gefunden.</p>
          ) : (
            gefiltert.map((k) => {
              const istFunkenPartner = funkenPartnerIds.includes(k.userId)
              const istGewaehlt = ausgewaehlt.has(k.userId)

              return (
                <div
                  key={`snap-c-${k.userId}`}
                  onClick={() => toggleAuswahl(k.userId)}
                  className={`flex items-center justify-between p-2 rounded-2xl border transition-all cursor-pointer ${
                    istGewaehlt
                      ? 'bg-primary/20 border-primary/50 shadow-sm'
                      : 'bg-white/5 border-white/10 hover:bg-white/10'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <div className="relative shrink-0">
                      <Avatar src={k.avatarUrl} name={k.username} size="sm" />
                      {k.status === 'online' && (
                        <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-status-success ring-1 ring-black" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-white truncate">{k.username}</span>
                        {istFunkenPartner && (
                          <span className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded-full bg-status-warning/20 border border-status-warning/40 text-label-sm font-bold text-status-warning">
                            <Zap className="w-2.5 h-2.5 fill-status-warning" />
                            Funke
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div
                    className={`w-5 h-5 rounded-full border flex items-center justify-center transition-colors ${
                      istGewaehlt
                        ? 'bg-primary border-primary text-on-primary'
                        : 'border-white/30 bg-white/5'
                    }`}
                  >
                    {istGewaehlt && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Aktionen unten */}
        <div className="pt-3 mt-2 border-t border-white/10 flex items-center justify-end gap-2 shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={sendet}
            className="rounded-full text-xs text-white/70 hover:text-white hover:bg-white/10"
          >
            Abbrechen
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={ausgewaehlt.size === 0 || sendet}
            onClick={() => onSenden(Array.from(ausgewaehlt))}
            className="rounded-full text-xs px-4 gap-1.5 shadow-md shadow-primary/30"
          >
            {sendet ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Wird gesendet...</span>
              </>
            ) : (
              <>
                <Zap className="w-3.5 h-3.5 fill-current" />
                <span>Funken senden ({ausgewaehlt.size})</span>
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
