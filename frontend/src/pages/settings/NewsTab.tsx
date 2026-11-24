import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Bold,
  Bot,
  CalendarClock,
  Copy,
  Edit2,
  ExternalLink,
  Eye,
  Heading,
  ImagePlus,
  Italic,
  Link as LinkIcon,
  List,
  Newspaper,
  Pin,
  Plus,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { Badge, Button, buttonClasses, Dropdown, Spinner, Switch, Zustandsflaeche } from '@maunting/ui'
import { api, SanitizedApiError } from '@/api/client'
import {
  autoSlugFromTitle,
  isValidHttpsUrl,
  NEWS_CATEGORIES,
  newsApi,
  newsCoverSrc,
  type NewsCategory,
  type NewsPostAdmin,
  type NewsSourceItem,
} from '@/api/news'
import { AiMarkdown } from '@/components/ai/AiMarkdown'
import { useHasPermission } from '@/hooks/useHasPermission'
import { still } from '@/lib/still'
import { confirm } from '@/stores/confirmStore'
import { toast } from '@/stores/toastStore'
import { useAuthStore } from '@/stores/authStore'
import { categoryBadgeVariant } from '../NewsOverview'

interface GameOption {
  id: string
  name: string
}

type StatusFilter = 'all' | 'published' | 'draft'

