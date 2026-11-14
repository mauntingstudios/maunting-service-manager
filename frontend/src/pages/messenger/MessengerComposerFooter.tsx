import type { ChangeEvent, Dispatch, RefObject, SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import { Send, Smile, Trash2 } from 'lucide-react'
import { ChatInputBar, VoiceRecordingBar, Kurzinfo, type ChatInputBarRef } from '@maunting/ui'
import type { AntwortBezug, ChatMessage } from '@/components/social/ChatMessageBubble'
import type { FileAttachment, ImageAttachment } from '@/components/social/ChatMediaAttachments'
import type { ChatContact } from '@/components/social/sidebar/ConversationListItem'
import { BlockedNotice } from '@/components/social/chat/ChatComposerBars'
import { StickerEmojiPicker, type PickerReiter } from '@/components/social/chat/StickerEmojiPicker'
import { AttachMenu } from '@/components/social/chat/AttachMenu'
import { MentionSuggestions, ChatReplyBar } from '@/components/social/chat/ChatComposerTop'
import { ComposerSendActions } from '@/components/social/chat/ComposerSendActions'
import type { useSprachaufnahme } from '@/hooks/useSprachaufnahme'
import type { SendeAuftrag } from '@/hooks/useMessengerSenden'
import type { Erwaehnungsvorschlag } from '@/services/erwaehnungen'

export interface MessengerComposerFooterProps {
  activeContact: ChatContact | null
  isBlocked: (uid: number) => boolean
  onUnblock: (uid: number) => Promise<void>
  aufnahme: ReturnType<typeof useSprachaufnahme>
  isStickerPickerOpen: boolean
  setIsStickerPickerOpen: Dispatch<SetStateAction<boolean>>
  stickerTab: PickerReiter
  setStickerTab: Dispatch<SetStateAction<PickerReiter>>
  startFotoTresor: boolean
  setStartFotoTresor: Dispatch<SetStateAction<boolean>>
  handleSendMessage: (auftrag?: SendeAuftrag) => Promise<boolean> | Promise<void> | void
  inputText: string
  setInputText: Dispatch<SetStateAction<string>>
  handleInputChange: (text: string) => void
  selectedImage: ImageAttachment | null
  stagedFile: FileAttachment | null
  fileInputRef: RefObject<HTMLInputElement>
  docInputRef: RefObject<HTMLInputElement>
  chatInputRef: RefObject<ChatInputBarRef>
  handleFileChange: (e: ChangeEvent<HTMLInputElement>) => Promise<void>
  handleFileAttachment: (file: File) => void
  erwaehnungsVorschlaege: Erwaehnungsvorschlag[]
  waehleErwaehnung: (vorschlag: Erwaehnungsvorschlag) => void
  antwortAuf: AntwortBezug | null
  setAntwortAuf: Dispatch<SetStateAction<AntwortBezug | null>>
  istSchreibenGesperrt: boolean
  darfSchreiben: boolean
  darfAnhaengen: boolean
  editingMessage: ChatMessage | null
  sending: boolean
  onOpenCamera: () => void
  onOpenNotePicker: () => Promise<void>
  onOpenCalendarPicker: () => Promise<void>
  onOpenVideoNote: () => void
}

/** Untere Eingabeleiste des Messengers inkl. Sprachaufnahme, Stickern und Anhängen. */
export function MessengerComposerFooter({
  activeContact,
  isBlocked,
  onUnblock,
  aufnahme,
  isStickerPickerOpen,
  setIsStickerPickerOpen,
  stickerTab,
  setStickerTab,
  startFotoTresor,
  setStartFotoTresor,
  handleSendMessage,
  inputText,
  setInputText,
  handleInputChange,
  selectedImage,
  stagedFile,
  fileInputRef,
  docInputRef,
  chatInputRef,
  handleFileChange,
  handleFileAttachment,
  erwaehnungsVorschlaege,
  waehleErwaehnung,
  antwortAuf,
  setAntwortAuf,
  istSchreibenGesperrt,
  darfSchreiben,
  darfAnhaengen,
  editingMessage,
  sending,
  onOpenCamera,
  onOpenNotePicker,
  onOpenCalendarPicker,
  onOpenVideoNote,
}: MessengerComposerFooterProps) {
  const { t } = useTranslation()

  return (
    <div className="p-2.5 pb-[calc(0.625rem+var(--msm-unten-sicher))] bg-transparent relative z-10">
      <div className="mx-auto w-full max-w-3xl xl:max-w-4xl">
        {activeContact && isBlocked(activeContact.userId) ? (
          <BlockedNotice onAufheben={() => void onUnblock(activeContact.userId)} />
        ) : aufnahme.laeuft ? (
          <VoiceRecordingBar
            durationSeconds={aufnahme.dauer}
            statusLabel={t('messenger.voiceRecording')}
            stream={aufnahme.stream}
            variant="danger"
            onCancel={() => aufnahme.beende(false)}
            onConfirm={() => aufnahme.beende(true)}
            cancelLabel="Abbrechen"
            confirmLabel="Senden"
            cancelIcon={<Trash2 className="w-3.5 h-3.5" />}
            confirmIcon={<Send className="w-3.5 h-3.5" />}
          />
        ) : (
          <>
            {isStickerPickerOpen && (
              <StickerEmojiPicker
                reiter={stickerTab}
                onReiter={setStickerTab}
                startFotoTresor={startFotoTresor}
                onSticker={(stk) => {
                  void handleSendMessage({ sticker: stk })
                  setIsStickerPickerOpen(false)
                  setStartFotoTresor(false)
                }}
                onEmoji={(emoji) => setInputText((prev) => prev + emoji)}
                onSchliessen={() => {
                  setIsStickerPickerOpen(false)
                  setStartFotoTresor(false)
                }}
              />
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault()
                void handleSendMessage({
                  text: inputText,
                  img: selectedImage || undefined,
                  file: stagedFile || undefined,
                })
              }}
            >
              {/* Hidden Image Input */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />

              {/* Hidden Doc/File Input */}
              <input
                ref={docInputRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleFileAttachment(file)
                  if (docInputRef.current) docInputRef.current.value = ''
                }}
              />

              <ChatInputBar
                ref={chatInputRef}
                variant="glass"
                value={inputText}
                onChange={handleInputChange}
                topSlot={
                  <>
                    <MentionSuggestions vorschlaege={erwaehnungsVorschlaege} onWaehlen={waehleErwaehnung} />
                    {antwortAuf && <ChatReplyBar antwort={antwortAuf} onVerwerfen={() => setAntwortAuf(null)} />}
                  </>
                }
                onSubmit={() => {
                  void handleSendMessage({
                    text: inputText,
                    img: selectedImage || undefined,
                    file: stagedFile || undefined,
                  })
                }}
                disabled={istSchreibenGesperrt || !darfSchreiben}
                placeholder={
                  !darfSchreiben
                    ? t('messenger.sendNoRight')
                    : istSchreibenGesperrt
                      ? t('messenger.keyPreparing')
                      : editingMessage
                        ? t('messenger.editPlaceholder')
                        : t('messenger.writePlaceholder')
                }
                leftActions={
                  <>
                    <AttachMenu
                      erlaubt={darfAnhaengen}
                      onKamera={onOpenCamera}
                      onFoto={() => fileInputRef.current?.click()}
                      onDokument={() => docInputRef.current?.click()}
                      onNotiz={() => void onOpenNotePicker()}
                      onTermin={() => void onOpenCalendarPicker()}
                    />

                    {/* Bei offener Auswahl läge die Kurzinfo über ihr. */}
                    <Kurzinfo
                      text={t('messenger.stickers')}
                      seite="anfang"
                      lage="oben"
                      aussen="shrink-0"
                      className={isStickerPickerOpen ? '!hidden' : ''}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (isStickerPickerOpen) setStartFotoTresor(false)
                          setIsStickerPickerOpen((prev) => !prev)
                        }}
                        className={`grid h-9 w-9 place-items-center rounded-full transition-colors ${
                          isStickerPickerOpen
                            ? 'bg-primary/20 text-white border border-primary/50'
                            : 'text-white/70 hover:text-white hover:bg-white/10'
                        }`}
                        aria-label={t('messenger.pickSticker')}
                      >
                        <Smile className="w-4 h-4" />
                      </button>
                    </Kurzinfo>
                  </>
                }
                rightActions={
                  <ComposerSendActions
                    hatInhalt={Boolean(inputText.trim() || selectedImage || stagedFile)}
                    sendet={sending}
                    onVideonotiz={onOpenVideoNote}
                    onSprachnachricht={aufnahme.starte}
                  />
                }
              />
            </form>
          </>
        )}
      </div>
    </div>
  )
}
