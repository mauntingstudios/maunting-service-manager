import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  ArchiveRestore,
  CheckSquare,
  Edit3,
  Eye,
  Pin,
  Plus,
  Search,
  Square,
  StickyNote,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MarkdownBild, MarkdownLink } from '@/components/viewer/Markdownansicht'
import { toast } from '@/stores/toastStore'
import { FARB_PALETTE, farbwahl } from '@/config/farbpalette'
import { confirm } from '@/stores/confirmStore'
import { Dropdown, Kurzinfo, useZurueckSchliesst, DropdownOption } from '@maunting/ui'
import { Button } from '@maunting/ui'
import { Switch } from '@maunting/ui'
import { teamsApi, type Team } from '@/api/teams'
import { Spinner } from '@maunting/ui'
import { TageszeitHintergrund } from '@/components/layout/TageszeitHintergrund'
import { begruessungSchluessel, headerHintergrundWaehlen, tagesSeed } from '@/lib/tageszeit'
import { useAuthStore } from '@/stores/authStore'
import { NotizschluesselHinweis } from '@/components/notes/NotizschluesselHinweis'
import {
  loadNotesOfflineFirst,
  getOfflineNotes,
  saveNoteOffline,
  deleteNoteOffline,
  toggleNotePinOffline,
  toggleNoteArchiveOffline,
  toggleCheckItemOffline,
  useEntitySync,
} from '@/lib/offlineSync'

export interface NoteItem {
  id: number
  note_uid: string
  title: string
  content: string
  category: string
  color: string
  is_pinned: boolean
  is_archived: boolean
  note_type: string
  user_id: number
  team_id?: number | null
  team_name?: string | null
  creator_name?: string | null
  can_edit?: boolean
  created_at: string
  updated_at: string
}

