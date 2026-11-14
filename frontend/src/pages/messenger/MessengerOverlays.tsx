import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  ArchiveRestore,
  Bell,
  BellOff,
  Pin,
  PinOff,
  Timer,
  UserCheck,
  X,
} from 'lucide-react'
import { Blatteintrag, Blattmenue } from '@maunting/ui'
import type { ChatGroupItem, ChatStoryItem } from '@/api/social'
import type { CalendarEventItem } from '@/pages/Calendar'
import type { NoteItem } from '@/pages/Notes'
import type { ChatMessage } from '@/components/social/ChatMessageBubble'
import type { ImageAttachment } from '@/components/social/ChatMediaAttachments'
import type { ChatContact } from '@/components/social/sidebar/ConversationListItem'
import { CircularVideoNoteRecorder, type VideoNoteAufnahme } from '@/components/social/CircularVideoNoteRecorder'
import { CreateStoryModal } from '@/components/social/CreateStoryModal'
import { StoryViewerModal, type StoryReplyContext } from '@/components/social/StoryViewerModal'
import { ErwaehnungsWache } from '@/components/social/ErwaehnungsWache'
import { FunkenWache } from '@/components/social/FunkenWache'
import { GruppenMetaWache } from '@/components/social/GruppenMetaWache'
import { NachrichtenMenue } from '@/components/social/NachrichtenMenue'
import { TrefferListe } from '@/components/social/TrefferListe'
import { WeiterleitenAnsicht } from '@/components/social/WeiterleitenAnsicht'
import { CalendarPickerDialog } from '@/components/social/modals/CalendarPickerDialog'
import { ChatEntfernenDialog } from '@/components/social/modals/ChatEntfernenDialog'
import { FunkenEmpfaengerModal } from '@/components/social/modals/FunkenEmpfaengerModal'
import { MessengerDialoge } from '@/components/social/modals/MessengerDialoge'
import { NotePickerDialog } from '@/components/social/modals/NotePickerDialog'
import type { SendeAuftrag } from '@/hooks/useMessengerSenden'
import type { useSicherheitsnummern } from '@/hooks/useSicherheitsnummern'
import type { useStoryAnsicht } from '@/hooks/useStoryAnsicht'
import type { useUeberallAnsicht } from '@/hooks/useUeberallAnsicht'
import type { E2eeIdentity } from '@/services/e2eeIdentity'
import { istWeiterleitbar, type Weiterleitungsziel } from '@/services/nachrichtWeiterleiten'
import { VERFALL_STUFEN } from '@/services/nachrichtVerfall'
import type { Treffer } from '@/services/verlaufSuche'
import { PINS_MAX, type MailboxMeta } from '@/stores/messengerNotificationStore'
import { toast } from '@/stores/toastStore'

