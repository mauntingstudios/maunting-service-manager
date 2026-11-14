import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronDown,
  ExternalLink,
  FolderArchive,
  Globe,
  GripVertical,
  HardDrive,
  Layers,
  Package,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Star,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Upload,
  Users,
} from 'lucide-react'
import { api } from '@/api/client'
import { toast } from '@/stores/toastStore'
import { confirm } from '@/stores/confirmStore'
import { getModInstallPresentation, hasActiveModInstall } from '@/services/modInstallStatus'
import {
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
  Kurzinfo,
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
}

interface CurseForgeClassOption {
  id: number
  name: string
  slug: string
  icon_url?: string | null
  kind: string
}

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

type BrowserCache = Partial<Record<BrowserTab, { mods: SteamMod[]; page: number; hasMore: boolean }>>

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
  const [curseforgeUrlMap, setCurseforgeUrlMap] = useState<Record<string, string>>({})
  // Cache pro Tab — verhindert Re-Fetch + Layout-Shift beim Tab-Wechsel,
  // dadurch bleibt die Scroll-Position erhalten.
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
    if (!mods.some(hasActiveModInstall)) return
    const intervalId = window.setInterval(() => {
      void loadMods({ silent: true })
    }, 2500)
    return () => window.clearInterval(intervalId)
  }, [loadMods, mods])

  useEffect(() => {
    if (!isCurseForge) {
      setCurseforgeClasses([])
      return
    }
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
    return () => {
      cancelled = true
    }
  }, [isCurseForge, serverId])

  useEffect(() => {
    void loadBrowserTab(browserTab, 1, false, contentType, steamContentType)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browserTab, isCurseForge, contentType, steamContentType])

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

  const loadBrowserTab = async (
    tab: BrowserTab,
    page: number,
    append: boolean,
    typeFilter: string = contentType,
    steamType: 'mods' | 'collections' = steamContentType,
  ) => {
    setBrowserLoading(true)
    try {
      const classParam = buildCurseForgeClassParam(typeFilter)
      const steamTypeParam = !isCurseForge && steamType === 'collections' ? '&content_type=collections' : ''
      const endpoint = isCurseForge
        ? `/curseforge/popular?server_id=${serverId}&sort=${tab}&limit=${BROWSER_PAGE_SIZE}&page=${page}${classParam}`
        : `/steam/workshop/popular?server_id=${serverId}&sort=${tab}&limit=${BROWSER_PAGE_SIZE}&page=${page}${steamTypeParam}`
      const data = await api<SteamMod[]>(endpoint)
      cacheCurseForgeUrls(data)
      setBrowserCache((prev) => {
        const existing = prev[tab]?.mods ?? []
        return {
          ...prev,
          [tab]: {
            mods: append ? [...existing, ...data] : data,
            page,
            hasMore: data.length === BROWSER_PAGE_SIZE,
          },
        }
      })
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err))
      if (!append) {
        setBrowserCache((prev) => ({
          ...prev,
          [tab]: { mods: [], page: 1, hasMore: false },
        }))
      }
    } finally {
      setBrowserLoading(false)
    }
  }

  const switchTab = (tab: BrowserTab) => {
    setBrowserTab(tab) // Cache bleibt erhalten → Scroll-Position stabil
  }

  const [searchActive, setSearchActive] = useState(false)

  const handleContentTypeChange = (newType: string) => {
    setContentType(newType)
    setBrowserCache({})
    if (steamQuery.trim() && searchActive) {
      void searchSteam(1, false, newType, steamContentType)
    }
  }

  const handleSteamContentTypeChange = (newType: 'mods' | 'collections') => {
    setSteamContentType(newType)
    setBrowserCache({})
    if (steamQuery.trim() && searchActive) {
      void searchSteam(1, false, contentType, newType)
    }
  }

  const loadMoreBrowser = () => {
    const entry = browserCache[browserTab]
    if (!entry || !entry.hasMore || browserLoading) return
    void loadBrowserTab(browserTab, entry.page + 1, true, contentType, steamContentType)
  }

  const searchSteam = async (
    page: number,
    append: boolean,
    typeFilter: string = contentType,
    steamType: 'mods' | 'collections' = steamContentType,
  ) => {
    if (!steamQuery.trim()) return
    setSteamLoading(true)
    try {
      const q = encodeURIComponent(steamQuery.trim())
      const classParam = buildCurseForgeClassParam(typeFilter)
      const steamTypeParam = !isCurseForge && steamType === 'collections' ? '&content_type=collections' : ''
      const endpoint = isCurseForge
        ? `/curseforge/search?server_id=${serverId}&query=${q}&per_page=${BROWSER_PAGE_SIZE}&page=${page}${classParam}`
        : `/steam/workshop/search?server_id=${serverId}&query=${q}&per_page=${BROWSER_PAGE_SIZE}&page=${page}${steamTypeParam}`
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
    setSearchActive(true)
    void searchSteam(1, false, contentType, steamContentType)
  }

  const clearSearch = () => {
    setSearchActive(false)
    setSteamResults([])
    setSteamQuery('')
    setSteamPage(1)
    setSteamHasMore(false)
  }

  const loadMoreSearch = () => {
    if (!steamHasMore || steamLoading) return
    void searchSteam(steamPage + 1, true, contentType, steamContentType)
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

  const addMod = async () => {
    const rawInput = newWorkshopId.trim()
    if (!rawInput) return
    const steamUrlMatch = rawInput.match(/(?:\bid=|^)(\d{5,20})(?:&|$)/)
    const cleanId = steamUrlMatch ? steamUrlMatch[1] : rawInput
    setAdding(true)
    try {
      await subscribeMod(cleanId, newModName.trim() || undefined)
      await loadMods()
      setShowAddModal(false)
      setNewWorkshopId('')
      setNewModName('')
      toast.success(t('mods.added'))
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('mods.addFailed'))
    } finally {
      setAdding(false)
    }
  }

  const addSteamMod = async (workshopId: string, name?: string) => {
    setAdding(true)
    try {
      await subscribeMod(workshopId, name)
      await loadMods()
      toast.success(t('mods.added'))
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('mods.addFailed'))
    } finally {
      setAdding(false)
    }
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

  // Drag & drop fuer Load-Order ──────────────────────────────────────────
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
    if (dragId.current === null || dragId.current === targetId) return

    const from = mods.findIndex((m) => m.id === dragId.current)
    const to = mods.findIndex((m) => m.id === targetId)
    if (from === -1 || to === -1) return

    const newOrder = [...mods]
    const [moved] = newOrder.splice(from, 1)
    newOrder.splice(to, 0, moved)
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
    dragId.current = null
  }

  const filteredMods = mods.filter(
    (mod) =>
      mod.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      mod.workshop_id.includes(searchTerm),
  )
  const visibleInstalled = filteredMods.slice(0, installedShown)
  const hasMoreInstalled = filteredMods.length > visibleInstalled.length
  const anyModInstallActive = mods.some(hasActiveModInstall)

  // Suche zeigt Suchtreffer-Grid, sonst das gewaehlte Browser-Tab-Grid.
  const isSearchMode = searchActive || steamResults.length > 0
  const browserEntry = browserCache[browserTab]
  const displayedMods = isSearchMode ? steamResults : browserEntry?.mods ?? []
  const showLoadMoreBrowser = !isSearchMode && !!browserEntry?.hasMore
  const showLoadMoreSearch = isSearchMode && steamHasMore
  const statusBadgeClass = {
    success: 'msm-badge-success',
    warning: 'msm-badge-warning',
    info: 'msm-badge-info',
    error: 'msm-badge-error',
  } as const

  const renderSteamModCard = (mod: SteamMod) => {
    const isAdded = mods.some((m) => m.workshop_id === mod.publishedfileid)
    const isCollection = !isCurseForge && (mod.item_type === 'collection' || steamContentType === 'collections')
    const isModpack = isCurseForge && Boolean(mod.is_modpack || mod.item_type === 'modpack')

    return (
      <div
        key={mod.publishedfileid}
        className="msm-card overflow-hidden flex flex-col hover:border-mint-accent/40 transition-all"
      >
        <div className="relative">
          {mod.preview_url ? (
            <img
              src={mod.preview_url}
              alt={mod.title}
              className="w-full h-40 object-cover bg-surface-container-highest"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-40 flex items-center justify-center bg-surface-container-highest">
              {isCollection ? (
                <Layers className="w-10 h-10 text-on-surface-variant" />
              ) : isModpack ? (
                <FolderArchive className="w-10 h-10 text-on-surface-variant" />
              ) : (
                <Package className="w-10 h-10 text-on-surface-variant" />
              )}
            </div>
          )}
          {(isCollection || isModpack || mod.has_server_pack) && (
            <div className="absolute top-2 left-2 flex flex-wrap gap-1.5">
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
            </div>
          )}
        </div>
        <div className="p-4 flex flex-col gap-2 flex-1">
          <h4 className="font-headline text-body-md text-on-surface line-clamp-2 leading-tight">
            {mod.title}
          </h4>
          <p className="font-body-md text-xs text-on-surface-variant line-clamp-3 flex-1">
            {mod.description}
          </p>
          <div className="flex flex-wrap items-center gap-3 text-xs text-on-surface-variant font-mono-sm">
            <span className="flex items-center gap-1">
              <Users className="w-3 h-3" /> {mod.subscriptions.toLocaleString()}
            </span>
            <span className="flex items-center gap-1">
              <Star className="w-3 h-3" /> {mod.favorites.toLocaleString()}
            </span>
            {mod.file_size_mb > 0 && (
              <span className="flex items-center gap-1">
                <HardDrive className="w-3 h-3" /> {mod.file_size_mb} MB
              </span>
            )}
          </div>
          <div className="flex gap-2 mt-1">
            {isCollection ? (
              <Button
                size="sm"
                onClick={() => void openSteamCollectionPreview(mod)}
                className="flex-1 inline-flex items-center justify-center gap-1.5"
              >
                <Layers className="w-3.5 h-3.5" />
                {t('mods.inspectCollection')}
              </Button>
            ) : isModpack ? (
              <Button
                size="sm"
                variant={isAdded ? 'secondary' : 'primary'}
                onClick={() => void openCurseForgeBundlePreview(mod)}
                className="flex-1 inline-flex items-center justify-center gap-1.5"
              >
                <FolderArchive className="w-3.5 h-3.5" />
                {isAdded ? t('mods.added') : t('mods.inspectCollection')}
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => addSteamMod(mod.publishedfileid, mod.title)}
                disabled={adding || isAdded}
                className="flex-1 disabled:opacity-50"
              >
                {isAdded ? t('mods.added') : t('common.add')}
              </Button>
            )}
            <Kurzinfo text={ansehenText} seite="ende" portal>
              <a
                href={mod.direct_url}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClasses('secondary', 'sm')}
                aria-label={ansehenText}
              >
                <ExternalLink className="w-3.5 h-3.5" />
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

  return (
    <div className="space-y-8">
      {/* Tab-Body Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="font-body-md text-body-md text-on-surface-variant">{t('mods.subtitle')}</p>
        <Button variant="secondary"
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          {t('mods.addById')}
        </Button>
      </div>

      {/* Installed Mods Section */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-headline text-body-lg text-on-surface inline-flex items-center gap-2">
            <Package className="w-4 h-4 text-secondary" />
            {t('mods.installedTitle')}
            <span className="text-on-surface-variant text-sm font-mono">({mods.length})</span>
          </h2>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant" />
            <input
              type="search"
              placeholder={t('mods.searchPlaceholder')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="msm-input pl-10 text-sm"
            />
          </div>
          <Kurzinfo text={t('mods.abortInstallsHint')}>
            <Button variant="secondary"
              onClick={() => void abortModInstalls()}
              disabled={loading || !anyModInstallActive}
              className="inline-flex items-center gap-2 disabled:opacity-50"
              aria-description={t('mods.abortInstallsHint')}
            >
              {t('mods.abortInstalls')}
            </Button>
          </Kurzinfo>
          <Kurzinfo text={t('mods.reinstallAllHint')}>
            <Button variant="secondary"
              onClick={() => void reinstallAllMods()}
              disabled={loading || reinstallingAll || mods.length === 0 || anyModInstallActive}
              className="inline-flex items-center gap-2 disabled:opacity-50"
              aria-description={t('mods.reinstallAllHint')}
            >
              <RotateCcw className={`w-4 h-4 ${reinstallingAll ? 'animate-spin' : ''}`} />
              {t('mods.reinstallAll')}
            </Button>
          </Kurzinfo>
          <Button variant="secondary"
            onClick={() => void checkModUpdates()}
            className="inline-flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            {t('mods.checkUpdates')}
          </Button>
        </div>

        <div className="space-y-2">
          {loading ? (
            <div className="text-center py-12 text-on-surface-variant font-body-md">
              {t('common.loading')}
            </div>
          ) : filteredMods.length === 0 ? (
            <div className="msm-card p-10 text-center border-dashed border-2 border-outline-variant">
              <Package className="w-10 h-10 text-on-surface-variant mx-auto mb-3" />
              <h3 className="font-headline text-body-lg text-on-surface mb-2">
                {searchTerm ? t('mods.noSearchResults') : t('mods.noMods')}
              </h3>
              <p className="font-body-md text-sm text-on-surface-variant">
                {searchTerm ? t('mods.searchHint') : t('mods.noModsHint')}
              </p>
            </div>
          ) : (
            visibleInstalled.map((mod) => {
              const installStatus = getModInstallPresentation(mod, t)
              const isInstalling = hasActiveModInstall(mod)
              const hasPendingUpdate =
                (mod.install_status === 'pending' && mod.install_action === 'update') ||
                mod.update_status === 'outdated'
              return (
              <div
                key={mod.id}
                className={`msm-card p-4 transition-opacity ${mod.enabled ? '' : 'opacity-60'}`}
                onDragOver={onDragOver}
                onDrop={(e) => void onDrop(e, mod.id)}
              >
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div
                    className="cursor-grab active:cursor-grabbing p-1 text-on-surface-variant hover:text-on-surface flex-shrink-0"
                    draggable
                    onDragStart={(e) => onDragStart(e, mod.id)}
                  >
                    <GripVertical className="w-4 h-4" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <h3
                      className={`font-headline text-body-md ${mod.enabled ? 'text-on-surface' : 'text-on-surface-variant line-through'}`}
                    >
                      {mod.name || `${providerLabel} Mod ${mod.workshop_id}`}
                    </h3>
                    <div className="flex flex-wrap items-center gap-4 mt-1 text-sm text-on-surface-variant font-body-md">
                      <span>ID: {mod.workshop_id}</span>
                      {mod.last_updated && (
                        <span>{new Date(mod.last_updated).toLocaleDateString()}</span>
                      )}
                      {mod.load_order !== null && (
                        <span>
                          {t('mods.loadOrder')}: {mod.load_order}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={statusBadgeClass[installStatus.kind]}>
                          {installStatus.label}
                        </span>
                        {installStatus.detail && (
                          <span className="text-xs text-on-surface-variant font-body-md">
                            {installStatus.detail}
                          </span>
                        )}
                      </div>
                      {installStatus.showProgress && (
                        <div className="h-1.5 w-full max-w-md overflow-hidden rounded-full bg-surface-container-high border border-outline-variant">
                          <div
                            className="h-full rounded-full bg-primary transition-[width] duration-500"
                            style={{ width: `${installStatus.progress ?? 0}%` }}
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {hasPendingUpdate && (
                      <Button size="sm"
                        onClick={() => void installExistingMod(mod, 'update')}
                        disabled={isInstalling}
                        className="inline-flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        {t('mods.updateAvailable')}
                      </Button>
                    )}
                    <Button variant="secondary" size="sm"
                      onClick={() => void installExistingMod(mod, 'reinstall')}
                      disabled={isInstalling}
                      className="inline-flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      {t('mods.reinstall')}
                    </Button>
                    <Kurzinfo text={mod.enabled ? t('mods.disable') : t('mods.enable')}>
                      <button
                        onClick={() => toggleEnabled(mod.id, mod.enabled)}
                        aria-label={mod.enabled ? t('mods.disable') : t('mods.enable')}
                        className="p-1.5 rounded-md hover:bg-surface-container transition-colors"
                      >
                        {mod.enabled ? (
                          <ToggleRight className="w-5 h-5 text-primary" />
                        ) : (
                          <ToggleLeft className="w-5 h-5 text-on-surface-variant" />
                        )}
                      </button>
                    </Kurzinfo>

                    <Kurzinfo text={ansehenText}>
                      <a
                        href={
                          isCurseForge
                            ? curseforgeUrlMap[mod.workshop_id] ||
                              `https://www.curseforge.com/search?search=${encodeURIComponent(mod.name || mod.workshop_id)}`
                            : `https://steamcommunity.com/sharedfiles/filedetails/?id=${mod.workshop_id}`
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 rounded-md hover:bg-surface-container transition-colors"
                        aria-label={ansehenText}
                      >
                        <ExternalLink className="w-4 h-4 text-on-surface-variant" />
                      </a>
                    </Kurzinfo>

                    <Kurzinfo text={t('common.remove')} seite="ende">
                      <button
                        onClick={() => removeMod(mod.id)}
                        className="p-1.5 rounded-md hover:bg-status-destructive/10 transition-colors"
                        aria-label={t('common.remove')}
                      >
                        <Trash2 className="w-4 h-4 text-status-destructive" />
                      </button>
                    </Kurzinfo>
                  </div>
                </div>
              </div>
              )
            })
          )}
          {hasMoreInstalled && (
            <Button variant="secondary"
              onClick={() => setInstalledShown((n) => n + INSTALLED_PAGE_SIZE)}
              className="w-full inline-flex items-center justify-center gap-2"
            >
              <ChevronDown className="w-4 h-4" />
              {t('mods.loadMore')} ({filteredMods.length - visibleInstalled.length})
            </Button>
          )}
        </div>
      </section>

      {/* Workshop / CurseForge Browser (Inline Section, breit) */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-headline text-body-lg text-on-surface inline-flex items-center gap-2">
            <Globe className="w-4 h-4 text-secondary" />
            {isCurseForge ? t('mods.curseforgeSearch', { defaultValue: 'CurseForge Browser' }) : t('mods.steamSearch')}
          </h2>

          <div className="flex items-center gap-2 flex-wrap">
            {!isCurseForge && (
              <div className="flex gap-1 bg-surface-container rounded-lg p-1">
                <button
                  type="button"
                  onClick={() => handleSteamContentTypeChange('mods')}
                  className={`px-3 py-1 rounded-md text-xs font-body-md transition-colors ${
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
                  className={`px-3 py-1 rounded-md text-xs font-body-md transition-colors inline-flex items-center gap-1.5 ${
                    steamContentType === 'collections'
                      ? 'bg-surface text-primary shadow-sm font-semibold'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  {t('mods.tabCollections')}
                </button>
              </div>
            )}

            {isCurseForge && (curseforgeClasses.length > 0 || supportsModpacks) && (
              <div className="flex gap-1 bg-surface-container rounded-lg p-1 flex-wrap">
                <button
                  type="button"
                  onClick={() => handleContentTypeChange('all')}
                  className={`px-3 py-1 rounded-md text-xs font-body-md transition-colors ${
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
                        className={`px-3 py-1 rounded-md text-xs font-body-md transition-colors ${
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
                      className={`px-3 py-1 rounded-md text-xs font-body-md transition-colors ${
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
                      className={`px-3 py-1 rounded-md text-xs font-body-md transition-colors ${
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
                  variant="secondary"
                  onClick={() => manifestInputRef.current?.click()}
                  disabled={importingManifest}
                  className="inline-flex items-center gap-1.5"
                >
                  <Upload className="w-3.5 h-3.5" />
                  {importingManifest ? t('common.loading') : t('mods.importManifest')}
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="flex gap-2 items-center flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant" />
            <input
              type="search"
              placeholder={
                isCurseForge
                  ? supportsModpacks
                    ? t('mods.searchPlaceholderCurseForge', { defaultValue: 'CurseForge Mods & Modpacks suchen …' })
                    : t('mods.searchPlaceholderCurseForgeModsOnly', { defaultValue: 'CurseForge Mods suchen …' })
                  : steamContentType === 'collections'
                    ? t('mods.searchPlaceholderCollections')
                    : t('mods.searchPlaceholder')
              }
              value={steamQuery}
              onChange={(e) => setSteamQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
              className="msm-input pl-10"
            />
          </div>
          <Button
            onClick={runSearch}
            disabled={steamLoading || !steamQuery.trim()}
            className="disabled:opacity-50"
          >
            {steamLoading && steamPage === 1 ? t('common.loading') : t('common.search')}
          </Button>
          {isSearchMode && (
            <Button variant="secondary"
              onClick={clearSearch}
            >
              {t('mods.clearSearch')}
            </Button>
          )}
        </div>

        {/* Tabs nur ausserhalb des Suchmodus. Nicht sticky, damit der Scroll-
            Anker (das Tab-Element) seine Position behaelt und der Browser beim
            Wechsel zwischen Tabs nicht nach oben springt. */}
        {!isSearchMode && (
          <div className="flex gap-1 bg-surface-container rounded-lg p-1 overflow-x-auto">
            {BROWSER_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => switchTab(tab.key)}
                className={`flex-1 min-w-[110px] px-3 py-1.5 rounded-md text-sm font-body-md transition-colors ${
                  browserTab === tab.key
                    ? 'bg-surface text-primary shadow-sm'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {displayedMods.length > 0 ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {displayedMods.map((mod) => renderSteamModCard(mod))}
            </div>
            {(showLoadMoreBrowser || showLoadMoreSearch) && (
              <div className="flex justify-center pt-2">
                <Button variant="secondary"
                  onClick={isSearchMode ? loadMoreSearch : loadMoreBrowser}
                  disabled={browserLoading || steamLoading}
                  className="inline-flex items-center gap-2 disabled:opacity-50"
                >
                  <ChevronDown className="w-4 h-4" />
                  {isSearchMode
                    ? steamLoading
                      ? t('common.loading')
                      : t('mods.loadMore')
                    : browserLoading
                      ? t('common.loading')
                      : t('mods.loadMore')}
                </Button>
              </div>
            )}
          </>
        ) : browserLoading || steamLoading ? (
          <div className="text-center py-12 text-on-surface-variant font-body-md">
            {t('common.loading')}
          </div>
        ) : (
          <div className="text-center py-12 text-on-surface-variant font-body-md">
            {!isCurseForge && steamContentType === 'collections'
              ? t('mods.noCollectionsFound')
              : isCurseForge && contentType === 'modpacks'
                ? t('mods.noModpacksFound')
                : t('mods.noSearchResults')}
          </div>
        )}
      </section>

      {/* Steam Collection / CurseForge Manifest Preview Dialog */}
      <Dialog
        open={collectionPreview.open}
        onOpenChange={(open) => {
          if (!collectionPreview.installing) {
            setCollectionPreview((prev) => ({ ...prev, open }))
          }
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 pr-6">
              <Layers className="w-5 h-5 text-primary shrink-0" />
              <span className="truncate">{collectionPreview.title || t('mods.collectionPreviewTitle')}</span>
            </DialogTitle>
            <DialogDescription>
              {collectionPreview.creator
                ? `${t('mods.collectionPreviewTitle')} · ${collectionPreview.creator}`
                : t('mods.collectionPreviewTitle')}
            </DialogDescription>
          </DialogHeader>

          {collectionPreview.loading ? (
            <div className="py-12 text-center text-on-surface-variant font-body-md">
              {t('mods.collectionLoading')}
            </div>
          ) : (
            <div className="space-y-4">
              {collectionPreview.unavailableIds.length > 0 && (
                <div className="rounded-lg border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-xs text-status-warning">
                  {t('mods.collectionUnavailableHint', {
                    count: collectionPreview.unavailableIds.length,
                  })}
                </div>
              )}

              {collectionPreview.wrongGameIds.length > 0 && (
                <div className="rounded-lg border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-xs text-status-warning">
                  {t('mods.wrongGameHint', {
                    count: collectionPreview.wrongGameIds.length,
                  })}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      setCollectionPreview((prev) => ({
                        ...prev,
                        selectedIds: new Set(prev.items.map((item) => item.publishedfileid)),
                      }))
                    }
                    disabled={collectionPreview.items.length === 0}
                  >
                    {t('mods.selectAll')}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
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
                  >
                    {t('mods.selectMissingOnly')}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      setCollectionPreview((prev) => ({
                        ...prev,
                        selectedIds: new Set(),
                      }))
                    }
                    disabled={collectionPreview.selectedIds.size === 0}
                  >
                    {t('mods.deselectAll')}
                  </Button>
                </div>
                {collectionPreview.directUrl && (
                  <a
                    href={collectionPreview.directUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={buttonClasses('secondary', 'sm')}
                  >
                    <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                    {ansehenText}
                  </a>
                )}
              </div>

              {collectionPreview.items.length === 0 ? (
                <div className="py-8 text-center text-sm text-on-surface-variant">
                  {t('mods.collectionEmpty')}
                </div>
              ) : (
                <div className="max-h-[45vh] overflow-y-auto space-y-2 pr-1">
                  {collectionPreview.items.map((item) => {
                    const already = mods.some((m) => m.workshop_id === item.publishedfileid)
                    const checked = collectionPreview.selectedIds.has(item.publishedfileid)
                    return (
                      <div
                        key={item.publishedfileid}
                        className="flex items-center gap-3 rounded-lg border border-outline-variant/30 bg-surface-container/60 p-2.5"
                      >
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
                        {item.preview_url ? (
                          <img
                            src={item.preview_url}
                            alt={item.title}
                            className="w-10 h-10 rounded object-cover shrink-0 bg-surface-container-highest"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded flex items-center justify-center shrink-0 bg-surface-container-highest">
                            <Package className="w-5 h-5 text-on-surface-variant" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-body-md text-sm text-on-surface truncate">
                              {item.title}
                            </span>
                            {already && <Badge variant="success">{t('mods.alreadyInstalled')}</Badge>}
                          </div>
                          <div className="text-xs text-on-surface-variant font-mono-sm flex items-center gap-3">
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

          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setCollectionPreview((prev) => ({ ...prev, open: false }))}
              disabled={collectionPreview.installing}
            >
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => void installSelectedCollectionItems()}
              disabled={
                collectionPreview.loading ||
                collectionPreview.installing ||
                collectionPreview.selectedIds.size === 0
              }
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
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 pr-6">
              <FolderArchive className="w-5 h-5 text-primary shrink-0" />
              <span className="truncate">
                {bundlePreview.mod?.title || t('mods.bundlePreviewTitle')}
              </span>
            </DialogTitle>
            <DialogDescription>
              {bundlePreview.mod?.creator
                ? `${t('mods.bundlePreviewTitle')} · ${bundlePreview.mod.creator}`
                : t('mods.bundlePreviewTitle')}
            </DialogDescription>
          </DialogHeader>

          {bundlePreview.loading ? (
            <div className="py-10 text-center text-on-surface-variant font-body-md">
              {t('common.loading')}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {bundlePreview.mod?.is_modpack && (
                  <Badge variant="info">{t('mods.modpack')}</Badge>
                )}
                {bundlePreview.mod?.has_server_pack && (
                  <Badge variant="success">{t('mods.serverPack')}</Badge>
                )}
              </div>

              {!bundlePreview.supportsBundleInstall && (
                <div className="rounded-lg border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-xs text-status-warning">
                  {t('mods.noDistributionWarning')}
                </div>
              )}

              {bundlePreview.mod?.description && (
                <p className="text-xs text-on-surface-variant leading-relaxed">
                  {bundlePreview.mod.description}
                </p>
              )}

              {bundlePreview.dependencies.length > 0 && (
                <div className="space-y-2 rounded-lg border border-outline-variant/30 bg-surface-container/50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-on-surface">
                      {t('mods.bundleDependencies', {
                        count: bundlePreview.dependencies.length,
                      })}
                    </span>
                    <label className="flex items-center gap-2 text-xs text-on-surface cursor-pointer">
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
                  <div className="flex flex-wrap gap-1.5">
                    {bundlePreview.dependencies.map((dep) => (
                      <Badge key={dep.publishedfileid} variant="info">
                        {dep.title}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {bundlePreview.files.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-on-surface">
                    {t('mods.bundleFiles')}
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                    {bundlePreview.files.map((f) => (
                      <div
                        key={f.id}
                        className="flex items-center justify-between gap-2 rounded-md border border-outline-variant/25 bg-surface-container/40 px-2.5 py-1.5 text-xs"
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

          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setBundlePreview((prev) => ({ ...prev, open: false }))}
              disabled={bundlePreview.installing}
            >
              {t('common.cancel')}
            </Button>
            {bundlePreview.mod?.direct_url && (
              <a
                href={bundlePreview.mod.direct_url}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClasses('secondary', 'sm')}
              >
                <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                {ansehenText}
              </a>
            )}
            <Button
              onClick={() => void installCurseForgeBundle()}
              disabled={bundlePreview.loading || bundlePreview.installing || !bundlePreview.mod}
            >
              {bundlePreview.installing ? t('common.loading') : t('mods.installBundle')}
            </Button>
          </DialogFooter>
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
            <div className="flex gap-3 mt-6">
              <Button variant="secondary" onClick={() => setShowAddModal(false)} className="flex-1">
                {t('common.cancel')}
              </Button>
              <Button
                onClick={() => void addMod()}
                disabled={adding || !newWorkshopId.trim()}
                className="flex-1 disabled:opacity-50"
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
