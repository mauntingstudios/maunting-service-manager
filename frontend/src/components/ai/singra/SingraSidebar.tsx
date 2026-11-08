import { useState } from 'react'
import {
  Bookmark,
  BookOpen,
  Folder,
  FolderGit2,
  History,
  Layers,
  LayoutGrid,
  MessageSquare,
  Pencil,
  Pin,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { type AiConversationSummary } from '@/api/ai'
import { Avatar } from '@/components/app/Avatar'
import { useAuthStore } from '@/stores/authStore'
import { AiGenerationBadge } from './AiGenerationBadge'

export type SingraSection =
  | 'chat'
  | 'projekte'
  | 'wissen'
  | 'dateien'
  | 'erinnerungen'
  | 'tools'
  | 'verlauf'

interface SingraNavDef {
  id: SingraSection
  label: string
  icon: React.ComponentType<{ className?: string }>
}

export const SINGRA_MAIN_NAV: SingraNavDef[] = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'projekte', label: 'Projekte', icon: Layers },
  { id: 'wissen', label: 'Wissen', icon: BookOpen },
  { id: 'dateien', label: 'KI-Speicher', icon: Folder },
  { id: 'erinnerungen', label: 'Erinnerungen', icon: Bookmark },
  { id: 'tools', label: 'Tools', icon: LayoutGrid },
]

export const SINGRA_MOBILE_TABS: SingraNavDef[] = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'projekte', label: 'Projekte', icon: Layers },
  { id: 'wissen', label: 'Wissen', icon: BookOpen },
  { id: 'tools', label: 'Tools', icon: LayoutGrid },
]

interface SingraSidebarProps {
  activeSection: SingraSection
  onSelectSection: (section: SingraSection) => void
  conversations: AiConversationSummary[]
  activeConversationId: string | null
  onSelectConversation: (conversationId: string) => void
  onNewChat: () => void
  onRenameConversation?: (conv: AiConversationSummary, newTitle: string) => Promise<void>
  onTogglePinConversation?: (conv: AiConversationSummary) => void
  onDeleteConversation?: (conv: AiConversationSummary) => void
  mobileDrawerOpen: boolean
  onCloseMobileDrawer: () => void
}

