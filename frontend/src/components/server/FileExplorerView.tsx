import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowDownUp,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  FileArchive,
  FileCog,
  FileText,
  Folder,
  FolderOpen,
  MoreHorizontal,
  PackageOpen,
  ScrollText,
  Search,
  Upload,
} from 'lucide-react'
import { ActionMenu, Button, Input, Spinner, type ActionMenuItem } from '@maunting/ui'
import { formatBytes, formatZeitpunkt } from '@/lib/format'
import { fileName, joinPath } from './fileHelpers'
import type { ContentMatch, EditorTab, FileEntry, SearchResult } from './fileWorkspaceTypes'

export type FileCategoryFilter = 'all' | 'config' | 'logs' | 'archives' | 'database'
type SortKey = 'name' | 'size' | 'modified'
type SortDirection = 'asc' | 'desc'

const PAGE_SIZE = 40

interface FileExplorerViewProps {
  currentPath: string
  entries: FileEntry[]
  loading: boolean
  searchQuery: string
  searchMode: 'name' | 'content'
  searchResults: SearchResult[] | null
  contentMatches: ContentMatch[] | null
  searchTruncated: boolean
  canWrite: boolean
  openTabs: EditorTab[]
  uploads: Array<{ id: string; name: string; fraction: number; status: string }>
  isArchive: (name: string) => boolean
  onSearchQueryChange: (query: string) => void
  onSearchModeChange: (mode: 'name' | 'content') => void
  onEnterDirectory: (path: string) => void
  onOpenFile: (path: string) => void
  onResumeTab: (path: string) => void
  onContextMenu: (event: React.MouseEvent, entry: FileEntry, parent: string) => void
  onDragStart: (event: React.DragEvent, entry: FileEntry, parent: string) => void
  onDropFolder: (event: React.DragEvent, entry: FileEntry, parent: string) => void
  actionItemsForEntry: (entry: FileEntry, parent: string) => ActionMenuItem[]
  onDownloadEntry: (entry: FileEntry, parent: string) => void
  onExtractEntry: (entry: FileEntry, parent: string) => void
  onUploadClick: () => void
}

type FileKind = 'folder' | 'config' | 'logs' | 'archives' | 'database' | 'other'

function classifyEntry(entry: FileEntry): FileKind {
  if (entry.is_dir) return 'folder'
  const lower = entry.name.toLowerCase()
  if (
    lower.endsWith('.json') ||
    lower.endsWith('.yaml') ||
    lower.endsWith('.yml') ||
    lower.endsWith('.toml') ||
    lower.endsWith('.ini') ||
    lower.endsWith('.cfg') ||
    lower.endsWith('.conf') ||
    lower.endsWith('.properties') ||
    lower.endsWith('.env') ||
    lower.endsWith('.xml') ||
    lower.endsWith('.txt')
  ) {
    return 'config'
  }
  if (lower.endsWith('.log') || /\.log\.\d+/.test(lower)) return 'logs'
  if (
    lower.endsWith('.zip') ||
    lower.endsWith('.tar') ||
    lower.endsWith('.gz') ||
    lower.endsWith('.tgz') ||
    lower.endsWith('.tar.gz') ||
    lower.endsWith('.bz2') ||
    lower.endsWith('.xz')
  ) {
    return 'archives'
  }
  if (
    lower.endsWith('.db') ||
    lower.endsWith('.sqlite') ||
    lower.endsWith('.sqlite3') ||
    lower.endsWith('.db3')
  ) {
    return 'database'
  }
  return 'other'
}

const KIND_ICON_CLASS: Record<FileKind, string> = {
  folder: 'text-secondary',
  config: 'text-status-success',
  logs: 'text-primary',
  archives: 'text-status-warning',
  database: 'text-secondary',
  other: 'text-on-surface-variant',
}

