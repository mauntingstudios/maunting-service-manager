import type { ChangeEvent, Dispatch, SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import { Archive, ChevronDown, Search } from 'lucide-react'
import { Input } from '@maunting/ui'
import type { ChatGroupItem, ChatStoryItem } from '@/api/social'
import { FreundschaftsanfragenKarte } from '@/components/social/FreundschaftsanfragenKarte'
import { MessengerRail } from '@/components/social/sidebar/MessengerRail'
import { StoriesCarouselBar, type StoryIch } from '@/components/social/sidebar/StoriesCarouselBar'
import { ContactListItem, type ChatContact } from '@/components/social/sidebar/ConversationListItem'
import { CommunityView } from '@/components/social/sidebar/CommunityView'
import { StatusUpdatesView } from '@/components/social/sidebar/StatusUpdatesView'
import { MessengerBottomNav } from '@/components/social/sidebar/MessengerModeNav'
import type { useStoryAnsicht } from '@/hooks/useStoryAnsicht'
import type { useUeberallAnsicht } from '@/hooks/useUeberallAnsicht'
import type { MessengerNavTab } from './useMessengerKontakte'

export interface MessengerSidebarColumnProps {
  mobileNavTab: MessengerNavTab
  setMobileNavTab: Dispatch<SetStateAction<MessengerNavTab>>
  isSidebarCollapsed: boolean
  setIsSidebarCollapsed: Dispatch<SetStateAction<boolean>>
  isChatOpen: boolean
  stories: ChatStoryItem[]
  storyIch: StoryIch
  storyAnsicht: ReturnType<typeof useStoryAnsicht>
  unreadCounts: Record<string, number>
  ungelesenChats: number
  ungelesenCommunity: number
  funkeGesamt: number
  hatNeueMarkierung: boolean
  onClearNeueMarkierung: () => void
  mentionedChatsCount: number
  onFunke: () => void
  onOpenWallpaperModal: () => void
  ueberall: ReturnType<typeof useUeberallAnsicht>
  searchQuery: string
  setSearchQuery: Dispatch<SetStateAction<string>>
  widerruf: { text: string; zurueck: () => void } | null
  onClearWiderruf: () => void
  archivZahl: number
  archivUngelesen: number
  archivOffen: boolean
  setArchivOffen: Dispatch<SetStateAction<boolean>>
  filteredContacts: ChatContact[]
  kontakteNachArchiv: { sichtbar: ChatContact[]; imArchiv: ChatContact[] }
  contactsList: ChatContact[]
  contactMailboxMap: Record<number, string>
  groupMailboxMap: Record<number, string>
  entwuerfeVorschau: Record<string, string>
  activeContact: ChatContact | null
  activeGroup: ChatGroupItem | null
  groups: ChatGroupItem[]
  onSelectContact: (kontakt: ChatContact, mailboxId: string | undefined) => void
  onOpenStatusChat: (kontakt: ChatContact) => void
  onSelectGroup: (gruppe: ChatGroupItem) => void
  onOpenCreateGroup: () => void
  onCopyInviteLink: (gruppe: ChatGroupItem) => void
  onAnheftenChat: (mid: string) => void
  onArchivieren: (mid: string) => void
  onZeilenMenue: (mid: string, name: string) => void
  onRefreshData: () => void
}

/** Linke Messenger-Navigationsleiste (Desktop Rail + Kontakt/Gruppen/Status-Spalte + Bottom Nav). */
export function MessengerSidebarColumn({
  mobileNavTab,
  setMobileNavTab,
  isSidebarCollapsed,
  setIsSidebarCollapsed,
  isChatOpen,
  stories,
  storyIch,
  storyAnsicht,
  unreadCounts,
  ungelesenChats,
  ungelesenCommunity,
  funkeGesamt,
  hatNeueMarkierung,
  onClearNeueMarkierung,
  mentionedChatsCount,
  onFunke,
  onOpenWallpaperModal,
  ueberall,
  searchQuery,
  setSearchQuery,
  widerruf,
  onClearWiderruf,
  archivZahl,
  archivUngelesen,
  archivOffen,
  setArchivOffen,
  filteredContacts,
  kontakteNachArchiv,
  contactsList,
  contactMailboxMap,
  groupMailboxMap,
  entwuerfeVorschau,
  activeContact,
  activeGroup,
  groups,
  onSelectContact,
  onOpenStatusChat,
  onSelectGroup,
  onOpenCreateGroup,
  onCopyInviteLink,
  onAnheftenChat,
  onArchivieren,
  onZeilenMenue,
  onRefreshData,
}: MessengerSidebarColumnProps) {
  const { t } = useTranslation()

  const zeichneKontakt = (c: ChatContact) => {
    const cmid = contactMailboxMap[c.userId]
    return (
      <ContactListItem
        key={c.listKey}
        kontakt={c}
        mid={cmid}
        ausgewaehlt={activeContact?.userId === c.userId}
        entwurf={cmid ? entwuerfeVorschau[cmid] || '' : ''}
        onOeffnen={() => onSelectContact(c, cmid)}
        onAnheften={onAnheftenChat}
        onArchivieren={onArchivieren}
        onMenue={onZeilenMenue}
      />
    )
  }

  return (
    <>
      {/* Desktop Navigation Rail */}
      <MessengerRail
        modus={mobileNavTab}
        onModus={(neu) => {
          setMobileNavTab(neu)
          setIsSidebarCollapsed(false)
        }}
        hatStories={stories.length > 0}
        ungelesenGesamt={Object.values(unreadCounts).reduce((a, b) => a + b, 0)}
        ungelesenChats={ungelesenChats}
        ungelesenCommunity={ungelesenCommunity}
        funkeZahl={funkeGesamt}
        hatNeueMarkierung={hatNeueMarkierung}
        ungeleseneErwaehnungen={mentionedChatsCount}
        onFunke={onFunke}
        onMarkierteNachrichten={() => {
          onClearNeueMarkierung()
          void ueberall.oeffne('markiert')
        }}
        onAntwortenAnMich={() => void ueberall.oeffne('anMich')}
        onHintergrund={onOpenWallpaperModal}
      />

      {/* Left Column: Modern Contacts & Groups List */}
      <div
        className={`w-full md:w-80 lg:w-96 shrink-0 flex flex-col min-h-0 border-r border-outline-variant/30 bg-surface-container messenger-sidebar msm-sidebar ${
          isChatOpen ? 'hidden md:flex' : 'flex'
        } ${isSidebarCollapsed ? 'md:hidden' : ''}`}
      >
        <FreundschaftsanfragenKarte />

        {/* Stories Bar direkt oben über den Kontakten */}
        {mobileNavTab === 'chats' && !searchQuery.trim() && (
          <StoriesCarouselBar
            ich={storyIch}
            eigeneStories={storyAnsicht.eigene}
            freunde={storyAnsicht.freunde}
            onOeffnen={(s) => storyAnsicht.betrachter.oeffne(s)}
            onErstellen={storyAnsicht.erstellung.mitText}
          />
        )}

        {/* Suchleiste für Kontakte */}
        {mobileNavTab === 'chats' && (
          <div className="flex items-center gap-2 p-2.5 border-b border-outline-variant/20 bg-transparent">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50" />
              <Input
                value={searchQuery}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
                placeholder={t('messenger.searchPlaceholder')}
                className="text-xs pl-8 h-8 rounded-full bg-surface-container-high/40 border border-outline-variant/30 text-on-surface placeholder:text-on-surface-variant/50 focus:border-primary/50 transition-all"
              />
            </div>
          </div>
        )}

        {/* Der Rückweg nach einer Wischgeste. Unten, weil dort der Daumen ist. */}
        {widerruf && (
          <div className="shrink-0 mx-2 mb-1 px-3 py-2 rounded-xl bg-surface-container-high border border-outline-variant/30 flex items-center justify-between gap-2">
            <span className="text-xs text-on-surface truncate">{widerruf.text}</span>
            <button
              type="button"
              onClick={() => {
                widerruf.zurueck()
                onClearWiderruf()
              }}
              className="min-h-11 px-3 text-xs font-semibold text-primary hover:bg-surface-container-highest rounded-lg transition-colors shrink-0"
            >
              Widerrufen
            </button>
          </div>
        )}

        {/* List Scroll Area */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {/* View 1: Standard Chats Mode - Nur Direktnachrichten, keine Gruppen */}
          {mobileNavTab === 'chats' && (
            <>
              {/* Das Archiv */}
              {archivZahl > 0 && (
                <button
                  type="button"
                  onClick={() => setArchivOffen((offen) => !offen)}
                  className="w-full min-h-11 px-2.5 py-2 mb-1.5 flex items-center gap-2.5 rounded-2xl text-left bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 transition-colors"
                  aria-expanded={archivOffen}
                >
                  <span className="w-9 h-9 rounded-full bg-white/10 text-on-surface-variant flex items-center justify-center shrink-0">
                    <Archive className="w-4 h-4" />
                  </span>
                  <span className="min-w-0 flex-1 text-xs font-semibold text-on-surface">
                    Archiviert ({archivZahl})
                  </span>
                  {archivUngelesen > 0 && (
                    <span className="inline-flex items-center justify-center px-1.5 py-0.5 text-label-sm font-bold rounded-full bg-primary text-on-primary min-w-[18px]">
                      {archivUngelesen > 99 ? '99+' : archivUngelesen}
                    </span>
                  )}
                  <ChevronDown
                    className={`w-4 h-4 text-on-surface-variant/70 shrink-0 transition-transform ${
                      archivOffen ? 'rotate-180' : ''
                    }`}
                  />
                </button>
              )}

              {/* Reine Kontaktliste */}
              {filteredContacts.length > 0 && (
                <div className="space-y-1.5">
                  {(archivOffen
                    ? [...kontakteNachArchiv.sichtbar, ...kontakteNachArchiv.imArchiv]
                    : kontakteNachArchiv.sichtbar
                  ).map((c) => zeichneKontakt(c))}
                </div>
              )}

              {filteredContacts.length === 0 && (
                <p className="py-12 text-center text-xs text-on-surface-variant/70">
                  {searchQuery.trim() ? 'Keine Kontakte gefunden.' : t('messenger.noContacts')}
                </p>
              )}

              {/* Volltextsuche über alle Chats, wenn ein Suchbegriff eingegeben wurde */}
              {searchQuery.trim().length > 1 && (
                <div className="pt-2 mt-1 border-t border-outline-variant/20">
                  <button
                    type="button"
                    onClick={() => void ueberall.oeffne('suche', searchQuery)}
                    className="w-full min-h-11 px-2.5 flex items-center gap-2.5 rounded-2xl text-left text-xs text-primary hover:bg-surface-container-high/60 transition-colors"
                  >
                    <Search className="w-4 h-4 shrink-0" />
                    <span className="truncate">{t('messenger.searchInMessages', { query: searchQuery.trim() })}</span>
                  </button>
                </div>
              )}
            </>
          )}

          {mobileNavTab === 'community' && (
            <CommunityView
              gruppen={groups}
              onGruppe={onSelectGroup}
              onNeueGruppe={onOpenCreateGroup}
              onEinladungKopieren={onCopyInviteLink}
              aktiveGruppeId={activeGroup?.id}
              ungeleseneNachrichten={unreadCounts}
              gruppenMailboxMap={groupMailboxMap}
            />
          )}

          {mobileNavTab === 'updates' && (
            <StatusUpdatesView
              ich={storyIch}
              eigeneStories={storyAnsicht.eigene}
              freunde={storyAnsicht.freunde}
              kontakte={contactsList}
              onOeffnen={(s) => storyAnsicht.betrachter.oeffne(s)}
              onErstellen={storyAnsicht.erstellung.mitText}
              onChat={onOpenStatusChat}
            />
          )}
        </div>

        {!isChatOpen && (
          <MessengerBottomNav
            modus={mobileNavTab}
            onModus={setMobileNavTab}
            ungelesenChats={ungelesenChats}
            ungelesenCommunity={ungelesenCommunity}
            hatStories={stories.length > 0}
            hatNeueMarkierung={hatNeueMarkierung}
            ungeleseneErwaehnungen={mentionedChatsCount}
            onFunke={onFunke}
            onMarkierteNachrichten={() => {
              onClearNeueMarkierung()
              void ueberall.oeffne('markiert')
            }}
            onAntwortenAnMich={() => void ueberall.oeffne('anMich')}
            onHintergrund={onOpenWallpaperModal}
            onAktualisieren={onRefreshData}
          />
        )}
      </div>
    </>
  )
}
