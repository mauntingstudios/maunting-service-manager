import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  BookOpen,
  FileCode2,
  FolderSync,
  GitCommit,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react'
import type {
  AiProject,
  AiProjectWikiOverview,
  AiProjectWikiPageDetail,
  AiProjectWikiPageSummary,
  AiProjectWikiSearchHit,
  WikiCategory,
} from '@/api/ai'
import { projectsApi } from '@/api/ai/projectsApi'
import { getDocument, updateDocument, type DocDetail } from '@/api/docs'
import { AiMarkdown } from '@/components/ai/AiMarkdown'
import { DocEditor } from '@/docs/DocEditor'
import type { OutlineEntry } from '@/docs/editor/Outline'
import { useIsOnline } from '@/hooks/useIsOnline'
import { still } from '@/lib/still'
import { useAuthStore } from '@/stores/authStore'
import { confirm } from '@/stores/confirmStore'
import { toast } from '@/stores/toastStore'
import { Badge, Button, Dropdown, Input, Spinner, Switch, Textarea } from '@maunting/ui'

export interface SingraWikiTabProps {
  selectedProject: AiProject
  onOpenSourceFile: (path: string) => void
}

const WIKI_CATEGORIES: readonly WikiCategory[] = [
  'overview',
  'architecture',
  'module',
  'api',
  'data',
  'workflow',
  'pitfalls',
]