function EntryIcon({ kind }: { kind: FileKind }) {
  const cls = `h-4 w-4 shrink-0 ${KIND_ICON_CLASS[kind]}`
  switch (kind) {
    case 'folder':
      return <Folder className={cls} aria-hidden="true" />
    case 'config':
      return <FileCog className={cls} aria-hidden="true" />
    case 'logs':
      return <ScrollText className={cls} aria-hidden="true" />
    case 'archives':
      return <FileArchive className={cls} aria-hidden="true" />
    case 'database':
      return <Database className={cls} aria-hidden="true" />
    default:
      return <FileText className={cls} aria-hidden="true" />
  }
}

/**
 * Vollflächiger Verwaltungs-Explorer als Standardansicht des Dateimanagers:
 * Bietet Schnellfilter für Konfigurationsdateien, Logs, Archive und Datenbanken,
 * direktes Öffnen im Editor, Kontextmenü sowie Drag-&-Drop-Upload ohne IDE-Überladung.
 */
export function FileExplorerView({
  currentPath,
  entries,
  loading,
  searchQuery,
  searchMode,
  searchResults,
  contentMatches,
  searchTruncated,
  canWrite,
  openTabs,
  uploads,
  isArchive,
  onSearchQueryChange,
  onSearchModeChange,
  onEnterDirectory,
  onOpenFile,
  onResumeTab,
  onContextMenu,
  onDragStart,
  onDropFolder,
  actionItemsForEntry,
  onDownloadEntry,
  onExtractEntry,
  onUploadClick,
}: FileExplorerViewProps) {
  const { t, i18n } = useTranslation()
  const [category, setCategory] = useState<FileCategoryFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDirection>('asc')
  const [page, setPage] = useState(1)

  useEffect(() => {
    setPage(1)
  }, [currentPath, category, sortKey, sortDir])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'name' ? 'asc' : 'desc')
    }
  }

  const visibleEntries = useMemo(() => {
    const filtered = category === 'all'
      ? entries
      : entries.filter((entry) => classifyEntry(entry) === category)

    return [...filtered].sort((a, b) => {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1
      let cmp = 0
      if (sortKey === 'name') {
        cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      } else if (sortKey === 'size') {
        cmp = (a.size ?? 0) - (b.size ?? 0)
      } else {
        cmp = (a.modified ?? 0) - (b.modified ?? 0)
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [category, entries, sortDir, sortKey])

  const totalPages = Math.max(1, Math.ceil(visibleEntries.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pagedEntries = useMemo(
    () => visibleEntries.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [currentPage, visibleEntries],
  )
  const pageFrom = visibleEntries.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1
  const pageTo = Math.min(currentPage * PAGE_SIZE, visibleEntries.length)

  const kindLabel = (kind: FileKind): string | null => {
    switch (kind) {
      case 'folder':
        return t('files.folderBadge')
      case 'config':
        return t('files.configBadge')
      case 'logs':
        return t('files.logBadge')
      case 'archives':
        return t('files.archiveBadge')
      case 'database':
        return t('files.databaseBadge')
      default:
        return null
    }
  }

  const filterButtons: Array<{ key: FileCategoryFilter; label: string }> = [
    { key: 'all', label: t('files.filterAll') },
    { key: 'config', label: t('files.filterConfig') },
    { key: 'logs', label: t('files.filterLogs') },
    { key: 'archives', label: t('files.filterArchives') },
    { key: 'database', label: t('files.filterDatabase') },
  ]

  const isSearching = searchQuery.trim().length > 0 && (searchResults !== null || contentMatches !== null)

  return (
    <div className="space-y-3 p-3 sm:p-4">
      {/* Offene Editor-Tabs als schnelle Rückkehr-Leiste */}
      {openTabs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-outline-variant/80 bg-surface-container-low/75 px-3 py-2">
          <span className="text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">
            {t('files.openFiles')}:
          </span>
          {openTabs.map((tab) => (
            <button
              key={tab.path}
              type="button"
              onClick={() => onResumeTab(tab.path)}
              className="inline-flex min-h-[44px] sm:min-h-[34px] max-w-full items-center gap-1.5 rounded-full border border-outline bg-surface-container-high px-3 text-xs font-mono text-on-surface hover:border-secondary hover:text-primary transition-colors"
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-secondary" aria-hidden="true" />
              <span className="truncate max-w-[12rem]">{fileName(tab.path)}</span>
              {tab.saveState === 'dirty' && (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-status-warning" aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
      )}

      {/* Suchleiste & Kategorie-Filter */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('files.typeColumn')}>
          {filterButtons.map((btn) => {
            const active = category === btn.key
            return (
              <button
                key={btn.key}
                type="button"
                aria-pressed={active}
                onClick={() => setCategory(btn.key)}
                className={`inline-flex min-h-[44px] sm:min-h-[34px] items-center rounded-full border px-3 text-xs font-medium transition-colors ${
                  active
                    ? 'border-secondary bg-secondary/15 text-primary'
                    : 'border-outline bg-surface-container-low/70 text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {btn.label}
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-2 min-w-0 lg:w-96">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 text-on-surface-variant"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              placeholder={searchMode === 'content' ? t('files.searchContentPlaceholder') : t('files.searchPlaceholder')}
              aria-label={searchMode === 'content' ? t('files.searchContentPlaceholder') : t('files.searchPlaceholder')}
              className="pl-8 text-xs max-md:h-11"
            />
          </div>
          <div
            role="group"
            aria-label={t('files.searchMode')}
            className="flex shrink-0 overflow-hidden rounded-lg border border-outline-variant"
          >
            {(['name', 'content'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={searchMode === mode}
                onClick={() => onSearchModeChange(mode)}
                className={`min-h-[44px] sm:min-h-[36px] px-2.5 text-label-sm ${
                  searchMode === mode
                    ? 'bg-secondary text-on-secondary'
                    : 'text-on-surface-variant hover:bg-surface-container-highest'
                }`}
              >
                {mode === 'name' ? t('common.name') : t('files.searchByContent')}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Laufende Uploads */}
      {uploads.length > 0 && (
        <div className="rounded-lg border border-outline-variant bg-surface-container-low/80 p-3 space-y-2">
          {uploads.map((job) => (
            <div key={job.id}>
              <div className="flex justify-between gap-2 text-label-sm">
                <span className="truncate font-mono">{job.name}</span>
                <span className={job.status === 'error' ? 'text-status-destructive' : 'text-on-surface-variant'}>
                  {job.status === 'error' ? t('common.error') : `${Math.round(job.fraction * 100)}%`}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-container-highest">
                <div
                  className={`h-full transition-all ${job.status === 'error' ? 'bg-status-destructive' : 'bg-secondary'}`}
                  style={{ width: `${job.fraction * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Suchtreffer oder Dateitabelle (begrenzte Scroll-Höhe + Sticky-Kopf + Seitenblättern) */}
      {isSearching ? (
        <div className="rounded-xl border border-outline-variant/80 bg-surface-container-low/60 divide-y divide-outline/60 max-h-[min(460px,55dvh)] overflow-y-auto">
          {contentMatches !== null ? (
            contentMatches.length === 0 ? (
              <p className="p-8 text-center text-sm text-on-surface-variant">{t('files.searchEmpty')}</p>
            ) : (
              contentMatches.map((match) => (
                <button
                  key={`${match.path}:${match.line}`}
                  type="button"
                  onClick={() => onOpenFile(match.path)}
                  className="flex w-full min-h-[44px] items-start justify-between gap-3 px-4 py-2.5 text-left hover:bg-surface-container-high/70 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-primary truncate">{match.path}</p>
                    <p className="mt-0.5 font-mono text-xs text-on-surface-variant truncate">{match.text}</p>
                  </div>
                  <span className="shrink-0 font-mono text-label-sm text-on-surface-variant">
                    L{match.line}
                  </span>
                </button>
              ))
            )
          ) : searchResults !== null ? (
            searchResults.length === 0 ? (
              <p className="p-8 text-center text-sm text-on-surface-variant">{t('files.searchEmpty')}</p>
            ) : (
              searchResults.map((result) => (
                <button
                  key={result.path}
                  type="button"
                  onClick={() => (result.is_dir ? onEnterDirectory(result.path) : onOpenFile(result.path))}
                  className="flex w-full min-h-[44px] items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-container-high/70 transition-colors"
                >
                  {result.is_dir ? (
                    <Folder className="h-4 w-4 shrink-0 text-secondary" aria-hidden="true" />
                  ) : (
                    <FileText className="h-4 w-4 shrink-0 text-on-surface-variant" aria-hidden="true" />
                  )}
                  <span className="font-mono text-xs text-on-surface truncate">{result.path}</span>
                </button>
              ))
            )
          ) : null}
          {searchTruncated && (
            <p className="px-4 py-2 text-xs text-on-surface-variant">{t('files.searchTruncated')}</p>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          <div
            role="region"
            aria-label={t('files.serverFiles')}
            tabIndex={0}
            className="@container rounded-xl border border-outline-variant/80 bg-surface-container-low/60 max-h-[min(520px,62dvh)] overflow-auto"
          >
            {loading && entries.length === 0 ? (
              <div className="flex items-center justify-center p-12">
                <Spinner size="md" className="text-secondary" />
              </div>
            ) : visibleEntries.length === 0 ? (
              <div className="p-10 text-center space-y-2">
                <FolderOpen className="mx-auto h-8 w-8 text-on-surface-variant/60" aria-hidden="true" />
                <p className="text-sm text-on-surface-variant">
                  {entries.length === 0 ? t('files.empty') : t('files.filterNoMatches')}
                </p>
              </div>
            ) : (
              <table className="w-full border-collapse text-left">
                <thead className="hidden @md:table-header-group sticky top-0 z-10 border-b border-outline-variant/80 bg-surface-container-low/95 backdrop-blur-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
                  <tr>
                    <th
                      scope="col"
                      aria-sort={sortKey === 'name' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      className="py-2.5 pl-4 pr-2 font-semibold"
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort('name')}
                        aria-label={t('files.sortByName')}
                        className="inline-flex items-center gap-1 hover:text-on-surface"
                      >
                        <span>{t('files.nameColumn')}</span>
                        <ArrowDownUp className="h-3 w-3 opacity-60" aria-hidden="true" />
                      </button>
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-semibold w-28">
                      {t('files.typeColumn')}
                    </th>
                    <th
                      scope="col"
                      aria-sort={sortKey === 'size' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      className="px-3 py-2.5 font-semibold w-28"
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort('size')}
                        aria-label={t('files.sortBySize')}
                        className="inline-flex items-center gap-1 hover:text-on-surface"
                      >
                        <span>{t('files.size')}</span>
                        <ArrowDownUp className="h-3 w-3 opacity-60" aria-hidden="true" />
                      </button>
                    </th>
                    <th
                      scope="col"
                      aria-sort={sortKey === 'modified' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      className="px-3 py-2.5 font-semibold w-44"
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort('modified')}
                        aria-label={t('files.sortByModified')}
                        className="inline-flex items-center gap-1 hover:text-on-surface"
                      >
                        <span>{t('files.modified')}</span>
                        <ArrowDownUp className="h-3 w-3 opacity-60" aria-hidden="true" />
                      </button>
                    </th>
                    <th scope="col" className="py-2.5 pl-2 pr-4 text-right font-semibold w-24">
                      {t('files.actionsColumn')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline/50">
                  {pagedEntries.map((entry) => {
                    const fullPath = joinPath(currentPath, entry.name)
                    const kind = classifyEntry(entry)
                    const badge = kindLabel(kind)
                    const rowMenuItems = actionItemsForEntry(entry, currentPath)

                    return (
                      <tr
                        key={entry.name}
                        draggable={canWrite}
                        onDragStart={(event) => onDragStart(event, entry, currentPath)}
                        onDragOver={(event) => {
                          if (entry.is_dir && canWrite) event.preventDefault()
                        }}
                        onDrop={(event) => {
                          if (entry.is_dir) void onDropFolder(event, entry, currentPath)
                        }}
                        onContextMenu={(event) => onContextMenu(event, entry, currentPath)}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 @md:table-row @md:p-0 hover:bg-surface-container-high/55 transition-colors"
                      >
                        <td className="min-w-0 flex-1 @md:py-2 @md:pl-4 @md:pr-2">
                          <button
                            type="button"
                            onClick={() => (entry.is_dir ? onEnterDirectory(fullPath) : onOpenFile(fullPath))}
                            className="flex min-h-[44px] @md:min-h-[34px] w-full items-center gap-2.5 text-left group"
                          >
                            <EntryIcon kind={kind} />
                            <span className="truncate font-mono text-xs text-on-surface group-hover:text-primary">
                              {entry.name}
                            </span>
                          </button>
                        </td>
                        <td className="hidden @md:table-cell px-3 py-2">
                          {badge ? (
                            <span className="inline-flex items-center rounded-full border border-outline/70 bg-surface-container-high/70 px-2 py-0.5 text-label-sm text-on-surface-variant">
                              {badge}
                            </span>
                          ) : (
                            <span className="text-xs text-on-surface-variant">—</span>
                          )}
                        </td>
                        <td className="text-xs font-mono text-on-surface-variant @md:px-3 @md:py-2">
                          {entry.is_dir ? '—' : formatBytes(entry.size)}
                        </td>
                        <td className="hidden @md:table-cell px-3 py-2 text-xs text-on-surface-variant">
                          {entry.modified ? formatZeitpunkt(entry.modified * 1000, i18n.language) : t('files.notAvailable')}
                        </td>
                        <td className="flex items-center justify-end gap-1 @md:table-cell @md:py-1.5 @md:pl-2 @md:pr-4 @md:text-right">
                          <div className="inline-flex items-center justify-end gap-1">
                            {!entry.is_dir && canWrite && isArchive(entry.name) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                type="button"
                                onClick={() => onExtractEntry(entry, currentPath)}
                                aria-label={`${t('files.extract')}: ${entry.name}`}
                                className="min-h-[44px] min-w-[44px] @md:min-h-[32px] @md:min-w-[32px]"
                              >
                                <PackageOpen className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            )}
                            {!entry.is_dir && (
                              <Button
                                variant="ghost"
                                size="sm"
                                type="button"
                                onClick={() => onDownloadEntry(entry, currentPath)}
                                aria-label={`${t('files.download')}: ${entry.name}`}
                                className="min-h-[44px] min-w-[44px] @md:min-h-[32px] @md:min-w-[32px]"
                              >
                                <Download className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            )}
                            {rowMenuItems.length > 0 && (
                              <ActionMenu
                                label={t('files.more')}
                                ariaLabel={`${t('files.more')}: ${entry.name}`}
                                icon={<MoreHorizontal className="h-4 w-4 shrink-0" aria-hidden="true" />}
                                items={rowMenuItems}
                                variant="ghost"
                                surface="dna"
                                align="end"
                                compact
                                iconOnly
                              />
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

          {visibleEntries.length > PAGE_SIZE && (
            <nav
              aria-label={t('files.serverFiles')}
              className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-on-surface-variant"
            >
              <span>
                {t('files.pageRange', { from: pageFrom, to: pageTo, total: visibleEntries.length })}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  fingerziel
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="inline-flex items-center gap-1 disabled:opacity-45"
                >
                  <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{t('common.back')}</span>
                </Button>
                <span className="font-mono px-1">
                  {currentPage} / {totalPages}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  fingerziel
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="inline-flex items-center gap-1 disabled:opacity-45"
                >
                  <span>{t('common.next')}</span>
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </div>
            </nav>
          )}
        </div>
      )}

      {/* Upload-Fußzeile / Schnell-Ablage */}
      {canWrite && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-outline-variant bg-surface-container-low/40 px-4 py-2.5 text-xs text-on-surface-variant">
          <span className="inline-flex items-center gap-2">
            <Upload className="h-4 w-4 text-secondary" aria-hidden="true" />
            <span>{t('files.dropzoneHint')}</span>
          </span>
          <Button variant="secondary" size="sm" fingerziel type="button" onClick={onUploadClick} className="min-h-[44px] sm:min-h-[32px]">
            {t('files.upload')}
          </Button>
        </div>
      )}
    </div>
  )
}
