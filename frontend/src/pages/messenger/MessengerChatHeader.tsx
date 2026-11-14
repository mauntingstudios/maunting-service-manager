import { useTranslation } from 'react-i18next'
import type { ChatGroupItem } from '@/api/social'
import type { ChatMessage } from '@/components/social/ChatMessageBubble'
import type { ChatContact } from '@/components/social/sidebar/ConversationListItem'
import { ChatSelectionBar } from '@/components/social/chat/ChatSelectionBar'
import { ChatHeader } from '@/components/social/chat/ChatHeader'
import { ChatActionsMenu } from '@/components/social/chat/ChatActionsMenu'
import { FunkenAbzeichen } from '@/components/social/FunkenBadge'
import { istWeiterleitbar } from '@/services/nachrichtWeiterleiten'
import { stufenLabel } from '@/services/nachrichtVerfall'
import { toast } from '@/stores/toastStore'

export interface MessengerChatHeaderProps {
  auswahlModus: boolean
  auswahlGroesse: number
  gewaehlteNachrichten: () => ChatMessage[]
  onBeendeAuswahl: () => void
  onForwardSelection: (messages: ChatMessage[]) => void
  onCopySelection: () => Promise<void>
  onMarkieren: (msg: ChatMessage) => void
  onDeleteSelection: () => Promise<void>
  activeGroup: ChatGroupItem | null
  activeContact: ChatContact | null
  currentUserId: number
  gruppenTitel: (g: { name?: string | null } | null | undefined) => string
  blindMailboxId: string
  isChatMuted: (mid: string) => boolean
  isBlocked: (uid: number) => boolean
  onZurueck: () => void
  isSidebarCollapsed: boolean
  onToggleSidebar: () => void
  groupCallCanStart: boolean
  onStartCall: (art: 'audio' | 'video') => Promise<void>
  onStartGroupCall: (video: boolean) => void
  angeheftet: ChatMessage | null
  darfAnheften: boolean
  onTogglePinned: (msg: ChatMessage) => Promise<void>
  onOpenFunkenRettung: (kontakt: ChatContact) => Promise<void>
  onSendFriendRequest: () => Promise<void>
  anfrageGesendet: boolean
  onNavigateProfile: (userId: number) => void
  onOpenSearch: () => void
  verfallSekunden: number
  darfVerfallStellen: boolean
  onOpenMute: () => void
  onOpenSafetyNumber: () => void
  onOpenDisappearing: () => void
  onOpenAugenblick: () => void
  onOpenGroupBackground: () => void
  onOpenPersonalWallpaper: () => void
  onCopyInviteLink: (gruppe: ChatGroupItem) => void
  onOpenGroupSettings: () => void
  onDeleteGroup: (gruppe: ChatGroupItem) => void
  onLeaveGroup: (gruppe: ChatGroupItem) => void
  onOpenBlockConfirm: () => void
  onOpenRemoveChat: () => void
}

