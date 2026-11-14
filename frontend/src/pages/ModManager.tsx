import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FolderArchive,
  Globe,
  GripVertical,
  HardDrive,
  Layers,
  LayoutGrid,
  List,
  MoreHorizontal,
  Package,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Star,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react'
import { api } from '@/api/client'
import { oeffneBrowser } from '@/desktop/tauri'
import { toast } from '@/stores/toastStore'
import { confirm } from '@/stores/confirmStore'
import { getModInstallPresentation, hasActiveModInstall } from '@/services/modInstallStatus'
import {
  ActionMenu,
  Badge,
  Button,
  buttonClasses,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Dropdown,
  Kurzinfo,
  Pagination,
  ProgressBar,
  Switch,
} from '@maunting/ui'
interface Mod {
  id: number
  server_id: number
  workshop_id: string
  name: string | null
  last_updated: string | null
  installed_version: number | null
  load_order: number | null
  enabled: boolean
  dependencies_json: string | null
  install_status: string
  install_action: string | null
  install_progress: number | null
  install_eta_seconds: number | null
  install_started_at: string | null
  install_completed_at: string | null
  install_error: string | null
  update_status: string
  update_reason: string | null
  update_checked_at: string | null
}

interface SteamMod {
  publishedfileid: string
  title: string
  description: string
  creator: string
  file_size_mb: number
  subscriptions: number
  favorites: number
  preview_url: string | null
  direct_url: string
  tags?: string[]
  last_updated?: string
  updated?: string
  item_type?: 'mod' | 'collection' | 'modpack'
  children_count?: number
  class_id?: number | null
  has_server_pack?: boolean
  server_pack_file_id?: number | null
  main_file_id?: number | null
  allow_mod_distribution?: boolean
  is_modpack?: boolean
  manifest_file_id?: number | null
  dependencies_count?: number
}

interface CurseForgeClassOption {
  id: number
  name: string
  slug: string
  icon_url?: string | null
  kind: string
}

interface CurseForgeCategoryRaw {
  id: number
  name: string
  slug?: string
  isClass?: boolean
  classId?: number
  parentCategoryId?: number
}

interface GameFilterOption {
  id: string
  name: string
}

interface InstalledModMeta {
  provider?: string
  title?: string
  description?: string
  creator?: string
  preview_url?: string | null
  direct_url?: string
  file_size?: number
  file_size_mb?: number
  tags?: string[]
  subscriptions?: number
  updated?: string | null
}

type LibraryFilter = 'all' | 'installed' | 'updates' | 'not_installed'
type ViewMode = 'grid' | 'list'

interface CollectionPreviewState {
  open: boolean
  loading: boolean
  source: 'steam_collection' | 'curseforge_manifest'
  title: string
  description?: string
  creator?: string
  directUrl?: string
  items: SteamMod[]
  unavailableIds: string[]
  wrongGameIds: string[]
  selectedIds: Set<string>
  installing: boolean
}

interface BundleFileSummary {
  id: number
  display_name: string
  file_name: string
  file_date?: string
  file_length: number
  is_server_pack?: boolean
  game_versions?: string[]
}

interface CurseForgeBundlePreviewState {
  open: boolean
  loading: boolean
  mod: SteamMod | null
  files: BundleFileSummary[]
  dependencies: SteamMod[]
  includeDependencies: boolean
  supportsBundleInstall: boolean
  installing: boolean
}

interface DependencyPromptState {
  open: boolean
  targetMod: {
    workshopId: string
    title: string
    creator?: string
    preview_url?: string | null
    direct_url?: string
  } | null
  dependencies: SteamMod[]
  unavailableIds: string[]
  selectedIds: Set<string>
  installing: boolean
  installingSingleId: string | null
}

type BrowserTab = 'trending' | 'popular' | 'newest' | 'updated'

const BROWSER_PAGE_SIZE = 24
const INSTALLED_PAGE_SIZE = 25

interface ModManagerProps {
  serverId: number
  gameInfo?: {
    id: string
    name: string
    mod_support?: boolean
    supports_steam_workshop?: boolean
    supports_curseforge?: boolean
    mod_provider?: 'steam' | 'curseforge' | null
    curseforge_game_id?: string | null
    curseforge_class_id?: string | null
    supports_modpacks?: boolean
  }
}

type BrowserCache = Record<string, { mods: SteamMod[]; page: number; hasMore: boolean }>