export interface MessengerOverlaysProps {
  menueNachricht: ChatMessage | null
  setMenueNachricht: Dispatch<SetStateAction<ChatMessage | null>>
  handleReaktion: (msg: ChatMessage, emoji: string) => Promise<void>
  handleAntworten: (msg: ChatMessage) => void
  weiterzuleiten: ChatMessage[] | null
  setWeiterzuleiten: Dispatch<SetStateAction<ChatMessage[] | null>>
  wlFortschritt: { gesamt: number; fertig: number } | null
  setWlFortschritt: Dispatch<SetStateAction<{ gesamt: number; fertig: number } | null>>
  weiterleitungsZiele: (Weiterleitungsziel & { avatarUrl?: string | null; istGruppe?: boolean })[]
  handleWeiterleiten: (ziele: Weiterleitungsziel[]) => Promise<void>
  handleKopieren: (msg: ChatMessage) => Promise<void>
  handleMarkieren: (msg: ChatMessage) => void
  onSelectMessage: (msg: ChatMessage) => void
  setEditingMessage: Dispatch<SetStateAction<ChatMessage | null>>
  setInputText: Dispatch<SetStateAction<string>>
  handleDeleteMessage: (msg: ChatMessage) => Promise<void>
  activeGroup: ChatGroupItem | null
  handleAnheften: (msg: ChatMessage) => Promise<void>
  darfAnheften: boolean
  darfFremdeLoeschen: boolean
  angeheftet: ChatMessage | null
  ueberall: ReturnType<typeof useUeberallAnsicht>
  verzeichnisMitGruppen: Record<string, MailboxMeta>
  oeffneTreffer: (treffer: Treffer) => Promise<void>
  zeilenMenue: { mid: string; name: string } | null
  setZeilenMenue: Dispatch<SetStateAction<{ mid: string; name: string } | null>>
  pinnedChats: string[]
  archivedChats: string[]
  isChatMuted: (mid: string) => boolean
  handleAnheftenChat: (mid: string) => void
  handleArchivieren: (mid: string) => void
  muteChat: (mid: string) => Promise<void> | void
  unmuteChat: (mid: string) => Promise<void> | void
  verfallOffen: boolean
  setVerfallOffen: Dispatch<SetStateAction<boolean>>
  verfallVonAnderem: boolean
  darfVerfallStellen: boolean
  verfallVonName: string
  verfallSekunden: number
  handleVerfallWaehlen: (sekunden: number) => Promise<void>
  activeContact: ChatContact | null
  currentUserId: number
  identityRef: MutableRefObject<E2eeIdentity>
  messengerGesperrt: boolean
  groups: ChatGroupItem[]
  blindMailboxId: string
  merkeErwaehnung: (mid: string) => void
  uebernimmGruppenInfo: (
    groupId: number,
    info: { name: string | null; beschreibung: string | null; logo: string | null },
  ) => void
  loadData: () => Promise<void>
  isNotePickerOpen: boolean
  setIsNotePickerOpen: Dispatch<SetStateAction<boolean>>
  userNotes: NoteItem[]
  isCalendarPickerOpen: boolean
  setIsCalendarPickerOpen: Dispatch<SetStateAction<boolean>>
  userEvents: CalendarEventItem[]
  handleSendMessage: (auftrag?: SendeAuftrag) => Promise<boolean> | Promise<void> | void
  viewingImage: string | null
  setViewingImage: Dispatch<SetStateAction<string | null>>
  storyAnsicht: ReturnType<typeof useStoryAnsicht>
  handleStoryCreated: (story: ChatStoryItem) => void
  handleStoryDeleted: (storyId: number) => void
  contactsList: ChatContact[]
  contactMailboxMap: Record<number, string>
  setActiveContact: Dispatch<SetStateAction<ChatContact | null>>
  setActiveGroup: Dispatch<SetStateAction<ChatGroupItem | null>>
  chatEntfernenOffen: boolean
  setChatEntfernenOffen: Dispatch<SetStateAction<boolean>>
  handleChatAusListe: () => Promise<void>
  isCreateGroupOpen: boolean
  setIsCreateGroupOpen: Dispatch<SetStateAction<boolean>>
  handleCreateGroup: (name: string, beschreibung: string | null) => Promise<boolean>
  funkenRettung: { partnerId: number; name: string; anzahl: number } | null
  setFunkenRettung: Dispatch<SetStateAction<{ partnerId: number; name: string; anzahl: number } | null>>
  isCameraModalOpen: boolean
  setIsCameraModalOpen: Dispatch<SetStateAction<boolean>>
  augenblickModus: boolean
  setAugenblickModus: Dispatch<SetStateAction<boolean>>
  funkeModus: 'blast' | null
  setFunkeModus: Dispatch<SetStateAction<'blast' | null>>
  setFunkenFoto: Dispatch<SetStateAction<string | null>>
  setIsFunkenEmpfaengerOpen: Dispatch<SetStateAction<boolean>>
  setSelectedImage: Dispatch<SetStateAction<ImageAttachment | null>>
  isGroupPermissionsOpen: boolean
  setIsGroupPermissionsOpen: Dispatch<SetStateAction<boolean>>
  groupSettingsTab: 'general' | 'background'
  handleCopyInviteLink: (gruppe: ChatGroupItem) => void
  setGroups: Dispatch<SetStateAction<ChatGroupItem[]>>
  groupToDelete: ChatGroupItem | null
  setGroupToDelete: Dispatch<SetStateAction<ChatGroupItem | null>>
  isDeletingGroup: boolean
  handleConfirmDeleteGroup: () => Promise<void>
  isWallpaperModalOpen: boolean
  setIsWallpaperModalOpen: Dispatch<SetStateAction<boolean>>
  isMuteModalOpen: boolean
  setIsMuteModalOpen: Dispatch<SetStateAction<boolean>>
  gruppenTitel: (g: { name?: string | null } | null | undefined) => string
  sicherheitsnummern: ReturnType<typeof useSicherheitsnummern>
  isBlockConfirmOpen: boolean
  setIsBlockConfirmOpen: Dispatch<SetStateAction<boolean>>
  isBlocked: (uid: number) => boolean
  handleBlockConfirm: () => Promise<void>
  isFunkenEmpfaengerOpen: boolean
  funkenFoto: string | null
  partnerMitFunkenIds: number[]
  handleSendFunkenBlast: (empfaengerUserIds: number[]) => Promise<void>
  isFunkenSending: boolean
  isVideoNoteRecording: boolean
  setIsVideoNoteRecording: Dispatch<SetStateAction<boolean>>
}

