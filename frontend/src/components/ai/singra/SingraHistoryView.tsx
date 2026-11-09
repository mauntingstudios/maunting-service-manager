import { useMemo, useState } from 'react'
import {
  Check,
  FolderGit2,
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
import { AiGenerationBadge } from './AiGenerationBadge'

interface SingraHistoryViewProps {
  conversations: AiConversationSummary[]
  activeConversationId: string | null
  projectMap?: Record<string, string>
  onSelectConversation: (conversationId: string) => void
  onNewChat: () => void
  onRenameConversation: (conv: AiConversationSummary, newTitle: string) => Promise<void>
  onTogglePinConversation: (conv: AiConversationSummary) => Promise<void>
  onDeleteConversation: (conv: AiConversationSummary) => Promise<void>
}

export function SingraHistoryView({
  conversations,
  activeConversationId,
  projectMap,
  onSelectConversation,
  onNewChat,
  onRenameConversation,
  onTogglePinConversation,
  onDeleteConversation,
}: SingraHistoryViewProps) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'main' | 'projects'>('all')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')

  const mainCount = useMemo(
    () => conversations.filter((c) => !c.project_id).length,
    [conversations],
  )
  const projectCount = useMemo(
    () => conversations.filter((c) => Boolean(c.project_id)).length,
    [conversations],
  )

  const filtered = useMemo(() => {
    let list = conversations
    if (filter === 'main') {
      list = list.filter((c) => !c.project_id)
    } else if (filter === 'projects') {
      list = list.filter((c) => Boolean(c.project_id))
    }
    const needle = query.trim().toLowerCase()
    if (!needle) return list
    return list.filter((c) => {
      const titleMatch = (c.title || '').toLowerCase().includes(needle)
      const projName = c.project_id ? (projectMap?.[c.project_id] || '').toLowerCase() : ''
      return titleMatch || projName.includes(needle)
    })
  }, [conversations, filter, projectMap, query])

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
                {conversations.length} gespeicherte Unterhaltungen: durchsuche, benenne um oder hefte wichtige Gespräche oben an.
              </p>
            </div>
          </div>

          <Button type="button" size="sm" onClick={onNewChat}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Neuer Chat
          </Button>
        </div>

        {/* Search & Filter */}
        <div className="space-y-2.5">
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

          <div className="flex items-center gap-1.5 overflow-x-auto msm-ohne-rollbalken">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={[
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors border',
                filter === 'all'
                  ? 'bg-primary/15 text-primary border-primary/30'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/40 border-transparent',
              ].join(' ')}
            >
              <span>Alle ({conversations.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setFilter('main')}
              className={[
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors border',
                filter === 'main'
                  ? 'bg-primary/15 text-primary border-primary/30'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/40 border-transparent',
              ].join(' ')}
            >
              <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Hauptchats ({mainCount})</span>
            </button>
            <button
              type="button"
              onClick={() => setFilter('projects')}
              className={[
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors border',
                filter === 'projects'
                  ? 'bg-primary/15 text-primary border-primary/30'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/40 border-transparent',
              ].join(' ')}
            >
              <FolderGit2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Projekte ({projectCount})</span>
            </button>
          </div>
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
                              : conv.project_id
                                ? 'bg-primary/15 text-primary'
                                : 'bg-surface-container-high text-on-surface-variant',
                          ].join(' ')}
                        >
                          {conv.pinned ? (
                            <Pin className="h-4 w-4" aria-hidden="true" />
                          ) : conv.project_id ? (
                            <FolderGit2 className="h-4 w-4" aria-hidden="true" />
                          ) : (
                            <MessageSquare className="h-4 w-4" aria-hidden="true" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="truncate text-sm font-medium text-on-surface">
                              {conv.title || 'Unterhaltung'}
                            </span>
                            <AiGenerationBadge conversationId={conv.id} />
                            {conv.project_id && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-primary/12 px-2 py-0.5 text-label-sm font-medium text-primary border border-primary/20">
                                <FolderGit2 className="h-3 w-3" aria-hidden="true" />
                                <span>{projectMap?.[conv.project_id] || 'Projekt'}</span>
                              </span>
                            )}
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
                          aria-label="Umbenennen"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void onDeleteConversation(conv)}
                          className="rounded-lg p-2 text-on-surface-variant hover:bg-status-destructive/15 hover:text-status-destructive transition-colors"
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
