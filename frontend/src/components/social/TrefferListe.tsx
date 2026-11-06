/**
 * Treffer ueber alle Chats hinweg:
 * Modernes, renommiertes modales Fenster fuer markierte Nachrichten,
 * @-Erwaehnungen und Volltext-Suchergebnisse gemaess Design-DNA.
 */

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { AtSign, Lock, MessageSquare, Search, Star, Users, X } from 'lucide-react'

import { Avatar } from '@/components/app/Avatar'
import type { ChatTreffer, Treffer } from '@/services/verlaufSuche'
import type { MailboxMeta } from '@/stores/messengerNotificationStore'

export interface TrefferListeProps {
  offen: boolean
  titel: string
  leerText: string
  chats: readonly ChatTreffer[]
  verzeichnis: Record<string, MailboxMeta>
  gesperrt?: boolean
  laeuft?: boolean
  onSchliessen: () => void
  onTreffer: (t: Treffer) => void
}

function Ausschnitt({ t }: { t: Treffer }) {
  if (t.bis <= t.von) return <span className="line-clamp-2">{t.auszug}</span>
  return (
    <span className="line-clamp-2">
      {t.auszug.slice(0, t.von)}
      <mark className="bg-primary/25 text-primary rounded px-1 font-semibold">{t.auszug.slice(t.von, t.bis)}</mark>
      {t.auszug.slice(t.bis)}
    </span>
  )
}

export function TrefferListe({
  offen,
  titel,
  leerText,
  chats,
  verzeichnis,
  gesperrt,
  laeuft,
  onSchliessen,
  onTreffer,
}: TrefferListeProps) {
  const { t } = useTranslation()
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!offen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onSchliessen()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [offen, onSchliessen])

  if (!offen || typeof document === 'undefined') return null

  const gesamt = chats.reduce((s, c) => s + c.treffer.length, 0)
  const istMarkiert = titel.toLowerCase().includes('markier')
  const istErwaehnung = titel.toLowerCase().includes('antwort') || titel.includes('@')

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-6 bg-black/65 backdrop-blur-md animate-fade-in select-none"
      onClick={(e) => {
        if (e.target === e.currentTarget) onSchliessen()
      }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="treffer-modal-titel"
        className="w-full max-w-xl max-h-[85vh] flex flex-col rounded-3xl bg-surface-container/95 backdrop-blur-2xl border border-outline-variant/30 shadow-2xl overflow-hidden animate-slide-up"
      >
        {/* Kopfzeile */}
        <div className="shrink-0 px-5 py-4 border-b border-outline-variant/20 flex items-center justify-between gap-3 bg-surface-container-low/50">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 shadow-sm ${
                istMarkiert
                  ? 'bg-status-warning/15 text-status-warning border border-status-warning/30'
                  : istErwaehnung
                    ? 'bg-primary/15 text-primary border border-primary/30'
                    : 'bg-primary/15 text-primary border border-primary/30'
              }`}
            >
              {istMarkiert ? (
                <Star className="w-5 h-5 fill-status-warning" />
              ) : istErwaehnung ? (
                <AtSign className="w-5 h-5" />
              ) : (
                <Search className="w-5 h-5" />
              )}
            </div>
            <div className="min-w-0">
              <h2 id="treffer-modal-titel" className="font-headline text-body-lg font-bold text-on-surface truncate">
                {titel}
              </h2>
              {!gesperrt && !laeuft && (
                <p className="font-body text-xs text-on-surface-variant/80 tabular-nums">
                  {gesamt === 0
                    ? t('messenger.searchNothingFound')
                    : t('messenger.searchHitsInChats', { hits: gesamt, count: chats.length })}
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onSchliessen}
            className="w-9 h-9 rounded-full flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest transition-colors shrink-0"
            aria-label={t('common.close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Inhalt */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 overscroll-contain">
          {gesperrt ? (
            <div className="py-16 px-6 text-center space-y-3">
              <div className="w-12 h-12 mx-auto rounded-2xl bg-surface-container-highest flex items-center justify-center text-on-surface-variant">
                <Lock className="w-6 h-6" />
              </div>
              <p className="text-xs text-on-surface-variant max-w-xs mx-auto">
                {t('messenger.searchLockedLong')}
              </p>
            </div>
          ) : laeuft ? (
            <div className="py-16 text-center space-y-2">
              <div className="w-6 h-6 mx-auto rounded-full border-2 border-primary border-t-transparent animate-spin" />
              <p className="text-xs text-on-surface-variant/70">{t('messenger.searching')}</p>
            </div>
          ) : chats.length === 0 ? (
            <div className="py-16 px-6 text-center space-y-3">
              <div className="w-12 h-12 mx-auto rounded-2xl bg-surface-container-highest flex items-center justify-center text-on-surface-variant/60">
                {istMarkiert ? (
                  <Star className="w-6 h-6" />
                ) : istErwaehnung ? (
                  <AtSign className="w-6 h-6" />
                ) : (
                  <Search className="w-6 h-6" />
                )}
              </div>
              <p className="text-xs text-on-surface-variant/80 max-w-xs mx-auto leading-relaxed">
                {leerText}
              </p>
            </div>
          ) : (
            chats.map((chat) => {
              const meta = verzeichnis[chat.blindMailboxId]
              return (
                <div key={chat.blindMailboxId} className="space-y-2">
                  <div className="px-1 flex items-center gap-2 text-label-sm font-semibold text-on-surface-variant">
                    {meta?.isGroup ? (
                      <Users className="w-3.5 h-3.5 text-primary shrink-0" />
                    ) : (
                      <MessageSquare className="w-3.5 h-3.5 text-primary shrink-0" />
                    )}
                    <span className="truncate">{meta?.name || t('messenger.unknownChat')}</span>
                    <span className="ml-auto text-label-sm px-2 py-0.5 rounded-full bg-surface-container-highest text-on-surface-variant font-mono">
                      {chat.treffer.length}
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    {chat.treffer.map((hit) => (
                      <button
                        key={`${hit.blindMailboxId}-${hit.id}-${hit.von}`}
                        type="button"
                        onClick={() => onTreffer(hit)}
                        className="group w-full p-3 rounded-2xl bg-surface-container-high/45 hover:bg-surface-container-high/90 border border-outline-variant/25 hover:border-primary/40 flex items-start gap-3 text-left transition-all shadow-2xs hover:shadow-sm"
                      >
                        <Avatar
                          src={hit.isSelf ? null : meta?.avatarUrl ?? null}
                          name={hit.isSelf ? 'Ich' : hit.senderName || meta?.name || 'Kontakt'}
                          size="sm"
                          className="w-8 h-8 rounded-xl shrink-0 mt-0.5"
                        />
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-body-sm font-semibold text-on-surface group-hover:text-primary transition-colors truncate">
                              {hit.isSelf ? 'Ich' : hit.senderName || meta?.name || 'Kontakt'}
                            </span>
                            <span className="text-label-sm text-on-surface-variant/70 shrink-0 tabular-nums">
                              {new Date(hit.createdAt).toLocaleDateString([], { day: '2-digit', month: '2-digit' })}
                            </span>
                          </div>
                          <p className="text-xs text-on-surface-variant leading-relaxed">
                            <Ausschnitt t={hit} />
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