/** Kopfzeile des offenen Chats: Mehrfachauswahl-Leiste oder Chat-Header samt Aktionsmenü. */
export function MessengerChatHeader({
  auswahlModus,
  auswahlGroesse,
  gewaehlteNachrichten,
  onBeendeAuswahl,
  onForwardSelection,
  onCopySelection,
  onMarkieren,
  onDeleteSelection,
  activeGroup,
  activeContact,
  currentUserId,
  gruppenTitel,
  blindMailboxId,
  isChatMuted,
  isBlocked,
  onZurueck,
  isSidebarCollapsed,
  onToggleSidebar,
  groupCallCanStart,
  onStartCall,
  onStartGroupCall,
  angeheftet,
  darfAnheften,
  onTogglePinned,
  onOpenFunkenRettung,
  onSendFriendRequest,
  anfrageGesendet,
  onNavigateProfile,
  onOpenSearch,
  verfallSekunden,
  darfVerfallStellen,
  onOpenMute,
  onOpenSafetyNumber,
  onOpenDisappearing,
  onOpenAugenblick,
  onOpenGroupBackground,
  onOpenPersonalWallpaper,
  onCopyInviteLink,
  onOpenGroupSettings,
  onDeleteGroup,
  onLeaveGroup,
  onOpenBlockConfirm,
  onOpenRemoveChat,
}: MessengerChatHeaderProps) {
  const { t } = useTranslation()

  if (auswahlModus) {
    return (
      <ChatSelectionBar
        anzahl={auswahlGroesse}
        loeschenMoeglich={gewaehlteNachrichten().some((m) => m.isSelf && !m.isDeleted)}
        onBeenden={onBeendeAuswahl}
        onWeiterleiten={() => {
          const auswahl = gewaehlteNachrichten().filter(istWeiterleitbar)
          if (!auswahl.length) {
            toast.error(t('messenger.nothingToForwardPlural'))
            return
          }
          onForwardSelection(auswahl)
        }}
        onKopieren={() => void onCopySelection()}
        onMarkieren={() => {
          for (const m of gewaehlteNachrichten()) onMarkieren(m)
          onBeendeAuswahl()
        }}
        onLoeschen={() => void onDeleteSelection()}
      />
    )
  }

  return (
    <ChatHeader
      titel={(activeGroup ? gruppenTitel(activeGroup) : activeContact?.username) ?? ''}
      info={activeGroup ? null : activeContact?.info?.text ?? null}
      bild={activeGroup ? activeGroup.avatar_url ?? null : activeContact?.avatarUrl ?? null}
      stumm={Boolean(blindMailboxId && isChatMuted(blindMailboxId))}
      blockiert={Boolean(activeContact && isBlocked(activeContact.userId))}
      onZurueck={onZurueck}
      onSeitenleisteUmschalten={onToggleSidebar}
      seitenleisteEingeklappt={isSidebarCollapsed}
      onSprachanruf={
        activeContact?.isFriend
          ? () => void onStartCall('audio')
          : activeGroup && groupCallCanStart
            ? () => onStartGroupCall(false)
            : undefined
      }
      onVideoanruf={
        activeContact?.isFriend
          ? () => void onStartCall('video')
          : activeGroup && groupCallCanStart
            ? () => onStartGroupCall(true)
            : undefined
      }
      onAnheften={
        angeheftet && darfAnheften ? () => void onTogglePinned(angeheftet) : undefined
      }
      angeheftet={Boolean(angeheftet)}
      online={activeContact?.status === 'online'}
      funke={
        activeContact?.isFriend ? (
          <FunkenAbzeichen
            partnerId={activeContact.userId}
            name={activeContact.username}
            interaktiv
            onWiederherstellen={() => void onOpenFunkenRettung(activeContact)}
          />
        ) : null
      }
      onFreundschaftsanfrage={
        activeContact && !activeContact.isFriend ? () => void onSendFriendRequest() : undefined
      }
      anfrageGesendet={anfrageGesendet}
      onProfil={activeContact ? () => onNavigateProfile(activeContact.userId) : undefined}
      onSuche={onOpenSearch}
      menue={(schliessen) => (
        <ChatActionsMenu
          schliessen={schliessen}
          stumm={blindMailboxId ? isChatMuted(blindMailboxId) : null}
          kontakt={
            activeContact
              ? { istFreund: activeContact.isFriend, blockiert: isBlocked(activeContact.userId) }
              : null
          }
          gruppe={
            activeGroup
              ? {
                  hatEinladung: Boolean(activeGroup.invite_code),
                  istEigentuemer: activeGroup.owner_user_id === currentUserId,
                  istAdmin: activeGroup.role === 'admin',
                }
              : null
          }
          verfallStufe={stufenLabel(verfallSekunden > 0 ? verfallSekunden : 0, t)}
          verfallErlaubt={darfVerfallStellen}
          onStumm={onOpenMute}
          onProfil={() => activeContact && onNavigateProfile(activeContact.userId)}
          onSicherheitsnummer={onOpenSafetyNumber}
          onVerfall={onOpenDisappearing}
          onVideoanruf={() => void onStartCall('video')}
          onSprachanruf={
            activeContact?.isFriend ? () => void onStartCall('audio') : undefined
          }
          onGruppenanruf={
            activeGroup
              ? { erlaubt: groupCallCanStart, onStarten: () => onStartGroupCall(false) }
              : undefined
          }
          onAugenblick={
            activeContact?.isFriend && !isBlocked(activeContact.userId) ? onOpenAugenblick : undefined
          }
          onHintergrund={() => {
            if (activeGroup) {
              onOpenGroupBackground()
            } else {
              onOpenPersonalWallpaper()
            }
          }}
          onEinladung={() => activeGroup && onCopyInviteLink(activeGroup)}
          onEinstellungen={onOpenGroupSettings}
          onLoeschen={() => activeGroup && onDeleteGroup(activeGroup)}
          onVerlassen={() => activeGroup && onLeaveGroup(activeGroup)}
          onBlockieren={onOpenBlockConfirm}
          onChatEntfernen={onOpenRemoveChat}
        />
      )}
    />
  )
}
