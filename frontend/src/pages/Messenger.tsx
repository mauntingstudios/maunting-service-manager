import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, useNavigate } from 'react-router-dom'
import { Ablageflaeche, useMehrfachauswahl, useZurueckSchliesst, ChatInputBarRef } from '@maunting/ui'
import { useWischZurueck } from '@/hooks/useWischZurueck'
import { ArrowDown } from 'lucide-react'
import { useCallStore } from '@/stores/useCallStore'
import {
  ChatMessageBubble,
  type AntwortBezug,
  type BlasenAktionen,
  type ChatMessage,
  type TonZustand,
} from '@/components/social/ChatMessageBubble'
import {
  type ChatGroupItem,
  type ChatStoryItem,
  joinGroupByInvite,
  sendFriendRequest,
  getGroupInviteInfo,
} from '@/api/social'
// Chat-Kennungen werden lokal aus peerId/groupId gebildet.
import { messengerSocket } from '@/services/messengerSocket'
import { useSprachaufnahme } from '@/hooks/useSprachaufnahme'
import { useSprachwiedergabe } from '@/hooks/useSprachwiedergabe'
import { useChatSuche } from '@/hooks/useChatSuche'
import { useEntwuerfe } from '@/hooks/useEntwuerfe'
import { useMessengerKontakte } from '@/pages/messenger/useMessengerKontakte'
import { useMessengerAuswahl } from '@/pages/messenger/useMessengerAuswahl'
import { useGruppenAktionen } from '@/hooks/useGruppenAktionen'
import { useMessengerKern } from '@/hooks/useMessengerKern'
import { useMessengerSenden } from '@/hooks/useMessengerSenden'
import { useMessengerInteraktionen } from '@/hooks/useMessengerInteraktionen'
import { useMessengerSync } from '@/hooks/useMessengerSync'
import { useSicherheitsnummern } from '@/hooks/useSicherheitsnummern'
import { useUeberallAnsicht } from '@/hooks/useUeberallAnsicht'
import { MessengerSidebarColumn } from '@/pages/messenger/MessengerSidebarColumn'
import { MessengerChatHeader } from '@/pages/messenger/MessengerChatHeader'
import { MessengerComposerFooter } from '@/pages/messenger/MessengerComposerFooter'
import { MessengerOverlays } from '@/pages/messenger/MessengerOverlays'
import { useMessengerAnhaenge } from '@/pages/messenger/useMessengerAnhaenge'
import { useMessengerScrollUndTrenner } from '@/pages/messenger/useMessengerScrollUndTrenner'
import { useMessengerVerfall } from '@/pages/messenger/useMessengerVerfall'
import {
  getOutbox,
  setOutbox,
  replayOutbox,
} from '@/lib/offlineSync'
import { logischeUuid } from '@/services/wirkungTypen'
import {
  lieseEinladungsKarte,
  schluesselAusLink,
  type EinladungsInhalt,
} from '@/services/einladungsKarte'
import { merkeGruppenName } from '@/services/gruppenName'
import {
  vergissGespraech,
  versteckeGespraech,
} from '@/services/gespraechsListe'
import { ladeGruppenzustand, type Gruppenzustand } from '@/services/gruppenKonfig'
import { ladeGruppenInfo } from '@/services/gruppenInfo'
import { rechteAusGruppe } from '@/services/gruppenRollen'
import {
  entferneLokaleNachricht,
  leereMailboxLokal,
  updateMessageInLocalStore,
  sortMessagesChronologically,
} from '@/services/messengerLocalStore'
import { quittungsstand } from '@/services/quittungsstand'
import {
  binIchGemeint,
  offeneErwaehnung,
  setzeVorschlagEin,
  sucheVorschlaege,
  type Erwaehnungsvorschlag,
} from '@/services/erwaehnungen'
import { type Weiterleitungsziel } from '@/services/nachrichtWeiterleiten'
import { vergissMailbox, type Treffer } from '@/services/verlaufSuche'
import { sessionChatCache } from '@/services/klartextSpeicher'
import { rettungMoeglich } from '@/services/funkenService'
import { useFunkenStore } from '@/stores/funkenStore'
import { VerlaufSuchleiste } from '@/components/social/VerlaufSuchleiste'

import { MessengerSperrschirm } from '@/components/social/MessengerSperrschirm'
import { istGesperrt, useMessengerSperre } from '@/services/messengerSperre'
import { MessengerEmptyState } from '@/components/social/chat/MessengerEmptyState'
import { type ChatContact } from '@/components/social/sidebar/ConversationListItem'
import { ChatPinnedBar } from '@/components/social/chat/ChatPinnedBar'
import { ChatTimeline } from '@/components/social/chat/ChatTimeline'
import { StagedImageBar, StagedFileBar, EditingBanner } from '@/components/social/chat/ChatComposerBars'
import { type PickerReiter } from '@/components/social/chat/StickerEmojiPicker'
import { ChatHintergrund } from '@/features/chatHintergrund'
import { useAuthStore } from '@/stores/authStore'
import { toast } from '@/stores/toastStore'
import { still } from '@/lib/still'
import { useMessengerNotificationStore } from '@/stores/messengerNotificationStore'
import { STICKER_TRESOR_PARAM, STICKER_TRESOR_WERT } from '@/services/stickerTresor'

/**
 * Was gesendet werden soll.
 *
 * Bis 09/2026 nahm `handleSendMessage` zehn Positionsargumente, und die
 * Aufrufe sahen entsprechend aus: `handleSendMessage('', undefined, undefined,
 * undefined, { … })`. Wer eine Sprachnachricht verschicken wollte, musste vier
 * Lücken abzählen, und jede neue Möglichkeit wäre Argument elf geworden.
 *
 * Benannte Felder kosten beim Aufruf ein paar Zeichen mehr und ersparen das
 * Zählen. Alles ist freiwillig; was nichts zu senden hat, kommt gar nicht erst
 * bis zum Umschlag.
 */
/** Kennung einer Nachricht in der Mehrfachauswahl; noch nicht gesendete haben nur ihre `clientUuid`. */
const auswahlSchluessel = (m: ChatMessage) => m.clientUuid || `#${m.id}`

/**
 * Der Messenger hinter seinem Schloss.
 *
 * Gesperrt wird die Seite **ausgehängt**, nicht überdeckt. Bis 09/2026 stand
 * der Sperrschirm als `return` in der Seite selbst: sie blieb eingehängt, und
 * mit ihr im React-Zustand der entschlüsselte Verlauf des offenen Chats, das
 * Eingabefeld, Antwort- und Bearbeitungsziel, die Suchtreffer. Nach dem
 * Entsperren stand alles sofort wieder da, ohne dass etwas neu entsiegelt
 * wurde.
 *
 * Ausgehängt ist das alles weg. Nach dem Entsperren baut sich die Seite neu
 * auf und lädt den Verlauf aus der versiegelten Ablage. Welcher Chat offen war,
 * steht in der Adresse und im `sessionStorage`, als Kennung, nicht als Inhalt.
 */
export function Messenger() {
  const gesperrt = useMessengerSperre(istGesperrt)
  if (gesperrt) {
    return (
      <div className="flex h-full w-full min-h-0 flex-1 flex-col overflow-hidden bg-surface">
        <MessengerSperrschirm />
      </div>
    )
  }
  return <MessengerSeite />
}