export function ModManager({ serverId, gameInfo }: ModManagerProps) {
  const { t } = useTranslation()
  const [mods, setMods] = useState<Mod[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [newWorkshopId, setNewWorkshopId] = useState('')
  const [newModName, setNewModName] = useState('')
  const [adding, setAdding] = useState(false)
  const [reinstallingAll, setReinstallingAll] = useState(false)
  const [selectedModIds, setSelectedModIds] = useState<Set<number>>(new Set())
  const [bulkActionLoading, setBulkActionLoading] = useState<'update' | 'reinstall' | 'delete' | 'deleteAll' | null>(null)
  const lastSelectedModIdRef = useRef<number | null>(null)
  const shiftSelectPendingRef = useRef(false)
  const [pointerDragActiveId, setPointerDragActiveId] = useState<number | null>(null)
  const [pointerDropTargetId, setPointerDropTargetId] = useState<number | null>(null)
  const [dragSlotPitch, setDragSlotPitch] = useState(0)
  const [settledModId, setSettledModId] = useState<number | null>(null)
  const modsListRef = useRef<HTMLDivElement | null>(null)
  const pendingFlipRectsRef = useRef<Map<number, { top: number; left: number }> | null>(null)
  const lastReorderedIdRef = useRef<number | null>(null)
  const settledTimerRef = useRef<number | null>(null)
  const pointerDragMetaRef = useRef<{
    modId: number
    pointerId: number | undefined
    handleEl: HTMLElement | null
    rowEl: HTMLElement | null
    startClientX: number
    startClientY: number
    containerTop0: number
    slotPitch: number
    rows: Array<{ id: number; index: number; relTop: number; relBottom: number; midY: number; height: number }>
    hasRealLayout: boolean
    lastClientX: number
    lastClientY: number
    targetId: number
  } | null>(null)

  const isCurseForge = Boolean(gameInfo?.supports_curseforge || gameInfo?.mod_provider === 'curseforge')
  const supportsModpacks = isCurseForge && Boolean(gameInfo?.supports_modpacks ?? true)
  const providerLabel = isCurseForge ? 'CurseForge' : 'Steam Workshop'
  const ansehenText = isCurseForge ? t('mods.viewInCurseForge', { defaultValue: 'Auf CurseForge anzeigen' }) : t('mods.viewInWorkshop')

  // Workshop / CurseForge Browser (inline section)
  const [steamQuery, setSteamQuery] = useState('')
  const [steamResults, setSteamResults] = useState<SteamMod[]>([])
  const [steamPage, setSteamPage] = useState(1)
  const [steamHasMore, setSteamHasMore] = useState(false)
  const [steamLoading, setSteamLoading] = useState(false)
  const [browserTab, setBrowserTab] = useState<BrowserTab>('trending')
  const [steamContentType, setSteamContentType] = useState<'mods' | 'collections'>('mods')
  const [contentType, setContentType] = useState<string>('all')
  const [curseforgeClasses, setCurseforgeClasses] = useState<CurseForgeClassOption[]>([])
  const [curseforgeCategories, setCurseforgeCategories] = useState<GameFilterOption[]>([])
  const [steamFilterTags, setSteamFilterTags] = useState<GameFilterOption[]>([])
  const [selectedGameFilter, setSelectedGameFilter] = useState<string>('')
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>('all')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [browserPage, setBrowserPage] = useState(1)
  const [installedLibraryPage, setInstalledLibraryPage] = useState(1)
  const [modMetadata, setModMetadata] = useState<Record<string, InstalledModMeta>>({})
  const [installBarExpanded, setInstallBarExpanded] = useState(false)
  const [mobileSection, setMobileSection] = useState<'library' | 'active'>('library')
  const [curseforgeUrlMap, setCurseforgeUrlMap] = useState<Record<string, string>>({})
  // Cache pro Tab+Filter+Seite — verhindert Re-Fetch bei Seiten-/Tab-Wechsel.
  const [browserCache, setBrowserCache] = useState<BrowserCache>({})
  const [browserLoading, setBrowserLoading] = useState(false)
  const [installedShown, setInstalledShown] = useState(INSTALLED_PAGE_SIZE)
  const [collectionPreview, setCollectionPreview] = useState<CollectionPreviewState>({
    open: false,
    loading: false,
    source: 'steam_collection',
    title: '',
    items: [],
    unavailableIds: [],
    wrongGameIds: [],
    selectedIds: new Set(),
    installing: false,
  })
  const [bundlePreview, setBundlePreview] = useState<CurseForgeBundlePreviewState>({
    open: false,
    loading: false,
    mod: null,
    files: [],
    dependencies: [],
    includeDependencies: true,
    supportsBundleInstall: true,
    installing: false,
  })
  const [checkingDepModId, setCheckingDepModId] = useState<string | null>(null)
  const [dependencyPrompt, setDependencyPrompt] = useState<DependencyPromptState>({
    open: false,
    targetMod: null,
    dependencies: [],
    unavailableIds: [],
    selectedIds: new Set(),
    installing: false,
    installingSingleId: null,
  })
  const [importingManifest, setImportingManifest] = useState(false)
  const manifestInputRef = useRef<HTMLInputElement | null>(null)

  // Drag & drop fuer Load-Order
  const dragId = useRef<number | null>(null)

  const loadMods = useCallback(
    async (options?: { silent?: boolean }) => {
      try {
        const data = await api<Mod[]>(`/mods/${serverId}`)
        setMods(data)
      } catch (err: unknown) {
        if (!options?.silent) {
          toast.error(err instanceof Error ? err.message : t('mods.loadError'))
        }
      } finally {
        if (!options?.silent) {
          setLoading(false)
        }
      }
    },
    [serverId, t],
  )

  useEffect(() => {
    setLoading(true)
    void loadMods()
  }, [loadMods])

  useEffect(() => {
    const existingIds = new Set(mods.map((m) => m.id))
    setSelectedModIds((prev) => {
      let changed = false
      const next = new Set<number>()
      for (const id of prev) {
        if (existingIds.has(id)) {
          next.add(id)
        } else {
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [mods])

  useEffect(() => {
    if (!mods.some(hasActiveModInstall)) return
    const intervalId = window.setInterval(() => {
      void loadMods({ silent: true })
    }, 2500)
    return () => window.clearInterval(intervalId)
  }, [loadMods, mods])

  const modIdsSignature = mods.map((m) => m.workshop_id).sort().join(',')

  useEffect(() => {
    if (!modIdsSignature) {
      setModMetadata({})
      return
    }
    let cancelled = false
    api<Record<string, InstalledModMeta>>(`/mods/${serverId}/metadata`)
      .then((meta) => {
        if (!cancelled && meta && typeof meta === 'object' && !Array.isArray(meta)) {
          setModMetadata(meta)
        }
      })
      .catch(() => {
        // Metadaten sind rein anreichernd; kein Fehler-Toast beim Polling nötig.
      })
    return () => {
      cancelled = true
    }
  }, [modIdsSignature, serverId])

  useEffect(() => {
    setSelectedGameFilter('')
    if (!isCurseForge) {
      setCurseforgeClasses([])
      setCurseforgeCategories([])
      let cancelled = false
      api<{ tags?: GameFilterOption[] }>(`/steam/workshop/filters?server_id=${serverId}`)
        .then((res) => {
          if (!cancelled && res && !Array.isArray(res) && Array.isArray(res.tags)) {
            setSteamFilterTags(res.tags.filter((item) => item?.id && item?.name))
          }
        })
        .catch(() => {
          if (!cancelled) setSteamFilterTags([])
        })
      return () => {
        cancelled = true
      }
    }
    setSteamFilterTags([])
    let cancelled = false
    api<CurseForgeClassOption[]>(`/curseforge/classes?server_id=${serverId}`)
      .then((classes) => {
        if (!cancelled && Array.isArray(classes)) {
          setCurseforgeClasses(classes)
        }
      })
      .catch(() => {
        if (!cancelled) setCurseforgeClasses([])
      })
    api<CurseForgeCategoryRaw[]>(`/curseforge/categories?server_id=${serverId}`)
      .then((categories) => {
        if (!cancelled && Array.isArray(categories)) {
          const seen = new Set<string>()
          const opts: GameFilterOption[] = []
          for (const cat of categories) {
            if (!cat || cat.isClass || !cat.id || !cat.name) continue
            const idStr = String(cat.id)
            if (seen.has(idStr)) continue
            seen.add(idStr)
            opts.push({ id: idStr, name: cat.name })
          }
          opts.sort((a, b) => a.name.localeCompare(b.name))
          setCurseforgeCategories(opts)
        }
      })
      .catch(() => {
        if (!cancelled) setCurseforgeCategories([])
      })
    return () => {
      cancelled = true
    }
  }, [isCurseForge, serverId])

  useEffect(() => {
    if (searchActive && steamQuery.trim()) {
      void searchSteam(1, false, contentType, steamContentType, browserTab, selectedGameFilter)
    } else {
      void loadBrowserTab(browserTab, 1, false, contentType, steamContentType, selectedGameFilter)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browserTab, isCurseForge, contentType, steamContentType, selectedGameFilter])

  const buildCurseForgeClassParam = (typeFilter: string): string => {
    if (!isCurseForge) return ''
    if (typeFilter === 'all') {
      return supportsModpacks || curseforgeClasses.length > 0
        ? '&class_id=all'
        : gameInfo?.curseforge_class_id
          ? `&class_id=${gameInfo.curseforge_class_id}`
          : ''
    }
    if (typeFilter === 'mods') {
      return `&class_id=${gameInfo?.curseforge_class_id || 'mods'}`
    }
    return `&class_id=${encodeURIComponent(typeFilter)}`
  }

  const getBrowserCacheKey = (
    tab: BrowserTab,
    page: number,
    typeFilter: string,
    steamType: 'mods' | 'collections',
    gameFilter: string,
  ) => `${tab}::${typeFilter}::${steamType}::${gameFilter}::p${page}`

  const buildGameFilterParam = (gameFilter: string, steamType: 'mods' | 'collections'): string => {
    if (!gameFilter) return ''
    if (isCurseForge) {
      return `&category_id=${encodeURIComponent(gameFilter)}`
    }
    if (steamType === 'collections') return ''
    return `&tags=${encodeURIComponent(gameFilter)}`
  }

  const cacheCurseForgeUrls = (items: SteamMod[]) => {
    if (!isCurseForge || !items.length) return
    setCurseforgeUrlMap((prev) => {
      const next = { ...prev }
      let changed = false
      for (const item of items) {
        if (item.publishedfileid && item.direct_url && next[item.publishedfileid] !== item.direct_url) {
          next[item.publishedfileid] = item.direct_url
          changed = true
        }
      }
      return changed ? next : prev
    })
  }

  const resolveModPageUrl = (workshopId: string, title?: string | null, directUrl?: string | null): string => {
    if (directUrl) return directUrl
    if (modMetadata[workshopId]?.direct_url) return modMetadata[workshopId].direct_url
    if (isCurseForge) {
      return (
        curseforgeUrlMap[workshopId] ||
        `https://www.curseforge.com/search?search=${encodeURIComponent(title || workshopId)}`
      )
    }
    return `https://steamcommunity.com/sharedfiles/filedetails/?id=${workshopId}`
  }

  const openExternalUrl = async (url: string) => {
    try {
      await oeffneBrowser(url)
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }

  const loadBrowserTab = async (
    tab: BrowserTab,
    page: number,
    append: boolean,
    typeFilter: string = contentType,
    steamType: 'mods' | 'collections' = steamContentType,
    gameFilter: string = selectedGameFilter,
  ) => {
    const key = getBrowserCacheKey(tab, page, typeFilter, steamType, gameFilter)
    if (!append && browserCache[key]) {
      setBrowserPage(page)
      return
    }
    setBrowserLoading(true)
    try {
      const classParam = buildCurseForgeClassParam(typeFilter)
      const steamTypeParam = !isCurseForge && steamType === 'collections' ? '&content_type=collections' : ''
      const filterParam = buildGameFilterParam(gameFilter, steamType)
      const endpoint = isCurseForge
        ? `/curseforge/popular?server_id=${serverId}&sort=${tab}&limit=${BROWSER_PAGE_SIZE}&page=${page}${classParam}${filterParam}`
        : `/steam/workshop/popular?server_id=${serverId}&sort=${tab}&limit=${BROWSER_PAGE_SIZE}&page=${page}${steamTypeParam}${filterParam}`
      const data = await api<SteamMod[]>(endpoint)
      cacheCurseForgeUrls(data)
      setBrowserPage(page)
      setBrowserCache((prev) => ({
        ...prev,
        [key]: {
          mods: data,
          page,
          hasMore: data.length === BROWSER_PAGE_SIZE,
        },
      }))
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err))
      if (!append) {
        setBrowserCache((prev) => ({
          ...prev,
          [key]: { mods: [], page, hasMore: false },
        }))
      }
    } finally {
      setBrowserLoading(false)
    }
  }

  const switchTab = (tab: BrowserTab) => {
    setBrowserPage(1)
    setBrowserTab(tab)
  }

  const [searchActive, setSearchActive] = useState(false)

  const handleContentTypeChange = (newType: string) => {
    setContentType(newType)
    setBrowserPage(1)
    setBrowserCache({})
  }

  const handleSteamContentTypeChange = (newType: 'mods' | 'collections') => {
    setSteamContentType(newType)
    if (newType === 'collections') {
      setSelectedGameFilter('')
    }
    setBrowserPage(1)
    setBrowserCache({})
  }

  const handleGameFilterChange = (nextFilter: string) => {
    setSelectedGameFilter(nextFilter)
    setBrowserPage(1)
    setInstalledLibraryPage(1)
  }

  const searchSteam = async (
    page: number,
    append: boolean,
    typeFilter: string = contentType,
    steamType: 'mods' | 'collections' = steamContentType,
    sortTab: BrowserTab = browserTab,
    gameFilter: string = selectedGameFilter,
  ) => {
    if (!steamQuery.trim()) return
    setSteamLoading(true)
    try {
      const q = encodeURIComponent(steamQuery.trim())
      const classParam = buildCurseForgeClassParam(typeFilter)
      const steamTypeParam = !isCurseForge && steamType === 'collections' ? '&content_type=collections' : ''
      const filterParam = buildGameFilterParam(gameFilter, steamType)
      const endpoint = isCurseForge
        ? `/curseforge/search?server_id=${serverId}&query=${q}&per_page=${BROWSER_PAGE_SIZE}&page=${page}&sort=${sortTab}${classParam}${filterParam}`
        : `/steam/workshop/search?server_id=${serverId}&query=${q}&per_page=${BROWSER_PAGE_SIZE}&page=${page}&sort=${sortTab}${steamTypeParam}${filterParam}`
      const data = await api<SteamMod[]>(endpoint)
      cacheCurseForgeUrls(data)
      setSteamResults((prev) => (append ? [...prev, ...data] : data))
      setSteamPage(page)
      setSteamHasMore(data.length === BROWSER_PAGE_SIZE)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('mods.steamSearchError'))
    } finally {
      setSteamLoading(false)
    }
  }

  const runSearch = () => {
    if (!steamQuery.trim()) return
    if (libraryFilter === 'installed' || libraryFilter === 'updates') {
      setInstalledLibraryPage(1)
      return
    }
    setSearchActive(true)
    void searchSteam(1, false, contentType, steamContentType, browserTab, selectedGameFilter)
  }

  const clearSearch = () => {
    setSearchActive(false)
    setSteamResults([])
    setSteamQuery('')
    setSteamPage(1)
    setSteamHasMore(false)
    setInstalledLibraryPage(1)
  }

  const subscribeMod = async (workshopId: string, name?: string) => {
    const params = new URLSearchParams({ workshop_id: workshopId })
    if (name) params.set('name', name)
    await api<Mod>(`/mods/${serverId}?${params.toString()}`, { method: 'POST' })
  }

  const installBatchItems = async (items: Array<{ workshop_id: string; name?: string | null }>) => {
    if (items.length === 0) return
    const res = await api<{ ok: boolean; queued: number; skipped: number }>(
      `/mods/${serverId}/batch`,
      {
        method: 'POST',
        body: JSON.stringify({ items, skip_existing: true }),
      },
    )
    await loadMods()
    if (res.queued > 0) {
      toast.success(t('mods.batchInstallQueued', { count: res.queued }))
    }
    if (res.skipped > 0) {
      toast.info(t('mods.batchInstallSkipped', { count: res.skipped }))
    }
  }

  const openSteamCollectionPreview = async (collectionMod: SteamMod) => {
    setCollectionPreview({
      open: true,
      loading: true,
      source: 'steam_collection',
      title: collectionMod.title,
      description: collectionMod.description,
      creator: collectionMod.creator,
      directUrl: collectionMod.direct_url,
      items: [],
      unavailableIds: [],
      wrongGameIds: [],
      selectedIds: new Set(),
      installing: false,
    })
    try {
      const data = await api<{
        collection: SteamMod
        items: SteamMod[]
        unavailable_ids: string[]
      }>(`/steam/workshop/collection/${collectionMod.publishedfileid}?server_id=${serverId}`)
      const installedSet = new Set(mods.map((m) => m.workshop_id))
      const defaultSelected = new Set(
        data.items.filter((item) => !installedSet.has(item.publishedfileid)).map((item) => item.publishedfileid),
      )
      setCollectionPreview({
        open: true,
        loading: false,
        source: 'steam_collection',
        title: data.collection?.title || collectionMod.title,
        description: data.collection?.description || collectionMod.description,
        creator: data.collection?.creator || collectionMod.creator,
        directUrl: data.collection?.direct_url || collectionMod.direct_url,
        items: data.items || [],
        unavailableIds: data.unavailable_ids || [],
        wrongGameIds: [],
        selectedIds: defaultSelected,
        installing: false,
      })
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('mods.collectionLoadFailed'))
      setCollectionPreview((prev) => ({ ...prev, open: false, loading: false }))
    }
  }

  const installSelectedCollectionItems = async () => {
    const selected = collectionPreview.items.filter((item) =>
      collectionPreview.selectedIds.has(item.publishedfileid),
    )
    if (selected.length === 0) return
    setCollectionPreview((prev) => ({ ...prev, installing: true }))
    try {
      await installBatchItems(
        selected.map((item) => ({ workshop_id: item.publishedfileid, name: item.title })),
      )
      setCollectionPreview((prev) => ({ ...prev, open: false, installing: false }))
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('mods.batchInstallFailed'))
      setCollectionPreview((prev) => ({ ...prev, installing: false }))
    }
  }

  const openCurseForgeBundlePreview = async (mod: SteamMod) => {
    setBundlePreview({
      open: true,
      loading: true,
      mod,
      files: [],
      dependencies: [],
      includeDependencies: true,
      supportsBundleInstall: mod.allow_mod_distribution ?? true,
      installing: false,
    })
    try {
      const data = await api<{
        mod: SteamMod
        files: BundleFileSummary[]
        dependencies: SteamMod[]
        supports_bundle_install: boolean
      }>(`/curseforge/mod/${mod.publishedfileid}/bundle?server_id=${serverId}`)
      cacheCurseForgeUrls([data.mod, ...(data.dependencies || [])])
      setBundlePreview({
        open: true,
        loading: false,
        mod: data.mod || mod,
        files: data.files || [],
        dependencies: data.dependencies || [],
        includeDependencies: true,
        supportsBundleInstall: data.supports_bundle_install ?? true,
        installing: false,
      })
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('mods.loadError'))
      setBundlePreview((prev) => ({ ...prev, open: false, loading: false }))
    }
  }

  const installCurseForgeBundle = async () => {
    if (!bundlePreview.mod) return
    setBundlePreview((prev) => ({ ...prev, installing: true }))
    try {
      const batch: Array<{ workshop_id: string; name?: string | null }> = [
        { workshop_id: bundlePreview.mod.publishedfileid, name: bundlePreview.mod.title },
      ]
      if (bundlePreview.includeDependencies) {
        for (const dep of bundlePreview.dependencies) {
          batch.push({ workshop_id: dep.publishedfileid, name: dep.title })
        }
      }
      await installBatchItems(batch)
      setBundlePreview((prev) => ({ ...prev, open: false, installing: false }))
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('mods.addFailed'))
      setBundlePreview((prev) => ({ ...prev, installing: false }))
    }
  }

  const handleManifestFileSelected = async (file: File | undefined) => {
    if (!file) return
    setImportingManifest(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const data = await api<{
        pack_name: string
        pack_version: string
        author: string
        items: SteamMod[]
        unavailable_ids: string[]
        wrong_game_ids?: string[]
      }>(`/curseforge/parse-manifest?server_id=${serverId}`, {
        method: 'POST',
        body: formData,
      })
      cacheCurseForgeUrls(data.items || [])
      const installedSet = new Set(mods.map((m) => m.workshop_id))
      const defaultSelected = new Set(
        (data.items || [])
          .filter((item) => !installedSet.has(item.publishedfileid))
          .map((item) => item.publishedfileid),
      )
      setCollectionPreview({
        open: true,
        loading: false,
        source: 'curseforge_manifest',
        title: data.pack_name || file.name,
        description: data.pack_version ? `Version ${data.pack_version}` : undefined,
        creator: data.author || undefined,
        items: data.items || [],
        unavailableIds: data.unavailable_ids || [],
        wrongGameIds: data.wrong_game_ids || [],
        selectedIds: defaultSelected,
        installing: false,
      })
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('mods.importManifestFailed'))
    } finally {
      setImportingManifest(false)
      if (manifestInputRef.current) {
        manifestInputRef.current.value = ''
      }
    }
  }

  const requestModInstall = async (
    workshopId: string,
    modMeta?: Partial<SteamMod>,
    opts?: { fromAddModal?: boolean },
  ) => {
    const cleanId = workshopId.trim()
    if (!cleanId) return
    setAdding(true)
    setCheckingDepModId(cleanId)
    try {
      let resolvedTarget = {
        workshopId: cleanId,
        title: modMeta?.title || cleanId,
        creator: modMeta?.creator,
        preview_url: modMeta?.preview_url ?? null,
        direct_url: modMeta?.direct_url,
      }
      let resolvedDeps: SteamMod[] = []
      let unavailableIds: string[] = []

      if (/^\d{1,20}$/.test(cleanId)) {
        try {
          const endpoint = isCurseForge
            ? `/curseforge/mod/${cleanId}/dependencies?server_id=${serverId}`
            : `/steam/workshop/mod/${cleanId}/dependencies?server_id=${serverId}`
          const depData = await api<{
            mod?: SteamMod
            dependencies?: SteamMod[]
            unavailable_ids?: string[]
          }>(endpoint)
          if (depData?.mod) {
            resolvedTarget = {
              workshopId: cleanId,
              title: depData.mod.title || resolvedTarget.title,
              creator: depData.mod.creator || resolvedTarget.creator,
              preview_url: depData.mod.preview_url ?? resolvedTarget.preview_url,
              direct_url: depData.mod.direct_url || resolvedTarget.direct_url,
            }
            cacheCurseForgeUrls([depData.mod])
          }
          resolvedDeps = depData?.dependencies || []
          unavailableIds = depData?.unavailable_ids || []
          if (resolvedDeps.length > 0) {
            cacheCurseForgeUrls(resolvedDeps)
          }
        } catch {
          // Fallback auf direkte Installation, falls Metadaten-/Abhaengigkeitsabfrage nicht erreichbar ist
        }
      }

      const installedSet = new Set(mods.map((m) => m.workshop_id))
      const missingDeps = resolvedDeps.filter((dep) => !installedSet.has(dep.publishedfileid))

      if (missingDeps.length > 0) {
        if (opts?.fromAddModal) {
          setShowAddModal(false)
          setNewWorkshopId('')
          setNewModName('')
        }
        setDependencyPrompt({
          open: true,
          targetMod: resolvedTarget,
          dependencies: resolvedDeps,
          unavailableIds,
          selectedIds: new Set(missingDeps.map((dep) => dep.publishedfileid)),
          installing: false,
          installingSingleId: null,
        })
        return
      }

      await subscribeMod(cleanId, resolvedTarget.title === cleanId ? modMeta?.title : resolvedTarget.title)
      await loadMods()
      if (opts?.fromAddModal) {
        setShowAddModal(false)
        setNewWorkshopId('')
        setNewModName('')
      }
      toast.success(t('mods.added'))
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('mods.addFailed'))
    } finally {
      setAdding(false)
      setCheckingDepModId(null)
    }
  }

  const installTargetModOnly = async () => {
    const target = dependencyPrompt.targetMod
    if (!target) return
    setDependencyPrompt((prev) => ({ ...prev, installing: true }))
    try {
      await subscribeMod(target.workshopId, target.title)
      await loadMods()
      setDependencyPrompt((prev) => ({ ...prev, open: false, installing: false }))
      toast.success(t('mods.added'))
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('mods.addFailed'))
      setDependencyPrompt((prev) => ({ ...prev, installing: false }))
    }
  }

  const installSingleDependencyFromPrompt = async (dep: SteamMod) => {
    setDependencyPrompt((prev) => ({ ...prev, installingSingleId: dep.publishedfileid }))
    try {
      await subscribeMod(dep.publishedfileid, dep.title)
      await loadMods()
      setDependencyPrompt((prev) => {
        const nextSelected = new Set(prev.selectedIds)
        nextSelected.delete(dep.publishedfileid)
        return {
          ...prev,
          selectedIds: nextSelected,
          installingSingleId: null,
        }
      })
      toast.success(t('mods.added'))
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('mods.addFailed'))
      setDependencyPrompt((prev) => ({ ...prev, installingSingleId: null }))
    }
  }

  const installAllWithDependencies = async () => {
    const target = dependencyPrompt.targetMod
    if (!target) return
    const installedSet = new Set(mods.map((m) => m.workshop_id))
    const selectedDeps = dependencyPrompt.dependencies.filter(
      (dep) =>
        dependencyPrompt.selectedIds.has(dep.publishedfileid) &&
        !installedSet.has(dep.publishedfileid),
    )
    const batchItems = [
      ...selectedDeps.map((dep) => ({ workshop_id: dep.publishedfileid, name: dep.title })),
      { workshop_id: target.workshopId, name: target.title },
    ]
    setDependencyPrompt((prev) => ({ ...prev, installing: true }))
    try {
      await installBatchItems(batchItems)
      setDependencyPrompt((prev) => ({ ...prev, open: false, installing: false }))
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('mods.batchInstallFailed'))
      setDependencyPrompt((prev) => ({ ...prev, installing: false }))
    }
  }

  const addMod = async () => {
    const rawInput = newWorkshopId.trim()
    if (!rawInput) return
    const steamUrlMatch = rawInput.match(/(?:\bid=|^)(\d{5,20})(?:&|$)/)
    const cleanId = steamUrlMatch ? steamUrlMatch[1] : rawInput
    await requestModInstall(
      cleanId,
      { title: newModName.trim() || undefined },
      { fromAddModal: true },
    )
  }

  const addSteamMod = async (mod: SteamMod) => {
    await requestModInstall(mod.publishedfileid, mod)
  }

  const removeMod = async (modId: number) => {
    if (!(await confirm({ message: t('mods.confirmRemove'), danger: true, confirmText: t('common.delete') }))) return
    try {
      await api(`/mods/${serverId}/${modId}`, { method: 'DELETE' })
      await loadMods()
      toast.success(t('mods.removed'))
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('mods.removeFailed'))
    }
  }

  const checkModUpdates = async () => {
    try {
      const data = await api<Mod[]>(`/mods/${serverId}/check-updates`, { method: 'POST' })
      setMods(data)
      toast.success(t('mods.updateCheckQueued'))
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('mods.updateCheckFailed'))
    }
  }

  const abortModInstalls = async () => {
    if (!anyModInstallActive) return
    const ok = await confirm({
      message: t('mods.confirmAbortInstalls'),
      confirmText: t('mods.abortInstalls'),
      danger: true,
    })
    if (!ok) return
    try {
      const data = await api<Mod[]>(`/mods/${serverId}/abort-installs`, { method: 'POST' })
      setMods(data)
      toast.success(t('mods.abortInstallsDone'))
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('mods.abortInstallsFailed'))
    }
  }

  const reinstallAllMods = async () => {
    if (mods.length === 0) return
    if (mods.some(hasActiveModInstall)) {
      toast.error(t('mods.reinstallAllBlocked'))
      return
    }
    const ok = await confirm({
      message: t('mods.confirmReinstallAll', { count: mods.length }),
      confirmText: t('mods.reinstallAll'),
    })
    if (!ok) return
    setReinstallingAll(true)
    try {
      const data = await api<Mod[]>(`/mods/${serverId}/reinstall-all`, { method: 'POST' })
      setMods(data)
      toast.success(t('mods.reinstallAllQueued'))
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('mods.reinstallAllFailed'))
    } finally {
      setReinstallingAll(false)
    }
  }

  const installExistingMod = async (mod: Mod, action: 'update' | 'reinstall') => {
    if (action === 'reinstall') {
      const ok = await confirm({
        message: t('mods.confirmReinstall', { mod: mod.name || `Workshop Mod ${mod.workshop_id}` }),
        confirmText: t('mods.reinstall'),
      })
      if (!ok) return
    }
    try {
      await api<Mod>(`/mods/${serverId}/${mod.id}/install?action=${action}`, { method: 'POST' })
      await loadMods()
      toast.success(action === 'update' ? t('mods.updateQueued') : t('mods.reinstallQueued'))
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('mods.installActionFailed'))
    }
  }

  const patchModFlag = async (modId: number, flag: 'enabled', value: boolean) => {
    const params = new URLSearchParams({ [flag]: value ? 'true' : 'false' })
    await api<Mod>(`/mods/${serverId}/${modId}?${params.toString()}`, { method: 'PATCH' })
  }

  const toggleEnabled = async (modId: number, current: boolean) => {
    try {
      await patchModFlag(modId, 'enabled', !current)
      await loadMods()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('mods.updateSettingFailed'))
    }
  }

  // Drag & Drop + Tastatur-/Button-Sortierung fuer Load-Order (Web + Tauri + Mobil) ──
  const captureFlipRects = useCallback(() => {
    const container = modsListRef.current
    if (!container) return null
    const map = new Map<number, { top: number; left: number }>()
    const rowNodes = container.querySelectorAll<HTMLElement>('[data-mod-row-id]')
    rowNodes.forEach((el) => {
      const id = Number(el.dataset.modRowId)
      if (Number.isNaN(id)) return
      const rect = el.getBoundingClientRect()
      map.set(id, { top: rect.top, left: rect.left })
    })
    return map
  }, [])

  useLayoutEffect(() => {
    const oldRects = pendingFlipRectsRef.current
    pendingFlipRectsRef.current = null
    const movedId = lastReorderedIdRef.current
    lastReorderedIdRef.current = null

    if (!oldRects || oldRects.size === 0 || !modsListRef.current) return

    const reduceMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (!reduceMotion) {
      const rowNodes = modsListRef.current.querySelectorAll<HTMLElement>('[data-mod-row-id]')
      rowNodes.forEach((el) => {
        const id = Number(el.dataset.modRowId)
        if (Number.isNaN(id)) return
        const prev = oldRects.get(id)
        if (!prev) return
        const next = el.getBoundingClientRect()
        const dy = prev.top - next.top
        const dx = prev.left - next.left
        if (Math.abs(dy) < 0.5 && Math.abs(dx) < 0.5) return
        if (typeof el.animate === 'function') {
          el.getAnimations?.().forEach((anim) => anim.cancel())
          const isMoved = id === movedId
          el.animate(
            [
              { transform: `translate3d(${dx}px, ${dy}px, 0) scale(${isMoved ? 1.02 : 1})` },
              { transform: 'translate3d(0, 0, 0) scale(1)' },
            ],
            {
              duration: isMoved ? 280 : 220,
              easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            },
          )
        }
      })
    }

    if (movedId !== null) {
      if (settledTimerRef.current !== null) {
        window.clearTimeout(settledTimerRef.current)
      }
      setSettledModId(movedId)
      settledTimerRef.current = window.setTimeout(() => {
        setSettledModId((curr) => (curr === movedId ? null : curr))
        settledTimerRef.current = null
      }, 600)
    }
  }, [mods])

  useEffect(() => {
    return () => {
      if (settledTimerRef.current !== null) {
        window.clearTimeout(settledTimerRef.current)
      }
    }
  }, [])

  const commitModOrder = useCallback(
    async (newOrder: Mod[]) => {
      setMods(newOrder)
      try {
        const data = await api<Mod[]>(`/mods/${serverId}/reorder`, {
          method: 'POST',
          body: JSON.stringify(newOrder.map((m) => m.id)),
        })
        setMods(data)
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : t('mods.reorderFailed'))
        await loadMods()
      }
    },
    [serverId, t, loadMods],
  )

  const moveModByIds = useCallback(
    async (sourceId: number, targetId: number, preserveExistingFlipRects = false) => {
      if (sourceId === targetId) return
      const from = mods.findIndex((m) => m.id === sourceId)
      const to = mods.findIndex((m) => m.id === targetId)
      if (from === -1 || to === -1) return

      if (!preserveExistingFlipRects || !pendingFlipRectsRef.current) {
        pendingFlipRectsRef.current = captureFlipRects()
      }
      lastReorderedIdRef.current = sourceId

      const newOrder = [...mods]
      const [moved] = newOrder.splice(from, 1)
      newOrder.splice(to, 0, moved)
      await commitModOrder(newOrder)
    },
    [mods, commitModOrder, captureFlipRects],
  )

  const moveModStep = useCallback(
    async (modId: number, delta: -1 | 1) => {
      const from = mods.findIndex((m) => m.id === modId)
      if (from === -1) return
      const to = from + delta
      if (to < 0 || to >= mods.length) return

      pendingFlipRectsRef.current = captureFlipRects()
      lastReorderedIdRef.current = modId

      const newOrder = [...mods]
      const [moved] = newOrder.splice(from, 1)
      newOrder.splice(to, 0, moved)
      await commitModOrder(newOrder)
    },
    [mods, commitModOrder, captureFlipRects],
  )

  const updateDropSlotStyles = useCallback(
    (
      meta: NonNullable<typeof pointerDragMetaRef.current>,
      targetId: number,
    ) => {
      const listEl = modsListRef.current
      if (!listEl) return
      if (!meta.hasRealLayout || targetId === meta.modId) {
        listEl.removeAttribute('data-drop')
        listEl.style.removeProperty('--drop-x')
        listEl.style.removeProperty('--drop-y')
        listEl.style.removeProperty('--drop-w')
        listEl.style.removeProperty('--drop-h')
        return
      }
      const targetRow = meta.rows.find((r) => r.id === targetId)
      if (!targetRow) {
        listEl.removeAttribute('data-drop')
        return
      }
      const listRect = listEl.getBoundingClientRect()
      listEl.setAttribute('data-drop', 'true')
      listEl.style.setProperty('--drop-x', `${listRect.left.toFixed(1)}px`)
      listEl.style.setProperty('--drop-y', `${(listRect.top + targetRow.relTop).toFixed(1)}px`)
      listEl.style.setProperty('--drop-w', `${listRect.width.toFixed(1)}px`)
      listEl.style.setProperty('--drop-h', `${targetRow.height.toFixed(1)}px`)
    },
    [],
  )

  const startPointerDrag = (e: React.PointerEvent<HTMLElement>, modId: number) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (mods.length < 2) return
    e.preventDefault()

    const listEl = modsListRef.current
    const containerTop0 = listEl?.getBoundingClientRect().top ?? 0
    const rowNodes = Array.from(listEl?.querySelectorAll<HTMLElement>('[data-mod-row-id]') ?? [])
    const rows = rowNodes
      .map((el, index) => {
        const id = Number(el.dataset.modRowId)
        const rect = el.getBoundingClientRect()
        const relTop = rect.top - containerTop0
        const relBottom = rect.bottom - containerTop0
        return {
          id,
          index,
          relTop,
          relBottom,
          midY: relTop + rect.height / 2,
          height: rect.height,
        }
      })
      .filter((r) => !Number.isNaN(r.id))

    const slotPitch =
      rows.length >= 2
        ? Math.max(0, rows[1].relTop - rows[0].relTop)
        : (rows[0]?.height ?? 0) + 8
    const hasRealLayout = rows.some((r) => r.height > 0)
    const rowEl = listEl?.querySelector<HTMLElement>(`[data-mod-row-id="${modId}"]`) ?? null
    const handleEl = e.currentTarget

    try {
      handleEl.setPointerCapture?.(e.pointerId)
    } catch {
      // Synthetic pointer events in tests may not map to an active native pointerId.
    }

    if (listEl) {
      listEl.setAttribute('data-dragging', 'true')
    }

    pointerDragMetaRef.current = {
      modId,
      pointerId: e.pointerId,
      handleEl,
      rowEl,
      startClientX: e.clientX,
      startClientY: e.clientY,
      containerTop0,
      slotPitch,
      rows,
      hasRealLayout,
      lastClientX: e.clientX,
      lastClientY: e.clientY,
      targetId: modId,
    }
    setDragSlotPitch(slotPitch)
    setPointerDragActiveId(modId)
    setPointerDropTargetId(modId)
  }

  useEffect(() => {
    if (pointerDragActiveId === null) return

    let rafId: number | null = null

    const updateDragFrame = (ev?: PointerEvent) => {
      const meta = pointerDragMetaRef.current
      if (!meta) return
      const clientX = ev ? ev.clientX : meta.lastClientX
      const clientY = ev ? ev.clientY : meta.lastClientY
      meta.lastClientX = clientX
      meta.lastClientY = clientY

      const listEl = modsListRef.current
      const containerTopNow = listEl?.getBoundingClientRect().top ?? meta.containerTop0
      const scrollCompensation = meta.containerTop0 - containerTopNow
      const dy = (clientY - meta.startClientY) + scrollCompensation
      const dx = Math.max(-14, Math.min(14, (clientX - meta.startClientX) * 0.18))

      if (meta.rowEl && meta.hasRealLayout) {
        meta.rowEl.style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0) scale(1.02)`
      }

      let nextTargetId = meta.targetId
      if (meta.hasRealLayout && meta.rows.length > 0) {
        const fromRow = meta.rows.find((r) => r.id === meta.modId)
        const fromIndex = fromRow ? fromRow.index : 0
        const relY = clientY - containerTopNow

        let candidateId = meta.modId
        for (const r of meta.rows) {
          if (r.index < fromIndex && relY < r.midY) {
            candidateId = r.id
            break
          }
        }
        if (candidateId === meta.modId) {
          for (let i = meta.rows.length - 1; i >= 0; i--) {
            const r = meta.rows[i]
            if (r.index > fromIndex && relY > r.midY) {
              candidateId = r.id
              break
            }
          }
        }
        nextTargetId = candidateId
      } else if (ev) {
        const underPointer =
          typeof document.elementFromPoint === 'function'
            ? document.elementFromPoint(clientX, clientY)
            : null
        const rowEl =
          underPointer?.closest<HTMLElement>('[data-mod-row-id]') ??
          (ev.target instanceof Element ? ev.target.closest<HTMLElement>('[data-mod-row-id]') : null)
        if (rowEl?.dataset.modRowId) {
          const parsed = Number(rowEl.dataset.modRowId)
          if (!Number.isNaN(parsed)) {
            nextTargetId = parsed
          }
        }
      }

      if (nextTargetId !== meta.targetId) {
        meta.targetId = nextTargetId
        setPointerDropTargetId(nextTargetId)
      }
      updateDropSlotStyles(meta, nextTargetId)
    }

    const stepAutoScroll = () => {
      const meta = pointerDragMetaRef.current
      if (!meta || !meta.hasRealLayout) return
      const edgeThreshold = 76
      const y = meta.lastClientY
      let delta = 0
      if (y < edgeThreshold) {
        delta = -Math.min(18, Math.ceil(((edgeThreshold - y) / edgeThreshold) * 14))
      } else if (y > window.innerHeight - edgeThreshold) {
        delta = Math.min(18, Math.ceil(((y - (window.innerHeight - edgeThreshold)) / edgeThreshold) * 14))
      }
      if (delta !== 0) {
        window.scrollBy(0, delta)
        updateDragFrame()
      }
      rafId = window.requestAnimationFrame(stepAutoScroll)
    }

    if (typeof window.requestAnimationFrame === 'function') {
      rafId = window.requestAnimationFrame(stepAutoScroll)
    }

    const handlePointerMove = (ev: PointerEvent) => {
      const meta = pointerDragMetaRef.current
      if (!meta) return
      if (ev.pointerId !== undefined && meta.pointerId !== undefined && ev.pointerId !== meta.pointerId) {
        return
      }
      updateDragFrame(ev)
    }

    const cleanupAndFinish = (ev: PointerEvent | null, commit: boolean) => {
      const meta = pointerDragMetaRef.current
      if (!meta) return
      if (ev && ev.pointerId !== undefined && meta.pointerId !== undefined && ev.pointerId !== meta.pointerId) {
        return
      }

      const { modId, targetId, rowEl, handleEl, pointerId } = meta
      const willMove = commit && modId !== targetId

      if (willMove) {
        // Visuelle Position (inkl. live Transform & gewanderter Geschwister) fuer FLIP sichern.
        pendingFlipRectsRef.current = captureFlipRects()
      } else if (!commit && rowEl && meta.hasRealLayout && rowEl.style.transform && typeof rowEl.animate === 'function') {
        const reduceMotion =
          typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches
        if (!reduceMotion) {
          const currentTransform = rowEl.style.transform
          rowEl.style.transform = ''
          rowEl.animate(
            [{ transform: currentTransform }, { transform: 'translate3d(0, 0, 0) scale(1)' }],
            { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
          )
        }
      }

      if (rowEl && !(!commit && rowEl.style.transform === '')) {
        rowEl.style.transform = ''
      }

      const listEl = modsListRef.current
      if (listEl) {
        listEl.removeAttribute('data-dragging')
        listEl.removeAttribute('data-drop')
        listEl.style.removeProperty('--drop-x')
        listEl.style.removeProperty('--drop-y')
        listEl.style.removeProperty('--drop-w')
        listEl.style.removeProperty('--drop-h')
      }

      try {
        if (pointerId !== undefined && handleEl?.hasPointerCapture?.(pointerId)) {
          handleEl.releasePointerCapture(pointerId)
        }
      } catch {
        // Ignore if pointer capture already ended.
      }

      pointerDragMetaRef.current = null
      setDragSlotPitch(0)
      setPointerDragActiveId(null)
      setPointerDropTargetId(null)

      if (willMove) {
        void moveModByIds(modId, targetId, true)
      }
    }

    const handlePointerUp = (ev: PointerEvent) => cleanupAndFinish(ev, true)
    const handlePointerCancel = (ev: PointerEvent) => cleanupAndFinish(ev, false)
    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault()
        cleanupAndFinish(null, false)
      }
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      if (rafId !== null && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(rafId)
      }
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [pointerDragActiveId, moveModByIds, captureFlipRects, updateDropSlotStyles])

  const onDragStart = (e: React.DragEvent, modId: number) => {
    dragId.current = modId
    e.dataTransfer.effectAllowed = 'move'
  }

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const onDrop = async (e: React.DragEvent, targetId: number) => {
    e.preventDefault()
    const sourceId = dragId.current
    dragId.current = null
    if (sourceId === null || sourceId === targetId) return
    await moveModByIds(sourceId, targetId)
  }

  const filteredMods = mods.filter(
    (mod) =>
      mod.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      mod.workshop_id.includes(searchTerm),
  )

  // Multi-Select & Bulk-Aktionen ───────────────────────────────────────────
  const toggleSelectMod = (modId: number, shiftKey: boolean) => {
    setSelectedModIds((prev) => {
      const next = new Set(prev)
      if (shiftKey && lastSelectedModIdRef.current !== null) {
        const startIdx = filteredMods.findIndex((m) => m.id === lastSelectedModIdRef.current)
        const endIdx = filteredMods.findIndex((m) => m.id === modId)
        if (startIdx !== -1 && endIdx !== -1) {
          const [lo, hi] = startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx]
          for (let i = lo; i <= hi; i++) {
            next.add(filteredMods[i].id)
          }
          lastSelectedModIdRef.current = modId
          return next
        }
      }
      if (next.has(modId)) {
        next.delete(modId)
      } else {
        next.add(modId)
      }
      lastSelectedModIdRef.current = modId
      return next
    })
  }

  const allFilteredSelected =
    filteredMods.length > 0 && filteredMods.every((m) => selectedModIds.has(m.id))

  const toggleSelectAllFiltered = () => {
    setSelectedModIds((prev) => {
      const next = new Set(prev)
      if (allFilteredSelected) {
        for (const mod of filteredMods) {
          next.delete(mod.id)
        }
      } else {
        for (const mod of filteredMods) {
          next.add(mod.id)
        }
      }
      return next
    })
  }

  const runBulkModAction = async (action: 'update' | 'reinstall') => {
    const targetIds = Array.from(selectedModIds)
    if (targetIds.length === 0) return
    const selectedMods = mods.filter((m) => selectedModIds.has(m.id))
    if (selectedMods.some(hasActiveModInstall)) {
      toast.error(t('mods.reinstallAllBlocked'))
      return
    }
    if (action === 'reinstall') {
      const ok = await confirm({
        message: t('mods.confirmReinstallSelected', { count: targetIds.length }),
        confirmText: t('mods.reinstallSelected'),
      })
      if (!ok) return
    }
    setBulkActionLoading(action)
    try {
      const data = await api<Mod[]>(`/mods/${serverId}/bulk-action`, {
        method: 'POST',
        body: JSON.stringify({ mod_ids: targetIds, action }),
      })
      setMods(data)
      setSelectedModIds(new Set())
      toast.success(
        t(action === 'update' ? 'mods.selectedUpdateQueued' : 'mods.selectedReinstallQueued', {
          count: targetIds.length,
        }),
      )
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('mods.bulkActionFailed'))
    } finally {
      setBulkActionLoading(null)
    }
  }

  const deleteSelectedMods = async () => {
    const targetIds = Array.from(selectedModIds)
    if (targetIds.length === 0) return
    const selectedMods = mods.filter((m) => selectedModIds.has(m.id))
    if (selectedMods.some(hasActiveModInstall)) {
      toast.error(t('mods.reinstallAllBlocked'))
      return
    }
    const ok = await confirm({
      message: t('mods.confirmDeleteSelected', { count: targetIds.length }),
      confirmText: t('mods.deleteSelected'),
      danger: true,
    })
    if (!ok) return
    setBulkActionLoading('delete')
    try {
      const res = await api<{ message: string; deleted_count?: number; mods?: Mod[] }>(
        `/mods/${serverId}/bulk-delete`,
        {
          method: 'POST',
          body: JSON.stringify({ mod_ids: targetIds, delete_all: false }),
        },
      )
      if (Array.isArray(res?.mods)) {
        setMods(res.mods)
      } else {
        await loadMods()
      }
      setSelectedModIds(new Set())
      toast.success(t('mods.deletedCount', { count: res?.deleted_count ?? targetIds.length }))
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('mods.removeFailed'))
    } finally {
      setBulkActionLoading(null)
    }
  }

  const deleteAllMods = async () => {
    if (mods.length === 0) return
    if (mods.some(hasActiveModInstall)) {
      toast.error(t('mods.reinstallAllBlocked'))
      return
    }
    const ok = await confirm({
      message: t('mods.confirmDeleteAll', { count: mods.length }),
      confirmText: t('mods.deleteAll'),
      danger: true,
    })
    if (!ok) return
    setBulkActionLoading('deleteAll')
    try {
      const res = await api<{ message: string; deleted_count?: number; mods?: Mod[] }>(
        `/mods/${serverId}/bulk-delete`,
        {
          method: 'POST',
          body: JSON.stringify({ mod_ids: [], delete_all: true }),
        },
      )
      setMods(Array.isArray(res?.mods) ? res.mods : [])
      setSelectedModIds(new Set())
      toast.success(t('mods.deletedCount', { count: res?.deleted_count ?? mods.length }))
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('mods.removeFailed'))
    } finally {
      setBulkActionLoading(null)
    }
  }

  const visibleInstalled = filteredMods.slice(0, installedShown)
  const hasMoreInstalled = filteredMods.length > visibleInstalled.length
  const activeInstallMods = mods.filter(hasActiveModInstall)
  const anyModInstallActive = activeInstallMods.length > 0
  const primaryActiveMod =
    activeInstallMods.find((m) => m.install_status === 'installing') ?? activeInstallMods[0] ?? null
  const dragVisIndex =
    pointerDragActiveId !== null
      ? visibleInstalled.findIndex((m) => m.id === pointerDragActiveId)
      : -1
  const dropVisIndex =
    pointerDropTargetId !== null
      ? visibleInstalled.findIndex((m) => m.id === pointerDropTargetId)
      : -1

  const installedModByWorkshopId = new Map<string, Mod>(mods.map((m) => [m.workshop_id, m]))
  const updatesMods = mods.filter(
    (m) =>
      m.update_status === 'outdated' ||
      (m.install_status === 'pending' && m.install_action === 'update'),
  )
  const isInstalledView = libraryFilter === 'installed' || libraryFilter === 'updates'

  // Dynamische Tags aus Backend-Filterabfrage, sonst aus geladenen Mods abgeleitet
  const inferredSteamTags: GameFilterOption[] = (() => {
    if (isCurseForge || steamFilterTags.length > 0) return []
    const seen = new Set<string>()
    const collected: GameFilterOption[] = []
    const collectFrom = (items: Array<{ tags?: string[] }>) => {
      for (const item of items) {
        for (const tag of item.tags ?? []) {
          const clean = tag.trim()
          if (!clean) continue
          const lower = clean.toLowerCase()
          if (seen.has(lower)) continue
          seen.add(lower)
          collected.push({ id: clean, name: clean })
        }
      }
    }
    collectFrom(Object.values(browserCache).flatMap((entry) => entry?.mods ?? []))
    collectFrom(steamResults)
    collectFrom(Object.values(modMetadata))
    return collected.slice(0, 35)
  })()

  const gameFilterOptions = isCurseForge
    ? curseforgeCategories
    : steamFilterTags.length > 0
      ? steamFilterTags
      : inferredSteamTags

  const isSearchMode = !isInstalledView && (searchActive || steamResults.length > 0)
  const currentBrowserKey = getBrowserCacheKey(
    browserTab,
    browserPage,
    contentType,
    steamContentType,
    selectedGameFilter,
  )
  const browserEntry = browserCache[currentBrowserKey]
  const catalogRawMods = isSearchMode ? steamResults : browserEntry?.mods ?? []

  const filteredInstalledLibraryItems: SteamMod[] = isInstalledView
    ? (libraryFilter === 'updates' ? updatesMods : mods)
        .map((mod): SteamMod => {
          const meta = modMetadata[mod.workshop_id]
          const title = meta?.title || mod.name || `${providerLabel} Mod ${mod.workshop_id}`
          return {
            publishedfileid: mod.workshop_id,
            title,
            description: meta?.description || '',
            creator: meta?.creator || '',
            file_size_mb: meta?.file_size_mb ?? 0,
            subscriptions: meta?.subscriptions ?? 0,
            favorites: 0,
            preview_url: meta?.preview_url ?? null,
            direct_url: resolveModPageUrl(mod.workshop_id, title, meta?.direct_url),
            tags: meta?.tags ?? [],
            updated: meta?.updated ?? mod.last_updated ?? undefined,
          }
        })
        .filter((item) => {
          const q = steamQuery.trim().toLowerCase()
          if (q) {
            const matchesText =
              item.title.toLowerCase().includes(q) ||
              item.publishedfileid.toLowerCase().includes(q) ||
              (item.tags ?? []).some((tag) => tag.toLowerCase().includes(q))
            if (!matchesText) return false
          }
          if (selectedGameFilter) {
            const targetTag = selectedGameFilter.toLowerCase()
            if (!(item.tags ?? []).some((tag) => tag.toLowerCase() === targetTag)) {
              return false
            }
          }
          return true
        })
    : []

  const installedLibraryTotalPages = Math.max(
    1,
    Math.ceil(filteredInstalledLibraryItems.length / BROWSER_PAGE_SIZE),
  )
  const safeInstalledLibraryPage = Math.min(installedLibraryPage, installedLibraryTotalPages)

  const displayedMods = isInstalledView
    ? filteredInstalledLibraryItems.slice(
        (safeInstalledLibraryPage - 1) * BROWSER_PAGE_SIZE,
        safeInstalledLibraryPage * BROWSER_PAGE_SIZE,
      )
    : libraryFilter === 'not_installed'
      ? catalogRawMods.filter((item) => !installedModByWorkshopId.has(item.publishedfileid))
      : catalogRawMods

  const activeCatalogPage = isInstalledView
    ? safeInstalledLibraryPage
    : isSearchMode
      ? steamPage
      : browserPage
  const activeHasMore = isInstalledView
    ? safeInstalledLibraryPage < installedLibraryTotalPages
    : isSearchMode
      ? steamHasMore
      : Boolean(browserEntry?.hasMore)
  const libraryPageCount = isInstalledView
    ? installedLibraryTotalPages
    : activeHasMore
      ? activeCatalogPage + 1
      : activeCatalogPage

  const handleLibraryPageChange = (nextPage: number) => {
    if (nextPage < 1) return
    if (isInstalledView) {
      setInstalledLibraryPage(nextPage)
      return
    }
    if (isSearchMode) {
      void searchSteam(nextPage, false, contentType, steamContentType, browserTab, selectedGameFilter)
      return
    }
    void loadBrowserTab(browserTab, nextPage, false, contentType, steamContentType, selectedGameFilter)
  }

  const handleLibraryFilterChange = (nextFilter: LibraryFilter) => {
    setLibraryFilter(nextFilter)
    setInstalledLibraryPage(1)
  }

  const statusBadgeClass = {
    success: 'msm-badge-success',
    warning: 'msm-badge-warning',
    info: 'msm-badge-info',
    error: 'msm-badge-error',
  } as const

  const renderSteamModCard = (mod: SteamMod) => {
    const installedRecord = installedModByWorkshopId.get(mod.publishedfileid)
    const isAdded = Boolean(installedRecord)
    const hasPendingUpdate = Boolean(
      installedRecord &&
        (installedRecord.update_status === 'outdated' ||
          (installedRecord.install_status === 'pending' && installedRecord.install_action === 'update')),
    )
    const isRowInstalling = Boolean(installedRecord && hasActiveModInstall(installedRecord))
    const isCollection = !isCurseForge && (mod.item_type === 'collection' || steamContentType === 'collections')
    const isModpack = isCurseForge && Boolean(mod.is_modpack || mod.item_type === 'modpack')
    const displayTags = (mod.tags ?? []).slice(0, 2)
    const isListMode = viewMode === 'list'

    return (
      <div
        key={mod.publishedfileid}
        className={`msm-card overflow-hidden transition-all hover:border-primary/40 ${
          isListMode ? 'flex flex-col sm:flex-row sm:items-center gap-3 p-3' : 'flex flex-col'
        }`}
      >
        <div className={isListMode ? 'relative shrink-0' : 'relative'}>
          {mod.preview_url ? (
            <img
              src={mod.preview_url}
              alt={mod.title}
              className={
                isListMode
                  ? 'w-full h-36 sm:w-28 sm:h-20 rounded-lg object-cover bg-surface-container-highest'
                  : 'w-full h-40 object-cover bg-surface-container-highest'
              }
              loading="lazy"
            />
          ) : (
            <div
              className={
                isListMode
                  ? 'w-full h-36 sm:w-28 sm:h-20 rounded-lg flex items-center justify-center bg-surface-container-highest'
                  : 'w-full h-40 flex items-center justify-center bg-surface-container-highest'
              }
            >
              {isCollection ? (
                <Layers className="w-8 h-8 text-on-surface-variant" />
              ) : isModpack ? (
                <FolderArchive className="w-8 h-8 text-on-surface-variant" />
              ) : (
                <Package className="w-8 h-8 text-on-surface-variant" />
              )}
            </div>
          )}
          {isAdded && (
            <span
              className={`absolute top-2 right-2 inline-flex h-6 w-6 items-center justify-center rounded-full shadow-sm ${
                hasPendingUpdate
                  ? 'bg-status-warning text-surface'
                  : 'bg-status-success text-surface'
              }`}
              aria-label={hasPendingUpdate ? t('mods.updateAvailable') : t('mods.added')}
            >
              {hasPendingUpdate ? <RefreshCw className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
            </span>
          )}
          {(isCollection || isModpack || mod.has_server_pack || (!isCollection && !isModpack && (mod.dependencies_count ?? 0) > 0)) && (
            <div className="absolute top-2 left-2 flex flex-wrap gap-1">
              {isCollection && (
                <Badge variant="info" className="bg-surface/90 backdrop-blur-sm">
                  {t('mods.collection')}
                </Badge>
              )}
              {isCollection && (mod.children_count ?? 0) > 0 && (
                <Badge variant="default" className="bg-surface/90 backdrop-blur-sm">
                  {t('mods.collectionItemsCount', { count: mod.children_count })}
                </Badge>
              )}
              {isModpack && (
                <Badge variant="info" className="bg-surface/90 backdrop-blur-sm">
                  {t('mods.modpack')}
                </Badge>
              )}
              {isCurseForge && mod.has_server_pack && (
                <Badge variant="success" className="bg-surface/90 backdrop-blur-sm">
                  {t('mods.serverPack')}
                </Badge>
              )}
              {!isCollection && !isModpack && (mod.dependencies_count ?? 0) > 0 && (
                <Badge variant="warning" className="bg-surface/90 backdrop-blur-sm">
                  {t('mods.bundleDependencies', { count: mod.dependencies_count })}
                </Badge>
              )}
            </div>
          )}
        </div>

        <div className={isListMode ? 'flex flex-col sm:flex-row sm:items-center gap-3 flex-1 min-w-0' : 'p-4 flex flex-col gap-2 flex-1'}>
          <div className="flex flex-col gap-1.5 flex-1 min-w-0">
            <h4 className="font-headline text-body-md text-on-surface line-clamp-2 leading-tight">
              {mod.title}
            </h4>
            {mod.description && (
              <p className="font-body-md text-xs text-on-surface-variant line-clamp-2 flex-1">
                {mod.description}
              </p>
            )}
            {displayTags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {displayTags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center rounded-md border border-outline-variant/30 bg-surface-container px-2 py-0.5 text-label-sm font-body-md text-on-surface-variant"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3 text-xs text-on-surface-variant font-mono-sm">
              {mod.subscriptions > 0 && (
                <span className="flex items-center gap-1">
                  <Users className="w-3 h-3" /> {mod.subscriptions.toLocaleString()}
                </span>
              )}
              {mod.favorites > 0 && (
                <span className="flex items-center gap-1">
                  <Star className="w-3 h-3" /> {mod.favorites.toLocaleString()}
                </span>
              )}
              {mod.file_size_mb > 0 && (
                <span className="flex items-center gap-1">
                  <HardDrive className="w-3 h-3" /> {mod.file_size_mb} MB
                </span>
              )}
            </div>
          </div>

          <div
            className={
              isListMode
                ? 'flex items-center gap-2 shrink-0 sm:pl-2'
                : 'flex items-center gap-2 mt-2 pt-3 border-t border-outline-variant/20'
            }
          >
            {isCollection ? (
              <Button
                size="sm"
                fingerziel
                onClick={() => void openSteamCollectionPreview(mod)}
                className={isListMode ? '' : 'flex-1'}
              >
                <Layers className="w-4 h-4 shrink-0" />
                {t('mods.inspectCollection')}
              </Button>
            ) : isModpack ? (
              <Button
                size="sm"
                fingerziel
                variant={isAdded ? 'secondary' : 'primary'}
                onClick={() => void openCurseForgeBundlePreview(mod)}
                className={isListMode ? '' : 'flex-1'}
              >
                <FolderArchive className="w-4 h-4 shrink-0" />
                {isAdded ? t('mods.added') : t('mods.inspectCollection')}
              </Button>
            ) : hasPendingUpdate && installedRecord ? (
              <Button
                size="sm"
                fingerziel
                variant="primary"
                onClick={() => void installExistingMod(installedRecord, 'update')}
                disabled={isRowInstalling}
                className={isListMode ? '' : 'flex-1'}
              >
                <RefreshCw className="w-3.5 h-3.5 shrink-0" />
                {t('mods.updateAvailable')}
              </Button>
            ) : (
              <Button
                size="sm"
                fingerziel
                variant={isAdded ? 'secondary' : 'primary'}
                onClick={() => void addSteamMod(mod)}
                disabled={adding || isAdded}
                className={isListMode ? '' : 'flex-1'}
              >
                {checkingDepModId === mod.publishedfileid
                  ? t('common.loading')
                  : isAdded
                    ? t('mods.added')
                    : t('common.add')}
              </Button>
            )}
            <Kurzinfo text={ansehenText} seite="ende" portal>
              <a
                href={mod.direct_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  e.preventDefault()
                  void openExternalUrl(mod.direct_url)
                }}
                className={buttonClasses('secondary', 'icon', 'shrink-0', true)}
                aria-label={ansehenText}
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            </Kurzinfo>
          </div>
        </div>
      </div>
    )
  }

  const BROWSER_TABS: { key: BrowserTab; label: string }[] = [
    { key: 'trending', label: t('mods.tabTrending') },
    { key: 'popular', label: t('mods.tabPopular') },
    { key: 'newest', label: t('mods.tabNewest') },
    { key: 'updated', label: t('mods.tabUpdated') },
  ]

  const libraryFilterPills: Array<{ key: LibraryFilter; label: string; count?: number; highlight?: boolean }> = [
    { key: 'all', label: t('mods.filterAll') },
    { key: 'installed', label: t('mods.filterInstalled'), count: mods.length },
    {
      key: 'updates',
      label: t('mods.filterUpdates'),
      count: updatesMods.length,
      highlight: updatesMods.length > 0,
    },
    { key: 'not_installed', label: t('mods.filterNotInstalled') },
  ]

  const headerOverflowItems = [
    {
      key: 'add-id',
      label: t('mods.addById'),
      icon: <Plus className="w-4 h-4" />,
      onSelect: () => setShowAddModal(true),
    },
    {
      key: 'check-updates',
      label: t('mods.checkUpdates'),
      icon: <RefreshCw className="w-4 h-4" />,
      onSelect: () => void checkModUpdates(),
    },
    ...(mods.length > 0
      ? [
          {
            key: 'select-all',
            label: allFilteredSelected ? t('mods.deselectAll') : t('mods.selectAll'),
            icon: <Check className="w-4 h-4" />,
            disabled: loading || filteredMods.length === 0,
            onSelect: () => toggleSelectAllFiltered(),
          },
          {
            key: 'reinstall-all',
            label: t('mods.reinstallAll'),
            icon: <RotateCcw className="w-4 h-4" />,
            disabled: loading || reinstallingAll || anyModInstallActive,
            separatorBefore: true,
            onSelect: () => void reinstallAllMods(),
          },
          {
            key: 'delete-all',
            label: t('mods.deleteAll'),
            icon: <Trash2 className="w-4 h-4" />,
            disabled: loading || bulkActionLoading !== null || anyModInstallActive,
            destructive: true,
            onSelect: () => void deleteAllMods(),
          },
        ]
      : []),
    ...(anyModInstallActive
      ? [
          {
            key: 'abort-installs',
            label: t('mods.abortInstalls'),
            icon: <X className="w-4 h-4" />,
            destructive: true,
            separatorBefore: true,
            onSelect: () => void abortModInstalls(),
          },
        ]
      : []),
  ]

  return (
    <div className="space-y-5 pb-4">
      {/* Mobile-Ansichtsschalter zwischen Bibliothek und aktiven Mods */}
      <div className="flex lg:hidden gap-1.5 bg-surface-container rounded-xl p-1 border border-outline-variant/25">
        <button
          type="button"
          onClick={() => setMobileSection('library')}
          className={`flex-1 min-h-11 px-3 py-2 rounded-lg text-sm font-body-md transition-colors ${
            mobileSection === 'library'
              ? 'bg-surface text-primary shadow-sm font-semibold'
              : 'text-on-surface-variant hover:text-on-surface'
          }`}
        >
          {t('mods.mobileLibraryTab')}
        </button>
        <button
          type="button"
          onClick={() => setMobileSection('active')}
          className={`flex-1 min-h-11 px-3 py-2 rounded-lg text-sm font-body-md transition-colors inline-flex items-center justify-center gap-2 ${
            mobileSection === 'active'
              ? 'bg-surface text-primary shadow-sm font-semibold'
              : 'text-on-surface-variant hover:text-on-surface'
          }`}
        >
          <span>{t('mods.mobileActiveTab', { count: mods.length })}</span>
          {anyModInstallActive && (
            <span className="inline-block h-2 w-2 rounded-full bg-primary animate-pulse" aria-hidden />
          )}
        </button>
      </div>

      {/* Zweispaltiger Mod-Manager-Arbeitsbereich: Links Mod-Bibliothek, Rechts Aktive Mods */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24.5rem] gap-6 items-start">
        {/* Linke Hauptspalte: Mod-Bibliothek */}
        <section
          className={`space-y-4 min-w-0 ${mobileSection === 'library' ? 'block' : 'hidden lg:block'}`}
          aria-label={t('mods.libraryTitle')}
        >
          {/* Bibliotheks-Kopf mit Provider-Inhaltstypen */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <h2 className="font-headline text-body-lg text-on-surface inline-flex items-center gap-2">
              <Globe className="w-4 h-4 text-secondary shrink-0" />
              <span>{t('mods.libraryTitle')}</span>
            </h2>

            <div className="flex items-center gap-2 flex-wrap">
              {!isCurseForge && (
                <div className="flex gap-1 bg-surface-container rounded-lg p-1 border border-outline-variant/25">
                  <button
                    type="button"
                    onClick={() => handleSteamContentTypeChange('mods')}
                    className={`min-h-9 sm:min-h-7 px-3.5 py-1 rounded-md text-xs font-body-md transition-colors ${
                      steamContentType === 'mods'
                        ? 'bg-surface text-primary shadow-sm font-semibold'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    {t('mods.typeMods')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSteamContentTypeChange('collections')}
                    className={`min-h-9 sm:min-h-7 px-3.5 py-1 rounded-md text-xs font-body-md transition-colors inline-flex items-center gap-1.5 ${
                      steamContentType === 'collections'
                        ? 'bg-surface text-primary shadow-sm font-semibold'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5 shrink-0" />
                    {t('mods.tabCollections')}
                  </button>
                </div>
              )}

              {isCurseForge && (curseforgeClasses.length > 0 || supportsModpacks) && (
                <div className="flex gap-1 bg-surface-container rounded-lg p-1 border border-outline-variant/25 flex-wrap">
                  <button
                    type="button"
                    onClick={() => handleContentTypeChange('all')}
                    className={`min-h-9 sm:min-h-7 px-3.5 py-1 rounded-md text-xs font-body-md transition-colors ${
                      contentType === 'all'
                        ? 'bg-surface text-primary shadow-sm font-semibold'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    {t('mods.tabAll')}
                  </button>
                  {curseforgeClasses.length > 0 ? (
                    curseforgeClasses.map((cls) => {
                      const clsKey = cls.kind === 'modpacks' ? 'modpacks' : String(cls.id)
                      return (
                        <button
                          type="button"
                          key={cls.id}
                          onClick={() => handleContentTypeChange(clsKey)}
                          className={`min-h-9 sm:min-h-7 px-3.5 py-1 rounded-md text-xs font-body-md transition-colors ${
                            contentType === clsKey
                              ? 'bg-surface text-primary shadow-sm font-semibold'
                              : 'text-on-surface-variant hover:text-on-surface'
                          }`}
                        >
                          {cls.name}
                        </button>
                      )
                    })
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => handleContentTypeChange('mods')}
                        className={`min-h-9 sm:min-h-7 px-3.5 py-1 rounded-md text-xs font-body-md transition-colors ${
                          contentType === 'mods'
                            ? 'bg-surface text-primary shadow-sm font-semibold'
                            : 'text-on-surface-variant hover:text-on-surface'
                        }`}
                      >
                        {t('mods.typeMods')}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleContentTypeChange('modpacks')}
                        className={`min-h-9 sm:min-h-7 px-3.5 py-1 rounded-md text-xs font-body-md transition-colors ${
                          contentType === 'modpacks'
                            ? 'bg-surface text-primary shadow-sm font-semibold'
                            : 'text-on-surface-variant hover:text-on-surface'
                        }`}
                      >
                        {t('mods.typeModpacks')}
                      </button>
                    </>
                  )}
                </div>
              )}

              {isCurseForge && (
                <>
                  <input
                    ref={manifestInputRef}
                    type="file"
                    accept=".zip,.json"
                    className="hidden"
                    onChange={(e) => void handleManifestFileSelected(e.target.files?.[0])}
                  />
                  <Button
                    size="sm"
                    fingerziel
                    variant="secondary"
                    onClick={() => manifestInputRef.current?.click()}
                    disabled={importingManifest}
                  >
                    <Upload className="w-3.5 h-3.5 shrink-0" />
                    {importingManifest ? t('common.loading') : t('mods.importManifest')}
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Bibliotheks-Suchleiste */}
          <div className="flex flex-col sm:flex-row gap-2.5 sm:items-center">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant pointer-events-none" />
              <input
                type="search"
                placeholder={
                  isCurseForge
                    ? supportsModpacks
                      ? t('mods.searchPlaceholderCurseForge', { defaultValue: 'CurseForge Mods & Modpacks suchen …' })
                      : t('mods.searchPlaceholderCurseForgeModsOnly', { defaultValue: 'CurseForge Mods suchen …' })
                    : steamContentType === 'collections'
                      ? t('mods.searchPlaceholderCollections')
                      : t('mods.librarySearchPlaceholder')
                }
                value={steamQuery}
                onChange={(e) => setSteamQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                className="msm-input h-10 max-md:h-11 pl-10"
              />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="md"
                fingerziel
                onClick={runSearch}
                disabled={steamLoading || !steamQuery.trim()}
                className="flex-1 sm:flex-initial"
              >
                {steamLoading && steamPage === 1 ? t('common.loading') : t('common.search')}
              </Button>
              {(isSearchMode || (isInstalledView && steamQuery.trim())) && (
                <Button
                  variant="secondary"
                  size="md"
                  fingerziel
                  onClick={clearSearch}
                  className="flex-1 sm:flex-initial"
                >
                  {t('mods.clearSearch')}
                </Button>
              )}
            </div>
          </div>

          {/* Status-Filter-Pills + Dynamischer Spiel-Tag/Kategorie-Filter + Sortierung + Ansicht */}
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
            <div className="msm-suche-quellen-scrolle pb-0.5" role="group" aria-label={t('mods.libraryTitle')}>
              {libraryFilterPills.map((pill) => {
                const active = libraryFilter === pill.key
                return (
                  <button
                    key={pill.key}
                    type="button"
                    onClick={() => handleLibraryFilterChange(pill.key)}
                    aria-pressed={active}
                    className={`min-h-10 sm:min-h-8 px-3.5 py-1.5 rounded-full text-xs font-body-md whitespace-nowrap border transition-colors inline-flex items-center gap-1.5 shrink-0 ${
                      active
                        ? 'border-primary/60 bg-primary/15 text-primary font-semibold'
                        : pill.highlight
                          ? 'border-status-warning/40 bg-status-warning/10 text-status-warning hover:border-status-warning/60'
                          : 'border-outline-variant/30 bg-surface-container text-on-surface-variant hover:text-on-surface hover:border-outline-variant/60'
                    }`}
                  >
                    <span>{pill.label}</span>
                    {typeof pill.count === 'number' && (
                      <span className="font-mono tabular-nums opacity-85">({pill.count})</span>
                    )}
                  </button>
                )
              })}
            </div>

            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0">
              {gameFilterOptions.length > 0 && (isCurseForge || steamContentType === 'mods') && (
                <Dropdown
                  value={selectedGameFilter}
                  onChange={handleGameFilterChange}
                  options={[
                    { value: '', label: t('mods.gameFilterAll') },
                    ...gameFilterOptions.map((opt) => ({ value: opt.id, label: opt.name })),
                  ]}
                  placeholder={t('mods.gameFilterPlaceholder')}
                  searchable={gameFilterOptions.length > 6}
                  searchPlaceholder={t('mods.gameFilterSearch')}
                  aria-label={t('mods.gameFilterPlaceholder')}
                  className="w-full sm:w-44"
                />
              )}

              {!isInstalledView && (
                <Dropdown
                  value={browserTab}
                  onChange={(val) => switchTab(val as BrowserTab)}
                  options={BROWSER_TABS.map((tab) => ({ value: tab.key, label: tab.label }))}
                  placeholder={t('mods.sortLabel')}
                  aria-label={t('mods.sortLabel')}
                  className="flex-1 sm:flex-initial sm:w-40"
                />
              )}

              <div className="inline-flex items-center rounded-lg border border-outline-variant/25 bg-surface-container p-0.5 shrink-0">
                <Kurzinfo text={t('mods.viewGrid')}>
                  <button
                    type="button"
                    onClick={() => setViewMode('grid')}
                    aria-label={t('mods.viewGrid')}
                    aria-pressed={viewMode === 'grid'}
                    className={`inline-flex h-9 w-9 sm:h-7 sm:w-7 items-center justify-center rounded-md transition-colors ${
                      viewMode === 'grid'
                        ? 'bg-surface text-primary shadow-sm'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    <LayoutGrid className="w-4 h-4" />
                  </button>
                </Kurzinfo>
                <Kurzinfo text={t('mods.viewList')} seite="ende">
                  <button
                    type="button"
                    onClick={() => setViewMode('list')}
                    aria-label={t('mods.viewList')}
                    aria-pressed={viewMode === 'list'}
                    className={`inline-flex h-9 w-9 sm:h-7 sm:w-7 items-center justify-center rounded-md transition-colors ${
                      viewMode === 'list'
                        ? 'bg-surface text-primary shadow-sm'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    <List className="w-4 h-4" />
                  </button>
                </Kurzinfo>
              </div>
            </div>
          </div>

          {/* Katalog-Ergebnisse */}
          {displayedMods.length > 0 ? (
            <>
              <div
                className={
                  viewMode === 'grid'
                    ? 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4'
                    : 'space-y-3'
                }
              >
                {displayedMods.map((mod) => renderSteamModCard(mod))}
              </div>
              <Pagination
                page={activeCatalogPage}
                pageCount={libraryPageCount}
                label={t('mods.paginationRange', { page: activeCatalogPage })}
                disabled={browserLoading || steamLoading}
                onChange={handleLibraryPageChange}
              />
            </>
          ) : browserLoading || steamLoading ? (
            <div className="text-center py-12 text-on-surface-variant font-body-md">
              {t('common.loading')}
            </div>
          ) : (
            <div className="msm-card p-10 text-center border-dashed border-2 border-outline-variant">
              <Package className="w-10 h-10 text-on-surface-variant mx-auto mb-3" />
              <p className="font-body-md text-sm text-on-surface-variant">
                {libraryFilter === 'updates'
                  ? t('mods.noUpdatesPending')
                  : libraryFilter === 'installed'
                    ? t('mods.noMods')
                    : libraryFilter === 'not_installed' || selectedGameFilter
                      ? t('mods.noFilteredMods')
                      : !isCurseForge && steamContentType === 'collections'
                        ? t('mods.noCollectionsFound')
                        : isCurseForge && contentType === 'modpacks'
                          ? t('mods.noModpacksFound')
                          : t('mods.noSearchResults')}
              </p>
            </div>
          )}
        </section>

        {/* Rechte Spalte: Aktive Mods (kompakte Arbeitsliste mit Thumbnail, Switch, DnD & Overflow-Menü) */}
        <aside
          className={`msm-card p-4 space-y-3 lg:sticky lg:top-4 ${
            mobileSection === 'active' ? 'block' : 'hidden lg:block'
          }`}
          aria-label={t('mods.activeModsTitle')}
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-headline text-body-lg text-on-surface inline-flex items-center gap-2 min-w-0">
              <Package className="w-4 h-4 text-secondary shrink-0" />
              <span className="truncate">{t('mods.activeModsTitle')}</span>
              <span className="text-on-surface-variant text-sm font-mono tabular-nums">({mods.length})</span>
            </h2>

            <div className="flex items-center gap-1.5 shrink-0">
              <Kurzinfo text={t('mods.addById')}>
                <Button
                  variant="secondary"
                  size="icon"
                  fingerziel
                  onClick={() => setShowAddModal(true)}
                  aria-label={t('mods.addById')}
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </Kurzinfo>
              <ActionMenu
                label={t('mods.moreActions')}
                ariaLabel={t('mods.moreActions')}
                icon={<MoreHorizontal className="w-4 h-4" />}
                iconOnly
                variant="secondary"
                align="end"
                surface="dna"
                items={headerOverflowItems}
              />
            </div>
          </div>

          {/* Eigene Suche nur für aktive/installierte Mods */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant pointer-events-none" />
            <input
              type="search"
              placeholder={t('mods.activeSearchPlaceholder')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="msm-input h-10 max-md:h-11 pl-10 text-sm"
            />
          </div>

          {selectedModIds.size > 0 && (
            <div
              className="rounded-xl border border-primary/30 bg-primary/10 p-3 space-y-2.5"
              role="region"
              aria-label={t('mods.selectedCount', { count: selectedModIds.size })}
            >
              <div className="flex items-center justify-between gap-2">
                <Badge variant="info">
                  {t('mods.selectedCount', { count: selectedModIds.size })}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  fingerziel
                  onClick={() => setSelectedModIds(new Set())}
                  disabled={bulkActionLoading !== null}
                >
                  {t('mods.deselectAll')}
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  variant="primary"
                  size="sm"
                  fingerziel
                  onClick={() => void runBulkModAction('update')}
                  disabled={
                    bulkActionLoading !== null ||
                    mods.filter((m) => selectedModIds.has(m.id)).some(hasActiveModInstall)
                  }
                  className="flex-1"
                >
                  <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${bulkActionLoading === 'update' ? 'animate-spin' : ''}`} />
                  {t('mods.updateSelected')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  fingerziel
                  onClick={() => void runBulkModAction('reinstall')}
                  disabled={
                    bulkActionLoading !== null ||
                    mods.filter((m) => selectedModIds.has(m.id)).some(hasActiveModInstall)
                  }
                  className="flex-1"
                >
                  <RotateCcw className={`w-3.5 h-3.5 shrink-0 ${bulkActionLoading === 'reinstall' ? 'animate-spin' : ''}`} />
                  {t('mods.reinstallSelected')}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  fingerziel
                  onClick={() => void deleteSelectedMods()}
                  disabled={
                    bulkActionLoading !== null ||
                    mods.filter((m) => selectedModIds.has(m.id)).some(hasActiveModInstall)
                  }
                >
                  <Trash2 className="w-3.5 h-3.5 shrink-0" />
                  {t('mods.deleteSelected')}
                </Button>
              </div>
            </div>
          )}

          <div
            ref={modsListRef}
            className="msm-mod-list space-y-2 lg:max-h-[calc(100dvh-18rem)] lg:overflow-y-auto lg:pr-1"
          >
            {loading ? (
              <div className="text-center py-8 text-on-surface-variant font-body-md text-sm">
                {t('common.loading')}
              </div>
            ) : filteredMods.length === 0 ? (
              <div className="rounded-xl p-6 text-center border-dashed border-2 border-outline-variant">
                <Package className="w-8 h-8 text-on-surface-variant mx-auto mb-2" />
                <h3 className="font-headline text-body-md text-on-surface mb-1">
                  {searchTerm ? t('mods.noSearchResults') : t('mods.noMods')}
                </h3>
                <p className="font-body-md text-xs text-on-surface-variant">
                  {searchTerm ? t('mods.searchHint') : t('mods.noModsHint')}
                </p>
              </div>
            ) : (
              visibleInstalled.map((mod, visIndex) => {
                const installStatus = getModInstallPresentation(mod, t)
                const isInstalling = hasActiveModInstall(mod)
                const isSelected = selectedModIds.has(mod.id)
                const fullIndex = mods.findIndex((m) => m.id === mod.id)
                const isDraggingThis = pointerDragActiveId === mod.id
                const isSettlingThis = settledModId === mod.id && pointerDragActiveId === null
                const isDropTarget =
                  pointerDropTargetId === mod.id &&
                  pointerDragActiveId !== null &&
                  pointerDragActiveId !== mod.id

                let siblingShiftY = 0
                if (
                  !isDraggingThis &&
                  dragVisIndex !== -1 &&
                  dropVisIndex !== -1 &&
                  dragSlotPitch > 0
                ) {
                  if (dragVisIndex < dropVisIndex && visIndex > dragVisIndex && visIndex <= dropVisIndex) {
                    siblingShiftY = -dragSlotPitch
                  } else if (dragVisIndex > dropVisIndex && visIndex >= dropVisIndex && visIndex < dragVisIndex) {
                    siblingShiftY = dragSlotPitch
                  }
                }

                const hasPendingUpdate =
                  (mod.install_status === 'pending' && mod.install_action === 'update') ||
                  mod.update_status === 'outdated'
                const meta = modMetadata[mod.workshop_id]
                const showCompactStatus =
                  isInstalling ||
                  hasPendingUpdate ||
                  mod.install_status === 'failed' ||
                  mod.install_status === 'error' ||
                  mod.update_status === 'missing'
                const displayName = mod.name || meta?.title || `${providerLabel} Mod ${mod.workshop_id}`

                const rowMenuItems = [
                  ...(hasPendingUpdate
                    ? [
                        {
                          key: 'update',
                          label: t('mods.updateAvailable'),
                          icon: <RefreshCw className="w-4 h-4" />,
                          disabled: isInstalling,
                          onSelect: () => void installExistingMod(mod, 'update'),
                        },
                      ]
                    : []),
                  ...(mods.length > 1
                    ? [
                        {
                          key: 'up',
                          label: t('mods.moveUp'),
                          icon: <ArrowUp className="w-4 h-4" />,
                          disabled: fullIndex <= 0,
                          onSelect: () => void moveModStep(mod.id, -1),
                        },
                        {
                          key: 'down',
                          label: t('mods.moveDown'),
                          icon: <ArrowDown className="w-4 h-4" />,
                          disabled: fullIndex === -1 || fullIndex >= mods.length - 1,
                          onSelect: () => void moveModStep(mod.id, 1),
                        },
                      ]
                    : []),
                  {
                    key: 'reinstall',
                    label: t('mods.reinstall'),
                    icon: <RotateCcw className="w-4 h-4" />,
                    disabled: isInstalling,
                    separatorBefore: mods.length > 1 || hasPendingUpdate,
                    onSelect: () => void installExistingMod(mod, 'reinstall'),
                  },
                  {
                    key: 'open',
                    label: ansehenText,
                    icon: <ExternalLink className="w-4 h-4" />,
                    onSelect: () => void openExternalUrl(resolveModPageUrl(mod.workshop_id, displayName)),
                  },
                  {
                    key: 'remove',
                    label: t('common.remove'),
                    icon: <Trash2 className="w-4 h-4" />,
                    destructive: true,
                    separatorBefore: true,
                    onSelect: () => void removeMod(mod.id),
                  },
                ]

                return (
                  <div
                    key={mod.id}
                    data-mod-row-id={mod.id}
                    style={siblingShiftY !== 0 ? { transform: `translate3d(0, ${siblingShiftY}px, 0)` } : undefined}
                    className={`group rounded-xl border border-outline-variant/25 bg-surface-container/60 p-2.5 msm-mod-row ${
                      mod.enabled ? '' : 'opacity-65'
                    } ${isSelected ? 'border-primary/45 bg-primary/[0.06]' : ''} ${
                      isDraggingThis ? 'msm-mod-row-dragging !opacity-100' : ''
                    } ${isSettlingThis ? 'msm-mod-row-settle' : ''} ${
                      isDropTarget && dragSlotPitch === 0 ? 'ring-2 ring-primary/60' : ''
                    }`}
                    onDragOver={onDragOver}
                    onDrop={(e) => void onDrop(e, mod.id)}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <label
                        className={`inline-flex h-8 w-6 items-center justify-center rounded cursor-pointer shrink-0 transition-opacity ${
                          isSelected
                            ? 'opacity-100'
                            : 'opacity-45 group-hover:opacity-100 focus-within:opacity-100'
                        }`}
                      >
                        <Checkbox
                          checked={isSelected}
                          onClick={(e) => {
                            shiftSelectPendingRef.current = e.shiftKey
                          }}
                          onCheckedChange={() => {
                            const shiftKey = shiftSelectPendingRef.current
                            shiftSelectPendingRef.current = false
                            toggleSelectMod(mod.id, shiftKey)
                          }}
                          aria-label={t('mods.selectMod', { name: displayName })}
                        />
                      </label>

                      <Kurzinfo text={t('mods.dragHandleHint')}>
                        <div
                          className={`touch-none select-none inline-flex h-9 w-6 items-center justify-center rounded-md shrink-0 transition-colors ${
                            isDraggingThis
                              ? 'cursor-grabbing bg-primary/20 text-primary'
                              : 'cursor-grab active:cursor-grabbing text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/60'
                          }`}
                          onDragStart={(e) => onDragStart(e, mod.id)}
                          onPointerDown={(e) => startPointerDrag(e, mod.id)}
                          aria-label={t('mods.dragHandleHint')}
                        >
                          <GripVertical className="w-4 h-4" />
                        </div>
                      </Kurzinfo>

                      <div className="msm-mod-thumb w-10 h-10 rounded-lg border border-outline-variant/25 flex items-center justify-center">
                        {meta?.preview_url ? (
                          <img
                            src={meta.preview_url}
                            alt={displayName}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <Package className="w-4 h-4 text-on-surface-variant" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <h3
                          className={`font-headline text-sm leading-snug truncate ${
                            mod.enabled ? 'text-on-surface' : 'text-on-surface-variant line-through'
                          }`}
                        >
                          {displayName}
                        </h3>
                        <div className="flex items-center gap-2 mt-0.5 text-xs text-on-surface-variant font-mono-sm min-w-0">
                          {meta && (meta.file_size_mb ?? 0) > 0 ? (
                            <span className="tabular-nums">{meta.file_size_mb} MB</span>
                          ) : (
                            <span className="tabular-nums">#{fullIndex + 1}</span>
                          )}
                          {isDraggingThis && dragVisIndex !== -1 && dropVisIndex !== -1 && dragVisIndex !== dropVisIndex && (
                            <Badge variant="info" className="font-mono tabular-nums">
                              #{dragVisIndex + 1} → #{dropVisIndex + 1}
                            </Badge>
                          )}
                          {showCompactStatus && (
                            <span className={`${statusBadgeClass[installStatus.kind]} truncate`}>
                              {installStatus.label}
                            </span>
                          )}
                        </div>
                        {installStatus.showProgress && (
                          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-surface-container-high">
                            <div
                              className="h-full rounded-full bg-primary transition-[width] duration-500"
                              style={{ width: `${installStatus.progress ?? 0}%` }}
                            />
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <Switch
                          checked={mod.enabled}
                          onCheckedChange={() => void toggleEnabled(mod.id, mod.enabled)}
                          aria-label={mod.enabled ? t('mods.disable') : t('mods.enable')}
                        />
                        <ActionMenu
                          label={t('mods.modActions', { name: displayName })}
                          ariaLabel={t('mods.modActions', { name: displayName })}
                          icon={<MoreHorizontal className="w-4 h-4" />}
                          iconOnly
                          compact
                          variant="ghost"
                          align="end"
                          surface="dna"
                          items={rowMenuItems}
                        />
                      </div>
                    </div>
                  </div>
                )
              })
            )}
            {hasMoreInstalled && (
              <Button
                variant="secondary"
                size="sm"
                fingerziel
                onClick={() => setInstalledShown((n) => n + INSTALLED_PAGE_SIZE)}
                className="w-full"
              >
                <ChevronDown className="w-4 h-4 shrink-0" />
                {t('mods.loadMore')} ({filteredMods.length - visibleInstalled.length})
              </Button>
            )}
          </div>
        </aside>
      </div>

      {/* Untere Live-Installationsleiste (nur sichtbar während Installation/Update) */}
      {primaryActiveMod && (() => {
        const primaryStatus = getModInstallPresentation(primaryActiveMod, t)
        const primaryMeta = modMetadata[primaryActiveMod.workshop_id]
        const primaryName =
          primaryActiveMod.name || primaryMeta?.title || `${providerLabel} Mod ${primaryActiveMod.workshop_id}`
        return (
          <div className="sticky bottom-3 z-20 space-y-2">
            {installBarExpanded && activeInstallMods.length > 0 && (
              <div
                className="msm-mod-install-bar rounded-2xl p-3 space-y-2 max-h-60 overflow-y-auto"
                role="region"
                aria-label={t('mods.installBarTitle')}
              >
                {activeInstallMods.map((item) => {
                  const st = getModInstallPresentation(item, t)
                  const mMeta = modMetadata[item.workshop_id]
                  const itemName = item.name || mMeta?.title || `${providerLabel} Mod ${item.workshop_id}`
                  return (
                    <div key={item.id} className="flex items-center gap-3 text-xs">
                      <div className="msm-mod-thumb w-7 h-7 rounded-md flex items-center justify-center">
                        {mMeta?.preview_url ? (
                          <img src={mMeta.preview_url} alt={itemName} className="w-full h-full object-cover" />
                        ) : (
                          <Package className="w-3.5 h-3.5 text-on-surface-variant" />
                        )}
                      </div>
                      <span className="font-headline text-on-surface truncate flex-1 min-w-0">{itemName}</span>
                      <span className="text-on-surface-variant shrink-0">{st.label}</span>
                      <div className="w-24 shrink-0">
                        <ProgressBar
                          value={st.progress ?? 0}
                          ariaLabel={itemName}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            <div
              className="msm-mod-install-bar rounded-2xl px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3"
              role="status"
              aria-live="polite"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="msm-mod-thumb w-10 h-10 rounded-lg border border-outline-variant/30 flex items-center justify-center">
                  {primaryMeta?.preview_url ? (
                    <img
                      src={primaryMeta.preview_url}
                      alt={primaryName}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Package className="w-4 h-4 text-primary" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-body-md text-primary font-semibold">
                      {primaryStatus.label}
                    </span>
                    {activeInstallMods.length > 1 && (
                      <span className="text-xs font-mono tabular-nums text-on-surface-variant">
                        {t('mods.installBarQueueCount', {
                          active: 1,
                          total: activeInstallMods.length,
                        })}
                      </span>
                    )}
                  </div>
                  <p className="font-headline text-sm text-on-surface truncate">{primaryName}</p>
                </div>
              </div>

              <div className="flex items-center gap-3 sm:w-64 md:w-80 shrink-0">
                <ProgressBar
                  value={primaryStatus.progress ?? 0}
                  ariaLabel={primaryName}
                  hint={
                    typeof primaryStatus.progress === 'number'
                      ? `${Math.round(primaryStatus.progress)}%`
                      : undefined
                  }
                />
              </div>

              <div className="flex items-center justify-end gap-2 shrink-0">
                {activeInstallMods.length > 1 && (
                  <Button
                    variant="secondary"
                    size="sm"
                    fingerziel
                    onClick={() => setInstallBarExpanded((prev) => !prev)}
                  >
                    {installBarExpanded ? (
                      <>
                        <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                        {t('mods.installBarHideAll')}
                      </>
                    ) : (
                      <>
                        <ChevronUp className="w-3.5 h-3.5 shrink-0" />
                        {t('mods.installBarShowAll', { count: activeInstallMods.length })}
                      </>
                    )}
                  </Button>
                )}
                <Kurzinfo text={t('mods.abortInstalls')} seite="ende">
                  <Button
                    variant="destructive"
                    size="icon"
                    fingerziel
                    onClick={() => void abortModInstalls()}
                    aria-label={t('mods.abortInstalls')}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </Kurzinfo>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Steam Collection / CurseForge Manifest Preview Dialog */}
      <Dialog
        open={collectionPreview.open}
        onOpenChange={(open) => {
          if (!collectionPreview.installing) {
            setCollectionPreview((prev) => ({ ...prev, open }))
          }
        }}
      >
        <DialogContent className="max-w-3xl max-h-[90dvh]">
          <DialogHeader className="px-5 py-4 sm:px-6 sm:py-5">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 pr-9">
              <div className="min-w-0">
                <DialogTitle className="flex items-center gap-2">
                  <Layers className="w-5 h-5 text-primary shrink-0" />
                  <span className="break-words">{collectionPreview.title || t('mods.collectionPreviewTitle')}</span>
                </DialogTitle>
                <DialogDescription className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>
                    {collectionPreview.creator
                      ? `${t('mods.collectionPreviewTitle')} · ${collectionPreview.creator}`
                      : t('mods.collectionPreviewTitle')}
                  </span>
                  {!collectionPreview.loading && collectionPreview.items.length > 0 && (
                    <>
                      <span aria-hidden>·</span>
                      <span className="tabular-nums">
                        {t('mods.collectionItemsCount', { count: collectionPreview.items.length })}
                      </span>
                    </>
                  )}
                </DialogDescription>
              </div>
              {collectionPreview.directUrl && (
                <a
                  href={collectionPreview.directUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => {
                    e.preventDefault()
                    if (collectionPreview.directUrl) {
                      void openExternalUrl(collectionPreview.directUrl)
                    }
                  }}
                  className={buttonClasses('ghost', 'sm', 'self-start shrink-0 border border-outline-variant/30', true)}
                >
                  <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                  {ansehenText}
                </a>
              )}
            </div>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6 sm:py-5">
            {collectionPreview.loading ? (
              <div className="py-12 text-center text-on-surface-variant font-body-md">
                {t('mods.collectionLoading')}
              </div>
            ) : (
              <div className="space-y-4">
                {collectionPreview.unavailableIds.length > 0 && (
                  <div className="rounded-lg border border-status-warning/30 bg-status-warning/10 px-4 py-3 text-xs text-status-warning">
                    {t('mods.collectionUnavailableHint', {
                      count: collectionPreview.unavailableIds.length,
                    })}
                  </div>
                )}

                {collectionPreview.wrongGameIds.length > 0 && (
                  <div className="rounded-lg border border-status-warning/30 bg-status-warning/10 px-4 py-3 text-xs text-status-warning">
                    {t('mods.wrongGameHint', {
                      count: collectionPreview.wrongGameIds.length,
                    })}
                  </div>
                )}

                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="inline-flex items-center gap-2 text-xs font-medium text-on-surface-variant tabular-nums">
                    <span className="inline-flex items-center justify-center min-w-6 h-6 px-2 rounded-full bg-primary/15 text-primary font-semibold">
                      {collectionPreview.selectedIds.size}
                    </span>
                    <span>
                      / {t('mods.collectionItemsCount', { count: collectionPreview.items.length })}
                    </span>
                  </div>

                  <div
                    role="group"
                    aria-label={t('mods.collectionPreviewTitle')}
                    className="flex flex-wrap sm:flex-nowrap items-center gap-1 rounded-xl border border-outline-variant/30 bg-surface-container-low/80 p-1 w-full sm:w-auto"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setCollectionPreview((prev) => ({
                          ...prev,
                          selectedIds: new Set(prev.items.map((item) => item.publishedfileid)),
                        }))
                      }
                      disabled={collectionPreview.items.length === 0}
                      className="flex-1 sm:flex-initial min-h-10 sm:min-h-8 px-3 py-1.5 rounded-lg text-xs font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors whitespace-nowrap disabled:opacity-40 disabled:pointer-events-none"
                    >
                      {t('mods.selectAll')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const installedSet = new Set(mods.map((m) => m.workshop_id))
                        setCollectionPreview((prev) => ({
                          ...prev,
                          selectedIds: new Set(
                            prev.items
                              .filter((item) => !installedSet.has(item.publishedfileid))
                              .map((item) => item.publishedfileid),
                          ),
                        }))
                      }}
                      disabled={collectionPreview.items.length === 0}
                      className="flex-1 sm:flex-initial min-h-10 sm:min-h-8 px-3 py-1.5 rounded-lg text-xs font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors whitespace-nowrap disabled:opacity-40 disabled:pointer-events-none"
                    >
                      {t('mods.selectMissingOnly')}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setCollectionPreview((prev) => ({
                          ...prev,
                          selectedIds: new Set(),
                        }))
                      }
                      disabled={collectionPreview.selectedIds.size === 0}
                      className="flex-1 sm:flex-initial min-h-10 sm:min-h-8 px-3 py-1.5 rounded-lg text-xs font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors whitespace-nowrap disabled:opacity-40 disabled:pointer-events-none"
                    >
                      {t('mods.deselectAll')}
                    </button>
                  </div>
                </div>

                {collectionPreview.items.length === 0 ? (
                  <div className="py-8 text-center text-sm text-on-surface-variant">
                    {t('mods.collectionEmpty')}
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {collectionPreview.items.map((item) => {
                      const already = mods.some((m) => m.workshop_id === item.publishedfileid)
                      const checked = collectionPreview.selectedIds.has(item.publishedfileid)
                      const itemUrl = resolveModPageUrl(item.publishedfileid, item.title, item.direct_url)
                      return (
                        <div
                          key={item.publishedfileid}
                          className="flex items-start sm:items-center gap-3 rounded-xl border border-outline-variant/30 bg-surface-container/60 p-3.5"
                        >
                          <label className="min-h-11 min-w-11 sm:min-h-8 sm:min-w-8 flex items-center justify-center shrink-0 cursor-pointer">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(nextChecked) => {
                                setCollectionPreview((prev) => {
                                  const next = new Set(prev.selectedIds)
                                  if (nextChecked) {
                                    next.add(item.publishedfileid)
                                  } else {
                                    next.delete(item.publishedfileid)
                                  }
                                  return { ...prev, selectedIds: next }
                                })
                              }}
                              aria-label={item.title}
                            />
                          </label>
                          {item.preview_url ? (
                            <img
                              src={item.preview_url}
                              alt={item.title}
                              className="w-12 h-12 rounded-md object-cover shrink-0 bg-surface-container-highest"
                            />
                          ) : (
                            <div className="w-12 h-12 rounded-md flex items-center justify-center shrink-0 bg-surface-container-highest">
                              <Package className="w-5 h-5 text-on-surface-variant" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <a
                                href={itemUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => {
                                  e.preventDefault()
                                  void openExternalUrl(itemUrl)
                                }}
                                className="inline-flex items-center gap-1.5 font-body-md text-sm font-medium text-on-surface hover:text-primary hover:underline transition-colors break-words min-w-0 py-0.5"
                              >
                                <span className="break-words">{item.title}</span>
                                <ExternalLink className="w-3.5 h-3.5 shrink-0 opacity-70" />
                              </a>
                              {already && <Badge variant="success">{t('mods.alreadyInstalled')}</Badge>}
                            </div>
                            <div className="text-xs text-on-surface-variant font-mono-sm flex flex-wrap items-center gap-3">
                              <span>#{item.publishedfileid}</span>
                              {item.file_size_mb > 0 && <span>{item.file_size_mb} MB</span>}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2.5 sm:gap-3 px-5 py-4 sm:px-6 sm:py-5">
            <Button
              variant="ghost"
              fingerziel
              onClick={() => setCollectionPreview((prev) => ({ ...prev, open: false }))}
              disabled={collectionPreview.installing}
              className="w-full sm:w-auto"
            >
              {t('common.cancel')}
            </Button>
            <Button
              fingerziel
              onClick={() => void installSelectedCollectionItems()}
              disabled={
                collectionPreview.loading ||
                collectionPreview.installing ||
                collectionPreview.selectedIds.size === 0
              }
              className="w-full sm:w-auto"
            >
              {collectionPreview.installing
                ? t('common.loading')
                : t('mods.installCollection', { count: collectionPreview.selectedIds.size })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CurseForge Modpack / Bundle Preview Dialog */}
      <Dialog
        open={bundlePreview.open}
        onOpenChange={(open) => {
          if (!bundlePreview.installing) {
            setBundlePreview((prev) => ({ ...prev, open }))
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90dvh]">
          <DialogHeader className="px-5 py-4 sm:px-6 sm:py-5">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 pr-9">
              <div className="min-w-0">
                <DialogTitle className="flex items-center gap-2">
                  <FolderArchive className="w-5 h-5 text-primary shrink-0" />
                  <span className="break-words">
                    {bundlePreview.mod?.title || t('mods.bundlePreviewTitle')}
                  </span>
                </DialogTitle>
                <DialogDescription className="mt-1">
                  {bundlePreview.mod?.creator
                    ? `${t('mods.bundlePreviewTitle')} · ${bundlePreview.mod.creator}`
                    : t('mods.bundlePreviewTitle')}
                </DialogDescription>
              </div>
              {bundlePreview.mod?.direct_url && (
                <a
                  href={bundlePreview.mod.direct_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => {
                    e.preventDefault()
                    if (bundlePreview.mod?.direct_url) {
                      void openExternalUrl(bundlePreview.mod.direct_url)
                    }
                  }}
                  className={buttonClasses('ghost', 'sm', 'self-start shrink-0 border border-outline-variant/30', true)}
                >
                  <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                  {ansehenText}
                </a>
              )}
            </div>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6 sm:py-5">
            {bundlePreview.loading ? (
              <div className="py-10 text-center text-on-surface-variant font-body-md">
                {t('common.loading')}
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex flex-wrap gap-2">
                  {bundlePreview.mod?.is_modpack && (
                    <Badge variant="info">{t('mods.modpack')}</Badge>
                  )}
                  {bundlePreview.mod?.has_server_pack && (
                    <Badge variant="success">{t('mods.serverPack')}</Badge>
                  )}
                </div>

                {!bundlePreview.supportsBundleInstall && (
                  <div className="rounded-lg border border-status-warning/30 bg-status-warning/10 px-4 py-3 text-xs text-status-warning">
                    {t('mods.noDistributionWarning')}
                  </div>
                )}

                {bundlePreview.mod?.description && (
                  <p className="text-xs text-on-surface-variant leading-relaxed">
                    {bundlePreview.mod.description}
                  </p>
                )}

                {bundlePreview.dependencies.length > 0 && (
                  <div className="space-y-2.5 rounded-xl border border-outline-variant/30 bg-surface-container/50 p-4">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
                      <span className="text-xs font-semibold text-on-surface">
                        {t('mods.bundleDependencies', {
                          count: bundlePreview.dependencies.length,
                        })}
                      </span>
                      <label className="flex items-center gap-2.5 min-h-11 sm:min-h-8 text-xs text-on-surface cursor-pointer">
                        <Checkbox
                          checked={bundlePreview.includeDependencies}
                          onCheckedChange={(checked) =>
                            setBundlePreview((prev) => ({ ...prev, includeDependencies: checked }))
                          }
                        />
                        <span>
                          {t('mods.installDependencies', {
                            count: bundlePreview.dependencies.length,
                          })}
                        </span>
                      </label>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {bundlePreview.dependencies.map((dep) => (
                        <Badge key={dep.publishedfileid} variant="info">
                          {dep.title}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {bundlePreview.files.length > 0 && (
                  <div className="space-y-2.5">
                    <div className="text-xs font-semibold text-on-surface">
                      {t('mods.bundleFiles')}
                    </div>
                    <div className="max-h-48 overflow-y-auto overscroll-contain space-y-2 pr-1">
                      {bundlePreview.files.map((f) => (
                        <div
                          key={f.id}
                          className="flex items-center justify-between gap-3 rounded-lg border border-outline-variant/25 bg-surface-container/40 px-3 py-2 text-xs"
                        >
                          <div className="min-w-0 truncate font-mono-sm text-on-surface">
                            {f.display_name || f.file_name}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {f.is_server_pack && (
                              <Badge variant="success">{t('mods.serverPack')}</Badge>
                            )}
                            {f.file_length > 0 && (
                              <span className="text-on-surface-variant font-mono-sm">
                                {(f.file_length / (1024 * 1024)).toFixed(1)} MB
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2.5 sm:gap-3 px-5 py-4 sm:px-6 sm:py-5">
            <Button
              variant="ghost"
              fingerziel
              onClick={() => setBundlePreview((prev) => ({ ...prev, open: false }))}
              disabled={bundlePreview.installing}
              className="w-full sm:w-auto"
            >
              {t('common.cancel')}
            </Button>
            <Button
              fingerziel
              onClick={() => void installCurseForgeBundle()}
              disabled={bundlePreview.loading || bundlePreview.installing || !bundlePreview.mod}
              className="w-full sm:w-auto"
            >
              {bundlePreview.installing ? t('common.loading') : t('mods.installBundle')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dependency Confirmation Dialog (Steam Workshop & CurseForge) */}
      <Dialog
        open={dependencyPrompt.open}
        onOpenChange={(open) => {
          if (!dependencyPrompt.installing && !dependencyPrompt.installingSingleId) {
            setDependencyPrompt((prev) => ({ ...prev, open }))
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90dvh]">
          <DialogHeader className="px-5 py-4 sm:px-6 sm:py-5">
            <DialogTitle className="flex items-center gap-2 pr-8">
              <Package className="w-5 h-5 text-primary shrink-0" />
              <span className="break-words">{t('mods.dependenciesTitle')}</span>
            </DialogTitle>
            <DialogDescription>
              {t('mods.dependenciesPrompt', {
                name: dependencyPrompt.targetMod?.title || dependencyPrompt.targetMod?.workshopId || '',
              })}
            </DialogDescription>
          </DialogHeader>

          {dependencyPrompt.targetMod && (() => {
            const installedSet = new Set(mods.map((m) => m.workshop_id))
            const selectedMissingCount = dependencyPrompt.dependencies.filter(
              (dep) =>
                dependencyPrompt.selectedIds.has(dep.publishedfileid) &&
                !installedSet.has(dep.publishedfileid),
            ).length
            const targetUrl = resolveModPageUrl(
              dependencyPrompt.targetMod.workshopId,
              dependencyPrompt.targetMod.title,
              dependencyPrompt.targetMod.direct_url,
            )

            return (
              <>
                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6 sm:py-5 space-y-5">
                  {/* Target mod preview */}
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/25 bg-primary/5 p-3.5 sm:p-4">
                    <div className="flex items-center gap-3.5 min-w-0 flex-1">
                      {dependencyPrompt.targetMod.preview_url ? (
                        <img
                          src={dependencyPrompt.targetMod.preview_url}
                          alt={dependencyPrompt.targetMod.title}
                          className="w-12 h-12 rounded-md object-cover bg-surface-container-highest shrink-0"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-md bg-surface-container-highest flex items-center justify-center shrink-0">
                          <Package className="w-5 h-5 text-on-surface-variant" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <a
                          href={targetUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => {
                            e.preventDefault()
                            void openExternalUrl(targetUrl)
                          }}
                          className="inline-flex items-center gap-1.5 text-sm font-semibold text-on-surface hover:text-primary hover:underline transition-colors break-words min-w-0 py-0.5"
                        >
                          <span className="break-words">{dependencyPrompt.targetMod.title}</span>
                          <ExternalLink className="w-3.5 h-3.5 shrink-0 opacity-70" />
                        </a>
                        <div className="text-xs text-on-surface-variant font-mono-sm truncate">
                          ID: {dependencyPrompt.targetMod.workshopId}
                          {dependencyPrompt.targetMod.creator ? ` · ${dependencyPrompt.targetMod.creator}` : ''}
                        </div>
                      </div>
                    </div>
                    {dependencyPrompt.targetMod.direct_url && (
                      <a
                        href={targetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => {
                          e.preventDefault()
                          void openExternalUrl(targetUrl)
                        }}
                        aria-label={ansehenText}
                        className={buttonClasses('ghost', 'icon', 'shrink-0 border border-outline-variant/30', true)}
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    )}
                  </div>

                  {dependencyPrompt.unavailableIds.length > 0 && (
                    <div className="rounded-lg border border-status-warning/30 bg-status-warning/10 px-4 py-3 text-xs text-status-warning">
                      {t('mods.dependenciesUnavailableHint', {
                        count: dependencyPrompt.unavailableIds.length,
                      })}
                    </div>
                  )}

                  {/* Required dependencies list */}
                  <div className="space-y-3">
                    {dependencyPrompt.dependencies.map((dep) => {
                      const alreadyInstalled = installedSet.has(dep.publishedfileid)
                      const checked =
                        !alreadyInstalled && dependencyPrompt.selectedIds.has(dep.publishedfileid)
                      const isSingleInstalling =
                        dependencyPrompt.installingSingleId === dep.publishedfileid
                      const depUrl = resolveModPageUrl(dep.publishedfileid, dep.title, dep.direct_url)

                      return (
                        <div
                          key={dep.publishedfileid}
                          className="flex items-start gap-3 rounded-xl border border-outline-variant/30 bg-surface-container/40 p-3.5 sm:p-4"
                        >
                          <label className="min-h-11 min-w-11 sm:min-h-8 sm:min-w-8 flex items-center justify-center shrink-0 cursor-pointer">
                            <Checkbox
                              checked={checked}
                              disabled={alreadyInstalled || dependencyPrompt.installing}
                              onCheckedChange={(nextChecked) => {
                                setDependencyPrompt((prev) => {
                                  const next = new Set(prev.selectedIds)
                                  if (nextChecked) next.add(dep.publishedfileid)
                                  else next.delete(dep.publishedfileid)
                                  return { ...prev, selectedIds: next }
                                })
                              }}
                              aria-label={dep.title}
                            />
                          </label>

                          {dep.preview_url ? (
                            <img
                              src={dep.preview_url}
                              alt={dep.title}
                              className="w-12 h-12 sm:w-14 sm:h-14 rounded-md object-cover bg-surface-container-highest shrink-0"
                            />
                          ) : (
                            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-md bg-surface-container-highest flex items-center justify-center shrink-0">
                              <Package className="w-5 h-5 text-on-surface-variant" />
                            </div>
                          )}

                          <div className="min-w-0 flex-1 space-y-1.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <a
                                href={depUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => {
                                  e.preventDefault()
                                  void openExternalUrl(depUrl)
                                }}
                                className="inline-flex items-center gap-1.5 text-sm font-medium text-on-surface hover:text-primary hover:underline transition-colors break-words min-w-0 py-0.5"
                              >
                                <span className="break-words">{dep.title}</span>
                                <ExternalLink className="w-3.5 h-3.5 shrink-0 opacity-70" />
                              </a>
                              <Badge variant={alreadyInstalled ? 'success' : 'warning'}>
                                {alreadyInstalled
                                  ? t('mods.alreadyInstalled')
                                  : t('mods.dependencyRequired')}
                              </Badge>
                            </div>
                            {dep.description && (
                              <p className="text-xs text-on-surface-variant line-clamp-2">
                                {dep.description}
                              </p>
                            )}
                            <div className="flex flex-wrap items-center gap-3 text-xs text-on-surface-variant font-mono-sm">
                              <span>ID: {dep.publishedfileid}</span>
                              {dep.creator && <span>{dep.creator}</span>}
                              {dep.file_size_mb > 0 && <span>{dep.file_size_mb} MB</span>}
                            </div>
                            <div className="flex flex-col min-[420px]:flex-row flex-wrap sm:items-center gap-2 pt-3 mt-2 border-t border-outline-variant/20">
                              {!alreadyInstalled && (
                                <Button
                                  size="sm"
                                  fingerziel
                                  variant="secondary"
                                  onClick={() => void installSingleDependencyFromPrompt(dep)}
                                  disabled={dependencyPrompt.installing || isSingleInstalling}
                                  className="w-full min-[420px]:w-auto"
                                >
                                  {isSingleInstalling
                                    ? t('common.loading')
                                    : t('mods.installSingleDependency')}
                                </Button>
                              )}
                              {depUrl && (
                                <a
                                  href={depUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => {
                                    e.preventDefault()
                                    void openExternalUrl(depUrl)
                                  }}
                                  className={buttonClasses('ghost', 'sm', 'w-full min-[420px]:w-auto text-on-surface-variant hover:text-primary', true)}
                                >
                                  <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                                  {t('mods.dependencyInspect', { provider: providerLabel })}
                                </a>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <DialogFooter className="flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2.5 sm:gap-3 px-5 py-4 sm:px-6 sm:py-5">
                  <Button
                    variant="ghost"
                    fingerziel
                    onClick={() => setDependencyPrompt((prev) => ({ ...prev, open: false }))}
                    disabled={dependencyPrompt.installing || Boolean(dependencyPrompt.installingSingleId)}
                    className="w-full sm:w-auto"
                  >
                    {t('common.cancel')}
                  </Button>
                  <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-2.5 sm:gap-3 w-full sm:w-auto">
                    <Button
                      variant="secondary"
                      fingerziel
                      onClick={() => void installTargetModOnly()}
                      disabled={dependencyPrompt.installing || Boolean(dependencyPrompt.installingSingleId)}
                      className="w-full sm:w-auto"
                    >
                      {t('mods.installModOnly')}
                    </Button>
                    <Button
                      fingerziel
                      onClick={() => void installAllWithDependencies()}
                      disabled={dependencyPrompt.installing || Boolean(dependencyPrompt.installingSingleId)}
                      className="w-full sm:w-auto"
                    >
                      {dependencyPrompt.installing
                        ? t('common.loading')
                        : t('mods.installAllWithDependencies', {
                            count: selectedMissingCount + 1,
                          })}
                    </Button>
                  </div>
                </DialogFooter>
              </>
            )
          })()}
        </DialogContent>
      </Dialog>

      {/* Add by ID Modal */}
      {showAddModal && (
        <div className="msm-modal-overlay">
          <div className="msm-card w-full max-w-md p-6">
            <h2 className="font-headline text-headline-md text-primary mb-4">{t('mods.addMod')}</h2>
            <div className="space-y-4">
              <div>
                <label className="block font-label-md text-label-md text-on-surface-variant mb-1.5 uppercase tracking-wider">
                  {isCurseForge ? t('mods.curseforgeModId', { defaultValue: 'CurseForge Mod-ID' }) : t('mods.workshopId')} *
                </label>
                <input
                  type="text"
                  placeholder={isCurseForge ? 'z.B. 927142' : 'z.B. 123456789'}
                  value={newWorkshopId}
                  onChange={(e) => setNewWorkshopId(e.target.value)}
                  className="msm-input"
                />
              </div>
              <div>
                <label className="block font-label-md text-label-md text-on-surface-variant mb-1.5 uppercase tracking-wider">
                  {t('mods.modName')}
                </label>
                <input
                  type="text"
                  placeholder="Mod-Name"
                  value={newModName}
                  onChange={(e) => setNewModName(e.target.value)}
                  className="msm-input"
                />
              </div>
            </div>
            <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2.5 sm:gap-3 mt-6">
              <Button variant="ghost" fingerziel onClick={() => setShowAddModal(false)} className="w-full sm:w-auto">
                {t('common.cancel')}
              </Button>
              <Button
                fingerziel
                onClick={() => void addMod()}
                disabled={adding || !newWorkshopId.trim()}
                className="w-full sm:w-auto"
              >
                {adding ? t('common.loading') : t('common.add')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
