import { useMemo, useState } from 'react'
import {
  Check,
  History,
  MessageSquare,
  Pencil,
  Pin,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { type AiConversationSummary } from '@/api/ai'
import { Button, Input } from '@maunting/ui'

interface SingraHistoryViewProps {
  conversations: AiConversationSummary[]
  activeConversationId: string | null
  onSelectConversation: (conversationId: string) => void
  onNewChat: () => void
  onRenameConversation: (conv: AiConversationSummary, newTitle: string) => Promise<void>
  onTogglePinConversation: (conv: AiConversationSummary) => Promise<void>
  onDeleteConversation: (conv: AiConversationSummary) => Promise<void>
}

export function SingraHistoryView({
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewChat,
  onRenameConversation,
  onTogglePinConversation,
  onDeleteConversation,
}: SingraHistoryViewProps) {
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return conversations
    return conversations.filter((c) =>
      (c.title || '').toLowerCase().includes(needle),
    )
  }, [conversations, query])

  const submitRename = async (conv: AiConversationSummary) => {
    const trimmed = editTitle.trim()
    setEditingId(null)
    if (!trimmed || trimmed === conv.title) return
    await onRenameConversation(conv, trimmed)
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-surface px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-outline-variant/30 bg-surface-container-low/45 p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <History className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="font-headline text-lg font-semibold text-on-surface">
                Unterhaltungsverlauf
              </h2>
              <p className="text-xs text-on-surface-variant">
                {conversations.length} gespeicherte Unterhaltungen — durchsuche, benenne um oder hefte wichtige Gespräche oben an.
              </p>
            </div>
          </div>

          <Button type="button" size="sm" onClick={onNewChat}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Neuer Chat
          </Button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Unterhaltungen nach Titel durchsuchen …"
            className="pl-10"
            aria-label="Unterhaltungen durchsuchen"
          />
        </div>

        {/* Conversation List */}
        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-low/30 p-10 text-center">
            <MessageSquare className="mx-auto h-8 w-8 text-on-surface-variant/60 mb-2" />
            <p className="text-sm font-medium text-on-surface">
              Keine Unterhaltungen gefunden
            </p>
            <p className="mt-1 text-xs text-on-surface-variant">
              Starte einen neuen Chat mit Singra, um deine erste Unterhaltung anzulegen.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((conv) => {
              const isSelected = conv.id === activeConversationId
              const isEditing = editingId === conv.id
              return (
                <div
                  key={conv.id}
                  className={[
                    'flex items-center justify-between gap-3 rounded-xl border p-3.5 transition-all',
                    isSelected
                      ? 'border-primary/40 bg-primary/10'
                      : 'border-outline-variant/30 bg-surface-container-low/40 hover:border-primary/30',
                  ].join(' ')}
                >
                  {isEditing ? (
                    <div className="flex flex-1 items-center gap-2">
                      <Input
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="flex-1 h-8 text-xs"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void submitRename(conv)
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                        aria-label="Titel bearbeiten"
                      />
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void submitRename(conv)}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditingId(null)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => onSelectConversation(conv.id)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <div
                          className={[
                            'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                            conv.pinned
                              ? 'bg-primary/20 text-primary'
                              : 'bg-surface-container-high text-on-surface-variant',
                          ].join(' ')}
                        >
                          {conv.pinned ? (
                            <Pin className="h-4 w-4" aria-hidden="true" />
                          ) : (
                            <MessageSquare className="h-4 w-4" aria-hidden="true" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-on-surface">
                              {conv.title || 'Unterhaltung'}
                            </span>
                            {isSelected && (
                              <span className="rounded-full bg-primary/20 px-2 py-0.5 text-label-sm font-medium text-primary">
                                Aktiv
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 text-xs text-on-surface-variant">
                            Zuletzt aktualisiert:{' '}
                            {new Date(conv.updated_at).toLocaleString()}
                          </div>
                        </div>
                      </button>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => void onTogglePinConversation(conv)}
                          className={[
                            'rounded-lg p-2 transition-colors',
                            conv.pinned
                              ? 'text-primary hover:bg-primary/15'
                              : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
                          ].join(' ')}
                          title={conv.pinned ? 'Anheftung lösen' : 'Oben anheften'}
                          aria-label={conv.pinned ? 'Anheftung lösen' : 'Oben anheften'}
                        >
                          <Pin className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(conv.id)
                            setEditTitle(conv.title)
                          }}
                          className="rounded-lg p-2 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-colors"
                          title="Umbenennen"
                          aria-label="Umbenennen"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void onDeleteConversation(conv)}
                          className="rounded-lg p-2 text-on-surface-variant hover:bg-status-destructive/15 hover:text-status-destructive transition-colors"
                          title="Löschen"
                          aria-label="Löschen"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