function SidebarContent({
  activeSection,
  onSelectSection,
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewChat,
  onRenameConversation,
  onTogglePinConversation,
  onDeleteConversation,
  onCloseMobile,
}: {
  activeSection: SingraSection
  onSelectSection: (section: SingraSection) => void
  conversations: AiConversationSummary[]
  activeConversationId: string | null
  onSelectConversation: (conversationId: string) => void
  onNewChat: () => void
  onRenameConversation?: (conv: AiConversationSummary, newTitle: string) => Promise<void>
  onTogglePinConversation?: (conv: AiConversationSummary) => void
  onDeleteConversation?: (conv: AiConversationSummary) => void
  onCloseMobile?: () => void
}) {
  const user = useAuthStore((s) => s.user)
  const displayName = user?.username || 'Nutzer'
  const recentConversations = conversations.slice(0, 8)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')

  return (
    <div className="flex h-full w-full flex-col justify-between bg-transparent text-on-surface select-none">
      {/* Top Brand + New Chat */}
      <div className="flex flex-col gap-3 px-3.5 pt-4 pb-2">
        <div className="flex items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-primary/35 bg-black/60 shadow-[0_0_16px_rgba(56,189,248,0.3)] overflow-hidden">
              <img
                src="/singra-logo.png"
                alt="Singra Logo"
                className="h-full w-full object-contain rounded-full"
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 font-headline text-base font-semibold tracking-tight text-on-surface leading-tight">
                <span>Singra</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                onNewChat()
                onCloseMobile?.()
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/12 px-2.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
              aria-label="Neuen Chat starten"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Neu</span>
            </button>
            {onCloseMobile && (
              <button
                type="button"
                onClick={onCloseMobile}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface lg:hidden"
                aria-label="Menü schließen"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="mt-1 space-y-1" aria-label="Singra Bereiche">
          {SINGRA_MAIN_NAV.map((item) => {
            const Icon = item.icon
            const active = activeSection === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelectSection(item.id)
                  onCloseMobile?.()
                }}
                aria-current={active ? 'page' : undefined}
                className={[
                  'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all',
                  active
                    ? 'bg-gradient-to-r from-primary/22 via-primary/14 to-transparent text-on-surface border border-primary/30 shadow-sm'
                    : 'text-on-surface-variant hover:bg-surface-container-high/50 hover:text-on-surface border border-transparent',
                ].join(' ')}
              >
                <Icon
                  className={`h-4 w-4 shrink-0 ${
                    active ? 'text-primary' : 'text-on-surface-variant'
                  }`}
                />
                <span className="truncate">{item.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="my-1 h-px bg-outline-variant/25" />

        {/* Verlauf Section */}
        <div className="flex items-center justify-between px-2">
          <button
            type="button"
            onClick={() => {
              onSelectSection('verlauf')
              onCloseMobile?.()
            }}
            className={[
              'flex items-center gap-2.5 text-xs font-semibold uppercase tracking-wider transition-colors py-1',
              activeSection === 'verlauf'
                ? 'text-primary'
                : 'text-on-surface-variant hover:text-on-surface',
            ].join(' ')}
          >
            <History className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Verlauf</span>
          </button>
          {conversations.length > 0 && (
            <button
              type="button"
              onClick={() => {
                onSelectSection('verlauf')
                onCloseMobile?.()
              }}
              className="text-label-sm text-on-surface-variant hover:text-primary transition-colors"
            >
              Alle ({conversations.length})
            </button>
          )}
        </div>
      </div>

      {/* Scrollable Recent Conversations */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3.5 py-1 space-y-0.5 msm-ohne-rollbalken">
        {recentConversations.length === 0 ? (
          <p className="px-2.5 py-2 text-xs text-on-surface-variant/65">
            Noch keine gespeicherten Unterhaltungen.
          </p>
        ) : (
          recentConversations.map((conv) => {
            const isSelected =
              activeSection === 'chat' && activeConversationId === conv.id
            const isEditing = editingId === conv.id

            if (isEditing) {
              return (
                <div
                  key={conv.id}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs bg-surface-container-high border border-primary/40"
                >
                  <input
                    type="text"
                    className="flex-1 min-w-0 bg-transparent text-xs text-on-surface focus:outline-none"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        if (editTitle.trim() && editTitle.trim() !== conv.title) {
                          void onRenameConversation?.(conv, editTitle.trim())
                        }
                        setEditingId(null)
                      } else if (e.key === 'Escape') {
                        setEditingId(null)
                      }
                    }}
                    autoFocus
                    onBlur={() => {
                      if (editTitle.trim() && editTitle.trim() !== conv.title) {
                        void onRenameConversation?.(conv, editTitle.trim())
                      }
                      setEditingId(null)
                    }}
                  />
                </div>
              )
            }

            return (
              <div
                key={conv.id}
                className={[
                  'group flex items-center justify-between gap-1 rounded-lg px-2.5 py-1.5 text-xs transition-colors',
                  isSelected
                    ? 'bg-primary/15 text-on-surface font-medium border border-primary/25'
                    : 'text-on-surface-variant hover:bg-surface-container-high/45 hover:text-on-surface border border-transparent',
                ].join(' ')}
              >
                <button
                  type="button"
                  onClick={() => {
                    onSelectConversation(conv.id)
                    onCloseMobile?.()
                  }}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  {conv.pinned ? (
                    <Pin className="h-3 w-3 shrink-0 text-primary" aria-hidden="true" />
                  ) : conv.project_id ? (
                    <FolderGit2 className="h-3 w-3 shrink-0 text-primary" aria-hidden="true" />
                  ) : (
                    <MessageSquare className="h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />
                  )}
                  <span className="truncate">{conv.title || 'Unterhaltung'}</span>
                  <AiGenerationBadge conversationId={conv.id} className="ml-auto shrink-0" />
                </button>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                  {onRenameConversation && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditingId(conv.id)
                        setEditTitle(conv.title || '')
                      }}
                      className="rounded p-1 text-on-surface-variant hover:text-primary"
                      aria-label="Unterhaltung umbenennen"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  )}
                  {onTogglePinConversation && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onTogglePinConversation(conv)
                      }}
                      className="rounded p-1 text-on-surface-variant hover:text-primary"
                      aria-label={conv.pinned ? 'Anheftung lösen' : 'Anheften'}
                    >
                      <Pin className="h-3 w-3" />
                    </button>
                  )}
                  {onDeleteConversation && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDeleteConversation(conv)
                      }}
                      className="rounded p-1 text-on-surface-variant hover:text-status-destructive"
                      aria-label="Unterhaltung löschen"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* User Footer */}
      <div className="shrink-0 border-t border-outline-variant/20 px-3.5 py-3">
        <div className="flex items-center justify-between gap-2.5 rounded-xl bg-surface-container-high/30 px-2.5 py-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <Avatar src={user?.avatar_url} name={displayName} size="xs" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-xs font-medium text-on-surface">
                  {displayName}
                </span>
                <span
                  className="h-2 w-2 shrink-0 rounded-full bg-status-success"
                  aria-hidden="true"
                />
              </div>
              <span className="block truncate text-label-sm text-on-surface-variant/75">
                Singra Workspace
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function SingraSidebar(props: SingraSidebarProps) {
  return (
    <>
      {/* Desktop Left Sidebar */}
      <aside
        className="hidden lg:flex lg:w-60 xl:w-64 shrink-0 flex-col border-r border-outline-variant/30 bg-surface-container-lowest/85 backdrop-blur-xl"
        aria-label="Singra Seitenleiste"
      >
        <SidebarContent {...props} />
      </aside>

      {/* Mobile Drawer Overlay */}
      {props.mobileDrawerOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden" role="dialog" aria-modal="true" aria-label="Singra Navigation">
          <div
            className="fixed inset-0 bg-black/65 backdrop-blur-sm transition-opacity"
            onClick={props.onCloseMobileDrawer}
            aria-hidden="true"
          />
          <div
            className="relative z-10 flex h-full w-72 max-w-[84vw] flex-col border-r border-outline-variant/30 bg-surface-container-lowest/95 backdrop-blur-2xl shadow-2xl"
            style={{
              paddingTop: 'max(0px, var(--msm-oben-sicher, 0px))',
              paddingBottom: 'max(0px, var(--msm-unten-sicher, 0px))',
            }}
          >
            <SidebarContent {...props} onCloseMobile={props.onCloseMobileDrawer} />
          </div>
        </div>
      )}
    </>
  )
}

export function SingraMobileBottomBar({
  activeSection,
  onSelectSection,
}: {
  activeSection: SingraSection
  onSelectSection: (section: SingraSection) => void
}) {
  return (
    <nav
      aria-label="Singra Schnellnavigation"
      className="flex lg:hidden shrink-0 items-center justify-around border-t border-outline-variant/30 bg-surface-container-lowest/90 backdrop-blur-xl px-2 pt-1.5"
      style={{
        paddingBottom: 'max(0.45rem, var(--msm-unten-sicher, 0.45rem))',
      }}
    >
      {SINGRA_MOBILE_TABS.map((tab) => {
        const Icon = tab.icon
        const active = activeSection === tab.id
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSelectSection(tab.id)}
            aria-current={active ? 'page' : undefined}
            className={[
              'flex flex-1 flex-col items-center justify-center gap-1 rounded-xl py-1.5 text-label-sm font-medium transition-colors',
              active
                ? 'text-primary'
                : 'text-on-surface-variant hover:text-on-surface',
            ].join(' ')}
          >
            <Icon className={`h-4 w-4 ${active ? 'text-primary' : ''}`} />
            <span>{tab.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