export function NewsTab() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const currentUser = useAuthStore((s) => s.user)
  const canManageNews =
    useHasPermission('panel.news.manage') ||
    useHasPermission('panel.settings.write') ||
    useHasPermission('shop.write')
  const canUseAi = useHasPermission('ai.chat.use')
  const canManageTasks = useHasPermission('ai.tasks.manage')

  const [posts, setPosts] = useState<NewsPostAdmin[]>([])
  const [games, setGames] = useState<GameOption[]>([])
  const [loading, setLoading] = useState(true)

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const [isCreating, setIsCreating] = useState(false)
  const [editingPost, setEditingPost] = useState<NewsPostAdmin | null>(null)
  const [editorMode, setEditorMode] = useState<'write' | 'preview'>('write')

  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [summary, setSummary] = useState('')
  const [contentMarkdown, setContentMarkdown] = useState('')
  const [category, setCategory] = useState<NewsCategory>('announcement')
  const [relatedGameType, setRelatedGameType] = useState('')
  const [authorDisplayName, setAuthorDisplayName] = useState('')
  const [sources, setSources] = useState<NewsSourceItem[]>([])
  const [isPublished, setIsPublished] = useState(false)
  const [isPinned, setIsPinned] = useState(false)
  const [stagedCoverFile, setStagedCoverFile] = useState<File | null>(null)
  const [stagedCoverPreviewUrl, setStagedCoverPreviewUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [coverBusy, setCoverBusy] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadPosts = useCallback(async () => {
    try {
      setLoading(true)
      const list = await newsApi.listAdmin()
      setPosts(Array.isArray(list) ? list : [])
    } catch (err) {
      toast.error(err instanceof SanitizedApiError ? err.message : t('news.cms.ladenFehler'))
      setPosts([])
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void loadPosts()
    api<GameOption[]>('/system/games')
      .then((list) => setGames(Array.isArray(list) ? list : []))
      .catch((err) => {
        still(err, 'NewsTab.loadGames')
        setGames([])
      })
  }, [loadPosts])

  useEffect(() => {
    return () => {
      if (stagedCoverPreviewUrl) {
        URL.revokeObjectURL(stagedCoverPreviewUrl)
      }
    }
  }, [stagedCoverPreviewUrl])

  const clearStagedCover = () => {
    if (stagedCoverPreviewUrl) {
      URL.revokeObjectURL(stagedCoverPreviewUrl)
    }
    setStagedCoverFile(null)
    setStagedCoverPreviewUrl(null)
  }

  const resetForm = () => {
    setIsCreating(false)
    setEditingPost(null)
    setEditorMode('write')
    setTitle('')
    setSlug('')
    setSlugTouched(false)
    setSummary('')
    setContentMarkdown('')
    setCategory('announcement')
    setRelatedGameType('')
    setAuthorDisplayName(currentUser?.username ?? '')
    setSources([])
    setIsPublished(false)
    setIsPinned(false)
    clearStagedCover()
  }

  const startCreate = () => {
    resetForm()
    setIsCreating(true)
  }

  const startEdit = (post: NewsPostAdmin) => {
    clearStagedCover()
    setIsCreating(false)
    setEditingPost(post)
    setEditorMode('write')
    setTitle(post.title)
    setSlug(post.slug)
    setSlugTouched(true)
    setSummary(post.summary || '')
    setContentMarkdown(post.content_markdown)
    setCategory(post.category)
    setRelatedGameType(post.related_game_type || '')
    setAuthorDisplayName(post.author_display_name || '')
    setSources(post.sources.map((s) => ({ ...s })))
    setIsPublished(post.is_published)
    setIsPinned(post.is_pinned)
  }

  const applyTitleChange = (value: string) => {
    setTitle(value)
    if (isCreating && !slugTouched) {
      setSlug(autoSlugFromTitle(value))
    }
  }

  const insertMarkdown = (before: string, after = '') => {
    const el = textareaRef.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const selected = contentMarkdown.substring(start, end)
    const next =
      contentMarkdown.substring(0, start) +
      before +
      selected +
      after +
      contentMarkdown.substring(end)
    setContentMarkdown(next)
    window.setTimeout(() => {
      el.focus()
      el.setSelectionRange(start + before.length, start + before.length + selected.length)
    }, 0)
  }

  const handleAddSource = () => {
    if (sources.length >= 10) return
    setSources((prev) => [...prev, { title: '', url: 'https://' }])
  }

  const handleUpdateSource = (index: number, field: 'title' | 'url', value: string) => {
    setSources((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, [field]: value } : item)),
    )
  }

  const handleRemoveSource = (index: number) => {
    setSources((prev) => prev.filter((_, idx) => idx !== index))
  }

  const handleCoverSelect = async (file: File | undefined) => {
    if (!file) return
    if (editingPost) {
      try {
        setCoverBusy(true)
        const updated = await newsApi.uploadCover(editingPost.id, file)
        setEditingPost(updated)
        setPosts((prev) => prev.map((row) => (row.id === updated.id ? updated : row)))
        toast.success(t('news.cms.coverHochgeladen'))
      } catch (err) {
        toast.error(err instanceof SanitizedApiError ? err.message : t('news.cms.coverFehler'))
      } finally {
        setCoverBusy(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
      return
    }
    clearStagedCover()
    setStagedCoverFile(file)
    setStagedCoverPreviewUrl(URL.createObjectURL(file))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleCoverDelete = async () => {
    if (stagedCoverFile) {
      clearStagedCover()
      return
    }
    if (!editingPost) return
    try {
      setCoverBusy(true)
      const updated = await newsApi.deleteCover(editingPost.id)
      setEditingPost(updated)
      setPosts((prev) => prev.map((row) => (row.id === updated.id ? updated : row)))
      toast.success(t('news.cms.coverEntfernt'))
    } catch (err) {
      toast.error(err instanceof SanitizedApiError ? err.message : t('news.cms.coverFehler'))
    } finally {
      setCoverBusy(false)
    }
  }

  const handleSave = async (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim() || !contentMarkdown.trim()) {
      toast.error(t('news.cms.pflichtfelderFehlen'))
      return
    }

    const cleanedSources: NewsSourceItem[] = []
    for (const item of sources) {
      const sTitle = item.title.trim()
      const sUrl = item.url.trim()
      if (!sTitle && (!sUrl || sUrl === 'https://')) continue
      if (!sTitle || !isValidHttpsUrl(sUrl)) {
        toast.error(t('news.cms.quelleUngueltig'))
        return
      }
      cleanedSources.push({ title: sTitle, url: sUrl })
    }

    try {
      setSaving(true)
      if (editingPost) {
        await newsApi.updateAdmin(editingPost.id, {
          title: title.trim(),
          slug: slug.trim() || null,
          summary: summary.trim(),
          content_markdown: contentMarkdown.trim(),
          category,
          related_game_type: relatedGameType || null,
          sources: cleanedSources,
          is_published: isPublished,
          is_pinned: isPinned,
          author_display_name: authorDisplayName.trim() || null,
        })
        toast.success(t('news.cms.gespeichert'))
      } else {
        const created = await newsApi.createAdmin({
          title: title.trim(),
          slug: slug.trim() || null,
          summary: summary.trim(),
          content_markdown: contentMarkdown.trim(),
          category,
          related_game_type: relatedGameType || null,
          sources: cleanedSources,
          is_published: isPublished,
          is_pinned: isPinned,
          author_display_name: authorDisplayName.trim() || null,
        })
        if (stagedCoverFile) {
          try {
            await newsApi.uploadCover(created.id, stagedCoverFile)
          } catch (coverErr) {
            still(coverErr, 'NewsTab.uploadStagedCover')
            toast.error(t('news.cms.coverFehler'))
          }
        }
        toast.success(t('news.cms.angelegt'))
      }
      resetForm()
      await loadPosts()
    } catch (err) {
      toast.error(err instanceof SanitizedApiError ? err.message : t('news.cms.speichernFehler'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (post: NewsPostAdmin) => {
    const ok = await confirm({
      title: t('news.cms.loeschenTitel'),
      message: t('news.cms.loeschenBestaetigung', { title: post.title }),
      danger: true,
      confirmText: t('common.delete'),
    })
    if (!ok) return
    try {
      await newsApi.deleteAdmin(post.id)
      toast.success(t('news.cms.geloescht'))
      if (editingPost?.id === post.id) resetForm()
      await loadPosts()
    } catch (err) {
      toast.error(err instanceof SanitizedApiError ? err.message : t('news.cms.loeschenFehler'))
    }
  }

  const handleCopyPrompt = async () => {
    const promptText = t('news.cms.kiVorlagePrompt')
    try {
      await navigator.clipboard.writeText(promptText)
      toast.success(t('news.cms.promptKopiert'))
    } catch (err) {
      still(err, 'NewsTab.copyPrompt')
      toast.error(t('news.cms.promptKopierenFehler'))
    }
  }

  const filteredPosts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return posts.filter((post) => {
      if (statusFilter === 'published' && !post.is_published) return false
      if (statusFilter === 'draft' && post.is_published) return false
      if (categoryFilter !== 'all' && post.category !== categoryFilter) return false
      if (!q) return true
      return (
        post.title.toLowerCase().includes(q) ||
        post.summary.toLowerCase().includes(q) ||
        post.slug.toLowerCase().includes(q)
      )
    })
  }, [posts, statusFilter, categoryFilter, searchQuery])

  const categoryOptions = useMemo(
    () =>
      NEWS_CATEGORIES.map((kat) => ({
        value: kat,
        label: t(`news.kategorien.${kat}`),
      })),
    [t],
  )

  const gameOptions = useMemo(() => {
    const base = [{ value: '', label: t('news.cms.keinSpiel') }]
    const known = new Set<string>()
    for (const g of games) {
      known.add(g.id)
      base.push({ value: g.id, label: g.name })
    }
    if (relatedGameType && !known.has(relatedGameType)) {
      base.push({ value: relatedGameType, label: relatedGameType })
    }
    return base
  }, [games, relatedGameType, t])

  const activeCoverUrl = stagedCoverPreviewUrl ?? newsCoverSrc(editingPost?.cover_url)

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="font-headline text-headline-sm text-primary">{t('news.cms.titel')}</h2>
          <p className="mt-1 text-body-md text-on-surface-variant">{t('news.cms.untertitel')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link to="/news" className={buttonClasses('secondary', 'sm', 'gap-1.5')}>
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            <span>{t('news.cms.oeffentlicheAnsicht')}</span>
          </Link>
          {canManageNews && !isCreating && !editingPost && (
            <Button variant="primary" size="sm" onClick={startCreate} className="gap-1.5">
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>{t('news.cms.neuerBeitrag')}</span>
            </Button>
          )}
        </div>
      </div>

      {canManageNews && (canUseAi || canManageTasks) && (
        <section className="msm-card border-primary/30 bg-primary/5 p-5">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
            <div className="space-y-1">
              <h3 className="flex items-center gap-2 font-headline text-sm font-bold text-on-surface">
                <Bot className="h-4 w-4 text-primary" aria-hidden="true" />
                <span>{t('news.cms.kiTitel')}</span>
              </h3>
              <p className="max-w-2xl text-xs leading-relaxed text-on-surface-variant">
                {t('news.cms.kiBeschreibung')}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" onClick={() => void handleCopyPrompt()} className="gap-1.5">
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{t('news.cms.promptKopieren')}</span>
              </Button>
              {canUseAi && (
                <Button variant="secondary" size="sm" onClick={() => navigate('/ai')} className="gap-1.5">
                  <Bot className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{t('news.cms.singularityOeffnen')}</span>
                </Button>
              )}
              {canManageTasks && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => navigate('/ai?ansicht=aufgaben')}
                  className="gap-1.5"
                >
                  <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{t('news.cms.aufgabePlanen')}</span>
                </Button>
              )}
            </div>
          </div>
        </section>
      )}

      {(isCreating || editingPost) && (
        <form onSubmit={handleSave} className="msm-card space-y-5 border-primary/40 p-6">
          <div className="flex items-center justify-between border-b border-outline-variant/30 pb-4">
            <h3 className="flex items-center gap-2 font-headline text-title-lg text-on-surface">
              <Newspaper className="h-5 w-5 text-primary" aria-hidden="true" />
              <span>
                {isCreating ? t('news.cms.editorNeu') : t('news.cms.editorBearbeiten')}
              </span>
            </h3>
            <button
              type="button"
              onClick={resetForm}
              aria-label={t('common.close')}
              className="rounded-lg p-1.5 text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label
                htmlFor="news-title-input"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-on-surface-variant"
              >
                {t('news.cms.feldTitel')} *
              </label>
              <input
                id="news-title-input"
                type="text"
                maxLength={200}
                value={title}
                onChange={(e) => applyTitleChange(e.target.value)}
                placeholder={t('news.cms.feldTitelPlaceholder')}
                className="h-10 w-full rounded-xl border border-outline-variant/50 bg-surface-container-low px-3.5 text-sm text-on-surface focus:border-primary focus:outline-none"
                required
              />
            </div>

            <div>
              <label
                htmlFor="news-slug-input"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-on-surface-variant"
              >
                {t('news.cms.feldSlug')}
              </label>
              <input
                id="news-slug-input"
                type="text"
                maxLength={140}
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true)
                  setSlug(e.target.value)
                }}
                placeholder="palworld-patch-v2"
                className="h-10 w-full rounded-xl border border-outline-variant/50 bg-surface-container-low px-3.5 font-mono text-sm text-on-surface focus:border-primary focus:outline-none"
              />
              <p className="mt-1 text-label-sm text-on-surface-variant">
                /news/{slug || autoSlugFromTitle(title) || 'artikel'}
              </p>
            </div>
          </div>

          <div>
            <label
              htmlFor="news-summary-input"
              className="mb-1.5 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-on-surface-variant"
            >
              <span>{t('news.cms.feldZusammenfassung')}</span>
              <span className="tabular-nums">{summary.length} / 400</span>
            </label>
            <textarea
              id="news-summary-input"
              rows={2}
              maxLength={400}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder={t('news.cms.feldZusammenfassungPlaceholder')}
              className="w-full rounded-xl border border-outline-variant/50 bg-surface-container-low px-3.5 py-2.5 text-sm text-on-surface focus:border-primary focus:outline-none"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                {t('news.cms.feldKategorie')}
              </span>
              <Dropdown
                value={category}
                onChange={(val) => setCategory(val as NewsCategory)}
                options={categoryOptions}
                aria-label={t('news.cms.feldKategorie')}
              />
            </div>

            <div>
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                {t('news.cms.feldSpiel')}
              </span>
              <Dropdown
                value={relatedGameType}
                onChange={setRelatedGameType}
                options={gameOptions}
                aria-label={t('news.cms.feldSpiel')}
              />
            </div>

            <div>
              <label
                htmlFor="news-author-input"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-on-surface-variant"
              >
                {t('news.cms.feldAutor')}
              </label>
              <input
                id="news-author-input"
                type="text"
                maxLength={120}
                value={authorDisplayName}
                onChange={(e) => setAuthorDisplayName(e.target.value)}
                placeholder={t('news.cms.feldAutorPlaceholder')}
                className="h-10 w-full rounded-xl border border-outline-variant/50 bg-surface-container-low px-3.5 text-sm text-on-surface focus:border-primary focus:outline-none"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                {t('news.cms.feldInhalt')} *
              </span>

              <div className="flex items-center gap-1 rounded-xl border border-outline-variant/40 bg-surface-container-low p-1">
                <button
                  type="button"
                  onClick={() => setEditorMode('write')}
                  aria-pressed={editorMode === 'write'}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                    editorMode === 'write'
                      ? 'bg-primary text-on-primary'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {t('news.cms.modusSchreiben')}
                </button>
                <button
                  type="button"
                  onClick={() => setEditorMode('preview')}
                  aria-pressed={editorMode === 'preview'}
                  className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                    editorMode === 'preview'
                      ? 'bg-primary text-on-primary'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{t('news.cms.modusVorschau')}</span>
                </button>
              </div>
            </div>

            {editorMode === 'write' ? (
              <div className="overflow-hidden rounded-xl border border-outline-variant/50 bg-surface-container-low">
                <div className="flex flex-wrap items-center gap-1 border-b border-outline-variant/30 bg-surface-container/60 px-2.5 py-1.5">
                  <button
                    type="button"
                    onClick={() => insertMarkdown('**', '**')}
                    aria-label={t('news.cms.formatFett')}
                    className="rounded-lg p-1.5 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                  >
                    <Bold className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => insertMarkdown('*', '*')}
                    aria-label={t('news.cms.formatKursiv')}
                    className="rounded-lg p-1.5 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                  >
                    <Italic className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => insertMarkdown('## ', '')}
                    aria-label={t('news.cms.formatUeberschrift')}
                    className="rounded-lg p-1.5 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                  >
                    <Heading className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => insertMarkdown('- ', '')}
                    aria-label={t('news.cms.formatListe')}
                    className="rounded-lg p-1.5 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                  >
                    <List className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => insertMarkdown('[', '](https://)')}
                    aria-label={t('news.cms.formatLink')}
                    className="rounded-lg p-1.5 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                  >
                    <LinkIcon className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>

                <textarea
                  ref={textareaRef}
                  rows={10}
                  value={contentMarkdown}
                  onChange={(e) => setContentMarkdown(e.target.value)}
                  placeholder={t('news.cms.feldInhaltPlaceholder')}
                  className="w-full bg-transparent px-3.5 py-3 font-mono text-sm text-on-surface focus:outline-none"
                  required
                />
              </div>
            ) : (
              <div className="min-h-[220px] rounded-xl border border-outline-variant/50 bg-surface-container-low/70 p-4">
                {contentMarkdown.trim() ? (
                  <AiMarkdown content={contentMarkdown} />
                ) : (
                  <p className="text-sm text-on-surface-variant">{t('news.cms.vorschauLeer')}</p>
                )}
              </div>
            )}
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-3 rounded-xl border border-outline-variant/40 bg-surface-container-low/60 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                  {t('news.cms.coverTitel')}
                </span>
                <div className="flex items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => void handleCoverSelect(e.target.files?.[0])}
                    className="hidden"
                    aria-label={t('news.cms.coverAuswaehlen')}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={coverBusy}
                    onClick={() => fileInputRef.current?.click()}
                    className="gap-1.5"
                  >
                    <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{t('news.cms.coverHochladen')}</span>
                  </Button>
                  {activeCoverUrl && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={coverBusy}
                      onClick={() => void handleCoverDelete()}
                      className="text-status-destructive hover:bg-status-destructive/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  )}
                </div>
              </div>

              {activeCoverUrl ? (
                <div className="overflow-hidden rounded-lg border border-outline-variant/30">
                  <img
                    src={activeCoverUrl}
                    alt={title || t('news.cms.coverTitel')}
                    className="aspect-[16/9] w-full object-cover"
                  />
                </div>
              ) : (
                <p className="text-xs text-on-surface-variant">{t('news.cms.coverHinweis')}</p>
              )}
            </div>

            <div className="space-y-3 rounded-xl border border-outline-variant/40 bg-surface-container-low/60 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                  {t('news.cms.quellenTitel')}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={sources.length >= 10}
                  onClick={handleAddSource}
                  className="gap-1"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{t('news.cms.quelleHinzufuegen')}</span>
                </Button>
              </div>

              {sources.length === 0 ? (
                <p className="text-xs text-on-surface-variant">{t('news.cms.quellenHinweis')}</p>
              ) : (
                <div className="space-y-2">
                  {sources.map((src, idx) => (
                    <div key={idx} className="grid grid-cols-12 items-center gap-2">
                      <input
                        type="text"
                        maxLength={160}
                        value={src.title}
                        onChange={(e) => handleUpdateSource(idx, 'title', e.target.value)}
                        placeholder={t('news.cms.quelleNamePlaceholder')}
                        aria-label={t('news.cms.quelleNamePlaceholder')}
                        className="col-span-5 h-9 rounded-lg border border-outline-variant/50 bg-background px-2.5 text-xs text-on-surface focus:border-primary focus:outline-none"
                      />
                      <input
                        type="url"
                        maxLength={2048}
                        value={src.url}
                        onChange={(e) => handleUpdateSource(idx, 'url', e.target.value)}
                        placeholder="https://example.com/artikel"
                        aria-label={t('news.cms.quelleUrlLabel')}
                        className="col-span-6 h-9 rounded-lg border border-outline-variant/50 bg-background px-2.5 text-xs text-on-surface focus:border-primary focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveSource(idx)}
                        aria-label={t('common.delete')}
                        className="col-span-1 grid h-9 place-items-center rounded-lg text-on-surface-variant hover:bg-status-destructive/10 hover:text-status-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-outline-variant/30 pt-4">
            <div className="flex flex-wrap items-center gap-6">
              <label className="flex cursor-pointer items-center gap-2.5 text-sm text-on-surface">
                <Switch
                  checked={isPublished}
                  onCheckedChange={setIsPublished}
                  aria-label={t('news.cms.schalterVeroeffentlichen')}
                />
                <span>{t('news.cms.schalterVeroeffentlichen')}</span>
              </label>

              <label className="flex cursor-pointer items-center gap-2.5 text-sm text-on-surface">
                <Switch
                  checked={isPinned}
                  onCheckedChange={setIsPinned}
                  aria-label={t('news.cms.schalterAnpinnen')}
                />
                <span>{t('news.cms.schalterAnpinnen')}</span>
              </label>
            </div>

            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" onClick={resetForm}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" variant="primary" disabled={saving} className="gap-1.5">
                <Save className="h-4 w-4" aria-hidden="true" />
                <span>{saving ? t('common.saving') : t('common.save')}</span>
              </Button>
            </div>
          </div>
        </form>
      )}

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="relative flex-1 md:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant"
            aria-hidden="true"
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('news.suchePlaceholder')}
            aria-label={t('news.suchePlaceholder')}
            className="h-10 w-full rounded-xl border border-outline-variant/50 bg-surface-container-low pl-9 pr-3 text-sm text-on-surface focus:border-primary focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="w-44">
            <Dropdown
              value={statusFilter}
              onChange={(val) => setStatusFilter(val as StatusFilter)}
              options={[
                { value: 'all', label: t('news.cms.statusAlle') },
                { value: 'published', label: t('news.cms.statusLive') },
                { value: 'draft', label: t('news.cms.statusEntwurf') },
              ]}
              aria-label={t('news.cms.filterStatus')}
            />
          </div>
          <div className="w-48">
            <Dropdown
              value={categoryFilter}
              onChange={setCategoryFilter}
              options={[
                { value: 'all', label: t('news.kategorien.all') },
                ...categoryOptions,
              ]}
              aria-label={t('news.filter.kategorie')}
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div
          className="flex items-center justify-center gap-2.5 py-12 text-sm text-on-surface-variant"
          role="status"
        >
          <Spinner size="md" />
          <span>{t('news.laedt')}</span>
        </div>
      ) : filteredPosts.length === 0 ? (
        <Zustandsflaeche
          art="leer"
          icon={<Newspaper className="h-10 w-10" aria-hidden="true" />}
          titel={t('news.cms.leerTitel')}
          text={t('news.cms.leerBeschreibung')}
        >
          {canManageNews && posts.length === 0 && (
            <Button variant="primary" size="sm" onClick={startCreate} className="mt-2 gap-1.5">
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>{t('news.cms.neuerBeitrag')}</span>
            </Button>
          )}
        </Zustandsflaeche>
      ) : (
        <div className="space-y-3">
          {filteredPosts.map((post) => {
            const coverSrc = newsCoverSrc(post.cover_url)
            const dateLabel = new Intl.DateTimeFormat(
              i18n.language.startsWith('en') ? 'en-US' : 'de-DE',
              { day: '2-digit', month: 'short', year: 'numeric' },
            ).format(new Date(post.published_at || post.updated_at))

            return (
              <article
                key={post.id}
                className="msm-card flex flex-col justify-between gap-4 p-4 sm:flex-row sm:items-center"
              >
                <div className="flex min-w-0 items-start gap-4">
                  <div className="hidden h-16 w-24 shrink-0 overflow-hidden rounded-lg border border-outline-variant/30 bg-surface-container-high sm:block">
                    {coverSrc ? (
                      <img
                        src={coverSrc}
                        alt={post.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-on-surface-variant/50">
                        <Newspaper className="h-5 w-5" aria-hidden="true" />
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={post.is_published ? 'success' : 'default'}>
                        {post.is_published
                          ? t('news.cms.statusLive')
                          : t('news.cms.statusEntwurf')}
                      </Badge>
                      <Badge variant={categoryBadgeVariant(post.category)}>
                        {t(`news.kategorien.${post.category}`)}
                      </Badge>
                      {post.is_pinned && (
                        <Badge variant="info">
                          <Pin className="mr-1 inline h-3 w-3" aria-hidden="true" />
                          {t('news.angepinnt')}
                        </Badge>
                      )}
                      <span className="text-xs text-on-surface-variant">{dateLabel}</span>
                    </div>

                    <h4 className="truncate font-headline text-base font-bold text-on-surface">
                      {post.title}
                    </h4>

                    {post.summary && (
                      <p className="line-clamp-1 text-xs text-on-surface-variant">
                        {post.summary}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  {post.is_published && (
                    <Link
                      to={`/news/${post.slug}`}
                      aria-label={t('news.cms.oeffentlichAnsehen')}
                      className={buttonClasses('ghost', 'sm')}
                    >
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  )}
                  {canManageNews && (
                    <>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => startEdit(post)}
                        aria-label={t('common.edit')}
                        className="gap-1.5"
                      >
                        <Edit2 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>{t('common.edit')}</span>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleDelete(post)}
                        aria-label={t('common.delete')}
                        className="text-status-destructive hover:bg-status-destructive/10"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