function MessengerSeite() {
  const { t } = useTranslation()

  /**
   * Wie eine Gruppe in der Oberfläche heisst.
   *
   * Seit Stufe 6 liefert der Server für `name` überall `null` — er kennt den
   * Namen nicht mehr. `benenneGruppen` setzt ihn aus dem versiegelten örtlichen
   * Speicher und aus dem verschlüsselten Gruppenblock wieder ein; bleibt er
   * trotzdem leer, ist der Schlüssel noch nicht da (frisches Gerät, verschlossener
   * Messenger). Dann steht hier eine ehrliche Überschrift statt eines leeren
   * Platzes — dieselbe Linie wie `social.invite.sealed` bei der Einladungskarte.
   */
  const gruppenTitel = useCallback(
    (g: { name?: string | null } | null | undefined): string =>
      g?.name?.trim() || t('messenger.groupSealed'),
    [t],
  )

  const { user } = useAuthStore()
  const currentUserId = user?.id || 0
  // Die Hülle hängt diese Seite gesperrt gar nicht erst ein. Die Schranken
  // unten bleiben trotzdem stehen: sie kosten nichts, und keiner der Effekte
  // soll davon abhängen, von wem die Seite gerendert wird.
  const messengerGesperrt = useMessengerSperre(istGesperrt)
  const { inviteCode } = useParams<{ inviteCode?: string }>()
  const navigate = useNavigate()
  const {
    friends,
    groups,
    setGroups,
    stories,
    setStories,
    loadData,
    kontakteGeladen,
    contactsList,
    filteredContacts,
    kontakteNachArchiv,
    archivZahl,
    archivUngelesen,
    contactMailboxMap,
    groupMailboxMap,
    storyAnsicht,
    searchQuery,
    setSearchQuery,
    setFilterTab,
    mobileNavTab,
    setMobileNavTab,
    archivOffen,
    setArchivOffen,
  } = useMessengerKontakte({ currentUserId, messengerGesperrt, gruppenTitel })

  const {
    activeContact,
    setActiveContact,
    activeGroup,
    setActiveGroup,
    searchParams,
    setSearchParams,
    zeilenMenue,
    setZeilenMenue,
    widerruf,
    setWiderruf,
    handleZurueckZurListe,
    handleAnheftenChat,
    handleArchivieren,
  } = useMessengerAuswahl({ kontakte: contactsList, gruppen: groups, kontakteGeladen, t })

  /**
   * Eine frisch entschlüsselte Gruppeninfo in die Liste übernehmen.
   *
   * Der örtliche Namensspeicher bekommt denselben Stand; `null` leert ihn
   * dort ausdrücklich. Die Liste ist die eine Stelle, aus der die Oberfläche
   * liest; `activeGroup` zieht über den bestehenden Vergleichseffekt nach.
   */
  const uebernimmGruppenInfo = useCallback(
    (groupId: number, info: { name: string | null; beschreibung: string | null; logo: string | null }) => {
      void merkeGruppenName(groupId, {
        name: info.name,
        beschreibung: info.beschreibung,
        logo: info.logo,
      }).catch(() => {})
      setGroups((vorher) =>
        vorher.map((g) =>
          g.id === groupId
            ? {
                ...g,
                name: info.name,
                description: info.beschreibung,
                avatar_url: info.logo,
              }
            : g,
        ),
      )
      setActiveGroup((vorher) =>
        vorher?.id === groupId
          ? {
              ...vorher,
              name: info.name,
              description: info.beschreibung,
              avatar_url: info.logo,
            }
          : vorher,
      )
    },
    [setGroups, setActiveGroup],
  )

  /**
   * „Ansehen“ aus der Freundschaftsmeldung.
   *
   * Auf dem Handy liegt die Liste hinter dem offenen Chat. Der Knopf soll
   * deshalb den Chat schliessen und die Karte ins Bild holen, nicht nur zur
   * ohnehin offenen Route wechseln.
   */
  useEffect(() => {
    const zeigen = () => {
      handleZurueckZurListe()
      setMobileNavTab('chats')
      window.setTimeout(() => {
        document.getElementById('freundschaftsanfragen')?.scrollIntoView?.({ block: 'nearest' })
      }, 0)
    }
    window.addEventListener('msm:freundschaftsanfragen-zeigen', zeigen)
    return () => window.removeEventListener('msm:freundschaftsanfragen-zeigen', zeigen)
  }, [handleZurueckZurListe, setMobileNavTab])

  const {
    isCreateGroupOpen,
    setIsCreateGroupOpen,
    groupToDelete,
    setGroupToDelete,
    isDeletingGroup,
    groupCallPermissions,
    handleStartGroupCall,
    handleCreateGroup,
    handleCopyInviteLink,
    handleLeaveGroup,
    handleDeleteGroup,
    handleConfirmDeleteGroup,
  } = useGruppenAktionen({
    t,
    currentUserId,
    activeGroup,
    setActiveGroup,
    setActiveContact,
    loadData,
    gruppenTitel,
    handleZurueckZurListe,
  })

  // Notification & Mute/Block Store
  const unreadCounts = useMessengerNotificationStore((s) => s.unreadCounts)
  const isChatMuted = useMessengerNotificationStore((s) => s.isMuted)
  const muteChat = useMessengerNotificationStore((s) => s.muteChat)
  const unmuteChat = useMessengerNotificationStore((s) => s.unmuteChat)
  const isBlocked = useMessengerNotificationStore((s) => s.isBlocked)
  const blockUser = useMessengerNotificationStore((s) => s.blockUser)
  const unblockUser = useMessengerNotificationStore((s) => s.unblockUser)
  const markAsRead = useMessengerNotificationStore((s) => s.markAsRead)
  const mailboxDirectory = useMessengerNotificationStore((s) => s.mailboxDirectory)
  const pinnedChats = useMessengerNotificationStore((s) => s.pinnedChats)
  const archivedChats = useMessengerNotificationStore((s) => s.archivedChats)
  const mentionedChats = useMessengerNotificationStore((s) => s.mentionedChats)
  const merkeErwaehnung = useMessengerNotificationStore((s) => s.merkeErwaehnung)
  const [hatNeueMarkierung, setHatNeueMarkierung] = useState(false)

  // Mute & Block modals
  const [isMuteModalOpen, setIsMuteModalOpen] = useState(false)
  const [isBlockConfirmOpen, setIsBlockConfirmOpen] = useState(false)

  // Pre-computed mailbox IDs
  
  // Selection
  const sicherheitsnummern = useSicherheitsnummern(activeContact?.userId)
  /**
   * Die eigenen Rollen der offenen Gruppe, entschlüsselt.
   *
   * `null` heisst „nicht belegbar": entweder hat die Gruppe noch keinen Block,
   * oder diesem Gerät fehlt der Schlüssel, oder er war nicht beglaubigt. In
   * allen drei Fällen zählen nur die Rechte aus der Mitgliederzeile — das ist
   * der ehrliche Stand, und nicht etwa „keine Rechte".
   */
  const [gruppenRollenZustand, setGruppenRollenZustand] = useState<Gruppenzustand | null>(null)

  // Group Permissions & Delete Modal State
  const [isGroupPermissionsOpen, setIsGroupPermissionsOpen] = useState(false)
  const [groupSettingsTab, setGroupSettingsTab] = useState<'general' | 'background'>('general')
  const [chatEntfernenOffen, setChatEntfernenOffen] = useState(false)
  /**
   * Die `?userId=`, für die schon geprüft wurde.
   *
   * Die Kontaktliste kommt alle 15 Sekunden neu; ohne diesen Merker fragte die
   * Seite für einen unbekannten Kontakt bei jedem Takt erneut nach dem Profil.
   */

  // Camera & Attachments
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false)
  /** Die Kamera nimmt einen Augenblick auf: Auslösen heißt Senden. */
  const [augenblickModus, setAugenblickModus] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [funkenFoto, setFunkenFoto] = useState<string | null>(null)
  const [funkeModus, setFunkeModus] = useState<'blast' | null>(null)
  const [isFunkenEmpfaengerOpen, setIsFunkenEmpfaengerOpen] = useState(false)
  const [isFunkenSending, setIsFunkenSending] = useState(false)
  /** Die offene Rückfrage vor einer Wiederherstellung des Funkens. */
  const [funkenRettung, setFunkenRettung] = useState<{ partnerId: number; name: string; anzahl: number } | null>(
    null,
  )
  const {
    isDragOver,
    setIsDragOver,
    stagedFile,
    setStagedFile,
    selectedImage,
    setSelectedImage,
    viewingImage,
    setViewingImage,
    isNotePickerOpen,
    setIsNotePickerOpen,
    userNotes,
    isCalendarPickerOpen,
    setIsCalendarPickerOpen,
    userEvents,
    importedAttachmentIds,
    fileInputRef,
    docInputRef,
    handleFileChange,
    handleFileAttachment,
    handleOpenNotePicker,
    handleOpenCalendarPicker,
    handleImportNote,
    handleImportCalendar,
  } = useMessengerAnhaenge(t)

  // Read receipts setting from profile
  const readReceiptsEnabled = useMemo(() => {
    try {
      return localStorage.getItem('msm_read_receipts_enabled') !== 'false'
    } catch {
      return true
    }
  }, [])

  // Conversation state
  const [inputText, setInputText] = useState('')
  // Ein Gerät legt seinen Schlüssel beim ersten Öffnen selbst an. Es gibt
  // nichts einzurichten, also auch keinen Zustand, in dem das Schreiben auf
  // Dauer gesperrt wäre — nur die kurze Spanne bis `ready`. Ist der Messenger
  // per PIN zu, steht ohnehin der Sperrschirm statt dieser Leiste.

  // Stickers / Emojis
  const [isStickerPickerOpen, setIsStickerPickerOpen] = useState(false)
  const [stickerTab, setStickerTab] = useState<PickerReiter>('stickers')
  const [startFotoTresor, setStartFotoTresor] = useState(false)

  /*
   * Rückkehr aus dem Tresor: Dort wurde die Smartcard entsperrt. Der Merker
   * steht im Rückweg, nicht in einem zweiten Zustand. Er wird nach dem Öffnen
   * aus der Adresse entfernt, damit ein Neuladen nicht erneut öffnet.
   */
  useEffect(() => {
    if (searchParams.get(STICKER_TRESOR_PARAM) !== STICKER_TRESOR_WERT) return
    setStartFotoTresor(true)
    setIsStickerPickerOpen(true)
    setStickerTab('foto')
    const naechste = new URLSearchParams(searchParams)
    naechste.delete(STICKER_TRESOR_PARAM)
    setSearchParams(naechste, { replace: true })
  }, [searchParams, setSearchParams])

  // Group creation modal

  const [isVideoNoteRecording, setIsVideoNoteRecording] = useState(false)
  const tonWiedergabe = useSprachwiedergabe()

  // Der Chat-Hintergrund liegt im gemeinsamen Modul (`features/chatHintergrund`):
  // die Schicht liest ihre Wahl selbst und hört auf Änderungen, hier steht nur
  // noch, ob das Einstellungsfenster offen ist.
  const [isWallpaperModalOpen, setIsWallpaperModalOpen] = useState(false)
  // Message Editing State
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null)

  /**
   * Worauf die nächste Nachricht antwortet.
   *
   * Der Auszug wird hier festgehalten und reist gleich mit — nicht nachgeschlagen
   * beim Anzeigen. Sonst stünde das Zitat beim Empfänger leer, wenn die zitierte
   * Nachricht bei ihm nie ankam oder inzwischen gelöscht wurde.
   */
  const [antwortAuf, setAntwortAuf] = useState<AntwortBezug | null>(null)
  /** Die Nachricht, für die gerade das Langdruck-Menü offen ist. */
  const [menueNachricht, setMenueNachricht] = useState<ChatMessage | null>(null)
  /**
   * Mehrfachauswahl: aus der Kopfzeile wird eine Aktionsleiste. Zurück und
   * Escape beenden sie, wie überall, wo `useMehrfachauswahl` gilt.
   */
  /** Was weitergeleitet werden soll, und wie weit das Neu-Hochladen ist. */
  const [weiterzuleiten, setWeiterzuleiten] = useState<ChatMessage[] | null>(null)
  const [wlFortschritt, setWlFortschritt] = useState<{ gesamt: number; fertig: number } | null>(null)
  /** Kurz aufleuchtende Zielzeile nach einem Sprung. */
  const [hervorgehoben, setHervorgehoben] = useState<string | null>(null)
  /** Die Nachricht, die in dieser Gruppe oben klebt. */
  const [angeheftet, setAngeheftet] = useState<ChatMessage | null>(null)
  /** Verfallsfrist dieses Chats in Sekunden, 0 = aus. */
  const [verfallSekunden, setVerfallSekunden] = useState(0)

  const gruppenrechteVonRef = useRef<(konto: number) => Set<string>>(() => new Set())
  const wahlLeerenRef = useRef<() => void>(() => {})
  const kern = useMessengerKern({
    t,
    currentUserId,
    friends,
    activeContact,
    activeGroup,
    groups,
    messengerGesperrt,
    gruppenrechteVon: (konto) => gruppenrechteVonRef.current(konto),
    setAngeheftet,
    angeheftet,
    setVerfallSekunden,
    markAsRead,
    isBlocked,
    readReceiptsEnabled,
    onGespraechWechsel: () => {
      setAntwortAuf(null)
      chatSuche.schliesse()
      setAngeheftet(null)
      wahlLeerenRef.current()
      setInputText('')
    },
    onEntwurf: setInputText,
  })
  const {
    messages, setMessages, loadingMessages, sending, setSending,
    identity, setIdentity, identityRef, geraetWartet, blindMailboxId, konversation,
    sendeWirkung, loadMessages, verarbeiteNachrichtenEreignis, zeigeSystemzeile,
    ladeAeltere, hatMehrRef, laedtAeltereRef,
    eingabeBeruehrtRef, highestIncomingIdAcknowledgedRef, highestIncomingIdDeliveredRef,
    maxPartnerReadIdRef, maxPartnerDeliveredIdRef,
  } = kern
  const auswahlReihe = useMemo(() => messages.map(auswahlSchluessel), [messages])
  const wahl = useMehrfachauswahl(auswahlReihe)
  wahlLeerenRef.current = wahl.leeren
  const auswahlModus = wahl.auswahl !== null
  const {
    messagesEndRef,
    scrollContainerRef,
    justSentRef,
    weitOben,
    trennerId,
    oeffneAusListe,
  } = useMessengerScrollUndTrenner({
    blindMailboxId,
    messages,
    ladeAeltere,
    hatMehrRef,
    laedtAeltereRef,
    unreadCounts,
    markAsRead,
  })
  const istSchreibenGesperrt = Boolean(activeContact) && identity.state === 'loading'


  // Real-time typing & voice recording indicator state
  const [partnerActivity, setPartnerActivity] = useState<{ status: 'typing' | 'recording'; username?: string } | null>(null)
  const partnerActivityTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastTypingSentRef = useRef<number>(0)

  const chatInputRef = useRef<ChatInputBarRef>(null)
  const [erwaehnungsVorschlaege, setErwaehnungsVorschlaege] = useState<Erwaehnungsvorschlag[]>([])

  /** Höchstens so viel vom Text steht im Zitat — der Rest wäre eine Kopie. */
  const ZITAT_MAX = 120

  /**
   * Der Auszug, der mit einer Antwort mitreist.
   *
   * Bei einer Nachricht ohne Text beschreibt er den Anhang. „Antwort auf Bild"
   * ist eine Auskunft; ein leeres Zitat ist keine.
   */
  const auszugFuerZitat = (msg: ChatMessage): string => {
    if (msg.text?.trim()) return msg.text.trim().slice(0, ZITAT_MAX)
    if (msg.imageAttachment) return 'Bild'
    if (msg.videoNoteAttachment) return 'Videonotiz'
    if (msg.audioAttachment) return 'Sprachnachricht'
    if (msg.stickerAttachment) return msg.stickerAttachment.label || 'Aufkleber'
    if (msg.fileAttachment) return String(msg.fileAttachment.name || 'Datei')
    if (msg.noteAttachment) return msg.noteAttachment.title || 'Notiz'
    if (msg.calendarAttachment) return msg.calendarAttachment.title || 'Termin'
    return 'Nachricht'
  }

  /** Setzt den gewählten Namen dort ein, wo gerade `@…` getippt wurde. */
  const waehleErwaehnung = (vorschlag: Erwaehnungsvorschlag) => {
    const feld = chatInputRef.current?.textarea
    const cursor = feld?.selectionStart ?? inputText.length
    const offen = offeneErwaehnung(inputText, cursor)
    if (!offen) return
    const { text, cursor: neuerCursor } = setzeVorschlagEin(inputText, offen.start, cursor, vorschlag.name)
    setInputText(text)
    setErwaehnungsVorschlaege([])
    window.requestAnimationFrame(() => {
      feld?.focus()
      feld?.setSelectionRange(neuerCursor, neuerCursor)
    })
  }

  const entwuerfe = useEntwuerfe()

  /** Ob gerade ein Versand läuft. Siehe `handleSendMessage`. */
  const sendeLaeuft = useRef(false)

  const handleInputChange = (text: string) => {
    eingabeBeruehrtRef.current = true
    setInputText(text)

    // Vorschlagsliste: nur in Gruppen, und nur solange der Cursor hinter einem
    // `@…` steht. Die Auswahl ist Bequemlichkeit — die Schranke für `@everyone`
    // sitzt beim Empfänger, nicht hier.
    if (activeGroup) {
      const feld = chatInputRef.current?.textarea
      const cursor = feld?.selectionStart ?? text.length
      const offen = offeneErwaehnung(text, cursor)
      setErwaehnungsVorschlaege(
        offen ? sucheVorschlaege(activeGroup, offen.praefix, currentUserId) : [],
      )
    } else if (erwaehnungsVorschlaege.length) {
      setErwaehnungsVorschlaege([])
    }

    if (!blindMailboxId) return
    const now = Date.now()
    if (text.trim()) {
      if (now - lastTypingSentRef.current > 2500) {
        lastTypingSentRef.current = now
        if (konversation.chatType && konversation.chatId) {
          messengerSocket.sendTyping(konversation.chatType, String(konversation.chatId), 'typing')
        }
      }
    } else {
      if (lastTypingSentRef.current > 0) {
        lastTypingSentRef.current = 0
        if (konversation.chatType && konversation.chatId) {
          messengerSocket.sendTyping(konversation.chatType, String(konversation.chatId), 'idle')
        }
      }
    }

    entwuerfe.merke(blindMailboxId, text)
  }

  useEffect(() => {
    if (!blindMailboxId) return
    try {
      const pending = sessionStorage.getItem('msm:pending_messenger_draft')
      if (pending) {
        sessionStorage.removeItem('msm:pending_messenger_draft')
        setInputText((prev) => (prev.trim() ? `${prev}\n\n${pending}` : pending))
        entwuerfe.merke(blindMailboxId, pending)
        window.requestAnimationFrame(() => chatInputRef.current?.focus())
      }
    } catch {}
  }, [blindMailboxId, entwuerfe])


  const handleStoryCreated = (story: ChatStoryItem) => {
    setStories((prev) => [story, ...prev])
    toast.success(t('messenger.storyPublished'))
  }

  const handleStoryDeleted = (storyId: number) => {
    setStories((prev) => prev.filter((s) => s.id !== storyId))
    toast.success(t('messenger.storyDeleted'))
  }

  // Handle public invite link join if inviteCode param is present
  useEffect(() => {
    if (!inviteCode || !currentUserId) return
    let active = true

    /*
     * Der Schlüssel steht in `location.hash` und wird hier gelesen, bevor das
     * `navigate` weiter unten ihn wegräumt. Er kam nie beim Server an — der
     * Browser schickt nichts hinter der Raute —, und genau deshalb ist er die
     * einzige Stelle, an der der Name dieser Gruppe zu holen ist.
     */
    const schluessel = schluesselAusLink(window.location.hash)

    joinGroupByInvite(inviteCode)
      .then(async (joinedGroup) => {
        if (!active) return
        let karte: EinladungsInhalt | null = null
        if (schluessel) {
          karte = await getGroupInviteInfo(inviteCode)
            .then((daten) => lieseEinladungsKarte(daten.invite_card, schluessel, inviteCode))
            .catch(() => null)
        }
        const benannt = await uebernimmEinladung(joinedGroup, karte)
        if (!active) return
        toast.success(t('messenger.groupJoined', { name: gruppenTitel(benannt) }))
        setActiveGroup(benannt)
        setActiveContact(null)
        loadData()
        navigate('/chat', { replace: true })
      })
      .catch(() => {
        if (!active) return
        toast.error(t('messenger.inviteInvalid'))
      })

    return () => {
      active = false
    }
  }, [inviteCode, currentUserId, navigate])

  /**
   * Übernimmt Name, Beschreibung und Logo einer Einladungskarte in den
   * versiegelten örtlichen Speicher und gibt die so benannte Gruppe zurück.
   *
   * Ohne Karte passiert nichts weiter — die Gruppe heisst dann bis zur ersten
   * Nachricht „Verschlüsselte Gruppe", und das ist ehrlicher als ein Name, den
   * der Server geraten hätte.
   *
   * Nicht in den Gruppenblock geschrieben: wer gerade beitritt, hat das
   * Gruppengeheimnis noch nicht, und ein neu gebauter Block überschriebe den
   * bestehenden samt Rollen. Der Block bleibt Sache der Mitglieder.
   */
  const uebernimmEinladung = async (
    gruppe: ChatGroupItem,
    karte?: EinladungsInhalt | null,
  ): Promise<ChatGroupItem> => {
    if (!karte) return gruppe
    await merkeGruppenName(gruppe.id, {
      name: karte.name,
      beschreibung: karte.beschreibung,
      logo: karte.logo,
    }).catch(() => {})
    return {
      ...gruppe,
      name: gruppe.name ?? karte.name ?? null,
      description: gruppe.description ?? karte.beschreibung ?? null,
      avatar_url: gruppe.avatar_url ?? karte.logo ?? null,
    }
  }

  /**
   * Beitritt über die Einladungskarte im Chat.
   *
   * `karte` ist der bereits geöffnete Inhalt der Vorschau. Er ist die einzige
   * Quelle für den Namen: der Server kennt ihn nicht, und den verschlüsselten
   * Gruppenblock kann dieses Gerät erst lesen, wenn es das Gruppengeheimnis
   * hat — das kommt mit der ersten Nachricht, nicht mit dem Beitritt.
   */
  const handleJoinByInviteCode = async (code: string, karte?: EinladungsInhalt | null) => {
    try {
      const joinedGroup = await joinGroupByInvite(code)
      const benannt = await uebernimmEinladung(joinedGroup, karte)
      toast.success(t('messenger.groupJoined', { name: gruppenTitel(benannt) }))
      setActiveGroup(benannt)
      setActiveContact(null)
      await loadData()
    } catch {
      toast.error(t('messenger.inviteExpired'))
    }
  }


  // When active contact or active group changes, derive mailbox ID
  /**
   * Das Gespräch, wie es die Krypto-Schicht sieht.
   *
   * Vorher stand hier ein Effekt mit 135 Zeilen, in dem dieselben dreißig
   * viermal standen: einmal je Kombination aus Gruppe/Kontakt und
   * Zwischenspeicher/Berechnung. Die Mailbox-Kennung und die Wahl des
   * Verfahrens liegen jetzt in `useKonversation`; hier bleibt, was die
   * Oberfläche davon merkt.
   */

  /*
   * Das offene Gespräch in den versiegelten örtlichen Speicher.
   *
   * Seit Stufe 6b weiss der Server nicht mehr, mit wem dieses Konto schreibt —
   * `direct_chats` nennt keine Menschen, und `GET /social/direct-chats` ist
   * entfernt. Diese Zeile ist der Ersatz: wer ein Gespräch öffnet, merkt es
   * sich selbst.
   *
   * Nur Kontakte, die nicht ohnehin in der Kontaktliste stehen, brauchen das
   * eigentlich — gemerkt wird trotzdem jeder. Ein Freund, der später keiner
   * mehr ist, verschwände sonst samt seinem Chatverlauf aus der Liste, und ein
   * Verlauf ohne Zeile ist ein Verlauf, den niemand mehr findet.
   */
  // Load and decrypt messages (non-flickering background sync + real-time)
  /**
   * Was ein Konto in der offenen Gruppe darf.
   *
   * Zwei Quellen: die Mitgliederzeile vom Server und der verschlüsselte
   * Rollenblock (`gruppenRollenZustand`). Zusammengeführt in
   * `wirksameGruppenrechte` — das ist die einzige Stelle, die diese Frage
   * beantwortet, und der Rechte-Dialog benutzt dieselbe.
   */
  const gruppenrechteVon = useCallback(
    (konto: number) => {
      if (!activeGroup) return new Set<string>()
      return rechteAusGruppe(activeGroup, konto, gruppenRollenZustand)
    },
    [activeGroup, gruppenRollenZustand],
  )
  gruppenrechteVonRef.current = gruppenrechteVon

  /**
   * Ob ich fremde Nachrichten in dieser Gruppe entfernen darf.
   *
   * `delete_messages` stand seit je im Rechtevokabular und hatte bis 09/2026
   * keinen Konsumenten: der Menüeintrag hing an `msg.isSelf`, ein Moderator
   * konnte also nichts entfernen, egal was im Dialog gesetzt war.
   */
  const darfFremdeLoeschen =
    Boolean(activeGroup) && gruppenrechteVon(currentUserId).has('delete_messages')

  /**
   * Ob ich in dieser Gruppe schreiben und anhängen darf.
   *
   * Im Direktchat immer — dort gibt es keine Rollen. `send_messages` und
   * `attach_media` standen seit je im Vokabular, ließen sich setzen und hatten
   * keinen Konsumenten: das Eingabefeld fragte nie.
   *
   * Durchgesetzt wird das **beim Empfänger** (siehe `umschlagAuswertung.ts`), nicht am
   * Server. Der Server kann den Inhalt nicht lesen und weiß nach Stufe 6 auch
   * nicht mehr, wer Mitglied ist; eine Schranke dort wäre eine, die wir bald
   * wieder herausreißen. Hier zu sperren ist die Höflichkeit, dort zu
   * verwerfen die Wirkung.
   */
  const darfSchreiben = !activeGroup || gruppenrechteVon(currentUserId).has('send_messages')
  const darfAnhaengen = !activeGroup || gruppenrechteVon(currentUserId).has('attach_media')


  /** Antworten: den Zitatkopf über die Eingabe setzen und dorthin springen. */
  const handleAntworten = (msg: ChatMessage) => {
    if (!msg.clientUuid) {
      // Ohne logische Kennung gäbe es nichts, worauf das Zitat zeigen könnte.
      toast.error(t('messenger.replyImpossible'))
      return
    }
    setAntwortAuf({
      clientUuid: msg.clientUuid,
      absenderId: msg.senderId,
      absenderName: msg.isSelf ? user?.username : msg.senderName || activeContact?.username,
      auszug: auszugFuerZitat(msg),
    })
    chatInputRef.current?.focus()
  }

  /** Markieren — bleibt auf diesem Gerät, geht nie über den Server. */
  const handleMarkieren = (msg: ChatMessage) => {
    if (!blindMailboxId) return
    const neu = !msg.istMarkiert
    setMessages((prev) => {
      const geaendert = prev.map((m) => (m.id === msg.id ? { ...m, istMarkiert: neu } : m))
      sessionChatCache.set(blindMailboxId, geaendert.slice(-80))
      return geaendert
    })
    void updateMessageInLocalStore(blindMailboxId, msg.id, { istMarkiert: neu }).catch(() => {})
    vergissMailbox(blindMailboxId)
    if (neu) setHatNeueMarkierung(true)
    toast.success(neu ? 'Markiert.' : 'Markierung entfernt.')
  }

  /** Text in die Zwischenablage. */
  const handleKopieren = async (msg: ChatMessage) => {
    if (!msg.text) return
    try {
      await navigator.clipboard.writeText(msg.text)
      toast.success(t('messenger.textCopied'))
    } catch {
      toast.error(t('messenger.copyRefused'))
    }
  }

  /**
   * Zu einer Nachricht springen.
   *
   * Nicht animiert: durch tausend Zeilen zu scrollen dauert und bringt nichts.
   * Direkt setzen, dann kurz aufleuchten lassen — das Aufleuchten ist die
   * Antwort auf „wo bin ich jetzt".
   */
  const springeZu = (clientUuid: string) => {
    const ziel = document.querySelector<HTMLElement>(`[data-nachricht="${CSS.escape(clientUuid)}"]`)
    if (!ziel) {
      toast.error(t('messenger.messageGoneLocally'))
      return
    }
    ziel.scrollIntoView({ block: 'center' })
    setHervorgehoben(clientUuid)
    window.setTimeout(() => setHervorgehoben((v) => (v === clientUuid ? null : v)), 1600)
  }

  /** Auswahlmodus: ein Haken je Zeile, die Aktionen unten. */
  const handleAuswahlUmschalten = (msg: ChatMessage) => wahl.umschalten(auswahlSchluessel(msg))

  const beendeAuswahl = wahl.leeren

  const gewaehlteNachrichten = () => messages.filter((m) => wahl.auswahl?.has(auswahlSchluessel(m)))

  /** Mehrere Texte am Stück in die Zwischenablage, in Reihenfolge des Verlaufs. */
  const handleAuswahlKopieren = async () => {
    const text = gewaehlteNachrichten()
      .filter((m) => m.text && !m.isDeleted)
      .map((m) => m.text)
      .join('\n')
    if (!text) {
      toast.error(t('messenger.selectionHasNoText'))
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      toast.success(t('messenger.textCopied'))
      beendeAuswahl()
    } catch {
      toast.error(t('messenger.copyRefused'))
    }
  }

  /**
   * Mehrere löschen.
   *
   * Der Reihe nach über denselben Weg wie eine einzelne Nachricht: erst die
   * Gegenseite, dann Server, dann dieses Gerät. Nebenläufig ginge schneller und
   * würde beim Netzabbruch einen halb geräumten Zustand hinterlassen.
   */
  const handleAuswahlLoeschen = async () => {
    const eigene = gewaehlteNachrichten().filter((m) => m.isSelf && !m.isDeleted)
    if (!eigene.length) return
    beendeAuswahl()
    for (const m of eigene) await handleDeleteMessage(m)
  }

  /** Alle Chats, in die sich weiterleiten lässt — zuletzt genutzte zuerst. */
  const weiterleitungsZiele = useMemo<
    (Weiterleitungsziel & { avatarUrl?: string | null; istGruppe?: boolean })[]
  >(() => {
    const ziele: (Weiterleitungsziel & { avatarUrl?: string | null; istGruppe?: boolean })[] = []
    for (const g of groups) {
      const mid = groupMailboxMap[g.id]
      if (mid) ziele.push({ blindMailboxId: mid, groupId: g.id, name: gruppenTitel(g), istGruppe: true })
    }
    for (const c of contactsList) {
      const mid = contactMailboxMap[c.userId]
      if (!mid || mid === blindMailboxId) continue
      ziele.push({
        blindMailboxId: mid,
        recipientId: c.userId,
        name: c.username,
        avatarUrl: c.avatarUrl,
      })
    }
    // Angeheftete zuerst — das sind die Chats, die jemand selbst als wichtig
    // markiert hat, und meistens leitet man an dieselben zwei Leute weiter.
    return ziele.sort((a, b) => {
      const pa = pinnedChats.indexOf(a.blindMailboxId)
      const pb = pinnedChats.indexOf(b.blindMailboxId)
      if (pa !== pb) return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb)
      return (a.name || '').localeCompare(b.name || '')
    })
  }, [groups, contactsList, groupMailboxMap, contactMailboxMap, blindMailboxId, pinnedChats])

  /**
   * Namen der Gruppen für die Trefferliste. Der Server liefert sie seit Stufe 6
   * nicht mehr; `gruppenTitel` holt sie aus dem versiegelten Namensspeicher.
   */
  const verzeichnisMitGruppen = useMemo(() => {
    const out = { ...mailboxDirectory }
    for (const gruppe of groups) {
      const mid = groupMailboxMap[gruppe.id] || `group:${gruppe.id}`
      out[mid] = {
        ...(out[mid] ?? { name: gruppenTitel(gruppe) }),
        name: gruppenTitel(gruppe),
        isGroup: true,
        groupId: gruppe.id,
      }
    }
    return out
  }, [mailboxDirectory, groups, groupMailboxMap, gruppenTitel])

  const { handleSendMessage, handleDeleteMessage } = useMessengerSenden({
    t,
    currentUserId,
    user,
    activeContact,
    activeGroup,
    groups,
    blindMailboxId,
    darfSchreiben,
    darfAnhaengen,
    darfFremdeLoeschen,
    editingMessage,
    setEditingMessage,
    inputText,
    setInputText,
    antwortAuf,
    setAntwortAuf,
    setSelectedImage,
    setStagedFile,
    setErwaehnungsVorschlaege,
    verfallSekunden,
    setMessages,
    setSending,
    setIdentity,
    identityRef,
    maxPartnerReadIdRef,
    maxPartnerDeliveredIdRef,
    justSentRef,
    lastTypingSentRef,
    sendeLaeuft,
    entwuerfe,
    konversation,
    loadMessages,
    sendeWirkung,
    getOutbox,
    setOutbox,
  })

  /**
   * Den verschlüsselten Rollenblock der offenen Gruppe holen.
   *
   * Er entscheidet mit, ob ein fremder Löschbefehl befolgt wird — also muss er
   * hier liegen und nicht nur im Rechte-Dialog. Wer ihn schreiben durfte, wird
   * gegen die **Mitgliederzeile** geprüft und nicht gegen den Block selbst:
   * ein Block, der seine eigene Befugnis bescheinigt, bescheinigt nichts.
   */
  useEffect(() => {
    if (!activeGroup || !blindMailboxId) {
      setGruppenRollenZustand(null)
      return
    }
    let abgebrochen = false
    const mitglieder = activeGroup.members ?? []
    const darfSchreiben = (konto: number) => {
      if (Number(activeGroup.owner_user_id) === Number(konto)) return true
      const m = mitglieder.find((x) => Number(x.user_id) === Number(konto))
      if (!m) return false
      if (m.role === 'owner' || m.role === 'admin') return true
      return (m.permissions || '')
        .split(',')
        .map((p) => p.trim())
        .includes('manage_roles')
    }

    void ladeGruppenzustand(
      {
        groupId: activeGroup.id,
        blindMailboxId,
        eigeneId: currentUserId,
        mitglieder: mitglieder.map((m) => m.user_id),
        istEigentuemer: activeGroup.role === 'owner',
      },
      darfSchreiben,
    )
      .then((lesung) => {
        if (abgebrochen) return
        setGruppenRollenZustand(lesung.art === 'zustand' ? lesung.zustand : null)
      })
      .catch(() => {
        if (!abgebrochen) setGruppenRollenZustand(null)
      })

    return () => {
      abgebrochen = true
    }
  }, [activeGroup?.id, activeGroup?.members, blindMailboxId, currentUserId])

  /**
   * Die Gruppeninfo der offenen Gruppe.
   *
   * Sie liegt seit 27.10.2026 in einem eigenen Block. Der Rollenblock daneben
   * trägt sie nur noch für Altbestände. Deshalb wird hier **nicht** mehr aus
   * dem Rollenblock gelesen: ein bewusst geleerter Name stünde sonst wieder
   * da, sobald jemand die Rollen lädt.
   */
  useEffect(() => {
    if (!activeGroup || !blindMailboxId || !currentUserId) return
    let abgebrochen = false
    const mitglieder = activeGroup.members ?? []
    const darfSchreiben = (konto: number) => {
      if (Number(activeGroup.owner_user_id) === Number(konto)) return true
      const m = mitglieder.find((x) => Number(x.user_id) === Number(konto))
      if (!m) return false
      if (m.role === 'owner' || m.role === 'admin') return true
      if (m.can_edit_group) return true
      return (m.permissions || '')
        .split(',')
        .map((p) => p.trim())
        .includes('edit_group')
    }

    void ladeGruppenInfo(
      {
        groupId: activeGroup.id,
        blindMailboxId,
        eigeneId: currentUserId,
        mitglieder: mitglieder.map((m) => m.user_id),
        istEigentuemer: activeGroup.role === 'owner',
      },
      darfSchreiben,
    )
      .then((lesung) => {
        if (abgebrochen || lesung.art !== 'info') return
        uebernimmGruppenInfo(activeGroup.id, {
          name: lesung.info.name,
          beschreibung: lesung.info.beschreibung,
          logo: lesung.info.logo,
        })
      })
      .catch(() => {})

    return () => {
      abgebrochen = true
    }
  }, [activeGroup?.id, blindMailboxId, currentUserId, uebernimmGruppenInfo])

  /**
   * Die offene Gruppe frisch halten.
   *
   * `activeGroup` war eine Momentaufnahme vom Öffnen des Chats und wurde nie
   * wieder angefasst — die Liste daneben aktualisierte sich im Takt, dieser
   * eine Eintrag nicht. Solange daran nur der Name hing, fiel es niemandem
   * auf. Seit die **Rechte** daran hängen, ist es eine Sicherheitsfrage: ein
   * entzogenes Schreibrecht wirkte erst, wenn der Betroffene den Chat von
   * Hand neu öffnete, und ein frisch vergebenes ebenso wenig.
   *
   * Verglichen wird, was Rechte trägt — und seit Stufe 6 auch Name,
   * Beschreibung und Logo. Die kommen jetzt aus dem verschlüsselten
   * Gruppenblock und treffen daher **nach** dem Öffnen ein: auf einem frisch
   * eingerichteten Gerät stünde sonst für immer „Verschlüsselte Gruppe" über
   * einem Chat, dessen Name längst in der Liste daneben steht. Sie ändern sich
   * selten genug, um das Vergleichen nicht teuer zu machen.
   *
   * Raumzeichen und Anrufzustand bleiben draussen; die ändern sich im
   * Sekundentakt, und darauf zu reagieren hiesse, die Ansicht ständig neu zu
   * setzen, ohne dass sich etwas geändert hätte.
   */
  useEffect(() => {
    if (!activeGroup) return
    const frisch = groups.find((g) => g.id === activeGroup.id)
    if (!frisch) return
    const rechtekennung = (g: ChatGroupItem) =>
      JSON.stringify([
        g.default_permissions ?? null,
        g.invite_code ?? null,
        g.role ?? null,
        g.owner_user_id,
        g.can_pin_messages ?? null,
        g.can_mention_everyone ?? null,
        g.can_set_disappearing_messages ?? null,
        g.name ?? null,
        g.description ?? null,
        g.avatar_url ?? null,
        (g.members ?? []).map((m) => [m.user_id, m.role, m.permissions ?? null]),
      ])
    if (rechtekennung(frisch) !== rechtekennung(activeGroup)) setActiveGroup(frisch)
  }, [groups, activeGroup])

  /** Ob ich in dieser Gruppe anheften darf — vom Server entschieden. */
  const darfAnheften = activeGroup
    ? Boolean(activeGroup.can_pin_messages)
    : Boolean(activeContact)

  const { handleReaktion, handleAnheften, handleWeiterleiten, medienBindung } =
    useMessengerInteraktionen({
      t,
      currentUserId,
      blindMailboxId,
      chatType: konversation.chatType,
      chatId: konversation.chatId,
      activeGroup,
      angeheftet,
      setAngeheftet,
      darfAnheften,
      weiterzuleiten,
      setWeiterzuleiten,
      setWlFortschritt,
      beendeAuswahl,
      setMessages,
      sendeWirkung,
      handleSendMessage,
    })

  const {
    verfallOffen,
    setVerfallOffen,
    verfallVonAnderem,
    darfVerfallStellen,
    verfallVonName,
    handleVerfallWaehlen,
    handleEphemeral,
  } = useMessengerVerfall({
    t,
    currentUserId,
    blindMailboxId,
    chatType: konversation.chatType,
    chatId: konversation.chatId,
    activeContact,
    activeGroup,
    messengerGesperrt,
    messages,
    setMessages,
    verfallSekunden,
    setVerfallSekunden,
    sendeWirkung,
    zeigeSystemzeile,
  })

  const chatSuche = useChatSuche(blindMailboxId, springeZu)

  /** Eine gesendete Freundschaftsanfrage gilt für diesen Kontakt, nicht für immer. */
  const [anfrageGesendet, setAnfrageGesendet] = useState(false)
  useEffect(() => {
    setAnfrageGesendet(false)
  }, [activeContact?.userId])

  /**
   * Zwei Wege zurück, ein Ziel: der offene Chat geht zur Liste.
   *
   * Der Verlaufseintrag deckt die Systemgeste und die Zurück-Taste ab — unter
   * Android beendet sie sonst die App, statt den Chat zu verlassen — und in
   * Pontis schließt dieselbe Anfrage zuerst den Chat, dann das Panel. Die
   * Wischgeste kommt für Web und MSS dazu; in Pontis schweigt sie, weil dort
   * bereits am Fenster gewischt wird.
   */
  useZurueckSchliesst(Boolean(activeContact || activeGroup), handleZurueckZurListe)
  useWischZurueck(
    Boolean(activeContact || activeGroup) && !auswahlModus && !chatSuche.offen,
    handleZurueckZurListe,
  )

  const ueberall = useUeberallAnsicht(currentUserId, groups)

  /**
   * Ein anderer Chat schliesst die Vollbildansicht.
   *
   * „Markierte Nachrichten", „@ und Antworten an mich" und die Suche über alle
   * Chats liegen als `fixed inset-0` über dem Gesprächsbereich — aber **nicht**
   * über der Seitenleiste: die Hülle kappt den Stapelkontext im Inhaltsbereich
   * (siehe `Shell.tsx`). Ein Klick auf einen Chat dort wechselte also die
   * Adresse, öffnete das Gespräch und liess die Trefferliste darüber stehen.
   * Man konnte tippen und senden, ohne etwas davon zu sehen; der einzige Weg
   * zurück war der Zurück-Knopf der Ansicht. Ein Treffer selbst schliesst sie
   * schon länger (`oeffneTreffer`), der Weg über die Seitenleiste nicht.
   */
  useEffect(() => {
    ueberall.schliesse()
  }, [activeContact?.userId, activeGroup?.id])

  /** Öffnet einen Treffer aus der Ansicht über alle Chats. */
  const oeffneTreffer = async (treffer: Treffer) => {
    ueberall.schliesse()
    const meta = verzeichnisMitGruppen[treffer.blindMailboxId]
    if (meta?.isGroup && meta.groupId) {
      const gruppe = groups.find((g) => g.id === meta.groupId)
      if (gruppe) {
        setActiveGroup(gruppe)
        setActiveContact(null)
      }
    } else if (meta?.userId) {
      const kontakt = contactsList.find((c) => c.userId === meta.userId)
      if (kontakt) {
        setActiveContact(kontakt)
        setActiveGroup(null)
      }
    }
    // Der Verlauf muss erst stehen, bevor der Anker im DOM liegt.
    if (treffer.clientUuid) {
      const uuid = treffer.clientUuid
      window.setTimeout(() => springeZu(uuid), 400)
    }
  }

  useMessengerSync({
    blindMailboxId,
    leseMailboxen: kern.konversation.leseMailboxen,
    currentUserId,
    geraeteMeldungen: user?.device_notifications,
    loadMessages,
    beiNachrichtenEreignis: verarbeiteNachrichtenEreignis,
    beiEphemeral: handleEphemeral,
    chatType: konversation.chatType,
    chatId: konversation.chatId,
    setGroups,
    setActiveGroup,
    setPartnerActivity,
    partnerActivityTimeoutRef,
  })


  useEffect(() => {
    setPartnerActivity(null)
    if (partnerActivityTimeoutRef.current) {
      clearTimeout(partnerActivityTimeoutRef.current)
      partnerActivityTimeoutRef.current = null
    }
    const stand = quittungsstand(blindMailboxId)
    highestIncomingIdAcknowledgedRef.current = stand.gelesen
    highestIncomingIdDeliveredRef.current = stand.zugestellt
    // Die Partnerzähler lädt der Kern aus `partnerstand`; hier auf 0 zu setzen
    // nahm den gespeicherten Zustellstand bei jedem Chatwechsel wieder weg.
  }, [blindMailboxId])

  /**
   * Fasst die Warteschlange nach.
   *
   * `replayOutbox` hatte bis 09/2026 genau einen Auslöser in der Anwendung:
   * `getNotesOffline`. Eine Nachricht, deren Versand scheiterte — ein
   * Ratenlimit reicht —, lag danach in `msm_offline_outbox` und wurde erst
   * wieder angefasst, wenn der Benutzer zufällig die Notizen öffnete. Am
   * laufenden System standen so 31 Aufträge mit `retryCount: 0` und rührten
   * sich nicht, während im Verlauf Nachrichten mit dem Uhr-Symbol hingen. Der
   * Chat ist der Ort, an dem man diese Uhr sieht, also fasst er auch nach.
   */
  const fasseWarteschlangeNach = useCallback(() => {
    if (getOutbox().length === 0) return
    void replayOutbox().catch(() => {})
  }, [])

  useEffect(() => {
    if (blindMailboxId && (activeContact || activeGroup)) {
      void loadMessages(true)
      fasseWarteschlangeNach()
      const interval = setInterval(() => {
        // Im Hintergrund nicht: jeder Durchgang entschlüsselt und versiegelt
        // den ganzen Verlauf neu. Neue Nachrichten holt dann das Sync-Ereignis
        // oben, und `visibilitychange` lädt beim Zurückkommen sofort.
        if (typeof document === 'undefined' || document.visibilityState === 'visible') {
          void loadMessages(false)
        }
        fasseWarteschlangeNach()
      }, 5000)
      const beiNetz = () => fasseWarteschlangeNach()
      window.addEventListener('online', beiNetz)
      return () => {
        clearInterval(interval)
        window.removeEventListener('online', beiNetz)
      }
    }
    // `identity.state` gehört in die Abhängigkeiten: nach dem Entsperren muss
    // derselbe Chat noch einmal durchlaufen, sonst bleibt der eben lesbar
    // gewordene Verlauf bis zum nächsten Wechsel stumm.
  }, [blindMailboxId, activeContact?.userId, activeGroup?.id, identity.state])

  // Listen for offline queue background confirmations from offlineSync
  useEffect(() => {
    const handleMessageConfirmed = (e: Event) => {
      const ce = e as CustomEvent<{ client_uuid: string; envelope_id: number; blind_mailbox_id: string }>
      const detail = ce.detail
      if (!detail?.client_uuid || !detail?.envelope_id) return
      const { envelope_id, blind_mailbox_id: confirmedMid } = detail
      /**
       * Die Warteschlange meldet die Kennung **mit** Gerätesuffix — ein
       * Auftrag steht je Zielgerät darin, und `#<geraet>` hält sie
       * auseinander. Die Zeile im Verlauf trägt die logische Kennung ohne
       * Suffix. Der Vergleich traf deshalb nie zu: der Umschlag ging raus, die
       * Zeile behielt ihre Uhr, und weil `updateMessageInLocalStore` dieselbe
       * Kennung benutzte, überlebte sie auch jedes Neuladen. Am laufenden
       * System waren das die Nachrichten, die zugestellt waren und trotzdem
       * für immer „in der Warteschlange" standen.
       */
      const client_uuid = logischeUuid(detail.client_uuid) ?? detail.client_uuid

      const isRead = maxPartnerReadIdRef.current >= envelope_id
      const isDelivered = isRead || maxPartnerDeliveredIdRef.current >= envelope_id
      const status: 'queued' | 'sent' | 'delivered' | 'read' = isRead
        ? 'read'
        : isDelivered
          ? 'delivered'
          : 'sent'
      if (confirmedMid === blindMailboxId) {
        setMessages((prev) =>
          sortMessagesChronologically(
            prev.map((m) =>
              m.clientUuid === client_uuid
                ? {
                    ...m,
                    id: envelope_id,
                    status,
                    isRead: m.isRead || isRead,
                    isDelivered: m.isDelivered || isDelivered,
                  }
                : m,
            ),
          ),
        )
      }
      if (confirmedMid) {
        void updateMessageInLocalStore(confirmedMid, client_uuid, {
          id: envelope_id,
          status,
          isRead,
          isDelivered,
        })
      }
    }
    window.addEventListener('msm:message-confirmed', handleMessageConfirmed)
    return () => {
      window.removeEventListener('msm:message-confirmed', handleMessageConfirmed)
    }
  }, [blindMailboxId])

  /**
   * Eine Nachricht, die die Warteschlange endgültig aufgegeben hat.
   *
   * Vorher erfuhr die Oberfläche davon nichts: der Auftrag verschwand, die Uhr
   * drehte weiter. Jetzt steht dort ein rotes Zeichen, und das Menü bietet
   * „Erneut senden". Der Text bleibt erhalten — das ist der Unterschied
   * zwischen „nicht angekommen" und „verloren".
   */
  useEffect(() => {
    const handleMessageFailed = (e: Event) => {
      const detail = (
        e as CustomEvent<{ client_uuid: string; blind_mailbox_id: string }>
      ).detail
      if (!detail?.client_uuid || detail.blind_mailbox_id !== blindMailboxId) return
      const clientUuid = logischeUuid(detail.client_uuid) ?? detail.client_uuid
      setMessages((prev) =>
        prev.map((m) =>
          m.clientUuid === clientUuid
            ? { ...m, status: 'failed', isDelivered: false, isRead: false }
            : m,
        ),
      )
    }
    window.addEventListener('msm:message-failed', handleMessageFailed)
    return () => {
      window.removeEventListener('msm:message-failed', handleMessageFailed)
    }
  }, [blindMailboxId])

  /**
   * Signal-Quittungen: Zustell- und Lesequittungen direkt und verzögerungsfrei
   * im UI-Zustand und Klartext-Cache aktualisieren (0 ms Feedback).
   */
  useEffect(() => {
    const handleReceipt = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (!detail) return
      if (
        String(detail.chat_type ?? '') !== String(konversation.chatType ?? '') ||
        Number(detail.chat_id) !== Number(konversation.chatId)
      ) {
        return
      }
      const uuids: string[] = Array.isArray(detail.client_uuids)
        ? detail.client_uuids
        : detail.client_uuid
        ? [detail.client_uuid]
        : []
      const uuidSet = new Set(uuids.map((u: string) => String(u).split('#')[0]))
      const upTo = Number(detail.up_to_id || 0)
      const isRead = detail.type === 'read_receipt'

      setMessages((prev) => {
        let changed = false
        const updated = prev.map((m) => {
          const baseUuid = (m.clientUuid || '').split('#')[0]
          const perUuid = Boolean(baseUuid && uuidSet.has(baseUuid))
          const perWatermark = !m.isSelf || upTo <= 0 ? false : m.id > 0 && m.id <= upTo
          if (perUuid || perWatermark) {
            const nextRead = isRead ? true : Boolean(m.isRead)
            const nextDelivered = true
            const nextStatus: 'read' | 'delivered' = nextRead ? 'read' : 'delivered'
            if (m.isRead !== nextRead || m.isDelivered !== nextDelivered || m.status !== nextStatus) {
              changed = true
              return {
                ...m,
                isDelivered: nextDelivered,
                isRead: nextRead,
                status: nextStatus,
              }
            }
          }
          return m
        })
        if (!changed) return prev
        if (blindMailboxId) {
          sessionChatCache.set(blindMailboxId, updated.slice(-80))
        }
        return updated
      })
    }

    window.addEventListener('msm:delivery-receipt', handleReceipt)
    window.addEventListener('msm:read-receipt', handleReceipt)
    return () => {
      window.removeEventListener('msm:delivery-receipt', handleReceipt)
      window.removeEventListener('msm:read-receipt', handleReceipt)
    }
  }, [blindMailboxId, konversation.chatId, konversation.chatType])

  /**
   * Wenn dieses Gerät sich nicht beim Konto melden kann, sieht es niemand.
   *
   * Der Fehler wird in `e2eeIdentity.resolveIdentity` gedrosselt gemeldet; hier
   * wird daraus ein Satz statt eines stummen Verschwindens.
   */
  useEffect(() => {
    const handlePublishFailed = () => {
      toast.error(t('messenger.devicePublishFailed'))
    }
    window.addEventListener('msm:e2ee-publish-failed', handlePublishFailed)
    return () => {
      window.removeEventListener('msm:e2ee-publish-failed', handlePublishFailed)
    }
  }, [t])

  /**
   * Eine endgültig gescheiterte Nachricht noch einmal schicken.
   *
   * Der Umschlag von damals ist weg (der Server hat ihn abgewiesen), also wird
   * die Nutzlast aus der lokalen Zeile neu gebaut. Anhänge mit `mediaId`
   * werden wiederverwendet; eine Videonotiz lässt sich nicht aus ihrem Zeiger
   * wiederherstellen, und ohne Text gäbe es dann nichts zu senden — das sagt
   * die Meldung, statt eine leere Blase zu schicken.
   */
  const handleErneutSenden = async (msg: ChatMessage) => {
    const hatInhalt = Boolean(
      msg.text ||
        msg.imageAttachment ||
        msg.fileAttachment ||
        msg.audioAttachment ||
        msg.stickerAttachment ||
        msg.noteAttachment ||
        msg.calendarAttachment ||
        msg.storyReply,
    )
    if (!hatInhalt) {
      toast.error(t('messenger.retryNotPossible'))
      return
    }

    /**
     * Erst senden, dann aufräumen.
     *
     * Bis 10/2026 fiel die alte Zeile **vor** dem Versand. Lief gerade ein
     * anderer Versand, wies `handleSendMessage` den neuen Auftrag still ab —
     * und die alte Nachricht war trotzdem weg: nicht gesendet, nicht mehr
     * sichtbar, nicht wiederholbar. Jetzt entscheidet die Annahme des Versands,
     * ob die alte Zeile fällt; sonst bleibt sie samt „Erneut senden“ stehen.
     */
    const angenommen = await handleSendMessage({
      text: msg.text,
      antwortAuf: msg.antwortAuf ?? null,
      img: msg.imageAttachment,
      file: msg.fileAttachment,
      audio: msg.audioAttachment,
      sticker: msg.stickerAttachment,
      note: msg.noteAttachment,
      cal: msg.calendarAttachment,
      storyReply: msg.storyReply,
      weitergeleitet: msg.weitergeleitet,
      ...(msg.clientUuid
        ? { wiederholung: { clientUuid: msg.clientUuid, id: msg.id } }
        : {}),
    })
    if (!angenommen) return

    // Mit clientUuid wurde dieselbe Zeile aktualisiert. Sie darf nicht
    // entfernt werden, sonst verschwindet die einzige Kopie nach dem Erfolg.
    if (!msg.clientUuid) {
      setMessages((prev) => prev.filter((m) => m.id !== msg.id))
      await entferneLokaleNachricht(blindMailboxId, {
        clientUuid: msg.clientUuid,
        id: msg.id,
      }).catch(() => {})
    }
  }

  /**
   * Nimmt ein 1:1-Gespräch aus der Liste — samt örtlichem Verlauf.
   *
   * Der Gegenpol zu den Geister-Kontakten aus früheren Fassungen: was nie in
   * der Liste stehen sollte, lässt sich jetzt auch wieder entfernen. Die
   * Freundschaft bleibt bestehen; nur das Gespräch und sein Verlauf gehen.
   */
  const handleChatAusListe = async () => {
    if (!activeContact) return
    const userId = activeContact.userId
    const mid = blindMailboxId

    try {
      // Erst der örtliche Verlauf. Scheitert das, ist der Chat **nicht**
      // entfernt: dann bleibt er offen und in der Liste, und die Meldung sagt
      // den Fehler, statt Erfolg zu behaupten. Umgekehrt wäre der Verlauf weg
      // und die Zeile stünde noch da.
      if (mid) await leereMailboxLokal(mid)
      // **Verstecken, nicht vergessen.** Ein Freund, ein Teammitglied oder ein
      // öffentliches Profil steht auch ohne Gespräch in der Kontaktliste; ein
      // gelöschter Gesprächseintrag allein ließ die Zeile deshalb stehen, obwohl
      // „entfernt“ erschien. Die Freundschaft bleibt unberührt.
      await versteckeGespraech(userId, {
        username: activeContact.username,
        avatarUrl: activeContact.avatarUrl,
      })
    } catch {
      toast.error(t('messenger.chatRemoveFailed'))
      return
    }

    if (mid) {
      sessionChatCache.delete(mid)
      vergissMailbox(mid)
      useMessengerNotificationStore.getState().markAsRead(mid)
    }

    handleZurueckZurListe()
    await loadData().catch(() => {})
    toast.success(t('messenger.chatRemoved'))
  }

  // Die fertige Sprachnachricht geht denselben Weg wie jede andere Nachricht.
  const aufnahme = useSprachaufnahme({
    blindMailboxId,
    chatType: konversation.chatType,
    chatId: konversation.chatId,
    onFertig: (audio) => void handleSendMessage({ text: '', audio }),
  })

  // Blockieren oder Aufheben aus dem Bestätigungsdialog, je nach heutigem Stand.
  const handleBlockConfirm = async () => {
    if (activeContact && isBlocked(activeContact.userId)) {
      await unblockUser(activeContact.userId)
      toast.success(t('social.contacts.unblocked', { name: activeContact.username }))
    } else if (activeContact) {
      await blockUser(activeContact.userId, activeContact.username, activeContact.avatarUrl)
      // Und aus der örtlichen Gesprächsliste. Seit Stufe 6b führt
      // sie dieses Gerät; bliebe die Zeile stehen, tauchte der
      // Blockierte weiter in der Kontaktliste auf und sein
      // Gespräch bliebe abonniert.
      await vergissGespraech(activeContact.userId).catch(() => {})
      toast.success(t('messenger.contactBlockedToast', { name: activeContact.username }))
    }
    setIsBlockConfirmOpen(false)
  }

  const isChatOpen = Boolean(activeContact || activeGroup)

  const storyIch = { avatarUrl: user?.avatar_url, username: user?.username }

  /** Ein Anruf an den offenen Kontakt; nur unter Freunden angeboten. */
  const starteAnruf = async (art: 'audio' | 'video') => {
    if (!activeContact) return
    try {
      await useCallStore.getState().initiateCall(
        {
          userId: activeContact.userId,
          username: activeContact.username,
          avatarUrl: activeContact.avatarUrl,
        },
        art,
      )
    } catch (err: any) {
      toast.error(err?.message || t('messenger.callStartFailedSingle'))
    }
  }

  /** Fragt nach, bevor der Funke mit diesem Kontakt wiederhergestellt wird. */
  const oeffneFunkenRettung = async (kontakt: ChatContact) => {
    await useFunkenStore.getState().lade()
    const jetzt = Date.now()
    const kern = useFunkenStore.getState().kernVon(kontakt.userId, jetzt)
    if (!kern || !rettungMoeglich(kern, jetzt)) {
      toast.error(t('messenger.streak.restoreUnavailable'))
      return
    }
    setFunkenRettung({ partnerId: kontakt.userId, name: kontakt.username, anzahl: kern.verloren })
  }

  // Aus der Freundesliste im Profil: `/chat?userId=<id>&funke=retten` öffnet
  // den Chat und gleich die Rückfrage. Der Zusatz fällt danach weg, damit ein
  // Neuladen nicht noch einmal fragt.
  useEffect(() => {
    if (searchParams.get('funke') !== 'retten' || !activeContact?.isFriend) return
    if (String(activeContact.userId) !== (searchParams.get('userId') || searchParams.get('contact'))) return
    const next = new URLSearchParams(searchParams)
    next.delete('funke')
    setSearchParams(next, { replace: true })
    void oeffneFunkenRettung(activeContact)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, activeContact])

  /** Öffnet die Kamera für einen Augenblick an den offenen Kontakt. */
  const oeffneAugenblick = () => {
    setAugenblickModus(true)
    setIsCameraModalOpen(true)
  }

  const sendeFreundschaftsanfrage = async () => {
    if (!activeContact) return
    try {
      await sendFriendRequest(activeContact.username)
      // Der Knopf verschwindet, sobald die Anfrage unterwegs ist. Sonst stünde
      // er bis zum nächsten Laden da, obwohl nichts mehr zu tun ist.
      setAnfrageGesendet(true)
      toast.success(t('messenger.friendRequestSent', { name: activeContact.username }))
    } catch (err: any) {
      toast.error(err?.message || t('messenger.friendRequestFailed'))
    }
  }

  /*
   * Der Verlauf zeichnet nur neu, wenn sich etwas ändert, das er zeigt.
   *
   * Bis 27.09.2026 zeichnete jeder Tastendruck im Eingabefeld alle
   * Nachrichtenblasen neu: `inputText` liegt hier in der Seite, und die Blasen
   * bekamen bei jedem Durchlauf neue Handler. Die Handler laufen jetzt über
   * `blasenHandler`, das in jedem Durchlauf die neueste Fassung bekommt. Der
   * gemerkte Verlauf ruft also nie einen Handler mit altem Zustand auf.
   *
   * Wer der Blase etwas Neues zeigt, trägt es in die Liste unter `useMemo`
   * ein. Sonst bleibt die Blase beim alten Stand stehen.
   */
  const blasenHandler = useRef<{ aktionen: BlasenAktionen; ton: TonZustand; umschalten: (m: ChatMessage) => void }>(null!)
  blasenHandler.current = {
    aktionen: {
      onViewImage: setViewingImage,
      onEdit: (m) => {
        setEditingMessage(m)
        setInputText(m.text)
      },
      onDelete: (m) => void handleDeleteMessage(m),
      onImportNote: (note, schluessel) => void handleImportNote(note, schluessel),
      onImportCalendar: (cal, schluessel) => void handleImportCalendar(cal, schluessel),
      onJoinByInviteCode: handleJoinByInviteCode,
      onMenue: setMenueNachricht,
      onAntworten: handleAntworten,
      onReaktion: (m, emoji) => void handleReaktion(m, emoji),
      onSpringeZu: springeZu,
      onErneutSenden: (m) => void handleErneutSenden(m),
    },
    ton: tonWiedergabe,
    umschalten: handleAuswahlUmschalten,
  }
  const blasenAktionen = useMemo<BlasenAktionen>(
    () => ({
      onViewImage: (url) => blasenHandler.current.aktionen.onViewImage(url),
      onEdit: (m) => blasenHandler.current.aktionen.onEdit(m),
      onDelete: (m) => blasenHandler.current.aktionen.onDelete(m),
      onImportNote: (note, schluessel) => blasenHandler.current.aktionen.onImportNote(note, schluessel),
      onImportCalendar: (cal, schluessel) => blasenHandler.current.aktionen.onImportCalendar(cal, schluessel),
      onJoinByInviteCode: (code, karte) =>
        blasenHandler.current.aktionen.onJoinByInviteCode(code, karte),
      onMenue: (m) => blasenHandler.current.aktionen.onMenue(m),
      onAntworten: (m) => blasenHandler.current.aktionen.onAntworten(m),
      onReaktion: (m, emoji) => blasenHandler.current.aktionen.onReaktion(m, emoji),
      onSpringeZu: (uuid) => blasenHandler.current.aktionen.onSpringeZu(uuid),
      onErneutSenden: (m) => blasenHandler.current.aktionen.onErneutSenden?.(m),
    }),
    [],
  )
  const { playingAudioId, audioCurrentTime, audioPlaybackRate } = tonWiedergabe
  const verlauf = useMemo(() => {
    const ton: TonZustand = {
      playingAudioId,
      audioCurrentTime,
      audioPlaybackRate,
      onTogglePlay: (id, anhang, bindung) => blasenHandler.current.ton.onTogglePlay(id, anhang, bindung),
      onCycleRate: (e) => blasenHandler.current.ton.onCycleRate(e),
      onSeek: (id, anhang, bindung, e) => blasenHandler.current.ton.onSeek(id, anhang, bindung, e),
    }
    const umschalten = (m: ChatMessage) => blasenHandler.current.umschalten(m)
    return (
      <ChatTimeline
        scrollRef={scrollContainerRef}
        endeRef={messagesEndRef}
        nachrichten={messages}
        laedt={loadingMessages}
        trennerId={trennerId}
        aktivitaet={partnerActivity}
        istGruppe={Boolean(activeGroup)}
        partnerName={activeGroup ? gruppenTitel(activeGroup) : activeContact?.username}
        partnerAvatar={activeGroup ? activeGroup.avatar_url : activeContact?.avatarUrl}
        onSchnellNachricht={(text) => setInputText(text)}
        zeichneNachricht={(msg) => (
          <ChatMessageBubble
            msg={msg}
            kontext={{
              activeGroup,
              activeContact,
              eigeneId: currentUserId,
              eigenerName: user?.username || 'Ich',
              eigenesBild: user?.avatar_url,
              readReceiptsEnabled,
              importedAttachmentIds,
              // Die Rechteprüfung für `@everyone` steht hier, beim
              // Empfänger: der Server kann den Inhalt nicht lesen
              // und die Regel deshalb nicht durchsetzen.
              michGemeint: binIchGemeint(msg, currentUserId, activeGroup),
              hervorgehoben: Boolean(msg.clientUuid && hervorgehoben === msg.clientUuid),
              gruppenzustand: gruppenRollenZustand,
            }}
            ton={ton}
            aktionen={blasenAktionen}
            auswahl={{
              aktiv: auswahlModus,
              gewaehlt: Boolean(wahl.auswahl?.has(auswahlSchluessel(msg))),
              onUmschalten: umschalten,
            }}
            medienBindung={medienBindung}
          />
        )}
      />
    )
  }, [
    messages,
    loadingMessages,
    trennerId,
    partnerActivity,
    activeGroup,
    activeContact,
    currentUserId,
    user?.username,
    user?.avatar_url,
    readReceiptsEnabled,
    importedAttachmentIds,
    hervorgehoben,
    playingAudioId,
    audioCurrentTime,
    audioPlaybackRate,
    auswahlModus,
    wahl.auswahl,
    // `medienBindung` liest nur diese beiden.
    blindMailboxId,
    blasenAktionen,
  ])

  const partnerMitFunken = contactsList.filter((c) => {
    if (!c.isFriend) return false
    const kern = useFunkenStore.getState().kernVon(c.userId, Date.now())
    return kern && kern.stand > 0
  })
  const funkeGesamt = partnerMitFunken.reduce((sum, c) => {
    const kern = useFunkenStore.getState().kernVon(c.userId, Date.now())
    return sum + (kern?.stand ?? 0)
  }, 0)

  const ungelesenCommunity = useMemo(
    () => groups.reduce((sum, g) => sum + (unreadCounts[groupMailboxMap[g.id]] || 0), 0),
    [groups, groupMailboxMap, unreadCounts],
  )
  const ungelesenChats = useMemo(
    () => contactsList.reduce((sum, c) => sum + (unreadCounts[contactMailboxMap[c.userId]] || 0), 0),
    [contactsList, contactMailboxMap, unreadCounts],
  )

  const handleFunkeTrigger = () => {
    setFunkeModus('blast')
    setAugenblickModus(true)
    setIsCameraModalOpen(true)
  }

  const handleSendFunkenBlast = async (empfaengerUserIds: number[]) => {
    if (!funkenFoto || empfaengerUserIds.length === 0) return
    setIsFunkenSending(true)
    let erfolgCount = 0
    try {
      for (const uid of empfaengerUserIds) {
        const targetContact = contactsList.find((c) => c.userId === uid)
        const mid = targetContact ? contactMailboxMap[targetContact.userId] : undefined
        if (!mid || !targetContact) continue
        try {
          await handleSendMessage({
            text: '',
            img: { dataUrl: funkenFoto, name: 'augenblick.jpg' },
            augenblick: true,
            antwortAuf: null,
            ziel: {
              blindMailboxId: mid,
              recipientId: targetContact.userId,
            },
          })
          erfolgCount++
        } catch (err) {
          still(err, 'messenger.funkenBlast')
        }
      }
      toast.success(
        erfolgCount === 1
          ? 'Funke erfolgreich gesendet!'
          : `Funke erfolgreich an ${erfolgCount} Kontakte gesendet!`,
      )
      setIsFunkenEmpfaengerOpen(false)
      setFunkenFoto(null)
    } finally {
      setIsFunkenSending(false)
    }
  }

  return (
    <div className="flex h-full w-full min-h-0 flex-1 flex-col overflow-hidden bg-surface">
      {!isChatOpen && geraetWartet && (
        <button
          type="button"
          onClick={() => navigate('/profile?tab=security')}
          className="shrink-0 border-b border-status-warning/30 bg-status-warning/10 px-4 py-2 text-left text-sm text-on-surface"
        >
          {t('messenger.thisDevicePending')}
        </button>
      )}

      {/* Main Split Layout: Left Rail + Contacts & Groups List, Right Chat Area */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <MessengerSidebarColumn
          mobileNavTab={mobileNavTab}
          setMobileNavTab={setMobileNavTab}
          isSidebarCollapsed={isSidebarCollapsed}
          setIsSidebarCollapsed={setIsSidebarCollapsed}
          isChatOpen={isChatOpen}
          stories={stories}
          storyIch={storyIch}
          storyAnsicht={storyAnsicht}
          unreadCounts={unreadCounts}
          ungelesenChats={ungelesenChats}
          ungelesenCommunity={ungelesenCommunity}
          funkeGesamt={funkeGesamt}
          hatNeueMarkierung={hatNeueMarkierung}
          onClearNeueMarkierung={() => setHatNeueMarkierung(false)}
          mentionedChatsCount={mentionedChats.length}
          onFunke={handleFunkeTrigger}
          onOpenWallpaperModal={() => setIsWallpaperModalOpen(true)}
          ueberall={ueberall}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          widerruf={widerruf}
          onClearWiderruf={() => setWiderruf(null)}
          archivZahl={archivZahl}
          archivUngelesen={archivUngelesen}
          archivOffen={archivOffen}
          setArchivOffen={setArchivOffen}
          filteredContacts={filteredContacts}
          kontakteNachArchiv={kontakteNachArchiv}
          contactsList={contactsList}
          contactMailboxMap={contactMailboxMap}
          groupMailboxMap={groupMailboxMap}
          entwuerfeVorschau={entwuerfe.vorschau}
          activeContact={activeContact}
          activeGroup={activeGroup}
          groups={groups}
          onSelectContact={(c, cmid) => {
            setActiveContact(c)
            setActiveGroup(null)
            oeffneAusListe(cmid)
          }}
          onOpenStatusChat={(c) => {
            setActiveContact(c)
            setActiveGroup(null)
          }}
          onSelectGroup={(g) => {
            setActiveGroup(g)
            setActiveContact(null)
          }}
          onOpenCreateGroup={() => setIsCreateGroupOpen(true)}
          onCopyInviteLink={handleCopyInviteLink}
          onAnheftenChat={handleAnheftenChat}
          onArchivieren={handleArchivieren}
          onZeilenMenue={(mid, name) => setZeilenMenue({ mid, name })}
          onRefreshData={() => void loadData()}
        />

        {/* Right Column: Chat Thread & Input Area */}
        <div
          // `min-w-0` ist hier nicht kosmetisch: ein Flex-Kind hat von Haus
          // aus `min-width: auto` und kann damit nicht unter die Breite
          // seines Inhalts schrumpfen. Der Chatbereich wuchs so auf 402 px
          // in einem 375 px breiten Fenster und schob sich 11 px nach links
          // aus dem Bild — daher die verrutschten Texte am Telefon.
          className={`flex-1 min-w-0 flex flex-col min-h-0 bg-surface-container-lowest/30 relative ${
            !isChatOpen ? 'hidden md:flex' : 'flex'
          }`}
          onDragOver={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setIsDragOver(true)
          }}
          onDragLeave={(e) => {
            e.preventDefault()
            e.stopPropagation()
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setIsDragOver(false)
            }
          }}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setIsDragOver(false)
            const file = e.dataTransfer.files?.[0]
            if (file) handleFileAttachment(file)
          }}
        >
          {isDragOver && <Ablageflaeche className="z-40" text={t('messenger.dropFile')} hinweis={t('messenger.dropHint')} />}

          {/* Der Chat-Hintergrund — dieselbe Schicht wie im KI-Bereich.
              Direktchats haben ihre eigene Wahl, Gruppen den geteilten
              Hintergrund der Gruppe; ohne beides gilt die Vorgabe. */}
          <ChatHintergrund
            bereich="messenger"
            peerId={activeGroup ? null : activeContact?.userId ?? null}
            gruppe={
              activeGroup
                ? {
                    groupId: activeGroup.id,
                    blindMailboxId: blindMailboxId || undefined,
                    eigeneId: currentUserId,
                    mitglieder: (activeGroup.members ?? []).map((m) => m.user_id),
                    istEigentuemer: activeGroup.role === 'owner',
                  }
                : null
            }
            gruppeDarfSetzen={(konto) => {
              if (!activeGroup) return false
              if (Number(activeGroup.owner_user_id) === Number(konto)) return true
              const m = (activeGroup.members ?? []).find((x) => Number(x.user_id) === Number(konto))
              if (!m) return false
              if (m.role === 'owner' || m.role === 'admin') return true
              return (
                Boolean(m.can_set_group_background) ||
                (m.permissions || '')
                  .split(',')
                  .map((p) => p.trim())
                  .includes('set_group_background')
              )
            }}
          />

          {isChatOpen ? (
            <>
              {/* Eine Leiste, zwei Rollen: Auswahl ersetzt den Kopf, sonst
                  steht er. Beide liegen im Fluss; der Verlauf beginnt darunter. */}
              <MessengerChatHeader
                auswahlModus={auswahlModus}
                auswahlGroesse={wahl.auswahl?.size ?? 0}
                gewaehlteNachrichten={gewaehlteNachrichten}
                onBeendeAuswahl={beendeAuswahl}
                onForwardSelection={(auswahl) => setWeiterzuleiten(auswahl)}
                onCopySelection={handleAuswahlKopieren}
                onMarkieren={handleMarkieren}
                onDeleteSelection={handleAuswahlLoeschen}
                activeGroup={activeGroup}
                activeContact={activeContact}
                currentUserId={currentUserId}
                gruppenTitel={gruppenTitel}
                blindMailboxId={blindMailboxId}
                isChatMuted={isChatMuted}
                isBlocked={isBlocked}
                onZurueck={handleZurueckZurListe}
                isSidebarCollapsed={isSidebarCollapsed}
                onToggleSidebar={() => setIsSidebarCollapsed((v) => !v)}
                groupCallCanStart={groupCallPermissions.canStart}
                onStartCall={starteAnruf}
                onStartGroupCall={handleStartGroupCall}
                angeheftet={angeheftet}
                darfAnheften={darfAnheften}
                onTogglePinned={handleAnheften}
                onOpenFunkenRettung={oeffneFunkenRettung}
                onSendFriendRequest={sendeFreundschaftsanfrage}
                anfrageGesendet={anfrageGesendet}
                onNavigateProfile={(userId) => navigate(`/user/${userId}`)}
                onOpenSearch={chatSuche.oeffne}
                verfallSekunden={verfallSekunden}
                darfVerfallStellen={darfVerfallStellen}
                onOpenMute={() => setIsMuteModalOpen(true)}
                onOpenSafetyNumber={() => sicherheitsnummern.setOffen(true)}
                onOpenDisappearing={() => setVerfallOffen(true)}
                onOpenAugenblick={oeffneAugenblick}
                onOpenGroupBackground={() => {
                  setGroupSettingsTab('background')
                  setIsGroupPermissionsOpen(true)
                }}
                onOpenPersonalWallpaper={() => setIsWallpaperModalOpen(true)}
                onCopyInviteLink={handleCopyInviteLink}
                onOpenGroupSettings={() => {
                  setGroupSettingsTab('general')
                  setIsGroupPermissionsOpen(true)
                }}
                onDeleteGroup={handleDeleteGroup}
                onLeaveGroup={handleLeaveGroup}
                onOpenBlockConfirm={() => setIsBlockConfirmOpen(true)}
                onOpenRemoveChat={() => setChatEntfernenOffen(true)}
              />

              {angeheftet && !auswahlModus && !chatSuche.offen && (
                <ChatPinnedBar
                  text={angeheftet.text || auszugFuerZitat(angeheftet)}
                  onOeffnen={() => angeheftet.clientUuid && springeZu(angeheftet.clientUuid)}
                  onLoesen={darfAnheften ? () => void handleAnheften(angeheftet) : undefined}
                />
              )}

              {geraetWartet && (
                <button
                  type="button"
                  onClick={() => navigate('/profile?tab=security')}
                  className="shrink-0 border-b border-status-warning/30 bg-status-warning/10 px-4 py-2 text-left text-xs sm:text-sm text-status-warning flex items-center justify-between transition-colors hover:bg-status-warning/15"
                >
                  <span>{t('messenger.thisDevicePending')}</span>
                </button>
              )}

              {verlauf}

              {selectedImage && <StagedImageBar bild={selectedImage} onEntfernen={() => setSelectedImage(null)} />}
              {stagedFile && <StagedFileBar datei={stagedFile} onEntfernen={() => setStagedFile(null)} />}
              {editingMessage && (
                <EditingBanner
                  text={editingMessage.text}
                  onAbbrechen={() => {
                    setEditingMessage(null)
                    setInputText('')
                  }}
                />
              )}

              {/* Nach unten. Schwebt über der Eingabe, nicht darunter, und weicht
                  dem Zitatkopf aus, wenn beide gleichzeitig da sind. */}
              {weitOben && !chatSuche.offen && (
                <div className="relative z-10">
                  <button
                    type="button"
                    onClick={() => messagesEndRef.current?.scrollIntoView?.({ behavior: 'smooth' })}
                    className="absolute -top-14 right-4 w-11 h-11 rounded-full bg-surface-container-high/95 backdrop-blur-md border border-outline-variant/30 shadow-lg flex items-center justify-center text-on-surface-variant hover:text-primary transition-colors"
                    aria-label={t('messenger.jumpToEnd')}
                  >
                    <ArrowDown className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Die Suche im offenen Chat. Sie sitzt über der Eingabe und
                  damit über der Tastatur: Feld, Zähler und Pfeile liegen alle
                  im Daumenbereich. Oben wären die Pfeile bei offener Tastatur
                  außer Reichweite. */}
              {chatSuche.offen && (
                <VerlaufSuchleiste
                  onSchliessen={chatSuche.schliesse}
                  onSuchen={chatSuche.suchen}
                  trefferAnzahl={chatSuche.treffer.length}
                  aktuellerTreffer={chatSuche.index}
                  onVor={() => chatSuche.blaettere(1)}
                  onZurueck={() => chatSuche.blaettere(-1)}
                  gesperrt={chatSuche.gesperrt}
                />
              )}

              {/* Footer Input Area */}
              {/* Die untere Polsterung wächst um die sichere Fläche des Geräts.
                  `viewport-fit=cover` steht in der index.html, also reicht der
                  Inhalt bis an den Rand — auf einem iPhone lag die Eingabeleiste
                  damit unter dem Home-Balken, und jeder Griff dorthin wischte
                  die App weg, statt zu tippen. */}
              <MessengerComposerFooter
                activeContact={activeContact}
                isBlocked={isBlocked}
                onUnblock={unblockUser}
                aufnahme={aufnahme}
                isStickerPickerOpen={isStickerPickerOpen}
                setIsStickerPickerOpen={setIsStickerPickerOpen}
                stickerTab={stickerTab}
                setStickerTab={setStickerTab}
                startFotoTresor={startFotoTresor}
                setStartFotoTresor={setStartFotoTresor}
                handleSendMessage={handleSendMessage}
                inputText={inputText}
                setInputText={setInputText}
                handleInputChange={handleInputChange}
                selectedImage={selectedImage}
                stagedFile={stagedFile}
                fileInputRef={fileInputRef}
                docInputRef={docInputRef}
                chatInputRef={chatInputRef}
                handleFileChange={handleFileChange}
                handleFileAttachment={handleFileAttachment}
                erwaehnungsVorschlaege={erwaehnungsVorschlaege}
                waehleErwaehnung={waehleErwaehnung}
                antwortAuf={antwortAuf}
                setAntwortAuf={setAntwortAuf}
                istSchreibenGesperrt={istSchreibenGesperrt}
                darfSchreiben={darfSchreiben}
                darfAnhaengen={darfAnhaengen}
                editingMessage={editingMessage}
                sending={sending}
                onOpenCamera={() => setIsCameraModalOpen(true)}
                onOpenNotePicker={handleOpenNotePicker}
                onOpenCalendarPicker={handleOpenCalendarPicker}
                onOpenVideoNote={() => setIsVideoNoteRecording(true)}
              />

            </>
          ) : (
            <MessengerEmptyState
              onNeueGruppe={() => setIsCreateGroupOpen(true)}
              onHintergrund={() => setIsWallpaperModalOpen(true)}
              onNeuerChat={() => {
                setFilterTab('all')
                setMobileNavTab('chats')
              }}
              isSidebarCollapsed={isSidebarCollapsed}
              onSeitenleisteUmschalten={() => setIsSidebarCollapsed((v) => !v)}
            />
          )}
        </div>
      </div>

      <MessengerOverlays
        menueNachricht={menueNachricht}
        setMenueNachricht={setMenueNachricht}
        handleReaktion={handleReaktion}
        handleAntworten={handleAntworten}
        weiterzuleiten={weiterzuleiten}
        setWeiterzuleiten={setWeiterzuleiten}
        wlFortschritt={wlFortschritt}
        setWlFortschritt={setWlFortschritt}
        weiterleitungsZiele={weiterleitungsZiele}
        handleWeiterleiten={handleWeiterleiten}
        handleKopieren={handleKopieren}
        handleMarkieren={handleMarkieren}
        onSelectMessage={(m) => wahl.umschalten(auswahlSchluessel(m))}
        setEditingMessage={setEditingMessage}
        setInputText={setInputText}
        handleDeleteMessage={handleDeleteMessage}
        activeGroup={activeGroup}
        handleAnheften={handleAnheften}
        darfAnheften={darfAnheften}
        darfFremdeLoeschen={darfFremdeLoeschen}
        angeheftet={angeheftet}
        ueberall={ueberall}
        verzeichnisMitGruppen={verzeichnisMitGruppen}
        oeffneTreffer={oeffneTreffer}
        zeilenMenue={zeilenMenue}
        setZeilenMenue={setZeilenMenue}
        pinnedChats={pinnedChats}
        archivedChats={archivedChats}
        isChatMuted={isChatMuted}
        handleAnheftenChat={handleAnheftenChat}
        handleArchivieren={handleArchivieren}
        muteChat={muteChat}
        unmuteChat={unmuteChat}
        verfallOffen={verfallOffen}
        setVerfallOffen={setVerfallOffen}
        verfallVonAnderem={verfallVonAnderem}
        darfVerfallStellen={darfVerfallStellen}
        verfallVonName={verfallVonName}
        verfallSekunden={verfallSekunden}
        handleVerfallWaehlen={handleVerfallWaehlen}
        activeContact={activeContact}
        currentUserId={currentUserId}
        identityRef={identityRef}
        messengerGesperrt={messengerGesperrt}
        groups={groups}
        blindMailboxId={blindMailboxId}
        merkeErwaehnung={merkeErwaehnung}
        uebernimmGruppenInfo={uebernimmGruppenInfo}
        loadData={loadData}
        isNotePickerOpen={isNotePickerOpen}
        setIsNotePickerOpen={setIsNotePickerOpen}
        userNotes={userNotes}
        isCalendarPickerOpen={isCalendarPickerOpen}
        setIsCalendarPickerOpen={setIsCalendarPickerOpen}
        userEvents={userEvents}
        handleSendMessage={handleSendMessage}
        viewingImage={viewingImage}
        setViewingImage={setViewingImage}
        storyAnsicht={storyAnsicht}
        handleStoryCreated={handleStoryCreated}
        handleStoryDeleted={handleStoryDeleted}
        contactsList={contactsList}
        contactMailboxMap={contactMailboxMap}
        setActiveContact={setActiveContact}
        setActiveGroup={setActiveGroup}
        chatEntfernenOffen={chatEntfernenOffen}
        setChatEntfernenOffen={setChatEntfernenOffen}
        handleChatAusListe={handleChatAusListe}
        isCreateGroupOpen={isCreateGroupOpen}
        setIsCreateGroupOpen={setIsCreateGroupOpen}
        handleCreateGroup={handleCreateGroup}
        funkenRettung={funkenRettung}
        setFunkenRettung={setFunkenRettung}
        isCameraModalOpen={isCameraModalOpen}
        setIsCameraModalOpen={setIsCameraModalOpen}
        augenblickModus={augenblickModus}
        setAugenblickModus={setAugenblickModus}
        funkeModus={funkeModus}
        setFunkeModus={setFunkeModus}
        setFunkenFoto={setFunkenFoto}
        setIsFunkenEmpfaengerOpen={setIsFunkenEmpfaengerOpen}
        setSelectedImage={setSelectedImage}
        isGroupPermissionsOpen={isGroupPermissionsOpen}
        setIsGroupPermissionsOpen={setIsGroupPermissionsOpen}
        groupSettingsTab={groupSettingsTab}
        handleCopyInviteLink={handleCopyInviteLink}
        setGroups={setGroups}
        groupToDelete={groupToDelete}
        setGroupToDelete={setGroupToDelete}
        isDeletingGroup={isDeletingGroup}
        handleConfirmDeleteGroup={handleConfirmDeleteGroup}
        isWallpaperModalOpen={isWallpaperModalOpen}
        setIsWallpaperModalOpen={setIsWallpaperModalOpen}
        isMuteModalOpen={isMuteModalOpen}
        setIsMuteModalOpen={setIsMuteModalOpen}
        gruppenTitel={gruppenTitel}
        sicherheitsnummern={sicherheitsnummern}
        isBlockConfirmOpen={isBlockConfirmOpen}
        setIsBlockConfirmOpen={setIsBlockConfirmOpen}
        isBlocked={isBlocked}
        handleBlockConfirm={handleBlockConfirm}
        isFunkenEmpfaengerOpen={isFunkenEmpfaengerOpen}
        funkenFoto={funkenFoto}
        partnerMitFunkenIds={partnerMitFunken.map((c) => c.userId)}
        handleSendFunkenBlast={handleSendFunkenBlast}
        isFunkenSending={isFunkenSending}
        isVideoNoteRecording={isVideoNoteRecording}
        setIsVideoNoteRecording={setIsVideoNoteRecording}
      />
    </div>
  )
}
