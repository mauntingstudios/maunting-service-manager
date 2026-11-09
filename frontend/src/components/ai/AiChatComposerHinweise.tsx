import { ListPlus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { AiAttachment, AiMessage } from '@/api/ai'
import { ChatComposerBanner, Kurzinfo } from '@maunting/ui'

import { AiAnhangLeiste } from './anhaenge/AiAnhangLeiste'
import { AiMemoryNotice } from './AiMemoryNotice'

export interface SlashBefehl {
  id: string
  label: string
  beschreibung: string
  icon: React.ComponentType<{ className?: string }>
  art: 'aktion' | 'skill'
  ausfuehren: () => void
}

interface Props {
  memoryNoticeDue: boolean
  onMemoryNoticeAnswered: () => void
  scopeKind: string
  anhaenge: AiAttachment[]
  vorschauen: Record<string, string>
  onRemoveAttachment: (anhang: AiAttachment) => void
  busy: boolean
  editingMessage: AiMessage | null
  onCancelEdit: () => void
  onEditInputClear: () => void
  replyingTo: AiMessage | null
  onCancelReply: () => void
  queuedMessages: string[]
  setQueuedMessages: React.Dispatch<React.SetStateAction<string[]>>
  zeigeSlashMenu: boolean
  gefilterteSlashBefehle: SlashBefehl[]
  slashIndex: number
  setSlashIndex: (index: number) => void
}

/**
 * Hinweise ueber dem Eingabefeld: Memory-Hinweis, Anhang-Chips,
 * Bearbeiten-/Antwort-Banner, Warteschlange und Slash-Menue.
 */
export function AiChatComposerHinweise({
  memoryNoticeDue,
  onMemoryNoticeAnswered,
  scopeKind,
  anhaenge,
  vorschauen,
  onRemoveAttachment,
  busy,
  editingMessage,
  onCancelEdit,
  onEditInputClear,
  replyingTo,
  onCancelReply,
  queuedMessages,
  setQueuedMessages,
  zeigeSlashMenu,
  gefilterteSlashBefehle,
  slashIndex,
  setSlashIndex,
}: Props) {
  const { t } = useTranslation()

  return (
    <>
            {memoryNoticeDue && scopeKind !== 'docs' && (
              <AiMemoryNotice onAnswered={() => onMemoryNoticeAnswered()} />
            )}
              {/* Nur Ungesendetes: alles Uebrige steht in seiner Nachricht. Vorher
                  blieb jeder Anhang hier stehen und ging bei jeder Folgefrage
                  erneut an den Anbieter. */}
              <AiAnhangLeiste
                anhaenge={anhaenge}
                vorschauen={vorschauen}
                onRemove={(anhang) => void onRemoveAttachment(anhang)}
                disabled={busy}
              />

              {editingMessage && (
                <ChatComposerBanner
                  mode="edit"
                  title={t('ai.chat.edit', 'Nachricht bearbeiten')}
                  text={editingMessage.content}
                  hint={t('ai.chat.editHint', 'Nachfolgende Antworten werden neu generiert')}
                  onCancel={() => {
                    onCancelEdit()
                    onEditInputClear()
                  }}
                  cancelLabel={t('common.cancel')}
                  className="mb-2 rounded-2xl border border-primary/35 shadow-lg"
                />
              )}

              {replyingTo && !editingMessage && (
                <ChatComposerBanner
                  mode="reply"
                  title={`Antwort an ${replyingTo.role === 'assistant' ? 'Singra' : 'Nachricht'}`}
                  text={replyingTo.content}
                  onCancel={() => onCancelReply()}
                  cancelLabel={t('common.cancel')}
                  className="mb-2 rounded-2xl border border-outline-variant/35 shadow-lg"
                />
              )}

              {queuedMessages.length > 0 && (
                <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-outline-variant/30 bg-surface-container-high/60 px-2.5 py-1.5 text-xs text-on-surface-variant">
                  <span className="flex items-center gap-1 font-medium text-on-surface">
                    <ListPlus className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                    Warteschlange ({queuedMessages.length}):
                  </span>
                  {queuedMessages.map((msg, idx) => (
                    <Kurzinfo key={idx} text={msg} aussen="max-w-[220px]">
                      <span className="inline-flex max-w-[220px] items-center gap-1 rounded bg-surface-container-highest px-2 py-0.5 text-on-surface border border-outline-variant/40">
                        <span className="truncate">{msg}</span>
                        <button
                          type="button"
                          className="text-on-surface-variant hover:text-status-destructive transition-colors"
                          onClick={() => setQueuedMessages((q) => q.filter((_, i) => i !== idx))}
                          aria-label="Aus Warteschlange entfernen"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    </Kurzinfo>
                  ))}
                  {queuedMessages.length > 1 && (
                    <button
                      type="button"
                      className="ml-auto text-label-sm text-on-surface-variant hover:text-status-destructive underline transition-colors"
                      onClick={() => setQueuedMessages([])}
                    >
                      Alle leeren
                    </button>
                  )}
                </div>
              )}

              {/* Autovervollständigung für Slash-Befehle und Skills */}
              {zeigeSlashMenu && gefilterteSlashBefehle.length > 0 && (
                <div
                  role="listbox"
                  aria-label="Verfügbare Befehle und Skills"
                  className="mb-2 max-h-64 overflow-y-auto rounded-2xl border border-outline-variant/40 bg-surface-container-high/95 p-2 shadow-2xl backdrop-blur-xl animate-fade-in"
                >
                  <div className="px-2.5 py-1 text-label-sm font-semibold uppercase tracking-wider text-white/50">
                    Befehle & Skills ({gefilterteSlashBefehle.length})
                  </div>
                  <div className="space-y-1 mt-1">
                    {gefilterteSlashBefehle.map((befehl, idx) => {
                      const aktiv = idx === slashIndex
                      const Icon = befehl.icon
                      return (
                        <button
                          key={befehl.id}
                          type="button"
                          role="option"
                          aria-selected={aktiv}
                          className={[
                            'flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-xs transition-colors',
                            aktiv
                              ? 'bg-primary/25 border border-primary/45 text-white'
                              : 'text-white/85 hover:bg-white/10 hover:text-white border border-transparent',
                          ].join(' ')}
                          onMouseEnter={() => setSlashIndex(idx)}
                          onClick={() => befehl.ausfuehren()}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div
                              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                                aktiv ? 'bg-primary/30 text-primary' : 'bg-white/10 text-white/70'
                              }`}
                            >
                              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                            </div>
                            <div className="min-w-0">
                              <span className="font-semibold text-white">{befehl.label}</span>
                              <span className="ml-2 truncate text-white/60">{befehl.beschreibung}</span>
                            </div>
                          </div>
                          <span className="text-label-sm text-white/40 shrink-0 font-mono">
                            {befehl.art === 'skill' ? 'Skill' : 'Aktion'}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

    </>
  )
}