function InlineMarkdown({ text, strikethrough }: { text: string; strikethrough?: boolean }) {
  return (
    <span className={`inline-block ${strikethrough ? 'line-through text-on-surface-variant/60' : 'text-on-surface'}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <span className="m-0 inline">{children}</span>,
          img: MarkdownBild,
          a: MarkdownLink,
          strong: ({ children }) => <strong className="font-semibold text-on-surface">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          code: ({ children }) => (
            <code className="px-1 py-0.5 rounded bg-surface-container-highest font-mono text-[0.85em]">
              {children}
            </code>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </span>
  )
}

export function Notes() {
  const { t } = useTranslation()
  const user = useAuthStore((s) => s.user)
  const [jetzt] = useState(() => new Date())
  const stunde = jetzt.getHours()
  const zufall = useMemo(() => tagesSeed(jetzt), [jetzt])
  const headerMotiv = useMemo(
    () => headerHintergrundWaehlen(stunde, zufall, 'notes'),
    [stunde, zufall]
  )
  const begruessung = user?.username
    ? t(begruessungSchluessel(stunde, false, zufall), { name: user.username })
    : t('common.begruessung.ohneName')

  const [notes, setNotes] = useState<NoteItem[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [selectedType, setSelectedType] = useState('all')
  const [showArchived, setShowArchived] = useState(false)

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false)
  useZurueckSchliesst(isModalOpen, () => setIsModalOpen(false))
  const [editingNote, setEditingNote] = useState<NoteItem | null>(null)
  const [formTitle, setFormTitle] = useState('')
  const [formContent, setFormContent] = useState('')
  const [formCategory, setFormCategory] = useState('personal')
  const [formColor, setFormColor] = useState('primary')
  const [formNoteType, setFormNoteType] = useState('personal')
  const [formTeamId, setFormTeamId] = useState<number | null>(null)
  const [formIsPinned, setFormIsPinned] = useState(false)
  const [modalTab, setModalTab] = useState<'edit' | 'preview'>('edit')
  const [saving, setSaving] = useState(false)

  // Nur der jüngste Ladelauf darf die Liste setzen (wie im Kalender).
  const ladeLauf = useRef(0)

  const loadNotes = useCallback(async () => {
    const lauf = ++ladeLauf.current
    // Zuerst der lokale Spiegel. Ist der Server nicht erreichbar, läuft jede
    // Anfrage erst nach der Zeitgrenze des Betriebssystems ab, und bis dahin
    // stand hier nur das Ladegerüst, obwohl die Notizen lokal lagen.
    const lokal = getOfflineNotes()
    if (lokal.length > 0) {
      setNotes(lokal)
      setLoading(false)
    } else {
      setLoading(true)
    }
    try {
      const { notes: data } = await loadNotesOfflineFirst()
      if (lauf === ladeLauf.current) setNotes(Array.isArray(data) ? data : [])
    } catch {
      // Der Spiegel steht schon da.
    } finally {
      if (lauf === ladeLauf.current) setLoading(false)
    }
  }, [])

  const loadTeams = useCallback(async () => {
    try {
      const data = await teamsApi.list()
      setTeams(Array.isArray(data) ? data : [])
    } catch {
      setTeams([])
    }
  }, [])

  useEntitySync('notes', () => {
    void loadNotes()
  })

  useEffect(() => {
    void loadNotes()
    void loadTeams()
  }, [loadNotes, loadTeams])

  const openCreateModal = () => {
    setEditingNote(null)
    setFormTitle('')
    setFormContent('')
    setFormCategory('personal')
    setFormColor('primary')
    setFormNoteType('personal')
    setFormTeamId(teams.length > 0 ? teams[0].id : null)
    setFormIsPinned(false)
    setModalTab('edit')
    setIsModalOpen(true)
  }

  const openEditModal = (note: NoteItem) => {
    setEditingNote(note)
    setFormTitle(note.title)
    setFormContent(note.content || '')
    setFormCategory(note.category || 'personal')
    setFormColor(note.color || 'primary')
    setFormNoteType(note.note_type || 'personal')
    setFormTeamId(note.team_id || (teams.length > 0 ? teams[0].id : null))
    setFormIsPinned(note.is_pinned || false)
    setModalTab('edit')
    setIsModalOpen(true)
  }

  // Riegel gegen Doppelklick. `saving` sperrt den Knopf erst nach dem nächsten
  // Zeichnen; drei schnelle Klicks legten bis dahin drei Notizen an, von denen
  // das Gerät nur eine zeigte und der Server später alle drei.
  const speichertGerade = useRef(false)

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (speichertGerade.current) return
    if (!formTitle.trim()) {
      toast.error(t('notes.titleRequired'))
      return
    }

    speichertGerade.current = true
    try {
      setSaving(true)
      const payload = {
        title: formTitle.trim(),
        content: formContent,
        category: formCategory,
        color: formColor,
        is_pinned: formIsPinned,
        note_type: formNoteType,
        team_id: formNoteType === 'team' ? formTeamId : null,
      }

      await saveNoteOffline(payload, editingNote)
      if (editingNote) {
        toast.success(t('notes.updated'))
      } else {
        toast.success(t('notes.created'))
      }

      setIsModalOpen(false)
      void loadNotes()
    } catch {
      toast.error(t('notes.saveError'))
    } finally {
      speichertGerade.current = false
      setSaving(false)
    }
  }

  const handleDelete = async (note: NoteItem) => {
    const ok = await confirm({
      title: t('notes.deleteConfirmTitle'),
      message: t('notes.deleteConfirmMessage'),
      confirmText: t('common.delete'),
      danger: true,
    })
    if (!ok) return

    try {
      await deleteNoteOffline(note)
      toast.success(t('notes.deleted'))
      void loadNotes()
    } catch {
      toast.error(t('notes.deleteError'))
    }
  }

  const handleTogglePin = async (note: NoteItem, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await toggleNotePinOffline(note)
      void loadNotes()
    } catch {
      toast.error(t('notes.pinError'))
    }
  }

  const handleToggleArchive = async (note: NoteItem, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await toggleNoteArchiveOffline(note)
      toast.success(note.is_archived ? t('notes.unarchived') : t('notes.archived'))
      void loadNotes()
    } catch {
      toast.error(t('notes.archiveError'))
    }
  }

  // Interactive Checklist Toggle
  const handleToggleCheckItem = async (note: NoteItem, itemIndex: number, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      const { updatedContent } = await toggleCheckItemOffline(note, itemIndex)
      setNotes((prev) =>
        prev.map((n) => (n.note_uid === note.note_uid ? { ...n, content: updatedContent } : n))
      )
    } catch {
      void loadNotes()
    }
  }

  // Filtered Notes
  const filteredNotes = useMemo(() => {
    return notes.filter((note) => {
      if (showArchived) {
        if (!note.is_archived) return false
      } else {
        if (note.is_archived) return false
      }

      if (selectedCategory !== 'all' && note.category !== selectedCategory) {
        return false
      }

      if (selectedType === 'personal' && note.note_type !== 'personal') {
        return false
      }
      if (selectedType === 'team' && note.note_type !== 'team') {
        return false
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const titleMatch = (note.title || '').toLowerCase().includes(q)
        const contentMatch = (note.content || '').toLowerCase().includes(q)
        const teamMatch = (note.team_name || '').toLowerCase().includes(q)
        if (!titleMatch && !contentMatch && !teamMatch) return false
      }

      return true
    })
  }, [notes, showArchived, selectedCategory, selectedType, searchQuery])

  const { pinnedNotes, otherNotes } = useMemo(() => {
    const pinned: NoteItem[] = []
    const others: NoteItem[] = []
    for (const note of filteredNotes) {
      if (note.is_pinned && !showArchived) {
        pinned.push(note)
      } else {
        others.push(note)
      }
    }
    return { pinnedNotes: pinned, otherNotes: others }
  }, [filteredNotes, showArchived])

  const categoryOptions: DropdownOption[] = [
    { value: 'all', label: t('notes.categories.all') },
    { value: 'personal', label: t('notes.categories.personal') },
    { value: 'shopping', label: t('notes.categories.shopping') },
    { value: 'todo', label: t('notes.categories.todo') },
    { value: 'work', label: t('notes.categories.work') },
    { value: 'idea', label: t('notes.categories.idea') },
    { value: 'meeting', label: t('notes.categories.meeting') },
  ]

  const modalCategoryOptions: DropdownOption[] = [
    { value: 'personal', label: t('notes.categories.personal') },
    { value: 'shopping', label: t('notes.categories.shopping') },
    { value: 'todo', label: t('notes.categories.todo') },
    { value: 'work', label: t('notes.categories.work') },
    { value: 'idea', label: t('notes.categories.idea') },
    { value: 'meeting', label: t('notes.categories.meeting') },
  ]

  const typeOptions: DropdownOption[] = [
    { value: 'all', label: t('notes.types.all') },
    { value: 'personal', label: t('notes.types.personal') },
    { value: 'team', label: t('notes.types.team') },
  ]

  const modalTypeOptions: DropdownOption[] = [
    { value: 'personal', label: t('notes.types.personal') },
    { value: 'team', label: t('notes.types.team') },
  ]

  const teamOptions: DropdownOption[] = teams.map((team) => ({
    value: String(team.id),
    label: team.name,
  }))

  const renderNoteCard = (note: NoteItem) => {
    const theme = farbwahl(note.color)
    const lines = (note.content || '').split('\n')
    let checkCounter = 0

    return (
      <div
        key={note.id}
        onClick={() => openEditModal(note)}
        className={`group relative flex flex-col justify-between rounded-2xl sm:rounded-3xl border transition-all duration-200 cursor-pointer overflow-hidden p-4 sm:p-5 backdrop-blur-md ${theme.flaeche} ${theme.rand} hover:shadow-lg hover:border-outline/50 hover:-translate-y-0.5 active:scale-[0.99]`}
      >
        {/* Header mit Kategorie, Team und Pin-Button */}
        <div>
          <div className="flex items-start justify-between gap-2 mb-2.5">
            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
              <span className={`text-label-sm font-semibold px-2.5 py-0.5 rounded-full border truncate shadow-sm ${theme.pille}`}>
                {note.category === 'shopping'
                  ? 'Einkauf'
                  : note.category === 'todo'
                  ? 'To-Do'
                  : note.category === 'work'
                  ? 'Server'
                  : note.category === 'idea'
                  ? 'Idee'
                  : note.category === 'meeting'
                  ? 'Meeting'
                  : 'Notiz'}
              </span>

              {note.note_type === 'team' && (
                <span className="text-label-sm font-semibold px-2.5 py-0.5 rounded-full bg-status-success/20 text-status-success border border-status-success/30 flex items-center gap-1 shadow-sm">
                  <Users className="w-3 h-3" />
                  <span className="truncate max-w-[90px]">{note.team_name || 'Team'}</span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <Kurzinfo text={note.is_pinned ? t('notes.unpin') : t('notes.pin')} seite="ende" portal>
                <button
                  type="button"
                  onClick={(e) => handleTogglePin(note, e)}
                  aria-label={note.is_pinned ? t('notes.unpin') : t('notes.pin')}
                  className={`p-2 rounded-xl transition-all active:scale-90 ${
                    note.is_pinned
                      ? 'text-primary bg-primary/20 hover:bg-primary/30 shadow-sm'
                      : 'text-on-surface-variant/60 hover:text-on-surface hover:bg-surface-container-high/80'
                  }`}
                >
                  {note.is_pinned ? <Pin className="w-3.5 h-3.5 fill-primary" /> : <Pin className="w-3.5 h-3.5" />}
                </button>
              </Kurzinfo>
            </div>
          </div>

          <h4 className="font-headline text-base font-bold text-on-surface mb-2.5 line-clamp-2 leading-snug tracking-tight">
            {note.title}
          </h4>

          {/* Content Preview & Interactive Checklist */}
          <div className="space-y-1.5 text-xs text-on-surface-variant line-clamp-6 mb-3.5">
            {lines.map((line, idx) => {
              const isUnchecked = line.trimStart().startsWith('- [ ]')
              const isChecked = line.trimStart().startsWith('- [x]') || line.trimStart().startsWith('- [X]')

              if (isUnchecked || isChecked) {
                const itemIdx = checkCounter++
                const itemText = line.replace(/^[ \t]*- \[[ xX]\][ \t]*/, '')
                return (
                  <div
                    key={idx}
                    onClick={(e) => handleToggleCheckItem(note, itemIdx, e)}
                    className="flex items-start gap-2.5 py-1 px-2 rounded-xl hover:bg-surface-container-high/60 active:bg-surface-container-high transition-colors cursor-pointer min-h-[30px]"
                  >
                    {isChecked ? (
                      <CheckSquare className="w-4 h-4 text-status-success shrink-0 mt-0.5" />
                    ) : (
                      <Square className="w-4 h-4 text-on-surface-variant/80 shrink-0 mt-0.5" />
                    )}
                    <InlineMarkdown text={itemText} strikethrough={isChecked} />
                  </div>
                )
              }

              if (!line.trim()) return <div key={idx} className="h-1.5" />

              return (
                <div key={idx} className="line-clamp-2 text-on-surface-variant leading-relaxed">
                  <InlineMarkdown text={line} />
                </div>
              )
            })}
          </div>
        </div>

        {/* Card Footer */}
        <div className="flex items-center justify-between pt-2.5 border-t border-outline-variant/20 text-label-sm text-on-surface-variant/80 mt-auto">
          <span className="font-medium text-xs text-on-surface-variant/70">
            {new Date(note.updated_at || note.created_at).toLocaleDateString('de-DE', {
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>

          <div className="flex items-center gap-1">
            <Kurzinfo text={note.is_archived ? t('notes.unarchive') : t('notes.archive')} portal>
              <button
                type="button"
                onClick={(e) => handleToggleArchive(note, e)}
                aria-label={note.is_archived ? t('notes.unarchive') : t('notes.archive')}
                className="p-1.5 text-on-surface-variant hover:text-on-surface rounded-xl hover:bg-surface-container-high transition-all active:scale-95"
              >
                {note.is_archived ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
              </button>
            </Kurzinfo>

            <Kurzinfo text={t('common.delete')} seite="ende" portal>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  void handleDelete(note)
                }}
                aria-label={t('common.delete')}
                className="p-1.5 text-status-destructive hover:text-status-destructive/80 rounded-xl hover:bg-status-destructive/15 transition-all active:scale-95"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </Kurzinfo>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative isolate flex flex-col h-full w-full min-h-0 overflow-y-auto text-on-surface scrollbar-thin">
      {/* Weicher atmosphärischer Tageszeit-Hintergrund für Notizen */}
      <TageszeitHintergrund
        motiv={headerMotiv}
        hoehe="h-[480px] sm:h-[540px] lg:h-[600px]"
        deckkraft="opacity-55"
        ebene="-z-10"
        verlauf="bg-gradient-to-b from-transparent via-surface/30 60% to-surface"
      />

      <div className="relative z-10 w-full max-w-7xl 2xl:max-w-[1600px] mx-auto px-3.5 py-4 sm:px-6 sm:py-6 lg:px-8 space-y-5 sm:space-y-6 pb-16">
        {/* Freischwebender Notizen-Header mit Tageszeit-Begrüßung, Zähler und Aktion */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
              <StickyNote className="h-4 w-4" aria-hidden="true" />
              <span>{t('notes.title')}</span>
            </div>
            <h1 className="mt-1 font-headline text-2xl sm:text-3xl font-extrabold tracking-tight text-on-surface">
              {begruessung}
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-on-surface-variant max-w-xl leading-relaxed">
              {t('notes.subtitle', { defaultValue: 'Gedanken, Checklisten und Team-Dokumente im Blick behalten.' })}
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <span className="text-label-sm font-semibold px-3 py-1 rounded-full bg-surface-container-high/85 text-on-surface-variant border border-outline-variant/30 shrink-0 backdrop-blur-md shadow-sm">
              {filteredNotes.length}
            </span>
            <Button
              onClick={openCreateModal}
              className="rounded-xl flex items-center gap-1.5 font-medium shadow-sm shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">{t('notes.newNote')}</span>
              <span className="sm:hidden">{t('notes.newNoteShort')}</span>
            </Button>
          </div>
        </div>

        <NotizschluesselHinweis />

        {/* ── Werkzeugleiste: Suche & Filter ── */}
        <div className="flex flex-col gap-3 bg-surface-container-low/75 border border-outline-variant/30 rounded-2xl p-3 sm:p-3.5 shadow-sm backdrop-blur-xl">
          {/* Obere Zeile: Suche & Dropdown-Filter */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            <div className="relative flex-1 min-w-0">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('notes.searchPlaceholder')}
                className="msm-input pl-10 pr-9 py-2 text-sm bg-surface-container/60 hover:bg-surface-container/80 focus:bg-surface-container transition-colors rounded-xl w-full"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-on-surface-variant hover:text-on-surface rounded-lg transition-colors"
                  aria-label={t('common.clear')}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Dropdown Filters für kompakte Breiten & Barrierefreiheit */}
            <div className="flex items-center gap-2 overflow-x-auto msm-ohne-rollbalken py-0.5">
              <div className="w-36 sm:w-44 shrink-0">
                <Dropdown
                  value={selectedCategory}
                  onChange={setSelectedCategory}
                  options={categoryOptions}
                  aria-label={t('notes.categories.all')}
                />
              </div>

              <div className="w-32 sm:w-40 shrink-0">
                <Dropdown
                  value={selectedType}
                  onChange={setSelectedType}
                  options={typeOptions}
                  aria-label={t('notes.types.all')}
                />
              </div>

              <button
                type="button"
                onClick={() => setShowArchived(!showArchived)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border transition-all whitespace-nowrap shrink-0 active:scale-95 ${
                  showArchived
                    ? 'bg-status-warning/20 text-status-warning border-status-warning/40 shadow-sm'
                    : 'bg-surface-container/80 text-on-surface-variant border-outline-variant/30 hover:text-on-surface hover:bg-surface-container'
                }`}
              >
                <Archive className="w-3.5 h-3.5" />
                <span>{showArchived ? t('notes.archivedView') : t('common.active')}</span>
              </button>
            </div>
          </div>

          {/* Horizontale Schnell-Kategorien (UX-Verbesserung fürs Handy & schnelle Navigation) */}
          <div className="flex items-center gap-1.5 overflow-x-auto msm-ohne-rollbalken pt-0.5 pb-0.5">
            {categoryOptions.map((opt) => {
              const aktiv = selectedCategory === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSelectedCategory(opt.value)}
                  className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-all shrink-0 active:scale-95 border ${
                    aktiv
                      ? 'bg-primary text-on-primary border-primary shadow-sm font-semibold'
                      : 'bg-surface-container/50 text-on-surface-variant border-outline-variant/25 hover:bg-surface-container hover:text-on-surface'
                  }`}
                >
                  <span>{opt.label}</span>
                </button>
              )
            })}
          </div>
        </div>

      {/* Grid of Notes */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3.5 sm:gap-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div
              key={i}
              className="h-44 rounded-2xl bg-surface-container-low/80 border border-outline-variant/20 animate-pulse"
            />
          ))}
        </div>
      ) : filteredNotes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 px-4 bg-surface-container-low/60 border border-outline-variant/20 rounded-2xl text-center backdrop-blur-md">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary mb-3">
            <StickyNote className="w-6 h-6" />
          </div>
          <h3 className="font-headline text-base font-semibold text-on-surface mb-1">
            {showArchived
              ? t('notes.emptyArchivedTitle')
              : searchQuery
              ? t('notes.emptySearch')
              : t('notes.emptyTitle')}
          </h3>
          <p className="text-xs text-on-surface-variant max-w-sm">
            {showArchived
              ? t('notes.emptyArchivedDesc')
              : searchQuery
              ? t('notes.emptySearchDesc')
              : t('notes.emptyDesc')}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {pinnedNotes.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-primary mb-3 px-1">
                <Pin className="w-3.5 h-3.5 fill-primary" />
                <span>{t('notes.pinnedNotes', { defaultValue: 'Angepinnt' })}</span>
                <span className="ml-1 text-label-sm font-semibold px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/20">
                  {pinnedNotes.length}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3.5 sm:gap-4">
                {pinnedNotes.map((note) => renderNoteCard(note))}
              </div>
            </div>
          )}

          {otherNotes.length > 0 && (
            <div>
              {pinnedNotes.length > 0 && (
                <div className="flex items-center gap-1.5 text-xs font-semibold text-on-surface-variant mb-3 px-1">
                  <span>{t('notes.otherNotes', { defaultValue: 'Weitere Notizen' })}</span>
                  <span className="ml-1 text-label-sm font-semibold px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant border border-outline-variant/30">
                    {otherNotes.length}
                  </span>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3.5 sm:gap-4">
                {otherNotes.map((note) => renderNoteCard(note))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Create / Edit Modal */}
      {isModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={editingNote ? t('notes.editNote') : t('notes.createNote')}
          className="msm-modal-overlay animate-fade-in"
          onClick={() => setIsModalOpen(false)}
        >
          <div
            className="w-full max-w-xl bg-surface-container-low/95 backdrop-blur-2xl border border-outline-variant/30 rounded-2xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:rounded-none max-h-[92vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-outline-variant/30">
              <h3 className="font-headline text-lg sm:text-title-lg font-bold text-on-surface">
                {editingNote ? t('notes.editNote') : t('notes.createNote')}
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="grid h-9 w-9 place-items-center rounded-full bg-surface-container-high/80 border border-outline-variant/30 hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-all active:scale-95"
                aria-label={t('common.close', { defaultValue: 'Schließen' })}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSave} className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 space-y-4">
              {/* Title */}
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">
                  {t('notes.formTitle')} *
                </label>
                <input
                  type="text"
                  required
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder={t('notes.formTitlePlaceholder')}
                  className="msm-input"
                />
              </div>

              {/* Category & Color */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">
                    {t('notes.formCategory')}
                  </label>
                  <Dropdown
                    value={formCategory}
                    onChange={setFormCategory}
                    options={modalCategoryOptions}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">
                    {t('notes.formType')}
                  </label>
                  <Dropdown
                    value={formNoteType}
                    onChange={setFormNoteType}
                    options={modalTypeOptions}
                  />
                </div>
              </div>

              {/* Team Selector if team note */}
              {formNoteType === 'team' && (
                <div>
                  <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">
                    {t('notes.formTeam')}
                  </label>
                  {teams.length === 0 ? (
                    <p className="text-xs text-status-warning bg-status-warning/10 border border-status-warning/20 rounded-xl p-2.5">
                      {t('notes.noTeamsAvailable')}
                    </p>
                  ) : (
                    <Dropdown
                      value={formTeamId ? String(formTeamId) : String(teams[0]?.id || '')}
                      onChange={(val) => setFormTeamId(Number(val))}
                      options={teamOptions}
                    />
                  )}
                </div>
              )}

              {/* Color Accent Picker */}
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">
                  {t('notes.formColor')}
                </label>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {FARB_PALETTE.map((theme) => (
                    <button
                      key={theme.id}
                      type="button"
                      onClick={() => setFormColor(theme.id)}
                      className={`px-2.5 py-1.5 rounded-xl text-xs font-medium border flex items-center gap-1.5 transition-all ${
                        formColor === theme.id
                          ? `${theme.flaeche} ${theme.rand} ${theme.text} ring-2 ring-primary/40`
                          : 'bg-surface-container border-outline-variant/30 text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${theme.flaeche} border ${theme.rand}`} />
                      {t(theme.labelKey)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Pin Switch */}
              <div className="flex items-center justify-between bg-surface-container/50 border border-outline-variant/30 rounded-xl p-3">
                <span className="text-xs font-semibold text-on-surface flex items-center gap-1.5">
                  <Pin className="w-3.5 h-3.5 text-primary" />
                  {t('notes.pinToTop')}
                </span>
                <Switch
                  checked={formIsPinned}
                  onCheckedChange={setFormIsPinned}
                  aria-label={t('notes.pinToTop')}
                />
              </div>

              {/* Content / Editor & Dictation */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-xs font-semibold text-on-surface-variant">
                    {t('notes.formContent')}
                  </label>
                  <div className="flex items-center bg-surface-container rounded-lg p-0.5 border border-outline-variant/30 text-label-sm">
                    <button
                      type="button"
                      onClick={() => setModalTab('edit')}
                      className={`flex items-center gap-1 px-2 py-0.5 rounded-md font-medium transition-colors ${
                        modalTab === 'edit'
                          ? 'bg-primary/20 text-primary'
                          : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      <Edit3 className="w-3 h-3" />
                      {t('notes.tabEditor')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setModalTab('preview')}
                      className={`flex items-center gap-1 px-2 py-0.5 rounded-md font-medium transition-colors ${
                        modalTab === 'preview'
                          ? 'bg-primary/20 text-primary'
                          : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      <Eye className="w-3 h-3" />
                      {t('common.preview')}
                    </button>
                  </div>
                </div>

                {modalTab === 'edit' && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setFormContent((prev) => (prev ? `${prev}\n- [ ] ` : '- [ ] '))}
                      className="inline-flex items-center gap-1 text-label-sm px-2.5 py-1 rounded-lg bg-surface-container text-on-surface-variant hover:text-primary hover:bg-surface-container-high border border-outline-variant/30 transition-colors"
                    >
                      <Plus className="w-3 h-3 text-primary" />
                      <span>Checkliste</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormContent((prev) => (prev ? `${prev}\n- [ ] 1x  (~0,00 €)` : '- [ ] 1x  (~0,00 €)'))}
                      className="inline-flex items-center gap-1 text-label-sm px-2.5 py-1 rounded-lg bg-surface-container text-on-surface-variant hover:text-status-success hover:bg-surface-container-high border border-outline-variant/30 transition-colors"
                    >
                      <Plus className="w-3 h-3 text-status-success" />
                      <span>Einkaufsposten</span>
                    </button>
                  </div>
                )}

                {modalTab === 'edit' ? (
                  <textarea
                    rows={8}
                    value={formContent}
                    onChange={(e) => setFormContent(e.target.value)}
                    placeholder={t('notes.contentPlaceholder')}
                    className="msm-input font-mono leading-relaxed resize-y"
                  />
                ) : (
                  <div className="w-full min-h-[190px] max-h-[300px] overflow-y-auto bg-surface-container/60 border border-outline-variant/40 rounded-xl p-3.5 text-xs space-y-1.5">
                    {formContent.trim() ? (
                      formContent.split('\n').map((line, idx) => {
                        const isUnchecked = line.trimStart().startsWith('- [ ]')
                        const isChecked = line.trimStart().startsWith('- [x]') || line.trimStart().startsWith('- [X]')

                        if (isUnchecked || isChecked) {
                          const itemText = line.replace(/^[ \t]*- \[[ xX]\][ \t]*/, '')
                          const toggleCheckInModal = () => {
                            const lines = formContent.split('\n')
                            lines[idx] = isUnchecked
                              ? line.replace('- [ ]', '- [x]')
                              : line.replace(/- \[[xX]\]/, '- [ ]')
                            setFormContent(lines.join('\n'))
                          }
                          return (
                            <div
                              key={idx}
                              onClick={toggleCheckInModal}
                              className="flex items-start gap-2 py-0.5 px-1.5 rounded hover:bg-surface-container-high/60 transition-colors cursor-pointer"
                            >
                              {isChecked ? (
                                <CheckSquare className="w-3.5 h-3.5 text-status-success shrink-0 mt-0.5" />
                              ) : (
                                <Square className="w-3.5 h-3.5 text-on-surface-variant shrink-0 mt-0.5" />
                              )}
                              <InlineMarkdown text={itemText} strikethrough={isChecked} />
                            </div>
                          )
                        }

                        if (!line.trim()) return <div key={idx} className="h-1.5" />

                        return (
                          <div key={idx} className="text-on-surface leading-relaxed">
                            <InlineMarkdown text={line} />
                          </div>
                        )
                      })
                    ) : (
                      <p className="text-xs text-on-surface-variant/60 italic py-6 text-center">
                        {t('notes.previewEmpty')}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-outline-variant/30 pb-[calc(var(--msm-unten-sicher,0px)+0.5rem)]">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setIsModalOpen(false)}
                >
                  {t('common.cancel')}
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? (
                    <Spinner className="mr-1.5" />
                  ) : null}
                  {editingNote ? t('common.save') : t('notes.createAction')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
      </div>
    </div>
  )
}