/** Portale, Aktionsblätter, Hintergrund-Wachen und Dialoge rund um den Messenger. */
export function MessengerOverlays({
  menueNachricht,
  setMenueNachricht,
  handleReaktion,
  handleAntworten,
  weiterzuleiten,
  setWeiterzuleiten,
  wlFortschritt,
  setWlFortschritt,
  weiterleitungsZiele,
  handleWeiterleiten,
  handleKopieren,
  handleMarkieren,
  onSelectMessage,
  setEditingMessage,
  setInputText,
  handleDeleteMessage,
  activeGroup,
  handleAnheften,
  darfAnheften,
  darfFremdeLoeschen,
  angeheftet,
  ueberall,
  verzeichnisMitGruppen,
  oeffneTreffer,
  zeilenMenue,
  setZeilenMenue,
  pinnedChats,
  archivedChats,
  isChatMuted,
  handleAnheftenChat,
  handleArchivieren,
  muteChat,
  unmuteChat,
  verfallOffen,
  setVerfallOffen,
  verfallVonAnderem,
  darfVerfallStellen,
  verfallVonName,
  verfallSekunden,
  handleVerfallWaehlen,
  activeContact,
  currentUserId,
  identityRef,
  messengerGesperrt,
  groups,
  blindMailboxId,
  merkeErwaehnung,
  uebernimmGruppenInfo,
  loadData,
  isNotePickerOpen,
  setIsNotePickerOpen,
  userNotes,
  isCalendarPickerOpen,
  setIsCalendarPickerOpen,
  userEvents,
  handleSendMessage,
  viewingImage,
  setViewingImage,
  storyAnsicht,
  handleStoryCreated,
  handleStoryDeleted,
  contactsList,
  contactMailboxMap,
  setActiveContact,
  setActiveGroup,
  chatEntfernenOffen,
  setChatEntfernenOffen,
  handleChatAusListe,
  isCreateGroupOpen,
  setIsCreateGroupOpen,
  handleCreateGroup,
  funkenRettung,
  setFunkenRettung,
  isCameraModalOpen,
  setIsCameraModalOpen,
  augenblickModus,
  setAugenblickModus,
  funkeModus,
  setFunkeModus,
  setFunkenFoto,
  setIsFunkenEmpfaengerOpen,
  setSelectedImage,
  isGroupPermissionsOpen,
  setIsGroupPermissionsOpen,
  groupSettingsTab,
  handleCopyInviteLink,
  setGroups,
  groupToDelete,
  setGroupToDelete,
  isDeletingGroup,
  handleConfirmDeleteGroup,
  isWallpaperModalOpen,
  setIsWallpaperModalOpen,
  isMuteModalOpen,
  setIsMuteModalOpen,
  gruppenTitel,
  sicherheitsnummern,
  isBlockConfirmOpen,
  setIsBlockConfirmOpen,
  isBlocked,
  handleBlockConfirm,
  isFunkenEmpfaengerOpen,
  funkenFoto,
  partnerMitFunkenIds,
  handleSendFunkenBlast,
  isFunkenSending,
  isVideoNoteRecording,
  setIsVideoNoteRecording,
}: MessengerOverlaysProps) {
  const { t } = useTranslation()

  return (
    <>
      <NachrichtenMenue
        msg={menueNachricht}
        onSchliessen={() => setMenueNachricht(null)}
        onReaktion={(m, emoji) => void handleReaktion(m, emoji)}
        onAntworten={handleAntworten}
        onWeiterleiten={(m) => {
          if (!istWeiterleitbar(m)) {
            toast.error(t('messenger.nothingToForward'))
            return
          }
          setWeiterzuleiten([m])
        }}
        onKopieren={(m) => void handleKopieren(m)}
        onMarkieren={handleMarkieren}
        onAuswaehlen={onSelectMessage}
        onBearbeiten={(m) => {
          setEditingMessage(m)
          setInputText(m.text)
        }}
        onLoeschen={(m) => void handleDeleteMessage(m)}
        onAnheften={activeGroup ? (m) => void handleAnheften(m) : undefined}
        darfAnheften={darfAnheften}
        darfFremdeLoeschen={darfFremdeLoeschen}
        istAngeheftet={Boolean(angeheftet && angeheftet.clientUuid === menueNachricht?.clientUuid)}
      />

      <WeiterleitenAnsicht
        offen={Boolean(weiterzuleiten)}
        onSchliessen={() => {
          setWeiterzuleiten(null)
          setWlFortschritt(null)
        }}
        ziele={weiterleitungsZiele}
        anzahlNachrichten={weiterzuleiten?.length || 0}
        fortschritt={wlFortschritt}
        onSenden={handleWeiterleiten}
      />

      <TrefferListe
        offen={ueberall.art !== 'aus'}
        titel={
          ueberall.art === 'markiert'
            ? t('messenger.markedMessages')
            : ueberall.art === 'anMich'
              ? t('messenger.mentionsAndReplies')
              : t('messenger.searchFor', { frage: ueberall.frage })
        }
        leerText={
          ueberall.art === 'markiert'
            ? t('messenger.nothingMarkedYet')
            : ueberall.art === 'anMich'
              ? t('messenger.nothingMentioned')
              : t('messenger.noChatHasThisText')
        }
        chats={ueberall.chats}
        verzeichnis={verzeichnisMitGruppen}
        gesperrt={ueberall.gesperrt}
        laeuft={ueberall.laeuft}
        onSchliessen={ueberall.schliesse}
        onTreffer={(treffer) => void oeffneTreffer(treffer)}
      />

      <Blattmenue
        offen={Boolean(zeilenMenue)}
        onSchliessen={() => setZeilenMenue(null)}
        titel={zeilenMenue?.name || 'Chat'}
      >
        <div className="px-4 pt-2 pb-1 text-xs font-semibold text-on-surface-variant truncate">
          {zeilenMenue?.name}
        </div>
        <div className="pb-2">
          <Blatteintrag
            icon={zeilenMenue && pinnedChats.includes(zeilenMenue.mid) ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
            label={
              zeilenMenue && pinnedChats.includes(zeilenMenue.mid)
                ? t('messenger.unpin')
                : t('messenger.pin')
            }
            hinweis={t('messenger.pinHint', { count: PINS_MAX })}
            onClick={() => {
              if (zeilenMenue) handleAnheftenChat(zeilenMenue.mid)
              setZeilenMenue(null)
            }}
          />
          <Blatteintrag
            icon={zeilenMenue && archivedChats.includes(zeilenMenue.mid) ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
            label={
              zeilenMenue && archivedChats.includes(zeilenMenue.mid)
                ? t('messenger.unarchive')
                : t('messenger.archive')
            }
            onClick={() => {
              if (zeilenMenue) handleArchivieren(zeilenMenue.mid)
              setZeilenMenue(null)
            }}
          />
          <Blatteintrag
            icon={zeilenMenue && isChatMuted(zeilenMenue.mid) ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
            label={
              zeilenMenue && isChatMuted(zeilenMenue.mid)
                ? t('messenger.unmute')
                : t('messenger.mute')
            }
            onClick={() => {
              if (!zeilenMenue) return
              if (isChatMuted(zeilenMenue.mid)) void unmuteChat(zeilenMenue.mid)
              else void muteChat(zeilenMenue.mid)
              setZeilenMenue(null)
            }}
          />
        </div>
      </Blattmenue>

      <Blattmenue
        offen={verfallOffen}
        onSchliessen={() => setVerfallOffen(false)}
        titel={t('messenger.disappearingMessages')}
      >
        <div className="px-4 pt-1 pb-3">
          <p className="text-label-sm text-on-surface-variant leading-relaxed">
            {t('messenger.disappearingHint')}
          </p>

          {verfallVonAnderem && (
            <p className="mt-2 text-label-sm text-on-surface-variant leading-relaxed">
              {darfVerfallStellen
                ? t('messenger.disappearingEnabledBy', { name: verfallVonName })
                : t('messenger.disappearingLocked', { name: verfallVonName })}
            </p>
          )}
        </div>
        <div className="pb-2">
          {VERFALL_STUFEN.map((stufe) => (
            <Blatteintrag
              key={stufe.sekunden}
              icon={
                verfallSekunden === stufe.sekunden ? (
                  <UserCheck className="w-4 h-4 text-primary" />
                ) : (
                  <Timer className="w-4 h-4" />
                )
              }
              label={t(stufe.labelKey)}
              disabled={!darfVerfallStellen}
              onClick={() => void handleVerfallWaehlen(stufe.sekunden)}
            />
          ))}
        </div>
      </Blattmenue>

      <FunkenWache
        aktiverPartner={activeContact?.userId ?? null}
        eigeneId={currentUserId}
        identitaetRef={identityRef}
        aktiv={!messengerGesperrt && !!currentUserId}
      />

      <ErwaehnungsWache
        gruppen={groups}
        aktiveMailboxId={blindMailboxId || null}
        eigeneId={currentUserId}
        identitaetRef={identityRef}
        onErwaehnung={merkeErwaehnung}
        aktiv={!messengerGesperrt && !!currentUserId}
      />

      <GruppenMetaWache
        groups={groups}
        eigeneId={currentUserId}
        onInfo={uebernimmGruppenInfo}
        onStruktur={() => void loadData()}
      />

      <NotePickerDialog
        open={isNotePickerOpen}
        onOpenChange={setIsNotePickerOpen}
        notes={userNotes}
        onPick={(n) => {
          setIsNotePickerOpen(false)
          void handleSendMessage({
            text: '',
            note: {
              title: n.title,
              content: n.content,
              color: n.color,
              category: n.category,
            },
          })
        }}
      />

      <CalendarPickerDialog
        open={isCalendarPickerOpen}
        onOpenChange={setIsCalendarPickerOpen}
        events={userEvents}
        onPick={(ev) => {
          setIsCalendarPickerOpen(false)
          void handleSendMessage({
            text: '',
            cal: {
              title: ev.title,
              start: ev.start,
              end: ev.end,
              description: ev.description,
              location: ev.location,
            },
          })
        }}
      />

      {viewingImage && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('messenger.fullView')}
          className="msm-modal-overlay bg-black/80"
          onClick={() => setViewingImage(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <img
              src={viewingImage}
              alt={t('messenger.fullView')}
              className="max-h-[85vh] max-w-full rounded-xl object-contain shadow-2xl"
            />
            <button
              type="button"
              onClick={() => setViewingImage(null)}
              className="absolute -top-3 -right-3 p-1.5 rounded-full bg-surface-container-highest text-on-surface shadow-md"
              aria-label={t('common.close')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <CreateStoryModal
        open={storyAnsicht.erstellung.offen}
        onOpenChange={storyAnsicht.erstellung.setOffen}
        onCreated={handleStoryCreated}
        initialMode={storyAnsicht.erstellung.modus}
        initialPhotoUrl={storyAnsicht.erstellung.fotoUrl}
      />

      <StoryViewerModal
        open={storyAnsicht.betrachter.offen}
        onOpenChange={storyAnsicht.betrachter.setOffen}
        stories={storyAnsicht.betrachter.stories}
        initialIndex={storyAnsicht.betrachter.index}
        onDeleted={handleStoryDeleted}
        onReply={async (targetUserId, _targetUsername, text, storyContext: StoryReplyContext) => {
          const contact = contactsList.find((c) => c.userId === targetUserId)
          if (!contact || !currentUserId) {
            toast.error(t('messenger.replyContactMissing'))
            return
          }
          storyAnsicht.betrachter.setOffen(false)
          const mailbox =
            contactMailboxMap[contact.userId] ?? `direct:peer:${contact.userId}`
          await handleSendMessage({
            text,
            storyReply: storyContext,
            antwortAuf: null,
            ziel: { blindMailboxId: mailbox, recipientId: contact.userId, groupId: null },
          })
          setActiveContact(contact)
          setActiveGroup(null)
        }}
      />

      <ChatEntfernenDialog
        open={chatEntfernenOffen}
        name={activeContact?.username ?? ''}
        onCancel={() => setChatEntfernenOffen(false)}
        onConfirm={() => {
          setChatEntfernenOffen(false)
          void handleChatAusListe()
        }}
      />

      <MessengerDialoge
        isCreateGroupOpen={isCreateGroupOpen}
        setIsCreateGroupOpen={setIsCreateGroupOpen}
        onCreateGroup={handleCreateGroup}
        funkenRettung={funkenRettung}
        setFunkenRettung={setFunkenRettung}
        onFunkenRettungBestaetigen={async () => {
          const ziel = funkenRettung
          setFunkenRettung(null)
          if (!ziel || activeContact?.userId !== ziel.partnerId) return
          await handleSendMessage({ text: '', funkenRettung: true, antwortAuf: null })
        }}
        activeContact={activeContact}
        isCameraModalOpen={isCameraModalOpen}
        setIsCameraModalOpen={setIsCameraModalOpen}
        augenblickModus={augenblickModus}
        setAugenblickModus={setAugenblickModus}
        onCameraCapture={(dataUrl) => {
          if (funkeModus === 'blast') {
            setFunkeModus(null)
            setFunkenFoto(dataUrl)
            setIsFunkenEmpfaengerOpen(true)
            return
          }
          if (augenblickModus && activeContact) {
            void handleSendMessage({
              text: '',
              img: { dataUrl, name: 'augenblick.jpg' },
              augenblick: true,
              antwortAuf: null,
            })
            return
          }
          if (augenblickModus && !activeContact) {
            setFunkenFoto(dataUrl)
            setIsFunkenEmpfaengerOpen(true)
            return
          }
          setSelectedImage({ dataUrl, name: 'kamera-aufnahme.jpg' })
        }}
        isGroupPermissionsOpen={isGroupPermissionsOpen}
        setIsGroupPermissionsOpen={setIsGroupPermissionsOpen}
        groupSettingsTab={groupSettingsTab}
        onGroupInvite={() => activeGroup && handleCopyInviteLink(activeGroup)}
        activeGroup={activeGroup}
        currentUserId={currentUserId}
        onGroupUpdated={(updatedGroup) => {
          setActiveGroup(updatedGroup)
          setGroups((prev) => prev.map((g) => (g.id === updatedGroup.id ? updatedGroup : g)))
        }}
        groupToDelete={groupToDelete}
        setGroupToDelete={setGroupToDelete}
        isDeletingGroup={isDeletingGroup}
        onConfirmDeleteGroup={handleConfirmDeleteGroup}
        isWallpaperModalOpen={isWallpaperModalOpen}
        setIsWallpaperModalOpen={setIsWallpaperModalOpen}
        isMuteModalOpen={isMuteModalOpen}
        setIsMuteModalOpen={setIsMuteModalOpen}
        blindMailboxId={blindMailboxId}
        chatName={activeGroup ? gruppenTitel(activeGroup) : activeContact?.username ?? null}
        sicherheitsnummern={sicherheitsnummern}
        isBlockConfirmOpen={isBlockConfirmOpen}
        setIsBlockConfirmOpen={setIsBlockConfirmOpen}
        blocked={Boolean(activeContact && isBlocked(activeContact.userId))}
        onBlockConfirm={handleBlockConfirm}
      />

      <FunkenEmpfaengerModal
        open={isFunkenEmpfaengerOpen}
        onOpenChange={setIsFunkenEmpfaengerOpen}
        fotoDataUrl={funkenFoto}
        kontakte={contactsList.filter((c) => c.isFriend)}
        funkenPartnerIds={partnerMitFunkenIds}
        onSenden={handleSendFunkenBlast}
        sendet={isFunkenSending}
      />

      {isVideoNoteRecording && (
        <CircularVideoNoteRecorder
          onCancel={() => setIsVideoNoteRecording(false)}
          onComplete={async (aufnahme: VideoNoteAufnahme) => {
            setIsVideoNoteRecording(false)
            await handleSendMessage({
              videoNote: aufnahme,
              videoUrl: URL.createObjectURL(aufnahme.blob),
            })
          }}
        />
      )}
    </>
  )
}
