import { useRef, useState, type ChangeEvent } from 'react'
import type { TFunction } from 'i18next'
import { useZurueckSchliesst } from '@maunting/ui'
import type { CalendarAttachment, NoteAttachment } from '@/components/social/ChatMessageBubble'
import type { FileAttachment, ImageAttachment } from '@/components/social/ChatMediaAttachments'
import { compressImageFile, readFileAsDataUrl } from '@/lib/imageCompression'
import {
  loadCalendarEventsOfflineFirst,
  loadNotesOfflineFirst,
  saveCalendarEventOffline,
  saveNoteOffline,
} from '@/lib/offlineSync'
import type { CalendarEventItem } from '@/pages/Calendar'
import type { NoteItem } from '@/pages/Notes'
import { maxAnhangBytes } from '@/services/medienKrypto'
import { toast } from '@/stores/toastStore'

const BLOCKED_EXTENSIONS = [
  '.exe',
  '.dll',
  '.bat',
  '.cmd',
  '.sh',
  '.msi',
  '.vbs',
  '.ps1',
  '.elf',
  '.com',
  '.scr',
  '.pif',
]

/**
 * Verwaltet gestagedte Bilder/Dateien, Drag-&-Drop-Validierung sowie den Import
 * geteilter Notizen und Kalendertermine im Messenger.
 */
export function useMessengerAnhaenge(t: TFunction) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [stagedFile, setStagedFile] = useState<FileAttachment | null>(null)
  const [selectedImage, setSelectedImage] = useState<ImageAttachment | null>(null)
  const [viewingImage, setViewingImage] = useState<string | null>(null)
  useZurueckSchliesst(Boolean(viewingImage), () => setViewingImage(null))

  const [isNotePickerOpen, setIsNotePickerOpen] = useState(false)
  const [userNotes, setUserNotes] = useState<NoteItem[]>([])
  const [isCalendarPickerOpen, setIsCalendarPickerOpen] = useState(false)
  const [userEvents, setUserEvents] = useState<CalendarEventItem[]>([])
  const [importedAttachmentIds, setImportedAttachmentIds] = useState<Set<string>>(() => new Set())

  const fileInputRef = useRef<HTMLInputElement>(null)
  const docInputRef = useRef<HTMLInputElement>(null)

  const loadAsDataUrl = (file: File, onLoaded: (dataUrl: string) => void) => {
    void readFileAsDataUrl(file).then((dataUrl) => {
      if (dataUrl) onLoaded(dataUrl)
    }).catch(() => undefined)
  }

  const stageImageFile = async (file: File) => {
    try {
      const compressed = await compressImageFile(file)
      setSelectedImage({ dataUrl: compressed.dataUrl, name: compressed.name })
    } catch {
      loadAsDataUrl(file, (dataUrl) => {
        setSelectedImage({ dataUrl, name: file.name })
      })
    }
  }

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error(t('messenger.pickValidImage'))
      return
    }
    await stageImageFile(file)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleOpenNotePicker = async () => {
    try {
      const res = await loadNotesOfflineFirst()
      setUserNotes(res.notes.filter((n) => !n.is_archived))
      setIsNotePickerOpen(true)
    } catch {
      toast.error(t('messenger.notesLoadFailed'))
    }
  }

  const handleOpenCalendarPicker = async () => {
    try {
      const now = new Date()
      const start = new Date(now.getTime() - 30 * 86400000).toISOString()
      const end = new Date(now.getTime() + 90 * 86400000).toISOString()
      const res = await loadCalendarEventsOfflineFirst(start, end)
      setUserEvents(res.events)
      setIsCalendarPickerOpen(true)
    } catch {
      toast.error(t('messenger.calendarLoadFailed'))
    }
  }

  const handleFileAttachment = (file: File) => {
    const maxFileBytes = maxAnhangBytes()
    const maxImageBytes = Math.min(8 * 1024 * 1024, maxFileBytes)
    const isImage = file.type.startsWith('image/')
    const limit = isImage ? maxImageBytes : maxFileBytes
    if (file.size > limit) {
      toast.error(t('messenger.fileTooLarge', { limit: Math.floor(limit / (1024 * 1024)) }))
      return
    }

    const lowerName = file.name.toLowerCase()
    if (BLOCKED_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
      toast.error(t('messenger.executableBlocked'))
      return
    }

    if (isImage) {
      void stageImageFile(file)
      return
    }

    loadAsDataUrl(file, (dataUrl) => {
      setStagedFile({
        name: file.name,
        sizeBytes: file.size,
        mimeType: file.type || 'application/octet-stream',
        dataUrl,
      })
    })
  }

  const handleImportNote = async (note: NoteAttachment, itemKey?: string) => {
    const key = itemKey || `${note.title}_${note.content?.slice(0, 30)}`
    if (importedAttachmentIds.has(key)) {
      toast.success(t('messenger.noteAlreadyTaken'))
      return
    }
    try {
      await saveNoteOffline({
        title: note.title || t('messenger.sharedNote'),
        content: note.content || '',
        category: note.category || 'personal',
        color: note.color || 'primary',
        is_pinned: false,
        note_type: 'personal',
        team_id: null,
      })
      setImportedAttachmentIds((prev) => new Set([...prev, key]))
      toast.success(t('messenger.noteSaved', { title: note.title || t('messenger.sharedNote') }))
    } catch {
      toast.error(t('messenger.noteSaveFailed'))
    }
  }

  const handleImportCalendar = async (cal: CalendarAttachment, itemKey?: string) => {
    const key = itemKey || `${cal.title}_${cal.start}`
    if (importedAttachmentIds.has(key)) {
      toast.success(t('messenger.eventAlreadyTaken'))
      return
    }
    try {
      await saveCalendarEventOffline({
        title: cal.title || t('messenger.sharedEvent'),
        start_time: cal.start,
        end_time: cal.end,
        description: cal.description || null,
        location: cal.location || null,
        all_day: false,
        color: 'primary',
        event_type: 'personal',
        team_id: null,
        server_id: null,
      })
      setImportedAttachmentIds((prev) => new Set([...prev, key]))
      toast.success(t('messenger.eventSaved', { title: cal.title || t('messenger.sharedEvent') }))
    } catch {
      toast.error(t('messenger.eventSaveFailed'))
    }
  }

  return {
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
  }
}