function extractMarkdownOutline(markdown: string): Array<{ level: number; text: string }> {
  const items: Array<{ level: number; text: string }> = []
  for (const line of (markdown || '').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('#')) continue
    const match = trimmed.match(/^(#{1,3})\s+(.+)$/)
    if (!match) continue
    items.push({ level: match[1].length, text: match[2].trim() })
  }
  return items
}

export function SingraWikiTab({
  selectedProject,
  onOpenSourceFile,
}: SingraWikiTabProps) {
  const { t } = useTranslation()
  const user = useAuthStore((s) => s.user)
  const online = useIsOnline()

  const [overview, setOverview] = useState<AiProjectWikiOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyAction, setBusyAction] = useState<string | null>(null)

  const [activeSlug, setActiveSlug] = useState<string | null>(null)
  const [activePage, setActivePage] = useState<AiProjectWikiPageDetail | null>(null)
  const [pageLoading, setPageLoading] = useState(false)

  const [searchQuery, setSearchQuery] = useState('')
  const [searchHits, setSearchHits] = useState<AiProjectWikiSearchHit[] | null>(null)
  const [searching, setSearching] = useState(false)

  // Bearbeitungsmodus: entweder kollaborativ via Maunting Docs oder direktes Markdown
  const [editMode, setEditMode] = useState<'read' | 'docs' | 'markdown'>('read')
  const [docDetail, setDocDetail] = useState<DocDetail | null>(null)
  const [docOutline, setDocOutline] = useState<OutlineEntry[]>([])
  const outlineJumpRef = useRef<((pos: number) => void) | null>(null)
  const projectIdRef = useRef(selectedProject.id)
  const overviewReqSeqRef = useRef(0)
  const pageReqSeqRef = useRef(0)
  projectIdRef.current = selectedProject.id

  // Formularzustand für direkte Markdown-Bearbeitung oder Neuanlage
  const [creatingNew, setCreatingNew] = useState(false)
  const [draftSlug, setDraftSlug] = useState('')
  const [draftTitle, setDraftTitle] = useState('')
  const [draftCategory, setDraftCategory] = useState<string>('module')
  const [draftSummary, setDraftSummary] = useState('')
  const [draftMarkdown, setDraftMarkdown] = useState('')
  const [draftSources, setDraftSources] = useState('')

  const categoryOptions = useMemo(
    () =>
      WIKI_CATEGORIES.map((cat) => ({
        value: cat,
        label: t(`ai.projects.wiki.categories.${cat}`),
      })),
    [t],
  )

  const categoryLabel = useCallback(
    (cat: string) =>
      WIKI_CATEGORIES.includes(cat as WikiCategory)
        ? t(`ai.projects.wiki.categories.${cat}`)
        : cat,
    [t],
  )

  const loadOverview = useCallback(async () => {
    const reqProjectId = selectedProject.id
    const seq = ++overviewReqSeqRef.current
    setLoading(true)
    try {
      const data = await projectsApi.getProjectWiki(reqProjectId)
      if (projectIdRef.current !== reqProjectId || overviewReqSeqRef.current !== seq) {
        return null
      }
      setOverview(data)
      return data
    } catch (err) {
      if (projectIdRef.current === reqProjectId && overviewReqSeqRef.current === seq) {
        still(err, 'singra:wiki:overview')
        toast.error(t('ai.projects.wiki.errors.loadFailed'))
      }
      return null
    } finally {
      if (projectIdRef.current === reqProjectId && overviewReqSeqRef.current === seq) {
        setLoading(false)
      }
    }
  }, [selectedProject.id, t])

  const openPage = useCallback(
    async (slug: string) => {
      const reqProjectId = selectedProject.id
      const seq = ++pageReqSeqRef.current
      setCreatingNew(false)
      setEditMode('read')
      setDocDetail(null)
      setActiveSlug(slug)
      setPageLoading(true)
      try {
        const detail = await projectsApi.getProjectWikiPage(reqProjectId, slug)
        if (projectIdRef.current !== reqProjectId || pageReqSeqRef.current !== seq) {
          return
        }
        setActivePage(detail)
      } catch (err) {
        if (projectIdRef.current === reqProjectId && pageReqSeqRef.current === seq) {
          still(err, 'singra:wiki:page')
          toast.error(t('ai.projects.wiki.errors.pageLoadFailed'))
        }
      } finally {
        if (projectIdRef.current === reqProjectId && pageReqSeqRef.current === seq) {
          setPageLoading(false)
        }
      }
    },
    [selectedProject.id, t],
  )

  useEffect(() => {
    overviewReqSeqRef.current += 1
    pageReqSeqRef.current += 1
    setActiveSlug(null)
    setActivePage(null)
    setEditMode('read')
    setDocDetail(null)
    setSearchQuery('')
    setSearchHits(null)
    setCreatingNew(false)
    void loadOverview()
  }, [selectedProject.id, loadOverview])

  useEffect(() => {
    if (!overview?.wiki_status) return
    if (overview.wiki_status !== 'generating' && overview.wiki_status !== 'updating') return
    const reqProjectId = selectedProject.id
    const timer = window.setInterval(() => {
      const seq = ++overviewReqSeqRef.current
      void projectsApi
        .getProjectWiki(reqProjectId)
        .then((next) => {
          if (projectIdRef.current === reqProjectId && overviewReqSeqRef.current === seq) {
            setOverview(next)
          }
        })
        .catch((err) => still(err, 'singra:wiki:poll'))
    }, 4000)
    return () => window.clearInterval(timer)
  }, [overview?.wiki_status, selectedProject.id])

  const handleToggleSettings = async (patch: {
    wiki_enabled?: boolean
    wiki_auto_update?: boolean
  }) => {
    setBusyAction('settings')
    try {
      const next = await projectsApi.updateProjectWikiSettings(selectedProject.id, patch)
      setOverview(next)
    } catch (err) {
      still(err, 'singra:wiki:settings')
      toast.error(t('ai.projects.wiki.errors.settingsFailed'))
    } finally {
      setBusyAction(null)
    }
  }

  const handleGenerate = async (mode: 'generate' | 'update', enableFirst = false) => {
    setBusyAction('generate')
    try {
      if (enableFirst) {
        await projectsApi.updateProjectWikiSettings(selectedProject.id, { wiki_enabled: true })
      }
      const res = await projectsApi.generateProjectWiki(selectedProject.id, { mode })
      if (res.started) {
        toast.success(t('ai.projects.wiki.messages.workerStarted'))
      } else {
        toast.info(t('ai.projects.wiki.messages.workerSkipped'))
      }
      await loadOverview()
    } catch (err) {
      still(err, 'singra:wiki:generate')
      toast.error(t('ai.projects.wiki.errors.generateFailed'))
    } finally {
      setBusyAction(null)
    }
  }

  const handleSearch = async (e: FormEvent) => {
    e.preventDefault()
    const clean = searchQuery.trim()
    if (!clean) {
      setSearchHits(null)
      return
    }
    setSearching(true)
    try {
      const hits = await projectsApi.searchProjectWiki(selectedProject.id, clean, 6)
      setSearchHits(hits)
    } catch (err) {
      still(err, 'singra:wiki:search')
      toast.error(t('ai.projects.wiki.errors.searchFailed'))
    } finally {
      setSearching(false)
    }
  }

  const startCreatingPage = () => {
    setActiveSlug(null)
    setActivePage(null)
    setDocDetail(null)
    setCreatingNew(true)
    setEditMode('markdown')
    setDraftSlug('')
    setDraftTitle('')
    setDraftCategory('module')
    setDraftSummary('')
    setDraftMarkdown('')
    setDraftSources('')
  }

  const startEditingPage = async () => {
    if (!activePage) return
    const enterMarkdownEditor = () => {
      setDraftSlug(activePage.slug)
      setDraftTitle(activePage.title)
      setDraftCategory(activePage.category || 'module')
      setDraftSummary(activePage.summary || '')
      setDraftMarkdown(activePage.content_markdown || '')
      setDraftSources(activePage.source_files.join(', '))
      setEditMode('markdown')
    }
    setBusyAction('openDoc')
    try {
      if (overview?.docs_collab_available && user) {
        const session = await projectsApi.openProjectWikiDoc(selectedProject.id, activePage.slug)
        if (session.mode === 'docs' && session.doc_uid) {
          const detail = await getDocument(session.doc_uid)
          setDocDetail(detail)
          setEditMode('docs')
          return
        }
      }
      enterMarkdownEditor()
    } catch (err) {
      still(err, 'singra:wiki:editOpen')
      enterMarkdownEditor()
    } finally {
      setBusyAction(null)
    }
  }

  const finishDocsEdit = async () => {
    if (!activePage) {
      setEditMode('read')
      setDocDetail(null)
      return
    }
    setBusyAction('syncDoc')
    try {
      const updated = await projectsApi.syncProjectWikiDoc(selectedProject.id, activePage.slug)
      setActivePage(updated)
      setDocDetail(null)
      setEditMode('read')
      await loadOverview()
      toast.success(t('ai.projects.wiki.messages.syncedFromDoc'))
    } catch (err) {
      still(err, 'singra:wiki:syncDoc')
      toast.error(t('ai.projects.wiki.errors.syncFailed'))
    } finally {
      setBusyAction(null)
    }
  }

  const handleSaveMarkdown = async (e: FormEvent) => {
    e.preventDefault()
    const cleanTitle = draftTitle.trim()
    const cleanSlug = (creatingNew ? draftSlug.trim() || cleanTitle : activePage?.slug || '').trim()
    if (!cleanTitle || !cleanSlug) {
      toast.error(t('ai.projects.wiki.errors.titleRequired'))
      return
    }
    setBusyAction('savePage')
    try {
      const saved = await projectsApi.saveProjectWikiPage(selectedProject.id, cleanSlug, {
        title: cleanTitle,
        category: draftCategory,
        summary: draftSummary.trim(),
        content_markdown: draftMarkdown,
        source_files: draftSources
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      })
      setCreatingNew(false)
      setEditMode('read')
      setActiveSlug(saved.slug)
      setActivePage(saved)
      await loadOverview()
      toast.success(t('ai.projects.wiki.messages.saved'))
    } catch (err) {
      still(err, 'singra:wiki:save')
      toast.error(t('ai.projects.wiki.errors.saveFailed'))
    } finally {
      setBusyAction(null)
    }
  }

  const handleDeletePage = async (page: AiProjectWikiPageSummary) => {
    const ok = await confirm({
      title: t('ai.projects.wiki.actions.deletePage'),
      message: t('ai.projects.wiki.confirmDelete', { title: page.title }),
      danger: true,
    })
    if (!ok) return
    setBusyAction('delete')
    try {
      await projectsApi.deleteProjectWikiPage(selectedProject.id, page.slug)
      if (activeSlug === page.slug) {
        setActiveSlug(null)
        setActivePage(null)
        setEditMode('read')
      }
      await loadOverview()
      toast.success(t('ai.projects.wiki.messages.deleted'))
    } catch (err) {
      still(err, 'singra:wiki:delete')
      toast.error(t('ai.projects.wiki.errors.deleteFailed'))
    } finally {
      setBusyAction(null)
    }
  }

  const handleWorkspaceSync = async () => {
    setBusyAction('syncWorkspace')
    try {
      const res = await projectsApi.syncProjectWikiWorkspace(selectedProject.id)
      await loadOverview()
      if (activeSlug) {
        await openPage(activeSlug)
      }
      toast.success(
        t('ai.projects.wiki.messages.workspaceSynced', {
          count: res.updated,
          total: res.synced_files,
        }),
      )
    } catch (err) {
      still(err, 'singra:wiki:workspaceSync')
      toast.error(t('ai.projects.wiki.errors.syncFailed'))
    } finally {
      setBusyAction(null)
    }
  }

  const handleCommitWiki = async () => {
    setBusyAction('commit')
    try {
      await projectsApi.commitProjectWiki(selectedProject.id, { push: false })
      toast.success(t('ai.projects.wiki.messages.committed'))
      await loadOverview()
    } catch (err) {
      still(err, 'singra:wiki:commit')
      toast.error(t('ai.projects.wiki.errors.commitFailed'))
    } finally {
      setBusyAction(null)
    }
  }

  const groupedPages = useMemo(() => {
    const map = new Map<string, AiProjectWikiPageSummary[]>()
    for (const p of overview?.pages ?? []) {
      const cat = p.category || 'module'
      const list = map.get(cat) ?? []
      list.push(p)
      map.set(cat, list)
    }
    return Array.from(map.entries())
  }, [overview?.pages])

  const readOutline = useMemo(
    () => (activePage ? extractMarkdownOutline(activePage.content_markdown) : []),
    [activePage],
  )

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-12">
        <Spinner />
      </div>
    )
  }

  if (!overview || !overview.wiki_enabled) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center py-8">
        <div className="rounded-2xl border border-outline-variant/25 bg-surface-container-low/40 p-6 sm:p-8 space-y-5">
          <div className="flex items-start gap-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
              <BookOpen className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-base font-semibold text-on-surface">
                {t('ai.projects.wiki.disabled.title')}
              </h3>
              <p className="text-sm leading-relaxed text-on-surface-variant">
                {t('ai.projects.wiki.disabled.description')}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 border-t border-outline-variant/20 pt-4">
            <div className="space-y-0.5">
              <div className="text-sm font-medium text-on-surface">
                {t('ai.projects.wiki.autoUpdate.label')}
              </div>
              <p className="text-xs text-on-surface-variant">
                {t('ai.projects.wiki.autoUpdate.hint')}
              </p>
            </div>
            <Switch
              checked={Boolean(overview?.wiki_auto_update)}
              onCheckedChange={(checked) => void handleToggleSettings({ wiki_auto_update: checked })}
              disabled={busyAction !== null}
              aria-label={t('ai.projects.wiki.autoUpdate.label')}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <Button
              type="button"
              className="rounded-full"
              disabled={busyAction !== null}
              onClick={() => void handleGenerate('generate', true)}
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              {t('ai.projects.wiki.actions.enableAndGenerate')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="rounded-full"
              disabled={busyAction !== null}
              onClick={() => void handleToggleSettings({ wiki_enabled: true })}
            >
              {t('ai.projects.wiki.actions.enableEmpty')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 min-h-[520px] flex-col lg:flex-row gap-4">
      {/* Linke Seitenleiste: Suche & Kategorie-Baum */}
      <aside className="w-full lg:w-64 shrink-0 flex flex-col gap-3 rounded-2xl border border-outline-variant/25 bg-surface-container-low/35 p-3">
        <form onSubmit={(e) => void handleSearch(e)} className="flex items-center gap-1.5">
          <div className="relative flex-1 min-w-0">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-on-surface-variant"
              aria-hidden="true"
            />
            <Input
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                if (!e.target.value.trim()) setSearchHits(null)
              }}
              placeholder={t('ai.projects.wiki.searchPlaceholder')}
              aria-label={t('ai.projects.wiki.searchPlaceholder')}
              className="pl-8 text-xs"
            />
          </div>
          {searching && <Spinner className="h-4 w-4 shrink-0" />}
        </form>

        <div className="flex items-center justify-between gap-2 px-1">
          <button
            type="button"
            onClick={() => {
              setActiveSlug(null)
              setActivePage(null)
              setCreatingNew(false)
              setEditMode('read')
              setSearchHits(null)
            }}
            className={[
              'rounded text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
              !activeSlug && !creatingNew
                ? 'text-primary'
                : 'text-on-surface-variant hover:text-on-surface',
            ].join(' ')}
          >
            {t('ai.projects.wiki.overviewTitle')}
          </button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={startCreatingPage}
            className="h-7 px-2 text-xs rounded-full"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {t('ai.projects.wiki.actions.newPage')}
          </Button>
        </div>

        <nav className="flex-1 space-y-3 overflow-y-auto pr-1" aria-label={t('ai.projects.wiki.overviewTitle')}>
          {groupedPages.length === 0 ? (
            <p className="px-2 py-4 text-xs text-on-surface-variant">
              {t('ai.projects.wiki.emptyList')}
            </p>
          ) : (
            groupedPages.map(([cat, list]) => (
              <div key={cat} className="space-y-1">
                <div className="px-2 text-label-sm font-semibold text-on-surface-variant">
                  {categoryLabel(cat)}
                </div>
                {list.map((page) => {
                  const selected = activeSlug === page.slug && !creatingNew
                  return (
                    <button
                      key={page.id}
                      type="button"
                      onClick={() => void openPage(page.slug)}
                      className={[
                        'flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                        selected
                          ? 'bg-primary/14 text-primary font-medium'
                          : 'text-on-surface-variant hover:bg-surface-container-high/50 hover:text-on-surface',
                      ].join(' ')}
                    >
                      <span className="truncate">{page.title}</span>
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </nav>
      </aside>

      {/* Hauptbereich: Suche, Knowledge-Cards-Übersicht, Leseansicht oder Live-Editor */}
      <section className="flex-1 min-w-0 flex flex-col rounded-2xl bg-surface-container-low/20 p-4 sm:p-6 overflow-y-auto">
        {searchHits !== null ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-on-surface">
                {t('ai.projects.wiki.searchResults', { count: searchHits.length })}
              </h3>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSearchQuery('')
                  setSearchHits(null)
                }}
              >
                {t('common.close')}
              </Button>
            </div>
            {searchHits.length === 0 ? (
              <p className="text-sm text-on-surface-variant">
                {t('ai.projects.wiki.noSearchResults')}
              </p>
            ) : (
              <div className="space-y-3">
                {searchHits.map((hit, idx) => (
                  <button
                    key={`${hit.slug}-${idx}`}
                    type="button"
                    onClick={() => {
                      setSearchHits(null)
                      void openPage(hit.slug)
                    }}
                    className="block w-full rounded-xl border border-outline-variant/25 bg-surface-container-high/30 p-4 text-left hover:border-primary/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-sm font-semibold text-on-surface">
                        {hit.title}: {hit.heading}
                      </span>
                      <Badge variant="default">{categoryLabel(hit.category)}</Badge>
                    </div>
                    <p className="text-xs leading-relaxed text-on-surface-variant line-clamp-3">
                      {hit.content}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : creatingNew || editMode === 'markdown' ? (
          <form onSubmit={(e) => void handleSaveMarkdown(e)} className="mx-auto w-full max-w-3xl space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-on-surface">
                {creatingNew
                  ? t('ai.projects.wiki.actions.newPage')
                  : t('ai.projects.wiki.actions.editMarkdown')}
              </h3>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setCreatingNew(false)
                  setEditMode('read')
                }}
              >
                {t('common.cancel')}
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor="wiki-draft-title" className="text-xs font-medium text-on-surface-variant">
                  {t('ai.projects.wiki.fields.title')}
                </label>
                <Input
                  id="wiki-draft-title"
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <span className="text-xs font-medium text-on-surface-variant block">
                  {t('ai.projects.wiki.fields.category')}
                </span>
                <Dropdown
                  value={draftCategory}
                  onChange={setDraftCategory}
                  options={categoryOptions}
                />
              </div>
            </div>

            {creatingNew && (
              <div className="space-y-1">
                <label htmlFor="wiki-draft-slug" className="text-xs font-medium text-on-surface-variant">
                  {t('ai.projects.wiki.fields.slug')}
                </label>
                <Input
                  id="wiki-draft-slug"
                  value={draftSlug}
                  onChange={(e) => setDraftSlug(e.target.value)}
                  placeholder="architektur"
                />
              </div>
            )}

            <div className="space-y-1">
              <label htmlFor="wiki-draft-summary" className="text-xs font-medium text-on-surface-variant">
                {t('ai.projects.wiki.fields.summary')}
              </label>
              <Input
                id="wiki-draft-summary"
                value={draftSummary}
                onChange={(e) => setDraftSummary(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="wiki-draft-sources" className="text-xs font-medium text-on-surface-variant">
                {t('ai.projects.wiki.fields.sourceFiles')}
              </label>
              <Input
                id="wiki-draft-sources"
                value={draftSources}
                onChange={(e) => setDraftSources(e.target.value)}
                placeholder="src/App.tsx, backend/main.py"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="wiki-draft-content" className="text-xs font-medium text-on-surface-variant">
                {t('ai.projects.wiki.fields.content')}
              </label>
              <Textarea
                id="wiki-draft-content"
                value={draftMarkdown}
                onChange={(e) => setDraftMarkdown(e.target.value)}
                rows={14}
                className="font-mono text-xs"
              />
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button type="submit" disabled={busyAction !== null} className="rounded-full">
                {t('common.save')}
              </Button>
            </div>
          </form>
        ) : editMode === 'docs' && docDetail && user ? (
          <div className="flex flex-1 min-h-[440px] flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-outline-variant/20 pb-2.5">
              <div className="flex items-center gap-2 text-xs text-on-surface-variant">
                <Users className="h-4 w-4 text-primary" aria-hidden="true" />
                <span>{t('ai.projects.wiki.docsCollabActive')}</span>
              </div>
              <Button
                type="button"
                size="sm"
                className="rounded-full"
                disabled={busyAction !== null}
                onClick={() => void finishDocsEdit()}
              >
                {t('ai.projects.wiki.actions.syncAndFinish')}
              </Button>
            </div>
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden rounded-xl border border-outline-variant/25">
              <DocEditor
                key={docDetail.uid}
                detail={docDetail}
                userId={user.id}
                userName={user.username}
                online={online}
                activePanel={null}
                onOpenPanel={() => undefined}
                onOpenShare={() => undefined}
                onOpenMembers={() => undefined}
                onCommentsChanged={() => undefined}
                onTitleChanged={async (title) => {
                  await updateDocument(docDetail.uid, { title })
                }}
                onOutlineChange={setDocOutline}
                outlineJumpRef={outlineJumpRef}
              />
            </div>
          </div>
        ) : pageLoading ? (
          <div className="flex flex-1 items-center justify-center py-12">
            <Spinner />
          </div>
        ) : activePage ? (
          <article className="mx-auto w-full max-w-[72ch] space-y-5">
            <header className="space-y-2 border-b border-outline-variant/20 pb-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveSlug(null)
                      setActivePage(null)
                    }}
                    className="inline-flex items-center gap-1 rounded text-xs text-on-surface-variant hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('ai.projects.wiki.overviewTitle')}
                  </button>
                  <Badge variant="default">{categoryLabel(activePage.category)}</Badge>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="rounded-full"
                    disabled={busyAction !== null}
                    onClick={() => void startEditingPage()}
                  >
                    {overview.docs_collab_available
                      ? t('ai.projects.wiki.actions.editCollab')
                      : t('ai.projects.wiki.actions.editMarkdown')}
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={t('ai.projects.wiki.actions.deletePage')}
                    disabled={busyAction !== null}
                    onClick={() => void handleDeletePage(activePage)}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-status-destructive" aria-hidden="true" />
                  </Button>
                </div>
              </div>
              <h2 className="text-xl font-semibold text-on-surface">{activePage.title}</h2>
              {activePage.summary && (
                <p className="text-sm text-on-surface-variant">{activePage.summary}</p>
              )}
            </header>

            <AiMarkdown content={activePage.content_markdown || t('ai.projects.wiki.emptyPage')} />
          </article>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-on-surface">
                  {t('ai.projects.wiki.knowledgeCardsTitle')}
                </h2>
                <p className="text-xs text-on-surface-variant">
                  {t('ai.projects.wiki.knowledgeCardsSubtitle', { path: overview.wiki_path })}
                </p>
              </div>
              {overview.pages.length === 0 && (
                <Button
                  type="button"
                  size="sm"
                  className="rounded-full"
                  disabled={busyAction !== null}
                  onClick={() => void handleGenerate('generate')}
                >
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('ai.projects.wiki.actions.generateNow')}
                </Button>
              )}
            </div>

            {overview.pages.length === 0 ? (
              <div className="rounded-2xl border border-outline-variant/25 bg-surface-container-low/40 p-8 text-center space-y-3">
                <BookOpen className="h-7 w-7 text-primary/60 mx-auto" aria-hidden="true" />
                <p className="text-sm font-medium text-on-surface">
                  {t('ai.projects.wiki.emptyStateTitle')}
                </p>
                <p className="text-xs text-on-surface-variant max-w-md mx-auto">
                  {t('ai.projects.wiki.emptyStateHint')}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {overview.pages.map((page) => (
                  <button
                    key={page.id}
                    type="button"
                    onClick={() => void openPage(page.slug)}
                    className="flex flex-col justify-between rounded-2xl border border-outline-variant/25 bg-surface-container-low/50 p-4 text-left hover:border-primary/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant="default">{categoryLabel(page.category)}</Badge>
                        <span className="text-label-sm text-on-surface-variant">
                          {t('ai.projects.wiki.sourceFileCount', { count: page.source_files.length })}
                        </span>
                      </div>
                      <h3 className="text-sm font-semibold text-on-surface">{page.title}</h3>
                      {page.summary && (
                        <p className="text-xs leading-relaxed text-on-surface-variant line-clamp-2">
                          {page.summary}
                        </p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Rechte Kontextleiste: Status, Gliederung, Quellen, Sync & Git */}
      <aside className="w-full lg:w-60 shrink-0 flex flex-col gap-4 rounded-2xl border border-outline-variant/25 bg-surface-container-low/35 p-3.5 text-xs">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-on-surface">
              {t('ai.projects.wiki.statusTitle')}
            </span>
            <Badge
              variant={
                overview.wiki_status === 'error'
                  ? 'destructive'
                  : overview.wiki_status === 'idle'
                    ? 'default'
                    : 'info'
              }
            >
              {t(`ai.projects.wiki.status.${overview.wiki_status}`, {
                defaultValue: overview.wiki_status,
              })}
            </Badge>
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-on-surface-variant">
              {t('ai.projects.wiki.autoUpdate.shortLabel')}
            </span>
            <Switch
              checked={overview.wiki_auto_update}
              onCheckedChange={(checked) => void handleToggleSettings({ wiki_auto_update: checked })}
              disabled={busyAction !== null}
              aria-label={t('ai.projects.wiki.autoUpdate.label')}
            />
          </div>

          <div className="flex flex-col gap-1.5 pt-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="w-full justify-start rounded-xl"
              disabled={busyAction !== null}
              onClick={() =>
                void handleGenerate(overview.pages.length > 0 ? 'update' : 'generate')
              }
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              {t('ai.projects.wiki.actions.refreshWithAi')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="w-full justify-start rounded-xl"
              disabled={busyAction !== null}
              onClick={() => void handleWorkspaceSync()}
            >
              <FolderSync className="h-3.5 w-3.5" aria-hidden="true" />
              {t('ai.projects.wiki.actions.syncWorkspace')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="w-full justify-start rounded-xl"
              disabled={busyAction !== null}
              onClick={() => void handleCommitWiki()}
            >
              <GitCommit className="h-3.5 w-3.5" aria-hidden="true" />
              {t('ai.projects.wiki.actions.commitWiki')}
            </Button>
          </div>
        </div>

        {activePage && readOutline.length > 0 && editMode === 'read' && (
          <div className="border-t border-outline-variant/20 pt-3 space-y-1.5">
            <div className="text-label-sm font-semibold text-on-surface-variant">
              {t('ai.projects.wiki.outlineTitle')}
            </div>
            <ul className="space-y-1">
              {readOutline.map((item, idx) => (
                <li
                  key={`${item.text}-${idx}`}
                  className={item.level >= 3 ? 'pl-3 text-on-surface-variant' : 'text-on-surface-variant'}
                >
                  {item.text}
                </li>
              ))}
            </ul>
          </div>
        )}

        {editMode === 'docs' && docOutline.length > 0 && (
          <div className="border-t border-outline-variant/20 pt-3 space-y-1.5">
            <div className="text-label-sm font-semibold text-on-surface-variant">
              {t('ai.projects.wiki.outlineTitle')}
            </div>
            <ul className="space-y-1">
              {docOutline.map((entry) => (
                <li key={entry.pos}>
                  <button
                    type="button"
                    onClick={() => outlineJumpRef.current?.(entry.pos)}
                    className="w-full truncate rounded text-left text-on-surface-variant hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    {entry.text}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {activePage && activePage.source_files.length > 0 && (
          <div className="border-t border-outline-variant/20 pt-3 space-y-1.5">
            <div className="text-label-sm font-semibold text-on-surface-variant">
              {t('ai.projects.wiki.linkedSources')}
            </div>
            <div className="space-y-1">
              {activePage.source_files.map((src) => (
                <button
                  key={src}
                  type="button"
                  onClick={() => onOpenSourceFile(src)}
                  className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left text-on-surface-variant hover:bg-surface-container-high/50 hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <FileCode2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate font-mono">{src}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </aside>
    </div>
  )
}
