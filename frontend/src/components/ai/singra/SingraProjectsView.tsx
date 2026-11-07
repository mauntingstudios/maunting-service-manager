import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileTree } from '@/components/server/FileTree'
import { FileEditorWorkspace } from '@/components/server/FileEditorWorkspace'
import { detectLineEnding, parentPath, pathSegments } from '@/components/server/fileHelpers'
import type { EditorTab, FileEntry, SearchResult } from '@/components/server/fileWorkspaceTypes'
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Code2,
  Database,
  Eye,
  FileCode,
  FilePlus2,
  FileText,
  Folder,
  FolderGit2,
  FolderPlus,
  GitBranch,
  GitCommit,
  Globe,
  Laptop,
  Layers,
  Lock,
  MessageSquare,
  MousePointer,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Server as ServerIcon,
  Settings2,
  Smartphone,
  Sparkles,
  Tablet,
  Terminal,
  Trash2,
  Unlock,
  Users,
  X,
} from 'lucide-react'
import {
  aiApi,
  type AiConversationSummary,
  type AiProject,
  type AiProjectEnvironmentState,
  type AiProjectExecResult,
  type AiProjectFile,
  type AiProjectGitStatus,
  type AiProjectWrite,
  type AiPreviewInspectionResult,
} from '@/api/ai'
import { api, SanitizedApiError } from '@/api/client'
import { still } from '@/lib/still'
import { buildPreviewDocument, isPreviewErrorMessage } from './previewBundle'
import { PreviewDiagnostics } from './PreviewDiagnostics'
import { SingraVisualInspectionModal } from './SingraVisualInspectionModal'
import { teamsApi, type Team } from '@/api/teams'
import {
  ActionMenu,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Dropdown,
  Input,
  Kontextmenue,
  Kurzinfo,
  Pfadleiste,
  Spinner,
  Switch,
  Textarea,
} from '@maunting/ui'
import { confirm } from '@/stores/confirmStore'
import { toast } from '@/stores/toastStore'

type ProjectTab = 'chats' | 'files' | 'preview' | 'settings'
type ProjectCreateMode = 'empty' | 'create_repo' | 'clone_repo'

interface SingraProjectsViewProps {
  initialProjectId?: string | null
  onOpenProjectChat: (projectId: string, conversationId?: string) => void
}

const PROJECT_KIND_OPTIONS = [
  { value: 'coding', label: 'Code & Entwicklung' },
  { value: 'docs', label: 'Dokumente & Wissen' },
  { value: 'general', label: 'Allgemeines Projekt' },
]

const GIT_PROVIDER_OPTIONS = [
  { value: '__none__', label: 'Keine Git-Anbindung' },
  { value: 'github', label: 'GitHub' },
  { value: 'gitlab', label: 'GitLab' },
  { value: 'custom', label: 'Eigener Git-Server (HTTPS)' },
]

/**
 * Baut aus der flachen Projektdatei-Liste eine hierarchische Verzeichnisstruktur
 * für die gemeinsame `FileTree`-Komponente.
 */
function buildProjectTreeNodes(files: AiProjectFile[]): {
  nodes: Record<string, FileEntry[]>
  allDirs: string[]
} {
  const nodes: Record<string, FileEntry[]> = { '': [] }
  const seenDirs = new Set<string>()

  const ensureDir = (dirPath: string, modifiedTs: number) => {
    if (!dirPath || seenDirs.has(dirPath)) return
    const parts = dirPath.split('/').filter(Boolean)
    let current = ''
    for (const part of parts) {
      const parent = current
      current = current ? `${current}/${part}` : part
      if (!seenDirs.has(current)) {
        seenDirs.add(current)
        if (!nodes[parent]) nodes[parent] = []
        nodes[parent].push({
          name: part,
          is_dir: true,
          size: 0,
          modified: modifiedTs,
          mode: null,
          owner: null,
          group: null,
        })
        if (!nodes[current]) nodes[current] = []
      }
    }
  }

  for (const file of files) {
    const cleaned = file.path.replace(/^\/+|\/+$/g, '')
    if (!cleaned) continue
    const modifiedTs = file.updated_at ? Math.floor(new Date(file.updated_at).getTime() / 1000) : 0
    const slashIdx = cleaned.lastIndexOf('/')
    const parent = slashIdx < 0 ? '' : cleaned.slice(0, slashIdx)
    const name = slashIdx < 0 ? cleaned : cleaned.slice(slashIdx + 1)

    if (parent) {
      ensureDir(parent, modifiedTs)
    }
    if (!nodes[parent]) nodes[parent] = []
    nodes[parent].push({
      name,
      is_dir: false,
      size: file.size_bytes ?? file.content.length,
      modified: modifiedTs,
      mode: null,
      owner: null,
      group: null,
    })
  }

  return { nodes, allDirs: Array.from(seenDirs) }
}

export function SingraProjectsView({
  initialProjectId,
  onOpenProjectChat,
}: SingraProjectsViewProps) {
  const [projects, setProjects] = useState<AiProject[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(initialProjectId ?? null)
  const [projectOpen, setProjectOpen] = useState<boolean>(Boolean(initialProjectId))
  const [activeTab, setActiveTab] = useState<ProjectTab>('chats')
  const [loading, setLoading] = useState(true)

  // Project-bound conversations
  const [projectChats, setProjectChats] = useState<AiConversationSummary[]>([])

  // Project files & multi-tab editor state
  const [files, setFiles] = useState<AiProjectFile[]>([])
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(['']))
  const [editorTabs, setEditorTabs] = useState<EditorTab[]>([])
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null)
  const [fileSearchQuery, setFileSearchQuery] = useState('')
  const [newFileModalOpen, setNewFileModalOpen] = useState(false)
  const [newFilePath, setNewFilePath] = useState('')
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    path: string
    isDir: boolean
  } | null>(null)

  // Collapsible terminal drawer inside Code & Files
  const [terminalOpen, setTerminalOpen] = useState(false)

  // Agents rules state
  const [agentsRules, setAgentsRules] = useState<{
    found: boolean
    filename: string | null
    content: string | null
    lines_count: number
    size_bytes: number
  } | null>(null)
  const [showAgentsModal, setShowAgentsModal] = useState(false)

  // Live-Preview, Environment (Dev vs. Production) & Inspector state
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop')
  const [inspectMode, setInspectMode] = useState(false)
  const [previewEnv, setPreviewEnv] = useState<'dev' | 'production'>('dev')
  const [inspectElement, setInspectElement] = useState<string | null>(null)
  const [inspectTargetChatId, setInspectTargetChatId] = useState<string>('__latest__')
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null)
  const [previewError, setPreviewError] = useState<{ message: string; detail?: string } | null>(null)
  const [previewErrorDismissed, setPreviewErrorDismissed] = useState(false)
  const [fixTargetChatId, setFixTargetChatId] = useState<string>('__latest__')

  // Visuelle Sichtprüfung (Headless Mobile vs. Desktop Screenshots & Layout-Analyse)
  const [visualModalOpen, setVisualModalOpen] = useState(false)
  const [visualInspection, setVisualInspection] = useState<AiPreviewInspectionResult | null>(null)
  const [visualLoading, setVisualLoading] = useState(false)

  // Welches Projekt in `files`/`editorTabs` tatsächlich geladen ist, und welche
  // Datei aus einer Chat-Diff-Karte geöffnet werden soll.
  const [detailsProjectId, setDetailsProjectId] = useState<string | null>(null)
  const [pendingOpenTarget, setPendingOpenTarget] = useState<{
    projectId: string
    tab?: ProjectTab
    filePath?: string
  } | null>(() => {
    try {
      const raw = sessionStorage.getItem('singra-open-project-target')
      if (!raw) return null
      const parsed = JSON.parse(raw) as { projectId?: string; tab?: ProjectTab; filePath?: string }
      return parsed.projectId ? { projectId: parsed.projectId, tab: parsed.tab, filePath: parsed.filePath } : null
    } catch (err) {
      still(err, 'singra:openTarget:read')
      return null
    }
  })

  // Dev / Production environment & Publishing state
  const [envState, setEnvState] = useState<AiProjectEnvironmentState | null>(null)
  const [productionFiles, setProductionFiles] = useState<
    Array<{ path: string; content: string; size_bytes: number }>
  >([])
  const [publishModalOpen, setPublishModalOpen] = useState(false)
  const [availableNodes, setAvailableNodes] = useState<
    Array<{ id: string; name: string; status?: string }>
  >([])
  const [selectedNodeId, setSelectedNodeId] = useState<string>('__auto__')
  const [releaseNotes, setReleaseNotes] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [publishDomainMode, setPublishDomainMode] = useState<'ip' | 'cloudflare' | 'external'>('ip')
  const [publishDomain, setPublishDomain] = useState('')
  const [publishMode, setPublishMode] = useState<'fullstack_split' | 'frontend' | 'backend'>('fullstack_split')
  const [publishEnableDb, setPublishEnableDb] = useState(true)
  const [publishApiPath, setPublishApiPath] = useState('/api/*')
  const [publishBackendProxyUrl, setPublishBackendProxyUrl] = useState('')

  // Team Sharing & Invite Modal state
  const [teamShareModalOpen, setTeamShareModalOpen] = useState(false)
  const [selectedTeamShareId, setSelectedTeamShareId] = useState<string>('__personal__')

  // Sandbox Terminal
  const [commandInput, setCommandInput] = useState('')
  const [runningCmd, setRunningCmd] = useState(false)
  const [execHistory, setExecHistory] = useState<
    Array<{ command: string; result: AiProjectExecResult; timestamp: string }>
  >([])

  // Git state & Direct Repo Creation
  const [gitStatus, setGitStatus] = useState<AiProjectGitStatus | null>(null)
  const [gitBusy, setGitBusy] = useState(false)
  const [commitMessage, setCommitMessage] = useState('')
  const [pushOnCommit, setPushOnCommit] = useState(true)
  const [createRepoOpen, setCreateRepoOpen] = useState(false)
  const [newRepoName, setNewRepoName] = useState('')
  const [newRepoPrivate, setNewRepoPrivate] = useState(true)
  const [newRepoProvider, setNewRepoProvider] = useState<'github' | 'gitlab'>('github')
  const [newRepoToken, setNewRepoToken] = useState('')

  // Create Project Modal (Single-View, Calm UX)
  const [createOpen, setCreateOpen] = useState(false)
  const [createMode, setCreateMode] = useState<ProjectCreateMode>('empty')
  const [createRepoPrivate, setCreateRepoPrivate] = useState(true)
  const [showAdvancedCreate, setShowAdvancedCreate] = useState(false)
  const [draft, setDraft] = useState<AiProjectWrite & { name: string }>({
    name: '',
    description: '',
    system_prompt: '',
    project_kind: 'coding',
    sandbox_enabled: true,
    local_directory: '',
    git_provider: null,
    git_repo_url: '',
    git_branch: 'main',
    git_token: '',
    team_id: null,
  })
  const [savingProject, setSavingProject] = useState(false)
  const [projectAutonomy, setProjectAutonomy] = useState(false)
  const [savingAutonomy, setSavingAutonomy] = useState(false)

  const selectedProject = projects.find((p) => p.id === selectedId) ?? null

  const { nodes: treeNodes, allDirs } = useMemo(() => buildProjectTreeNodes(files), [files])

  const breadcrumbTeile = useMemo(() => {
    const dir = activeFilePath ? parentPath(activeFilePath) : ''
    const segs = pathSegments(dir)
    const result: { key: string; label: string }[] = []
    let acc = ''
    for (const seg of segs) {
      acc = acc ? `${acc}/${seg}` : seg
      result.push({ key: acc, label: seg })
    }
    return result
  }, [activeFilePath])

  const searchResults = useMemo<SearchResult[] | null>(() => {
    const q = fileSearchQuery.trim().toLowerCase()
    if (!q) return null
    return files
      .filter((f) => f.path.toLowerCase().includes(q))
      .map((f) => ({ path: f.path, is_dir: false }))
  }, [files, fileSearchQuery])

  useEffect(() => {
    if (!selectedId) {
      setProjectAutonomy(false)
      return
    }
    let active = true
    aiApi
      .listAutonomyGrants()
      .then((grants) => {
        if (!active) return
        const g = grants.find((x) => x.project_id === selectedId)
        setProjectAutonomy(Boolean(g?.enabled))
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [selectedId])

  const handleToggleAutonomy = async (enabled: boolean) => {
    if (!selectedId || savingAutonomy) return
    setSavingAutonomy(true)
    try {
      await aiApi.saveAutonomyGrant({
        project_id: selectedId,
        enabled,
        max_actions_per_hour: 100,
      })
      setProjectAutonomy(enabled)
      toast.success(
        enabled
          ? 'Autonomie für dieses Projekt aktiviert.'
          : 'Autonomie für dieses Projekt deaktiviert.',
      )
    } catch {
      toast.error('Autonomie-Einstellung konnte nicht gespeichert werden.')
    } finally {
      setSavingAutonomy(false)
    }
  }

  const loadProjects = useCallback(async () => {
    setLoading(true)
    try {
      const [projRows, teamRows, nodeRows] = await Promise.all([
        aiApi.listProjects(),
        teamsApi.list().catch(() => [] as Team[]),
        api<Array<{ id: string; name: string; status?: string }>>('/nodes').catch(() => []),
      ])
      setProjects(projRows)
      setTeams(teamRows.filter((t) => !t.is_personal))
      setAvailableNodes(nodeRows)
      if (nodeRows.length > 0) {
        setSelectedNodeId((prev) => (prev === '__auto__' ? nodeRows[0].id : prev))
      }
      setSelectedId((prev) => prev || (projRows.length > 0 ? projRows[0].id : null))
    } catch (err: unknown) {
      toast.error(
        err instanceof SanitizedApiError
          ? err.message
          : 'Projekte konnten nicht geladen werden.',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadProjects()
  }, [loadProjects])

  useEffect(() => {
    if (initialProjectId) {
      setSelectedId(initialProjectId)
      setProjectOpen(true)
    }
  }, [initialProjectId])

  useEffect(() => {
    const handleResetView = () => setProjectOpen(false)
    window.addEventListener('singra-reset-project-view', handleResetView)
    return () => window.removeEventListener('singra-reset-project-view', handleResetView)
  }, [])

  const openFileInEditor = useCallback(
    (path: string, fileListSource?: AiProjectFile[]) => {
      const list = fileListSource ?? files
      const clean = path.replace(/^\.\//, '')
      const target = list.find(
        (f) =>
          f.path === path ||
          f.path.replace(/^\.\//, '') === clean ||
          f.path.toLowerCase() === clean.toLowerCase(),
      )
      if (!target) return
      const actualPath = target.path
      const modifiedTs = target.updated_at
        ? Math.floor(new Date(target.updated_at).getTime() / 1000)
        : 0
      setEditorTabs((prev) => {
        const exists = prev.some((t) => t.path === actualPath)
        if (exists) return prev
        const nextTab: EditorTab = {
          path: actualPath,
          content: target.content,
          savedContent: target.content,
          revision: String(modifiedTs),
          lineEnding: detectLineEnding(target.content),
          loading: false,
          saveState: 'clean',
          size: target.size_bytes ?? target.content.length,
          modified: modifiedTs,
          mode: null,
          owner: null,
          group: null,
        }
        return [...prev, nextTab]
      })
      setActiveFilePath(actualPath)
    },
    [files],
  )

  const loadProjectDetails = useCallback(
    async (projectId: string) => {
      try {
        const [chats, fileList, rules, envData, prodFileList] = await Promise.all([
          aiApi.listConversations(projectId),
          aiApi.listProjectFiles(projectId),
          aiApi.getProjectAgentsRules(projectId).catch(() => ({
            found: false,
            filename: null,
            content: null,
            lines_count: 0,
            size_bytes: 0,
          })),
          aiApi.getProjectEnvironment(projectId).catch(() => null),
          aiApi.listProjectProductionFiles(projectId).catch(() => []),
        ])
        setProjectChats(chats)
        setInspectTargetChatId(chats.length > 0 ? chats[0].id : '__new__')
        setFixTargetChatId(chats.length > 0 ? chats[0].id : '__new__')
        setFiles(fileList)
        setAgentsRules(rules)
        setEnvState(envData)
        setProductionFiles(prodFileList)
        if (envData?.production?.node_id) {
          setSelectedNodeId(envData.production.node_id)
        }

        const { allDirs: dirs } = buildProjectTreeNodes(fileList)
        setExpandedDirs(new Set(['', ...dirs.filter((d) => !d.includes('/'))]))

        if (fileList.length > 0) {
          const targetPath =
            pendingOpenTarget?.projectId === projectId && pendingOpenTarget.filePath
              ? pendingOpenTarget.filePath
              : null
          const entryFile = envData?.preview?.entry_file

          const preferred =
            (targetPath
              ? fileList.find(
                  (f) =>
                    f.path === targetPath ||
                    f.path.replace(/^\.\//, '') === targetPath.replace(/^\.\//, '') ||
                    f.path.toLowerCase() === targetPath.toLowerCase(),
                )
              : null) ??
            (entryFile
              ? fileList.find(
                  (f) =>
                    f.path === entryFile ||
                    f.path.replace(/^\.\//, '') === entryFile.replace(/^\.\//, '') ||
                    f.path.toLowerCase() === entryFile.toLowerCase(),
                )
              : null) ??
            fileList.find((f) => /^(src\/)?(App|main|index)\.(tsx|jsx|ts|js)$/i.test(f.path)) ??
            fileList.find((f) => f.path.toLowerCase() === 'index.html') ??
            fileList.find((f) => /^(app|main|server)\.(py|js|ts)$/i.test(f.path)) ??
            fileList.find((f) => f.path.toLowerCase() === 'readme.md') ??
            fileList[0]
          const modifiedTs = preferred.updated_at
            ? Math.floor(new Date(preferred.updated_at).getTime() / 1000)
            : 0
          setEditorTabs([
            {
              path: preferred.path,
              content: preferred.content,
              savedContent: preferred.content,
              revision: String(modifiedTs),
              lineEnding: detectLineEnding(preferred.content),
              loading: false,
              saveState: 'clean',
              size: preferred.size_bytes ?? preferred.content.length,
              modified: modifiedTs,
              mode: null,
              owner: null,
              group: null,
            },
          ])
          setActiveFilePath(preferred.path)
        } else {
          setEditorTabs([])
          setActiveFilePath(null)
        }
        setDetailsProjectId(projectId)
      } catch (err: unknown) {
        toast.error(
          err instanceof SanitizedApiError
            ? err.message
            : 'Projektdaten konnten nicht geladen werden.',
        )
      }
    },
    [],
  )

  useEffect(() => {
    if (!selectedId) return
    void loadProjectDetails(selectedId)
    setExecHistory([])
    setGitStatus(null)
  }, [selectedId, loadProjectDetails])

  // „Datei öffnen“ aus einer Diff-Karte im Chat: Projekt, Reiter und Datei.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string; tab?: ProjectTab; filePath?: string }>).detail
      if (!detail?.projectId) return
      setPendingOpenTarget({ projectId: detail.projectId, tab: detail.tab, filePath: detail.filePath })
      setSelectedId(detail.projectId)
      setProjectOpen(true)
    }
    window.addEventListener('singra-open-project', handler)
    return () => window.removeEventListener('singra-open-project', handler)
  }, [])

  useEffect(() => {
    if (!pendingOpenTarget) return
    if (selectedId !== pendingOpenTarget.projectId || detailsProjectId !== pendingOpenTarget.projectId) return
    try {
      sessionStorage.removeItem('singra-open-project-target')
    } catch (err) {
      still(err, 'singra:openTarget:remove')
    }
    const { tab, filePath } = pendingOpenTarget
    setPendingOpenTarget(null)
    setProjectOpen(true)
    if (filePath) {
      const clean = filePath.replace(/^\.\//, '')
      const match = files.find(
        (f) =>
          f.path === filePath ||
          f.path.replace(/^\.\//, '') === clean ||
          f.path.toLowerCase() === clean.toLowerCase(),
      )
      if (!match) {
        setActiveTab('files')
        toast.info(`„${filePath}“ ist im aktuellen Projektstand nicht mehr vorhanden.`)
        return
      }
      setExpandedDirs((prev) => {
        const next = new Set(prev)
        const parts = match.path.split('/').slice(0, -1)
        let current = ''
        for (const part of parts) {
          current = current ? `${current}/${part}` : part
          next.add(current)
        }
        return next
      })
      openFileInEditor(match.path, files)
      setActiveTab('files')
      return
    }
    if (tab) setActiveTab(tab)
  }, [pendingOpenTarget, selectedId, detailsProjectId, files, openFileInEditor])

  const loadGitStatus = useCallback(async () => {
    if (!selectedId) return
    setGitBusy(true)
    try {
      const status = await aiApi.getProjectGitStatus(selectedId)
      setGitStatus(status)
    } catch (err: unknown) {
      toast.error(
        err instanceof SanitizedApiError
          ? err.message
          : 'Git-Status konnte nicht abgefragt werden.',
      )
    } finally {
      setGitBusy(false)
    }
  }, [selectedId])

  useEffect(() => {
    if (activeTab === 'settings' && selectedId) {
      void loadGitStatus()
    }
  }, [activeTab, selectedId, loadGitStatus])

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!draft.name.trim() || savingProject) return
    setSavingProject(true)
    try {
      const providerForCreate =
        createMode === 'create_repo'
          ? (draft.git_provider === 'gitlab' ? 'gitlab' : 'github')
          : createMode === 'clone_repo'
            ? (draft.git_provider ?? 'github')
            : null

      const created = await aiApi.createProject({
        ...draft,
        name: draft.name.trim(),
        description: draft.description?.trim() || null,
        system_prompt: draft.system_prompt?.trim() || null,
        local_directory: draft.local_directory?.trim() || null,
        git_provider: providerForCreate,
        git_repo_url: createMode === 'clone_repo' ? draft.git_repo_url?.trim() || null : null,
        git_branch: draft.git_branch?.trim() || 'main',
        git_token: draft.git_token?.trim() || null,
      })
      setProjects((prev) => [created, ...prev])
      setSelectedId(created.id)
      setProjectOpen(true)
      setCreateOpen(false)

      if (createMode === 'create_repo') {
        toast.info('Projekt erstellt. Lege neues Repository an…')
        try {
          const repoStatus = await aiApi.createProjectGitRepo(created.id, {
            repo_name: draft.name.trim(),
            private: createRepoPrivate,
            description: draft.description?.trim() || null,
            provider: providerForCreate === 'gitlab' ? 'gitlab' : 'github',
            token: draft.git_token?.trim() || null,
          })
          setGitStatus(repoStatus)
          const refreshed = await aiApi.getProject(created.id)
          setProjects((prev) => prev.map((p) => (p.id === refreshed.id ? refreshed : p)))
          await loadProjectDetails(created.id)
          toast.success('Neues Repository erstellt und verknüpft.')
        } catch (repoErr: unknown) {
          toast.warning(
            repoErr instanceof SanitizedApiError
              ? repoErr.message
              : 'Projekt wurde erstellt, aber das Repository konnte noch nicht angelegt werden. Prüfe dein GitHub-Token unter Git & Einstellungen.',
          )
        }
      } else if (createMode === 'clone_repo' && draft.git_repo_url?.trim()) {
        toast.info('Projekt angelegt. Klone Repository…')
        try {
          const syncStatus = await aiApi.syncProjectGit(created.id, {
            repo_url: draft.git_repo_url.trim(),
            branch: draft.git_branch?.trim() || 'main',
            provider: providerForCreate,
            token: draft.git_token?.trim() || null,
          })
          setGitStatus(syncStatus)
          await loadProjectDetails(created.id)
          toast.success('Repository geklont und synchronisiert.')
        } catch {
          toast.warning(
            'Projekt wurde erstellt, aber das Klonen schlug fehl. Prüfe URL und Token unter Git & Einstellungen.',
          )
        }
      } else {
        toast.success('Projekt wurde angelegt.')
      }

      setCreateMode('empty')
      setShowAdvancedCreate(false)
      setDraft({
        name: '',
        description: '',
        system_prompt: '',
        project_kind: 'coding',
        sandbox_enabled: true,
        local_directory: '',
        git_provider: null,
        git_repo_url: '',
        git_branch: 'main',
        git_token: '',
        team_id: null,
      })
    } catch (err: unknown) {
      toast.error(
        err instanceof SanitizedApiError
          ? err.message
          : 'Projekt konnte nicht angelegt werden.',
      )
    } finally {
      setSavingProject(false)
    }
  }

  const handleCreateRemoteRepoForExisting = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedProject || gitBusy) return
    setGitBusy(true)
    try {
      const status = await aiApi.createProjectGitRepo(selectedProject.id, {
        repo_name: newRepoName.trim() || selectedProject.name,
        private: newRepoPrivate,
        description: selectedProject.description,
        provider: newRepoProvider,
        token: newRepoToken.trim() || null,
      })
      setGitStatus(status)
      setCreateRepoOpen(false)
      setNewRepoToken('')
      const refreshed = await aiApi.getProject(selectedProject.id)
      setProjects((prev) => prev.map((p) => (p.id === refreshed.id ? refreshed : p)))
      await loadProjectDetails(selectedProject.id)
      toast.success('Repository erstellt und erster Stand übertragen.')
    } catch (err: unknown) {
      toast.error(
        err instanceof SanitizedApiError
          ? err.message
          : 'Repository konnte nicht erstellt werden.',
      )
    } finally {
      setGitBusy(false)
    }
  }

  const handleUpdateProject = async (patch: AiProjectWrite) => {
    if (!selectedProject || savingProject) return
    setSavingProject(true)
    try {
      const updated = await aiApi.updateProject(selectedProject.id, patch)
      setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
      toast.success('Projekteinstellungen gespeichert.')
    } catch (err: unknown) {
      toast.error(
        err instanceof SanitizedApiError
          ? err.message
          : 'Änderungen konnten nicht gespeichert werden.',
      )
    } finally {
      setSavingProject(false)
    }
  }

  const handleDeleteProject = async (proj: AiProject) => {
    const ok = await confirm({
      title: 'Projekt löschen',
      message: `Möchtest du das Projekt „${proj.name}“ mitsamt seinen Projektdateien wirklich löschen?`,
      confirmText: 'Löschen',
      danger: true,
    })
    if (!ok) return
    try {
      await aiApi.deleteProject(proj.id)
      const next = projects.filter((p) => p.id !== proj.id)
      setProjects(next)
      if (selectedId === proj.id) {
        setSelectedId(next[0]?.id ?? null)
        setProjectOpen(false)
      }
      toast.success('Projekt gelöscht.')
    } catch (err: unknown) {
      toast.error(
        err instanceof SanitizedApiError
          ? err.message
          : 'Projekt konnte nicht gelöscht werden.',
      )
    }
  }

  const handleSaveFile = useCallback(
    async (pathToSave: string, contentToSave?: string) => {
      if (!selectedProject || !pathToSave.trim()) return
      const tab = editorTabs.find((t) => t.path === pathToSave)
      const text = contentToSave !== undefined ? contentToSave : (tab?.content ?? '')

      setEditorTabs((prev) =>
        prev.map((t) => (t.path === pathToSave ? { ...t, saveState: 'saving' } : t)),
      )

      try {
        const saved = await aiApi.saveProjectFile(selectedProject.id, {
          path: pathToSave.trim(),
          content: text,
        })
        const modifiedTs = saved.updated_at
          ? Math.floor(new Date(saved.updated_at).getTime() / 1000)
          : Math.floor(Date.now() / 1000)

        setFiles((prev) => {
          const exists = prev.some((f) => f.path === saved.path)
          const next = exists
            ? prev.map((f) => (f.path === saved.path ? saved : f))
            : [...prev, saved].sort((a, b) => a.path.localeCompare(b.path))
          return next
        })

        // Expand parent folders if a new nested file was created
        const slashIdx = saved.path.lastIndexOf('/')
        if (slashIdx > 0) {
          const parts = saved.path.slice(0, slashIdx).split('/')
          setExpandedDirs((prev) => {
            const next = new Set(prev)
            let cur = ''
            for (const p of parts) {
              cur = cur ? `${cur}/${p}` : p
              next.add(cur)
            }
            return next
          })
        }

        setEditorTabs((prev) => {
          const exists = prev.some((t) => t.path === saved.path)
          if (exists) {
            return prev.map((t) =>
              t.path === saved.path
                ? {
                    ...t,
                    content: saved.content,
                    savedContent: saved.content,
                    saveState: 'clean',
                    modified: modifiedTs,
                    size: saved.size_bytes ?? saved.content.length,
                  }
                : t,
            )
          }
          return [
            ...prev,
            {
              path: saved.path,
              content: saved.content,
              savedContent: saved.content,
              revision: String(modifiedTs),
              lineEnding: detectLineEnding(saved.content),
              loading: false,
              saveState: 'clean',
              size: saved.size_bytes ?? saved.content.length,
              modified: modifiedTs,
              mode: null,
              owner: null,
              group: null,
            },
          ]
        })
        setActiveFilePath(saved.path)
        toast.success(`„${saved.path}“ gespeichert.`)
      } catch (err: unknown) {
        setEditorTabs((prev) =>
          prev.map((t) => (t.path === pathToSave ? { ...t, saveState: 'error' } : t)),
        )
        toast.error(
          err instanceof SanitizedApiError
            ? err.message
            : 'Datei konnte nicht gespeichert werden.',
        )
      }
    },
    [selectedProject, editorTabs],
  )

  const handleEditorChange = useCallback((path: string, content: string) => {
    setEditorTabs((prev) =>
      prev.map((tab) =>
        tab.path === path
          ? {
              ...tab,
              content,
              saveState: content === tab.savedContent ? 'clean' : 'dirty',
            }
          : tab,
      ),
    )
  }, [])

  const handleEditorCloseTab = useCallback(
    (path: string) => {
      setEditorTabs((prev) => {
        const next = prev.filter((t) => t.path !== path)
        if (activeFilePath === path) {
          setActiveFilePath(next[next.length - 1]?.path ?? null)
        }
        return next
      })
    },
    [activeFilePath],
  )

  const handleEditorReloadTab = useCallback(
    (path: string) => {
      const file = files.find((f) => f.path === path)
      if (!file) return
      setEditorTabs((prev) =>
        prev.map((t) =>
          t.path === path
            ? { ...t, content: file.content, savedContent: file.content, saveState: 'clean' }
            : t,
        ),
      )
    },
    [files],
  )

  const handleToggleDir = useCallback((dirPath: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(dirPath)) next.delete(dirPath)
      else next.add(dirPath)
      return next
    })
  }, [])

  // Vorschau-Dokument (siehe previewBundle.ts) plus Inspektor-Br?cke.
  const previewSrcDoc = useMemo(() => {
    const activeFiles: Array<{ path: string; content: string }> =
      previewEnv === 'production' ? productionFiles : files
    const base = buildPreviewDocument(activeFiles, envState?.preview?.entry_file ?? null)
    if (!base) return null
    let doc = base

    const bridgeScript = `
<script>
(function() {
  document.addEventListener('click', function(e) {
    var target = e.target;
    while (target && target.tagName !== 'A') {
      target = target.parentElement;
    }
    if (target && target.tagName === 'A') {
      var href = target.getAttribute('href') || '';
      if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
  }, true);

  var activeHover = null;
  var style = document.createElement('style');
  style.id = '__singra_inspector_style__';
  style.textContent = '.singra-inspect-hover { outline: 2px dashed #06b6d4 !important; outline-offset: -2px !important; cursor: crosshair !important; background-color: rgba(6,182,212,0.1) !important; }';
  document.head.appendChild(style);

  window.__singra_inspect_active__ = false;

  window.addEventListener('message', function(ev) {
    if (ev.data && ev.data.type === 'SINGRA_SET_INSPECT') {
      window.__singra_inspect_active__ = !!ev.data.active;
      if (!window.__singra_inspect_active__ && activeHover) {
        activeHover.classList.remove('singra-inspect-hover');
        activeHover = null;
      }
    }
  });

  document.addEventListener('mouseover', function(e) {
    if (!window.__singra_inspect_active__) return;
    if (activeHover && activeHover !== e.target) {
      activeHover.classList.remove('singra-inspect-hover');
    }
    activeHover = e.target;
    if (activeHover) {
      activeHover.classList.add('singra-inspect-hover');
    }
  }, true);

  document.addEventListener('click', function(e) {
    if (!window.__singra_inspect_active__) return;
    e.preventDefault();
    e.stopPropagation();
    var el = e.target;
    if (!el) return;
    var tag = el.tagName.toLowerCase();
    var id = el.id ? '#' + el.id : '';
    var cls = (typeof el.className === 'string' && el.className.trim())
      ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.')
      : '';
    var textSnippet = (el.innerText || el.textContent || '').trim().slice(0, 40);
    var desc = tag + id + cls + (textSnippet ? ' ("' + textSnippet + '")' : '');

    window.parent.postMessage({
      type: 'SINGRA_ELEMENT_SELECTED',
      selector: desc,
      tag: tag,
      id: el.id || null,
      classes: el.className || null,
      text: textSnippet
    }, '*');
  }, true);
})();
</script>
`
    if (doc.includes('</body>')) {
      doc = doc.replace('</body>', `${bridgeScript}</body>`)
    } else {
      doc += bridgeScript
    }

    return doc
  }, [files, productionFiles, previewEnv, envState?.preview?.entry_file])

  // Neuer Stand, neue Prüfung: alte Fehlermeldungen gelten nicht mehr.
  useEffect(() => {
    setPreviewError(null)
    setPreviewErrorDismissed(false)
  }, [previewSrcDoc])

  useEffect(() => {
    const handleMsg = (ev: MessageEvent) => {
      if (isPreviewErrorMessage(ev.data)) {
        if (ev.source !== previewIframeRef.current?.contentWindow) return
        const { message, detail } = ev.data
        // Anonyme Browser-Skriptfehler ohne Stacktrace/Detail ignorieren (z. B. unkritische Cross-Origin Asset-Warnungen)
        if ((message === 'Skriptfehler' || message === 'Script error.') && !detail) {
          return
        }
        // Der erste Fehler ist meist die Ursache, Folgefehler überschreiben ihn nicht.
        setPreviewError((prev) => prev ?? { message, detail })
        return
      }
      if (ev.data && ev.data.type === 'SINGRA_ELEMENT_SELECTED') {
        const selector = String(ev.data.selector || 'Element')
        setInspectElement(selector)
        setInspectMode(false)
        toast.success(`Element ausgewählt: ${selector}`)
        try {
          previewIframeRef.current?.contentWindow?.postMessage(
            { type: 'SINGRA_SET_INSPECT', active: false },
            '*',
          )
        } catch (err) {
          still(err, 'singra:preview:postMessage:deactivate')
        }
      }
    }
    window.addEventListener('message', handleMsg)
    return () => window.removeEventListener('message', handleMsg)
  }, [])

  useEffect(() => {
    try {
      previewIframeRef.current?.contentWindow?.postMessage(
        { type: 'SINGRA_SET_INSPECT', active: inspectMode },
        '*',
      )
    } catch (err) {
      still(err, 'singra:preview:postMessage:toggle')
    }
  }, [inspectMode])

  const handleDeleteFile = async (path: string) => {
    if (!selectedProject) return
    const ok = await confirm({
      title: 'Datei löschen',
      message: `Soll die Datei „${path}“ aus dem Projekt entfernt werden?`,
      confirmText: 'Löschen',
      danger: true,
    })
    if (!ok) return
    try {
      await aiApi.deleteProjectFile(selectedProject.id, path)
      const remaining = files.filter((f) => f.path !== path)
      setFiles(remaining)
      handleEditorCloseTab(path)
      toast.success('Datei gelöscht.')
    } catch (err: unknown) {
      toast.error(
        err instanceof SanitizedApiError
          ? err.message
          : 'Datei konnte nicht gelöscht werden.',
      )
    }
  }

  const handleRunCommand = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedProject || !commandInput.trim() || runningCmd) return
    const cmd = commandInput.trim()
    setRunningCmd(true)
    try {
      const res = await aiApi.execProjectCommand(selectedProject.id, {
        command: cmd,
        timeout_seconds: 60,
      })
      setExecHistory((prev) => [
        { command: cmd, result: res, timestamp: new Date().toLocaleTimeString() },
        ...prev,
      ])
      setCommandInput('')
      void loadProjectDetails(selectedProject.id)
    } catch (err: unknown) {
      toast.error(
        err instanceof SanitizedApiError
          ? err.message
          : 'Befehl konnte nicht ausgeführt werden.',
      )
    } finally {
      setRunningCmd(false)
    }
  }

  const handleGitSync = async () => {
    if (!selectedProject || gitBusy) return
    setGitBusy(true)
    try {
      const status = await aiApi.syncProjectGit(selectedProject.id)
      setGitStatus(status)
      await loadProjectDetails(selectedProject.id)
      toast.success('Repository erfolgreich abgeglichen.')
    } catch (err: unknown) {
      toast.error(
        err instanceof SanitizedApiError
          ? err.message
          : 'Git-Synchronisierung fehlgeschlagen.',
      )
    } finally {
      setGitBusy(false)
    }
  }

  const handleGitCommit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedProject || !commitMessage.trim() || gitBusy) return
    setGitBusy(true)
    try {
      const status = await aiApi.commitProjectGit(selectedProject.id, {
        message: commitMessage.trim(),
        push: pushOnCommit,
      })
      setGitStatus(status)
      setCommitMessage('')
      toast.success(
        pushOnCommit
          ? 'Änderungen gespeichert und zum Repository übertragen.'
          : 'Änderungen lokal im Projekt gespeichert.',
      )
    } catch (err: unknown) {
      toast.error(
        err instanceof SanitizedApiError
          ? err.message
          : 'Git-Commit fehlgeschlagen.',
      )
    } finally {
      setGitBusy(false)
    }
  }

  const handleStartNewProjectChat = async (initialTitle?: string) => {
    if (!selectedProject) return
    try {
      const conv = await aiApi.createConversation({
        title: initialTitle || `${selectedProject.name} Chat`,
        project_id: selectedProject.id,
      })
      onOpenProjectChat(selectedProject.id, conv.id)
    } catch (err: unknown) {
      toast.error(
        err instanceof SanitizedApiError
          ? err.message
          : 'Projekt-Chat konnte nicht gestartet werden.',
      )
    }
  }

  const handleApplyElementWithSingra = async (selector: string) => {
    if (!selectedProject) return
    const promptHint = `Bitte passe folgendes Element in diesem Projekt an: \`${selector}\` — `
    try {
      sessionStorage.setItem('singra-inspect-prompt', promptHint)
      window.dispatchEvent(
        new CustomEvent('singra-inspect-element', {
          detail: { projectId: selectedProject.id, selector, promptHint },
        }),
      )
    } catch (err) {
      still(err, 'singra:inspect:sessionStorage')
    }

    const targetId =
      inspectTargetChatId === '__latest__'
        ? projectChats[0]?.id ?? '__new__'
        : inspectTargetChatId

    if (targetId && targetId !== '__new__') {
      onOpenProjectChat(selectedProject.id, targetId)
      return
    }
    await handleStartNewProjectChat(`Anpassung: ${selector.slice(0, 42)}`)
  }

  /** Legt einen Auftrag ab, den der Projekt-Chat nach dem Öffnen selbst abschickt. */
  const sendTaskToProjectChat = async (prompt: string, chatChoice: string, newChatTitle: string) => {
    if (!selectedProject) return
    try {
      sessionStorage.setItem(
        'singra-auto-send-prompt',
        JSON.stringify({ projectId: selectedProject.id, prompt }),
      )
    } catch (err) {
      still(err, 'singra:autoSendPrompt:write')
      toast.error('Der Auftrag konnte nicht an den Chat übergeben werden.')
      return
    }
    const targetId = chatChoice === '__latest__' ? projectChats[0]?.id ?? '__new__' : chatChoice
    if (targetId && targetId !== '__new__') {
      onOpenProjectChat(selectedProject.id, targetId)
      return
    }
    await handleStartNewProjectChat(newChatTitle)
  }

  const handleFixPreviewWithSingra = async () => {
    const entry = envState?.preview?.entry_file || 'nicht konfiguriert'
    const prompt = previewError
      ? [
          'Die Live-Vorschau dieses Projekts zeigt einen Fehler.',
          '',
          `Fehler: ${previewError.message}`,
          previewError.detail ? `Details:\n\`\`\`\n${previewError.detail.slice(0, 2500)}\n\`\`\`` : '',
          `Vorschau-Einstieg: ${entry}`,
          '',
          'Bitte finde die Ursache und behebe sie in den Projektdateien. Richte die Vorschau bei Bedarf mit `configure_preview` neu ein und prüfe danach mit `test_project`, dass sie fehlerfrei lädt. Melde dich erst, wenn das nachgewiesen ist.',
        ]
          .filter(Boolean)
          .join('\n')
      : [
          'Für dieses Projekt gibt es noch keine funktionierende Live-Vorschau.',
          '',
          'Bitte lege eine Browser-Einstiegsdatei an (z. B. `index.html` mit `#root` und `src/main.tsx`), halte Backend- und Testdateien in `backend/` bzw. `tests/` getrennt und registriere die Vorschau mit `configure_preview`. Prüfe anschließend mit `test_project`, dass `preview_ready: true` gemeldet wird.',
        ].join('\n')
    await sendTaskToProjectChat(prompt, fixTargetChatId, 'Vorschau reparieren')
  }

  const handleGuidedPublish = async () => {
    const nodeLabel =
      selectedNodeId === '__auto__'
        ? 'automatisch (lokale Haupt-Node)'
        : availableNodes.find((n) => n.id === selectedNodeId)?.name ?? selectedNodeId
    const domain = publishDomain.trim()
    const reach =
      publishDomainMode === 'cloudflare'
        ? `über Cloudflare${domain ? ` unter ${domain}` : ''} (DNS bitte direkt einrichten, falls das Cloudflare-Werkzeug verfügbar ist)`
        : publishDomainMode === 'external'
          ? `über meine eigene Domain${domain ? ` ${domain}` : ''} (erkläre mir bitte Schritt für Schritt, was ich bei meinem Domain-Anbieter eintragen muss)`
          : 'erst einmal direkt über IP-Adresse und Port'
    const modeLabel =
      publishMode === 'fullstack_split'
        ? 'Getrenntes Fullstack-Deployment (Frontend über Caddy + Backend im Docker-Container)'
        : publishMode === 'backend'
          ? 'Nur Backend (Docker-Container mit Port & PostgreSQL)'
          : 'Nur Frontend (Caddy Static Web/SPA)'
    const prompt = [
      'Bitte schalte dieses Projekt gemeinsam mit mir online.',
      '',
      `- Architektur: ${modeLabel}`,
      `- Ziel-Node: ${nodeLabel}`,
      `- Erreichbarkeit: ${reach}`,
      domain ? `- Domain: ${domain}` : '',
      publishMode !== 'frontend' ? `- PostgreSQL-Datenbank: ${publishEnableDb ? 'Ja (automatisch einrichten)' : 'Nein'}` : '',
      publishApiPath.trim() ? `- API-Proxy-Pfad: ${publishApiPath.trim()}` : '',
      publishBackendProxyUrl.trim() ? `- Backend-Zieladresse: ${publishBackendProxyUrl.trim()}` : '',
      releaseNotes.trim() ? `- Release-Notiz: ${releaseNotes.trim()}` : '',
      '',
      'Ablauf:',
      '1. Prüfe den aktuellen Stand mit `test_project` und behebe Fehler, bevor du veröffentlichst.',
      `2. Veröffentliche mit \`publish_production\` (mode="${publishMode}", node_id="${selectedNodeId}"${domain ? `, domain="${domain}"` : ''}, enable_database=${publishEnableDb}${publishApiPath ? `, api_path="${publishApiPath.trim()}"` : ''}${publishBackendProxyUrl ? `, backend_proxy_url="${publishBackendProxyUrl.trim()}"` : ''}).`,
      '3. Prüfe, ob das Projekt danach erreichbar ist, und nenne mir Adresse und Port.',
      '4. Führe mich in einfachen Worten durch die Domain-Einrichtung (A-Record oder CNAME, welche IP, welcher Port) oder richte sie über Cloudflare selbst ein.',
    ]
      .filter(Boolean)
      .join('\n')
    setPublishModalOpen(false)
    await sendTaskToProjectChat(prompt, '__latest__', 'Online schalten')
  }

  const handlePublishToProduction = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedProject || publishing) return
    setPublishing(true)
    try {
      const res = await aiApi.publishProjectToProduction(selectedProject.id, {
        node_id: selectedNodeId === '__auto__' ? null : selectedNodeId,
        release_notes: releaseNotes.trim() || null,
        mode: publishMode,
        domain: publishDomain.trim() || null,
        enable_database: publishEnableDb,
        api_path: publishApiPath.trim() || '/api/*',
        backend_proxy_url: publishBackendProxyUrl.trim() || null,
      })
      setEnvState(res.environment)
      const prodFiles = await aiApi
        .listProjectProductionFiles(selectedProject.id)
        .catch(() => [])
      setProductionFiles(prodFiles)
      setPreviewEnv('production')
      setPublishModalOpen(false)
      setReleaseNotes('')
      const portInfo = res.frontend_port
        ? `Web-Port ${res.frontend_port}`
        : res.backend_port
          ? `Backend-Port ${res.backend_port}`
          : ''
      const modeText =
        res.mode === 'fullstack_split'
          ? 'Fullstack (Frontend & Backend getrennt)'
          : res.mode === 'backend'
            ? 'Backend'
            : 'Frontend'
      toast.success(
        `Auf Node „${res.node_name}“ als ${modeText} veröffentlicht (${res.published_files} Dateien, Server #${res.server_id} aktiv${portInfo ? `, ${portInfo}` : ''}).`,
      )
    } catch (err: unknown) {
      toast.error(
        err instanceof SanitizedApiError
          ? err.message
          : 'Veröffentlichung fehlgeschlagen.',
      )
    } finally {
      setPublishing(false)
    }
  }

  const handleRunVisualInspection = async () => {
    if (!selectedProject || visualLoading) return
    setVisualModalOpen(true)
    setVisualLoading(true)
    try {
      const res = await aiApi.inspectProjectPreview(selectedProject.id, {
        viewports: ['mobile', 'desktop'],
      })
      setVisualInspection(res)
      if (!res.ok) {
        toast.warning(
          `Sichtprüfung: ${res.issues.length} Auffälligkeit(en) auf Smartphone oder Desktop erkannt.`,
        )
      } else {
        toast.success('Sichtprüfung bestanden: Mobil- und Desktop-Layout sind fehlerfrei.')
      }
    } catch (err: unknown) {
      still(err, 'singra:visualInspect')
      toast.error(err instanceof SanitizedApiError ? err.message : 'Sichtprüfung fehlgeschlagen.')
    } finally {
      setVisualLoading(false)
    }
  }

  const handleFixVisualIssuesWithSingra = async (issues: string[]) => {
    const prompt = [
      'Bei der visuellen Sichtprüfung der Vorschau wurden folgende Layout- und Render-Probleme auf Smartphone oder Desktop erkannt:',
      '',
      ...issues.map((iss) => `- ${iss}`),
      '',
      'Bitte korrigiere die betroffenen Projektdateien (z. B. overflow-x-hidden, max-w-full, responsive Tailwind-Klassen, Schriftgrößen oder DOM-Struktur), damit die Seite auf dem Smartphone sauber ohne seitlichen Überlauf dargestellt wird und keine JavaScript-Fehler auftreten.',
      'Prüfe nach deiner Reparatur mit `project_workspace` (action: "preview_inspect"), dass alle Viewports fehlerfrei sind.',
    ].join('\n')
    await sendTaskToProjectChat(prompt, '__latest__', 'Layout & Mobile optimieren')
  }

  const handleSaveTeamShare = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedProject || savingProject) return
    const nextTeamId =
      selectedTeamShareId === '__personal__' ? null : Number(selectedTeamShareId)
    await handleUpdateProject({
      team_id: nextTeamId,
    })
    setTeamShareModalOpen(false)
  }

  if (loading) {
    return (
      <div className="flex h-full flex-1 items-center justify-center">
        <Spinner size="lg" className="text-primary" />
      </div>
    )
  }

  return (
    <div className="flex h-full w-full min-w-0 min-h-0 flex-1 flex-col overflow-hidden bg-surface">
      {!projectOpen || !selectedProject ? (
        /* Calm Project Overview */
        <div className="flex flex-1 min-h-0 flex-col overflow-y-auto p-4 sm:p-6">
          <div className="mx-auto w-full max-w-4xl space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant/20 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <Layers className="h-5 w-5 text-primary" aria-hidden="true" />
                  <h2 className="font-headline text-lg font-semibold text-on-surface">
                    Projekte
                  </h2>
                  <span className="rounded-full bg-surface-container-high px-2.5 py-0.5 text-xs font-medium text-on-surface-variant">
                    {projects.length}
                  </span>
                </div>
                <p className="mt-1 text-xs sm:text-sm text-on-surface-variant">
                  Wähle ein Projekt aus, um deine Unterhaltungen, Dateien und die Vorschau zu öffnen.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                onClick={() => setCreateOpen(true)}
                className="rounded-full px-4"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Neues Projekt
              </Button>
            </div>

            {projects.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-outline-variant/25 bg-surface-container-low/30 p-8 sm:p-12 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary mb-4">
                  <Code2 className="h-6 w-6" aria-hidden="true" />
                </div>
                <h3 className="font-headline text-base sm:text-lg font-semibold text-on-surface">
                  Dein Projekt-Arbeitsbereich
                </h3>
                <p className="mt-2 max-w-md text-xs sm:text-sm text-on-surface-variant leading-relaxed">
                  Arbeite gemeinsam mit Singra an eigenen Anwendungen, Skripten oder Dokumenten. Du kannst leer starten, direkt ein neues GitHub-Repository anlegen oder bestehenden Code klonen.
                </p>
                <Button type="button" className="mt-5 rounded-full px-5" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Neues Projekt starten
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {projects.map((proj) => (
                  <button
                    key={proj.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(proj.id)
                      setProjectOpen(true)
                    }}
                    className="group flex flex-col justify-between rounded-2xl border border-outline-variant/25 bg-surface-container-low/40 p-4 text-left transition-all hover:border-primary/45 hover:bg-surface-container-high/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  >
                    <div className="min-w-0 w-full">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary group-hover:bg-primary/20 transition-colors">
                            <Folder className="h-4 w-4" aria-hidden="true" />
                          </div>
                          <span className="font-semibold text-sm sm:text-base text-on-surface truncate">
                            {proj.name}
                          </span>
                        </div>
                        <ChevronRight
                          className="h-4 w-4 shrink-0 text-on-surface-variant group-hover:text-primary group-hover:translate-x-0.5 transition-all"
                          aria-hidden="true"
                        />
                      </div>
                      {proj.description ? (
                        <p className="mt-2 line-clamp-2 text-xs text-on-surface-variant leading-relaxed">
                          {proj.description}
                        </p>
                      ) : (
                        <p className="mt-2 text-xs text-on-surface-variant/70">
                          Klicken, um Arbeitsbereich, Dateien und Chats zu öffnen
                        </p>
                      )}
                    </div>

                    {proj.git_repo_url && (
                      <div className="mt-3 flex items-center gap-1.5 pt-2.5 border-t border-outline-variant/15 text-xs text-on-surface-variant">
                        <GitBranch className="h-3.5 w-3.5 shrink-0 text-primary/80" aria-hidden="true" />
                        <span className="truncate">{proj.git_branch || 'main'}</span>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Cozy Project Workspace */
        <div className="flex flex-1 min-w-0 min-h-0 flex-col overflow-hidden">
          <>
            {/* Calm Project Top Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant/20 bg-surface-container-low/35 px-4 py-3 shrink-0">
              <div className="min-w-0 flex items-center gap-2.5">
                <Kurzinfo text="Zurück zur Projektübersicht">
                  <button
                    type="button"
                    onClick={() => setProjectOpen(false)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant/30 bg-surface-container-high/55 px-3 py-1.5 text-xs font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors shrink-0"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Alle Projekte</span>
                  </button>
                </Kurzinfo>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="font-headline text-base font-semibold text-on-surface truncate">
                      {selectedProject.name}
                    </h2>
                    {selectedProject.project_kind === 'coding' && (
                      <span
                        className={[
                          'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-label-sm font-medium border',
                          envState?.production?.published
                            ? 'border-status-success/35 bg-status-success/12 text-status-success'
                            : 'border-primary/30 bg-primary/10 text-primary',
                        ].join(' ')}
                      >
                        <Database className="h-3 w-3" aria-hidden="true" />
                        <span>
                          {envState?.production?.published
                            ? `Live (Server #${envState.production.server_id})`
                            : 'Entwicklung (Dev)'}
                        </span>
                      </span>
                    )}
                    {!selectedProject.git_repo_url && (
                      <button
                        type="button"
                        onClick={() => {
                          setNewRepoName(selectedProject.name)
                          setCreateRepoOpen(true)
                        }}
                        className="inline-flex items-center gap-1 rounded-full border border-outline-variant/35 bg-surface-container-high/50 px-2.5 py-0.5 text-label-sm font-medium text-on-surface-variant hover:text-primary hover:border-primary/40 transition-colors"
                      >
                        <FolderGit2 className="h-3 w-3" aria-hidden="true" />
                        <span>Mit GitHub verbinden</span>
                      </button>
                    )}
                    {agentsRules?.found && (
                      <Kurzinfo text="Projektregeln (AGENTS.md) ansehen">
                        <button
                          type="button"
                          onClick={() => setShowAgentsModal(true)}
                          className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-label-sm font-medium text-primary hover:bg-primary/20 transition-colors"
                        >
                          <FileText className="h-3 w-3" aria-hidden="true" />
                          <span>Projektregeln</span>
                          <Eye className="h-2.5 w-2.5 opacity-70" />
                        </button>
                      </Kurzinfo>
                    )}
                  </div>
                  {selectedProject.description && (
                    <p className="text-xs text-on-surface-variant truncate mt-0.5">
                      {selectedProject.description}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Kurzinfo text="Projekt mit einem Team teilen">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="rounded-full px-3"
                    onClick={() => {
                      setSelectedTeamShareId(
                        selectedProject.team_id ? String(selectedProject.team_id) : '__personal__',
                      )
                      setTeamShareModalOpen(true)
                    }}
                  >
                    <Users className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="hidden sm:inline">
                      {selectedProject.team_id
                        ? teams.find((t) => t.id === selectedProject.team_id)?.name ?? 'Team'
                        : 'Team & Teilen'}
                    </span>
                  </Button>
                </Kurzinfo>

                {selectedProject.project_kind === 'coding' && (
                  <Kurzinfo text="Entwicklungsstand auf einer Node online schalten und ins Server-Dashboard übernehmen">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="rounded-full px-3.5 border-primary/30 text-primary hover:bg-primary/15"
                      onClick={() => setPublishModalOpen(true)}
                    >
                      <Rocket className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>
                        {envState?.production?.published
                          ? 'Update veröffentlichen'
                          : 'Online schalten'}
                      </span>
                    </Button>
                  </Kurzinfo>
                )}

                <Button
                  type="button"
                  size="sm"
                  className="rounded-full px-3.5"
                  onClick={() => void handleStartNewProjectChat()}
                >
                  <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                  Neuer Chat
                </Button>

                <Kurzinfo text="Projekt löschen">
                  <button
                    type="button"
                    onClick={() => void handleDeleteProject(selectedProject)}
                    aria-label="Projekt löschen"
                    className="grid h-10 w-10 sm:h-9 sm:w-9 shrink-0 place-items-center rounded-full border border-outline-variant/30 bg-surface-container-high/85 text-on-surface-variant hover:border-status-destructive/40 hover:bg-status-destructive/15 hover:text-status-destructive backdrop-blur-md shadow-sm transition-all active:scale-95"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </Kurzinfo>
              </div>
            </div>

            {/* 4 Cozy Workspace Tabs: Mobile 4-Column Control (kein horizontales Swipen), Desktop Pills */}
            <div className="grid grid-cols-4 gap-1 border-b border-outline-variant/20 bg-surface-container-low/30 p-1 sm:hidden shrink-0">
              {(
                [
                  { id: 'chats', label: 'Unterhaltungen', mobileLabel: 'Chats', icon: MessageSquare },
                  { id: 'files', label: 'Dateien', mobileLabel: 'Dateien', icon: FileCode },
                  { id: 'preview', label: 'Vorschau', mobileLabel: 'Vorschau', icon: Globe },
                  { id: 'settings', label: 'Einstellungen', mobileLabel: 'Optionen', icon: Settings2 },
                ] as const
              ).map((tab) => {
                const Icon = tab.icon
                const active = activeTab === tab.id
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={[
                      'flex flex-col items-center justify-center gap-1 py-1.5 px-0.5 rounded-xl text-label-sm font-medium transition-colors text-center',
                      active
                        ? 'bg-primary/15 text-primary'
                        : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/40',
                    ].join(' ')}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="truncate max-w-full text-label-sm leading-tight">{tab.mobileLabel}</span>
                  </button>
                )
              })}
            </div>

            <div className="hidden sm:flex items-center gap-1.5 border-b border-outline-variant/20 bg-surface-container-low/15 px-4 py-1.5 overflow-x-auto no-scrollbar shrink-0">
              {(
                [
                  { id: 'chats', label: 'Unterhaltungen', icon: MessageSquare },
                  { id: 'files', label: 'Dateien', icon: FileCode },
                  { id: 'preview', label: 'Vorschau', icon: Globe },
                  { id: 'settings', label: 'Einstellungen', icon: Settings2 },
                ] as const
              ).map((tab) => {
                const Icon = tab.icon
                const active = activeTab === tab.id
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={[
                      'inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors shrink-0 border',
                      active
                        ? 'bg-primary/15 text-primary border-primary/30'
                        : 'text-on-surface-variant hover:bg-surface-container-high/50 hover:text-on-surface border-transparent',
                    ].join(' ')}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{tab.label}</span>
                  </button>
                )
              })}
            </div>

            {/* Tab Content */}
            <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 flex flex-col">
              {activeTab === 'chats' && (
                <div className="max-w-3xl w-full mx-auto space-y-4 py-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-on-surface">
                        Unterhaltungen im Projekt
                      </h3>
                      <p className="text-xs text-on-surface-variant">
                        Singra kennt hier automatisch deine Dateien, Projektanweisungen und den aktuellen Entwicklungsstand.
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      className="rounded-full"
                      onClick={() => void handleStartNewProjectChat()}
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      Unterhaltung starten
                    </Button>
                  </div>

                  {projectChats.length === 0 ? (
                    <div className="rounded-2xl border border-outline-variant/25 bg-surface-container-low/30 p-8 text-center">
                      <Sparkles className="h-7 w-7 text-primary/60 mx-auto mb-2.5" />
                      <p className="text-sm font-medium text-on-surface">
                        Noch keine Unterhaltung in „{selectedProject.name}“
                      </p>
                      <p className="mt-1 text-xs text-on-surface-variant max-w-md mx-auto">
                        Starte einen Projekt-Chat, um Ideen zu besprechen, Dateien schreiben zu lassen oder gemeinsam an Code zu arbeiten.
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        className="mt-4 rounded-full"
                        onClick={() => void handleStartNewProjectChat()}
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                        Jetzt loslegen
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {projectChats.map((chat) => (
                        <div
                          key={chat.id}
                          className="flex items-center justify-between rounded-2xl border border-outline-variant/25 bg-surface-container-low/40 px-4 py-3 hover:border-primary/35 transition-colors"
                        >
                          <button
                            type="button"
                            onClick={() => onOpenProjectChat(selectedProject.id, chat.id)}
                            className="flex min-w-0 flex-1 items-center gap-3 text-left"
                          >
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
                              <MessageSquare className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-on-surface">
                                {chat.title}
                              </div>
                              <div className="text-xs text-on-surface-variant">
                                Zuletzt aktiv: {new Date(chat.updated_at).toLocaleString()}
                              </div>
                            </div>
                          </button>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="rounded-full"
                            onClick={() => onOpenProjectChat(selectedProject.id, chat.id)}
                          >
                            Öffnen
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'files' && (
                <div className="flex flex-1 min-h-[480px] flex-col gap-3 overflow-hidden">
                  {/* Server File Manager Toolbar (Pfadleiste + ActionMenu) */}
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-outline-variant/25 bg-surface-container-low/40 px-3.5 py-2 text-xs shrink-0">
                    <Pfadleiste
                      label="Projektpfad"
                      stamm={{
                        key: '',
                        label: selectedProject.name,
                        icon: <Folder className="h-3.5 w-3.5 shrink-0" />,
                      }}
                      teile={breadcrumbTeile}
                      onWaehlen={(dirKey) => {
                        if (!dirKey) {
                          setExpandedDirs((prev) => new Set([...prev, '']))
                          return
                        }
                        setExpandedDirs((prev) => new Set([...prev, '', dirKey]))
                      }}
                    />

                    <div className="flex items-center gap-2">
                      <ActionMenu
                        label="Neu"
                        icon={<Plus className="h-3.5 w-3.5" />}
                        align="end"
                        items={[
                          {
                            key: 'new-file',
                            label: 'Neue Datei',
                            icon: <FilePlus2 className="h-4 w-4" />,
                            onSelect: () => {
                              const currentDir = activeFilePath ? parentPath(activeFilePath) : ''
                              setNewFilePath(currentDir ? `${currentDir}/` : '')
                              setNewFileModalOpen(true)
                            },
                          },
                          {
                            key: 'new-folder',
                            label: 'Neuer Ordner',
                            icon: <FolderPlus className="h-4 w-4" />,
                            onSelect: () => {
                              const currentDir = activeFilePath ? parentPath(activeFilePath) : ''
                              setNewFilePath(currentDir ? `${currentDir}/neuer-ordner/README.md` : 'neuer-ordner/README.md')
                              setNewFileModalOpen(true)
                            },
                          },
                        ]}
                      />
                      <Kurzinfo text="Dateien aktualisieren">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => void loadProjectDetails(selectedProject.id)}
                          aria-label="Dateien aktualisieren"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                      </Kurzinfo>
                    </div>
                  </div>

                  <div className="flex flex-1 min-h-0 flex-col md:flex-row gap-3 overflow-hidden">
                    {/* Left: Hierarchical Server FileTree */}
                    <div className="w-full md:w-64 xl:w-72 shrink-0 rounded-2xl border border-outline-variant/25 bg-surface-container-low/35 flex flex-col max-h-60 md:max-h-none overflow-hidden">
                      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-outline-variant/20">
                        <span className="text-xs font-semibold text-on-surface">
                          Ordner & Dateien
                        </span>
                        {allDirs.length > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedDirs((prev) =>
                                prev.size > 1 ? new Set(['']) : new Set(['', ...allDirs]),
                              )
                            }
                            className="text-label-sm text-on-surface-variant hover:text-on-surface"
                          >
                            {expandedDirs.size > 1 ? 'Einklappen' : 'Alle öffnen'}
                          </button>
                        )}
                      </div>

                      {files.length > 3 && (
                        <div className="px-2.5 pt-2">
                          <div className="relative">
                            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-on-surface-variant" />
                            <input
                              type="search"
                              value={fileSearchQuery}
                              onChange={(e) => setFileSearchQuery(e.target.value)}
                              placeholder="Datei suchen…"
                              aria-label="Projektdateien durchsuchen"
                              className="h-7 w-full rounded-lg border border-outline-variant/25 bg-surface-container/60 pl-8 pr-2 text-xs text-on-surface placeholder:text-on-surface-variant/70 focus:border-primary/50 focus:outline-none"
                            />
                          </div>
                        </div>
                      )}

                      <div className="flex-1 min-h-0 overflow-y-auto py-1">
                        <FileTree
                          nodes={treeNodes}
                          expanded={expandedDirs}
                          loadingPaths={new Set()}
                          activePath={activeFilePath}
                          searchResults={searchResults}
                          contentMatches={null}
                          searchTruncated={false}
                          emptyLabel="Noch keine Dateien im Projekt."
                          searchEmptyLabel="Keine passende Datei gefunden."
                          searchTruncatedLabel=""
                          onToggle={handleToggleDir}
                          onOpenFile={(path) => openFileInEditor(path)}
                          onContextMenu={(e, entry, parent) => {
                            e.preventDefault()
                            const fullPath = parent ? `${parent}/${entry.name}` : entry.name
                            setContextMenu({
                              x: e.clientX,
                              y: e.clientY,
                              path: fullPath,
                              isDir: entry.is_dir,
                            })
                          }}
                          onDragStart={() => undefined}
                          onDropFolder={() => undefined}
                        />
                      </div>

                      {/* Bottom Bar in File Tree: Toggle Terminal Drawer */}
                      <div className="border-t border-outline-variant/20 px-3 py-2 flex items-center justify-between bg-surface-container-low/50">
                        <button
                          type="button"
                          onClick={() => setTerminalOpen((v) => !v)}
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-on-surface-variant hover:text-primary transition-colors"
                        >
                          <Terminal className="h-3.5 w-3.5" />
                          <span>Konsole</span>
                          {terminalOpen ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronUp className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Right: Shared Multi-Tab FileEditorWorkspace */}
                    <div className="flex flex-1 min-w-0 min-h-[380px] flex-col rounded-2xl border border-outline-variant/25 bg-surface-container-low/35 overflow-hidden">
                      <FileEditorWorkspace
                        tabs={editorTabs}
                        activePath={activeFilePath}
                        canWrite={true}
                        tabListLabel="Geöffnete Projektdateien"
                        horizontalScrollHint="Horizontal scrollen"
                        ortLabel={
                          activeFilePath
                            ? `${selectedProject.name} / ${activeFilePath}`
                            : selectedProject.name
                        }
                        onActivate={(path) => setActiveFilePath(path)}
                        onChange={handleEditorChange}
                        onSave={(path) => void handleSaveFile(path)}
                        onClose={handleEditorCloseTab}
                        onReload={handleEditorReloadTab}
                      />
                    </div>
                  </div>

                  <Kontextmenue
                    ort={contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null}
                    label="Datei-Aktionen"
                    onSchliessen={() => setContextMenu(null)}
                    items={
                      contextMenu
                        ? contextMenu.isDir
                          ? [
                              {
                                key: 'toggle',
                                label: expandedDirs.has(contextMenu.path)
                                  ? 'Ordner einklappen'
                                  : 'Ordner öffnen',
                                icon: <Folder className="h-4 w-4" />,
                                onSelect: () => {
                                  handleToggleDir(contextMenu.path)
                                  setContextMenu(null)
                                },
                              },
                              {
                                key: 'new-in-dir',
                                label: 'Neue Datei in diesem Ordner',
                                icon: <FilePlus2 className="h-4 w-4" />,
                                onSelect: () => {
                                  setNewFilePath(`${contextMenu.path}/`)
                                  setNewFileModalOpen(true)
                                  setContextMenu(null)
                                },
                              },
                            ]
                          : [
                              {
                                key: 'open',
                                label: 'Im Editor öffnen',
                                icon: <FileCode className="h-4 w-4" />,
                                onSelect: () => {
                                  openFileInEditor(contextMenu.path)
                                  setContextMenu(null)
                                },
                              },
                              {
                                key: 'new-sibling',
                                label: 'Neue Datei im selben Ordner',
                                icon: <FilePlus2 className="h-4 w-4" />,
                                onSelect: () => {
                                  const dir = parentPath(contextMenu.path)
                                  setNewFilePath(dir ? `${dir}/` : '')
                                  setNewFileModalOpen(true)
                                  setContextMenu(null)
                                },
                              },
                              {
                                key: 'delete',
                                label: 'Datei löschen',
                                icon: <Trash2 className="h-4 w-4" />,
                                destructive: true,
                                separatorBefore: true,
                                onSelect: () => {
                                  const targetPath = contextMenu.path
                                  setContextMenu(null)
                                  void handleDeleteFile(targetPath)
                                },
                              },
                            ]
                        : []
                    }
                  />

                  {/* Collapsible Sandbox Terminal Drawer */}
                  {terminalOpen && (
                    <div className="rounded-2xl border border-outline-variant/30 bg-[#080d0f] p-3.5 shrink-0 max-h-64 flex flex-col">
                      <div className="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-white/10">
                        <div className="flex items-center gap-2 text-xs font-medium text-on-surface">
                          <Terminal className="h-3.5 w-3.5 text-primary" />
                          <span>Projekt-Konsole</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setTerminalOpen(false)}
                          className="text-on-surface-variant hover:text-on-surface"
                          aria-label="Konsole schließen"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      <form onSubmit={handleRunCommand} className="flex gap-2 mb-2">
                        <Input
                          value={commandInput}
                          onChange={(e) => setCommandInput(e.target.value)}
                          placeholder="Befehl eingeben (z. B. npm test)…"
                          className="flex-1 text-xs h-8"
                          disabled={runningCmd}
                          aria-label="Konsolenbefehl"
                        />
                        <Button
                          type="submit"
                          size="sm"
                          className="h-8"
                          disabled={runningCmd || !commandInput.trim()}
                        >
                          <Play className="h-3.5 w-3.5" aria-hidden="true" />
                          {runningCmd ? 'Läuft…' : 'Ausführen'}
                        </Button>
                      </form>

                      {execHistory.length > 0 && (
                        <div className="flex-1 overflow-y-auto space-y-2 font-mono text-xs">
                          {execHistory.map((item, idx) => (
                            <div
                              key={idx}
                              className="rounded-lg border border-white/10 bg-black/50 p-2.5"
                            >
                              <div className="flex items-center justify-between text-on-surface-variant text-label-sm">
                                <span className="text-primary font-semibold">$ {item.command}</span>
                                <span>{item.timestamp}</span>
                              </div>
                              {item.result.stdout && (
                                <pre className="mt-1 whitespace-pre-wrap break-words text-on-surface">
                                  {item.result.stdout}
                                </pre>
                              )}
                              {item.result.stderr && (
                                <pre className="mt-1 whitespace-pre-wrap break-words text-status-warning">
                                  {item.result.stderr}
                                </pre>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'preview' && (
                <div className="flex flex-1 min-h-[480px] flex-col rounded-2xl border border-outline-variant/25 bg-surface-container-low/35 overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant/20 bg-surface-container-low/60 px-4 py-2.5">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <div className="flex items-center rounded-lg border border-outline-variant/30 bg-surface-container-high/40 p-0.5 shrink-0 text-xs">
                        <button
                          type="button"
                          onClick={() => setPreviewEnv('dev')}
                          className={[
                            'px-2.5 py-1 rounded-md transition-colors font-medium',
                            previewEnv === 'dev'
                              ? 'bg-primary/20 text-primary'
                              : 'text-on-surface-variant hover:text-on-surface',
                          ].join(' ')}
                        >
                          Entwicklung (Dev)
                        </button>
                        <button
                          type="button"
                          onClick={() => setPreviewEnv('production')}
                          className={[
                            'px-2.5 py-1 rounded-md transition-colors font-medium',
                            previewEnv === 'production'
                              ? 'bg-status-success/20 text-status-success'
                              : 'text-on-surface-variant hover:text-on-surface',
                          ].join(' ')}
                        >
                          Produktion (Live)
                        </button>
                      </div>

                      {previewEnv === 'production' && !envState?.production?.published && (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="h-8 text-xs gap-1.5 border-primary/30 text-primary"
                          onClick={() => setPublishModalOpen(true)}
                        >
                          <Rocket className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Jetzt online schalten</span>
                        </Button>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex items-center rounded-lg border border-outline-variant/30 bg-surface-container-high/40 p-0.5">
                        <Kurzinfo text="Desktop-Ansicht">
                          <button
                            type="button"
                            onClick={() => setPreviewDevice('desktop')}
                            aria-label="Desktop-Ansicht"
                            className={[
                              'p-1.5 rounded-md transition-colors',
                              previewDevice === 'desktop'
                                ? 'bg-primary/20 text-primary'
                                : 'text-on-surface-variant hover:text-on-surface',
                            ].join(' ')}
                          >
                            <Laptop className="h-3.5 w-3.5" />
                          </button>
                        </Kurzinfo>
                        <Kurzinfo text="Tablet-Ansicht">
                          <button
                            type="button"
                            onClick={() => setPreviewDevice('tablet')}
                            aria-label="Tablet-Ansicht"
                            className={[
                              'p-1.5 rounded-md transition-colors',
                              previewDevice === 'tablet'
                                ? 'bg-primary/20 text-primary'
                                : 'text-on-surface-variant hover:text-on-surface',
                            ].join(' ')}
                          >
                            <Tablet className="h-3.5 w-3.5" />
                          </button>
                        </Kurzinfo>
                        <Kurzinfo text="Smartphone-Ansicht">
                          <button
                            type="button"
                            onClick={() => setPreviewDevice('mobile')}
                            aria-label="Smartphone-Ansicht"
                            className={[
                              'p-1.5 rounded-md transition-colors',
                              previewDevice === 'mobile'
                                ? 'bg-primary/20 text-primary'
                                : 'text-on-surface-variant hover:text-on-surface',
                            ].join(' ')}
                          >
                            <Smartphone className="h-3.5 w-3.5" />
                          </button>
                        </Kurzinfo>
                      </div>

                      <Button
                        type="button"
                        size="sm"
                        variant={inspectMode ? 'primary' : 'secondary'}
                        className="h-8 text-xs gap-1.5"
                        onClick={() => {
                          const next = !inspectMode
                          setInspectMode(next)
                          if (next) {
                            toast.info('Klicke in der Vorschau auf ein Element, um es auszuwählen.')
                          } else {
                            setInspectElement(null)
                          }
                        }}
                      >
                        <MousePointer className="h-3.5 w-3.5" aria-hidden="true" />
                        {inspectMode ? 'Auswahl aktiv' : 'Element wählen'}
                      </Button>

                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={visualLoading || !selectedProject || files.length === 0}
                        onClick={() => void handleRunVisualInspection()}
                        className="h-8 text-xs gap-1.5"
                      >
                        <Sparkles
                          className={`h-3.5 w-3.5 text-primary ${visualLoading ? 'animate-spin' : ''}`}
                          aria-hidden="true"
                        />
                        <span>{visualLoading ? 'Prüft…' : 'KI-Sichtprüfung'}</span>
                      </Button>
                    </div>
                  </div>

                  {inspectElement && (
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-primary/20 bg-primary/10 px-4 py-2 text-xs text-on-surface">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-semibold text-primary shrink-0">Ausgewählt:</span>
                        <span className="truncate rounded bg-black/40 px-2 py-0.5 font-mono text-primary text-xs">
                          {inspectElement}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="w-48">
                          <Dropdown
                            value={
                              inspectTargetChatId === '__latest__'
                                ? projectChats[0]?.id ?? '__new__'
                                : inspectTargetChatId
                            }
                            onChange={(val) => setInspectTargetChatId(val)}
                            options={[
                              ...projectChats.map((c, idx) => ({
                                value: c.id,
                                label: idx === 0 ? `${c.title} (Zuletzt aktiv)` : c.title,
                              })),
                              { value: '__new__', label: '+ Neuer Projekt-Chat' },
                            ]}
                            aria-label="Ziel-Chat für Anpassung wählen"
                          />
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          className="h-8 px-3 text-xs"
                          onClick={() => {
                            void handleApplyElementWithSingra(inspectElement)
                          }}
                        >
                          Mit Singra anpassen
                        </Button>
                        <button
                          type="button"
                          onClick={() => setInspectElement(null)}
                          aria-label="Elementauswahl aufheben"
                          className="text-on-surface-variant hover:text-on-surface p-1"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-1 items-center justify-center bg-black/35 p-4 overflow-auto min-h-[380px]">
                    <div
                      className={[
                        'relative h-full min-h-[420px] transition-all rounded-xl overflow-hidden border border-outline-variant/30 shadow-2xl bg-surface flex flex-col',
                        previewDevice === 'desktop'
                          ? 'w-full'
                          : previewDevice === 'tablet'
                            ? 'w-[768px] max-w-full'
                            : 'w-[375px] max-w-full',
                      ].join(' ')}
                    >
                      {!previewSrcDoc && previewEnv === 'dev' && files.length > 0 ? (
                        <PreviewDiagnostics
                          kind="unconfigured"
                          fileCount={files.length}
                          entryFile={envState?.preview?.entry_file}
                          chats={projectChats}
                          chatChoice={fixTargetChatId}
                          onChatChoiceChange={setFixTargetChatId}
                          onFix={() => void handleFixPreviewWithSingra()}
                        />
                      ) : !previewSrcDoc ? (
                        <div className="flex flex-1 flex-col items-center justify-center p-8 text-center text-on-surface-variant">
                          <Globe className="h-10 w-10 text-primary/40 mb-3" />
                          <p className="text-sm font-medium text-on-surface">
                            {previewEnv === 'production'
                              ? 'Noch nicht auf Produktion veröffentlicht'
                              : 'Noch keine Vorschau verfügbar'}
                          </p>
                          <p className="text-xs text-on-surface-variant max-w-sm mt-1">
                            {previewEnv === 'production'
                              ? 'Schalte deinen aktuellen Entwicklungsstand online, um ihn als Live-Server im Dashboard bereitzustellen.'
                              : 'Sobald eine Webseite oder React-Oberfläche im Projekt angelegt ist, wird sie hier direkt dargestellt.'}
                          </p>
                          {previewEnv === 'production' && (
                            <Button
                              type="button"
                              size="sm"
                              className="mt-4 rounded-full px-4"
                              onClick={() => setPublishModalOpen(true)}
                            >
                              <Rocket className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Jetzt online schalten</span>
                            </Button>
                          )}
                        </div>
                      ) : (
                        <>
                          <iframe
                            ref={previewIframeRef}
                            key={`preview-${previewEnv}`}
                            srcDoc={previewSrcDoc ?? undefined}
                            title="Projekt-Vorschau"
                            className="w-full flex-1 border-0 min-h-[400px] bg-white"
                            sandbox="allow-scripts allow-forms allow-modals"
                          />
                          {previewError && !previewErrorDismissed && (
                            <div className="absolute inset-0 z-10 flex flex-col">
                              <PreviewDiagnostics
                                kind="error"
                                error={previewError}
                                fileCount={(previewEnv === 'production' ? productionFiles : files).length}
                                entryFile={envState?.preview?.entry_file}
                                chats={projectChats}
                                chatChoice={fixTargetChatId}
                                onChatChoiceChange={setFixTargetChatId}
                                onFix={() => void handleFixPreviewWithSingra()}
                                onDismiss={() => setPreviewErrorDismissed(true)}
                              />
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'settings' && (
                <div className="max-w-3xl w-full mx-auto space-y-5 py-1">
                  {/* Card 1: Everyday Project Name, Instructions & Autonomy */}
                  <div className="rounded-2xl border border-outline-variant/25 bg-surface-container-low/40 p-5 space-y-4">
                    <div>
                      <h3 className="text-sm font-semibold text-on-surface">
                        Allgemeine Einstellungen & Arbeitsweise
                      </h3>
                      <p className="text-xs text-on-surface-variant mt-0.5">
                        Lege fest, wie das Projekt heißt und worauf Singra bei der Zusammenarbeit achten soll.
                      </p>
                    </div>
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-on-surface-variant mb-1">
                          Projektname
                        </label>
                        <Input
                          defaultValue={selectedProject.name}
                          onBlur={(e) => {
                            if (
                              e.target.value.trim() &&
                              e.target.value !== selectedProject.name
                            ) {
                              void handleUpdateProject({ name: e.target.value.trim() })
                            }
                          }}
                          aria-label="Projektname"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-on-surface-variant mb-1">
                          Arbeitsanweisungen für dieses Projekt
                        </label>
                        <Textarea
                          defaultValue={selectedProject.system_prompt ?? ''}
                          rows={4}
                          placeholder="Welche Ziele, Stilvorgaben oder Wünsche gelten für dieses Projekt?"
                          onBlur={(e) => {
                            if (e.target.value !== (selectedProject.system_prompt ?? '')) {
                              void handleUpdateProject({ system_prompt: e.target.value })
                            }
                          }}
                          aria-label="Projektanweisungen"
                        />
                      </div>
                      <div className="flex items-center justify-between rounded-xl border border-outline-variant/25 bg-surface-container/60 p-3.5">
                        <div>
                          <div className="text-xs font-semibold text-on-surface">
                            Selbstständiges Arbeiten im Projekt erlauben
                          </div>
                          <p className="text-xs text-on-surface-variant mt-0.5">
                            Singra darf Dateien in diesem Projekt direkt anlegen und bearbeiten, ohne jede Änderung einzeln abzufragen.
                          </p>
                        </div>
                        <Switch
                          checked={projectAutonomy}
                          disabled={savingAutonomy}
                          onCheckedChange={handleToggleAutonomy}
                          aria-label="Selbstständiges Arbeiten im Projekt erlauben"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Card 2: GitHub / GitLab Connection & Sync */}
                  <div className="rounded-2xl border border-outline-variant/25 bg-surface-container-low/40 p-5 space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-on-surface flex items-center gap-2">
                          <FolderGit2 className="h-4 w-4 text-primary" />
                          <span>Online-Sicherung (GitHub & GitLab)</span>
                        </h3>
                        <p className="text-xs text-on-surface-variant mt-0.5">
                          {selectedProject.git_repo_url
                            ? `Verbunden mit ${selectedProject.git_repo_url}`
                            : 'Sichere dein Projekt online auf GitHub oder GitLab.'}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {!selectedProject.git_repo_url && (
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => {
                              setNewRepoName(selectedProject.name)
                              setCreateRepoOpen(true)
                            }}
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Neues GitHub-Repo erstellen
                          </Button>
                        )}
                        {selectedProject.git_repo_url && (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={gitBusy}
                            onClick={() => void handleGitSync()}
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${gitBusy ? 'animate-spin' : ''}`} />
                            Aktualisieren
                          </Button>
                        )}
                      </div>
                    </div>

                    {gitStatus && gitStatus.initialized && (
                      <div className="rounded-xl border border-outline-variant/20 bg-surface-container/50 px-3.5 py-2.5 text-xs flex flex-wrap items-center justify-between gap-2">
                        <span className="text-on-surface">
                          {(gitStatus.changed_files?.length ?? 0) > 0
                            ? `${gitStatus.changed_files?.length} ungesicherte Änderung(en) bereit zum Übertragen.`
                            : 'Alle Dateien sind gesichert und auf dem aktuellen Stand.'}
                        </span>
                        {gitStatus.branch && (
                          <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-primary font-medium">
                            {gitStatus.branch}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Quick Commit & Push */}
                    <form
                      onSubmit={handleGitCommit}
                      className="rounded-xl border border-outline-variant/20 bg-surface-container/30 p-3.5 space-y-3"
                    >
                      <div className="text-xs font-semibold text-on-surface">
                        Stand sichern & hochladen
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <Input
                          value={commitMessage}
                          onChange={(e) => setCommitMessage(e.target.value)}
                          placeholder="Was hast du geändert?"
                          className="flex-1 text-xs"
                          aria-label="Commit-Nachricht"
                        />
                        <Button
                          type="submit"
                          size="sm"
                          disabled={gitBusy || !commitMessage.trim()}
                        >
                          <GitCommit className="h-3.5 w-3.5" />
                          Sichern
                        </Button>
                      </div>
                      <label className="flex items-center gap-2 text-xs text-on-surface-variant">
                        <Switch
                          checked={pushOnCommit}
                          onCheckedChange={setPushOnCommit}
                          aria-label="Direkt zu GitHub/GitLab übertragen"
                        />
                        <span>Gleichzeitig online zum verbundenen Repository hochladen</span>
                      </label>
                    </form>

                    {/* Repository URL & Token configuration */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-outline-variant/15">
                      <div>
                        <label className="block text-xs font-medium text-on-surface-variant mb-1">
                          Anbieter
                        </label>
                        <Dropdown
                          value={selectedProject.git_provider ?? '__none__'}
                          onChange={(val) =>
                            void handleUpdateProject({
                              git_provider:
                                val === '__none__'
                                  ? null
                                  : (val as 'github' | 'gitlab' | 'custom'),
                            })
                          }
                          options={GIT_PROVIDER_OPTIONS}
                          aria-label="Git-Anbieter"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-on-surface-variant mb-1">
                          Zweig (Branch)
                        </label>
                        <Input
                          defaultValue={selectedProject.git_branch}
                          onBlur={(e) => {
                            if (
                              e.target.value.trim() &&
                              e.target.value !== selectedProject.git_branch
                            ) {
                              void handleUpdateProject({ git_branch: e.target.value.trim() })
                            }
                          }}
                          aria-label="Git-Branch"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-medium text-on-surface-variant mb-1">
                          Repository-Adresse
                        </label>
                        <Input
                          key={selectedProject.git_repo_url ?? 'no-url'}
                          defaultValue={selectedProject.git_repo_url ?? ''}
                          placeholder="https://github.com/nutzer/projekt.git"
                          onBlur={(e) => {
                            if (e.target.value !== (selectedProject.git_repo_url ?? '')) {
                              void handleUpdateProject({
                                git_repo_url: e.target.value.trim() || null,
                              })
                            }
                          }}
                          aria-label="Repository-Adresse"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-medium text-on-surface-variant mb-1">
                          Zugangsschlüssel (optional, falls nicht global im Schlüsselbund hinterlegt)
                        </label>
                        <Input
                          type="password"
                          placeholder={
                            selectedProject.git_token_configured
                              ? 'Schlüssel ist hinterlegt (zum Ändern neu eingeben)'
                              : 'Nur nötig bei eigenem Zugangsschlüssel…'
                          }
                          onBlur={(e) => {
                            if (e.target.value.trim()) {
                              void handleUpdateProject({ git_token: e.target.value.trim() })
                              e.target.value = ''
                            }
                          }}
                          aria-label="Git Zugangstoken"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        </div>
      )}

      {/* New File Dialog */}
      <Dialog open={newFileModalOpen} onOpenChange={setNewFileModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Neue Datei anlegen</DialogTitle>
            <DialogDescription>
              Gib den Namen oder Pfad der Datei an (z. B. index.html oder src/app.ts). Unterordner werden automatisch erstellt.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!newFilePath.trim()) return
              setNewFileModalOpen(false)
              void handleSaveFile(newFilePath.trim(), '')
            }}
            className="space-y-4 px-6 pb-6 pt-5"
          >
            <Input
              value={newFilePath}
              onChange={(e) => setNewFilePath(e.target.value)}
              placeholder="index.html"
              autoFocus
              aria-label="Dateipfad"
            />
            <div className="flex justify-end gap-2 pt-2 border-t border-outline-variant/20">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setNewFileModalOpen(false)}
              >
                Abbrechen
              </Button>
              <Button type="submit" disabled={!newFilePath.trim()}>
                Anlegen
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Direct GitHub/GitLab Repo Creation Modal for an existing project */}
      <Dialog open={createRepoOpen} onOpenChange={setCreateRepoOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Neues Repository auf GitHub / GitLab anlegen</DialogTitle>
            <DialogDescription>
              Erstellt das Repository in deinem Account, verknüpft es mit „{selectedProject?.name}“ und lädt deine Projektdateien direkt hoch.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateRemoteRepoForExisting} className="space-y-4 px-6 pb-6 pt-5">
            <div>
              <label className="block text-xs font-medium text-on-surface-variant mb-1">
                Name des Repositories
              </label>
              <Input
                value={newRepoName}
                onChange={(e) => setNewRepoName(e.target.value)}
                placeholder="mein-projekt"
                required
                autoFocus
                aria-label="Name des Repositories"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setNewRepoPrivate(true)}
                className={[
                  'flex items-center gap-2 rounded-xl border p-3 text-left text-xs transition-all',
                  newRepoPrivate
                    ? 'border-primary/40 bg-primary/12 text-on-surface font-medium'
                    : 'border-outline-variant/25 bg-surface-container/40 text-on-surface-variant',
                ].join(' ')}
              >
                <Lock className="h-4 w-4 text-primary shrink-0" />
                <div>
                  <div>Privat</div>
                  <div className="text-label-sm opacity-75">Nur für dich sichtbar</div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setNewRepoPrivate(false)}
                className={[
                  'flex items-center gap-2 rounded-xl border p-3 text-left text-xs transition-all',
                  !newRepoPrivate
                    ? 'border-primary/40 bg-primary/12 text-on-surface font-medium'
                    : 'border-outline-variant/25 bg-surface-container/40 text-on-surface-variant',
                ].join(' ')}
              >
                <Unlock className="h-4 w-4 text-primary shrink-0" />
                <div>
                  <div>Öffentlich</div>
                  <div className="text-label-sm opacity-75">Für alle einsehbar</div>
                </div>
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-on-surface-variant mb-1">
                Plattform
              </label>
              <Dropdown
                value={newRepoProvider}
                onChange={(v) => setNewRepoProvider(v as 'github' | 'gitlab')}
                options={[
                  { value: 'github', label: 'GitHub' },
                  { value: 'gitlab', label: 'GitLab' },
                ]}
                aria-label="Plattform"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-on-surface-variant mb-1">
                Zugangsschlüssel (optional, falls bereits im Schlüsselbund gespeichert)
              </label>
              <Input
                type="password"
                value={newRepoToken}
                onChange={(e) => setNewRepoToken(e.target.value)}
                placeholder="Gespeicherten Schlüssel verwenden oder hier eingeben…"
                aria-label="Personal Access Token"
              />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-outline-variant/20">
              <Button type="button" variant="ghost" onClick={() => setCreateRepoOpen(false)}>
                Abbrechen
              </Button>
              <Button type="submit" disabled={gitBusy || !newRepoName.trim()}>
                {gitBusy ? 'Erstellt…' : 'Repository erstellen'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Calm, Single-View Create Project Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader className="space-y-1.5">
            <DialogTitle className="text-lg font-headline font-semibold text-on-surface">
              Neues Projekt anlegen
            </DialogTitle>
            <DialogDescription className="text-xs text-on-surface-variant">
              Schaffe einen aufgeräumten Arbeitsbereich für deine Unterhaltungen, Dateien und deinen Code.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateProject} className="space-y-4 px-6 pb-6 pt-5">
            <div>
              <label className="block text-xs font-medium text-on-surface-variant mb-1">
                Projektname
              </label>
              <Input
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="z. B. Wetter-App, Server-Skripte oder Konzept"
                required
                autoFocus
                aria-label="Name des Projekts"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-on-surface-variant mb-1">
                Worum geht es? (optional)
              </label>
              <Input
                value={draft.description ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                placeholder="Kurze Beschreibung des Vorhabens…"
                aria-label="Kurzbeschreibung"
              />
            </div>

            {/* 3 Clear Start Mode Cards */}
            <div>
              <label className="block text-xs font-medium text-on-surface-variant mb-1.5">
                Wie möchtest du starten?
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {(
                  [
                    {
                      id: 'empty',
                      title: 'Leeres Projekt',
                      sub: 'Frischer Arbeitsbereich ohne Git',
                      icon: Folder,
                    },
                    {
                      id: 'create_repo',
                      title: 'Neues GitHub-Repo',
                      sub: 'Erstellt automatisch ein Repo',
                      icon: FolderGit2,
                    },
                    {
                      id: 'clone_repo',
                      title: 'Von Git klonen',
                      sub: 'Bestehendes Repo importieren',
                      icon: GitBranch,
                    },
                  ] as const
                ).map((item) => {
                  const Icon = item.icon
                  const selected = createMode === item.id
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setCreateMode(item.id)}
                      className={[
                        'flex flex-col items-start rounded-xl border p-3 text-left transition-all',
                        selected
                          ? 'border-primary/45 bg-primary/12 text-on-surface shadow-sm'
                          : 'border-outline-variant/25 bg-surface-container/35 text-on-surface-variant hover:bg-surface-container-high/40 hover:text-on-surface',
                      ].join(' ')}
                    >
                      <Icon className="h-4 w-4 text-primary mb-1.5" />
                      <div className="text-xs font-semibold text-on-surface">{item.title}</div>
                      <div className="text-label-sm text-on-surface-variant mt-0.5 leading-snug">
                        {item.sub}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Conditional fields for "Neues GitHub-Repo" */}
            {createMode === 'create_repo' && (
              <div className="rounded-xl border border-outline-variant/25 bg-surface-container-low/50 p-3.5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-medium text-on-surface">Privates Repository</div>
                    <div className="text-label-sm text-on-surface-variant">
                      Nur für dich und freigegebene Mitglieder sichtbar
                    </div>
                  </div>
                  <Switch
                    checked={createRepoPrivate}
                    onCheckedChange={setCreateRepoPrivate}
                    aria-label="Privates Repository"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-on-surface-variant mb-1">
                    Zugangsschlüssel (nur nötig, falls noch keiner im Schlüsselbund liegt)
                  </label>
                  <Input
                    type="password"
                    value={draft.git_token ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, git_token: e.target.value }))}
                    placeholder="Leer lassen für gespeicherten Schlüssel"
                    aria-label="GitHub Token"
                  />
                </div>
              </div>
            )}

            {/* Conditional fields for "Von Git klonen" */}
            {createMode === 'clone_repo' && (
              <div className="rounded-xl border border-outline-variant/25 bg-surface-container-low/50 p-3.5 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-on-surface-variant mb-1">
                    Repository-Adresse
                  </label>
                  <Input
                    value={draft.git_repo_url ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, git_repo_url: e.target.value }))}
                    placeholder="https://github.com/nutzer/projekt.git"
                    required
                    aria-label="Repository-URL"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-xs font-medium text-on-surface-variant mb-1">
                      Zweig (Branch)
                    </label>
                    <Input
                      value={draft.git_branch ?? 'main'}
                      onChange={(e) => setDraft((d) => ({ ...d, git_branch: e.target.value }))}
                      placeholder="main"
                      aria-label="Branch"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-on-surface-variant mb-1">
                      Zugangsschlüssel (optional)
                    </label>
                    <Input
                      type="password"
                      value={draft.git_token ?? ''}
                      onChange={(e) => setDraft((d) => ({ ...d, git_token: e.target.value }))}
                      placeholder="Optional…"
                      aria-label="Personal Access Token"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Collapsible Optional Settings */}
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowAdvancedCreate((v) => !v)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-on-surface-variant hover:text-on-surface"
              >
                {showAdvancedCreate ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
                <span>Weitere Optionen (Team, Projektart & eigene Anweisungen)</span>
              </button>

              {showAdvancedCreate && (
                <div className="mt-3 space-y-3 rounded-xl border border-outline-variant/20 bg-surface-container-low/35 p-3.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-on-surface-variant mb-1">
                        Projektart
                      </label>
                      <Dropdown
                        value={draft.project_kind ?? 'coding'}
                        onChange={(val) =>
                          setDraft((d) => ({
                            ...d,
                            project_kind: val as 'general' | 'coding' | 'docs',
                          }))
                        }
                        options={PROJECT_KIND_OPTIONS}
                        aria-label="Projektart"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-on-surface-variant mb-1">
                        Zuordnung
                      </label>
                      <Dropdown
                        value={draft.team_id ? String(draft.team_id) : '__personal__'}
                        onChange={(val) =>
                          setDraft((d) => ({
                            ...d,
                            team_id: val === '__personal__' ? null : Number(val),
                          }))
                        }
                        options={[
                          { value: '__personal__', label: 'Persönlich' },
                          ...teams.map((t) => ({ value: String(t.id), label: `Team: ${t.name}` })),
                        ]}
                        aria-label="Projektbereich"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-on-surface-variant mb-1">
                      Eigene Anweisungen für Singra (optional)
                    </label>
                    <Textarea
                      value={draft.system_prompt ?? ''}
                      onChange={(e) => setDraft((d) => ({ ...d, system_prompt: e.target.value }))}
                      rows={3}
                      placeholder="Besondere Vorgaben zu Sprache, Stil oder Aufbau…"
                      aria-label="Projektanweisungen"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-outline-variant/20">
              <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
                Abbrechen
              </Button>
              <Button type="submit" disabled={savingProject || !draft.name.trim()}>
                {savingProject ? 'Wird angelegt…' : 'Projekt erstellen'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* View AGENTS.md Modal */}
      <Dialog open={showAgentsModal} onOpenChange={setShowAgentsModal}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              <span>Projektregeln ({agentsRules?.filename ?? 'AGENTS.md'})</span>
            </DialogTitle>
            <DialogDescription>
              Diese Datei aus deinem Projekt wird bei Unterhaltungen automatisch berücksichtigt.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-6 pb-6 pt-5">
            <div className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest/80 p-4 font-mono text-xs leading-relaxed text-on-surface overflow-x-auto whitespace-pre-wrap max-h-[55vh] select-text">
              {agentsRules?.content || 'Kein Inhalt.'}
            </div>
            <div className="flex justify-end pt-2 border-t border-outline-variant/20">
              <Button type="button" onClick={() => setShowAgentsModal(false)}>
                Schließen
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Publish to Production (Online schalten) Modal */}
      <Dialog open={publishModalOpen} onOpenChange={setPublishModalOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Rocket className="h-5 w-5 text-primary" />
              <span>
                {envState?.production?.published
                  ? 'Produktions-Update veröffentlichen'
                  : 'Projekt auf Produktion online schalten'}
              </span>
            </DialogTitle>
            <DialogDescription>
              Übernimmt deinen aktuellen Entwicklungsstand auf eine Node, führt ausstehende PostgreSQL-Migrationen aus und stellt das Projekt im Server-Dashboard bereit.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handlePublishToProduction} className="space-y-4 p-6">
            <div className="rounded-xl border border-outline-variant/25 bg-surface-container-low/50 p-3.5 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-on-surface-variant flex items-center gap-1.5">
                  <Database className="h-3.5 w-3.5 text-primary" />
                  <span>PostgreSQL Dev → Prod Branch</span>
                </span>
                <span className="font-mono text-on-surface">
                  {envState?.dev_db?.branch ?? 'pg_dev'} → {envState?.prod_db?.branch ?? 'pg_prod'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-on-surface-variant flex items-center gap-1.5">
                  <ServerIcon className="h-3.5 w-3.5 text-primary" />
                  <span>Dashboard-Status</span>
                </span>
                <span className="font-medium text-on-surface">
                  {envState?.production?.published
                    ? `Aktiv (Server #${envState.production.server_id}, Release #${envState.production.release_count})`
                    : 'Wird beim Veröffentlichen im Dashboard angelegt'}
                </span>
              </div>
              {envState?.production?.web_url && (
                <div className="flex items-center justify-between pt-1 border-t border-outline-variant/15">
                  <span className="text-on-surface-variant flex items-center gap-1.5">
                    <Globe className="h-3.5 w-3.5 text-primary" />
                    <span>Öffentliche Adresse</span>
                  </span>
                  <a
                    href={envState.production.web_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-primary hover:underline truncate max-w-[260px]"
                  >
                    {envState.production.web_url}
                  </a>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-on-surface-variant mb-1">
                Architektur-Modus
              </label>
              <Dropdown
                value={publishMode}
                onChange={(val) => setPublishMode(val as 'fullstack_split' | 'frontend' | 'backend')}
                options={[
                  { value: 'fullstack_split', label: 'Frontend & Backend getrennt (Fullstack)' },
                  { value: 'frontend', label: 'Nur Frontend (Webseite / SPA über Caddy)' },
                  { value: 'backend', label: 'Nur Backend (Docker-Container mit Port & DB)' },
                ]}
                aria-label="Architektur-Modus auswählen"
              />
            </div>

            {publishMode !== 'frontend' && (
              <label className="flex items-start gap-2.5 text-xs text-on-surface cursor-pointer rounded-xl border border-outline-variant/25 bg-surface-container-low/40 p-3 select-none">
                <input
                  type="checkbox"
                  checked={publishEnableDb}
                  onChange={(e) => setPublishEnableDb(e.target.checked)}
                  className="rounded border-outline-variant text-primary focus:ring-primary mt-0.5"
                />
                <div className="flex flex-col">
                  <span className="font-medium text-on-surface">Eigene PostgreSQL-Datenbank automatisch anlegen & verbinden</span>
                  <span className="text-xs text-on-surface-variant">Erstellt eine verwaltete Datenbank auf der Node und injiziert DATABASE_URL in die Umgebung des Backends.</span>
                </div>
              </label>
            )}

            {publishMode !== 'backend' && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-on-surface-variant mb-1">
                    API-Pfad für Backend-Proxy
                  </label>
                  <Input
                    value={publishApiPath}
                    onChange={(e) => setPublishApiPath(e.target.value)}
                    placeholder="/api/*"
                    aria-label="API-Pfad für Backend-Proxy"
                  />
                  <span className="text-xs text-on-surface-variant mt-0.5 block">Standard: /api/* (anpassbar für /graphql, /trpc/* etc.)</span>
                </div>
                {publishMode === 'frontend' && (
                  <div>
                    <label className="block text-xs font-medium text-on-surface-variant mb-1">
                      Backend-Zieladresse (optional)
                    </label>
                    <Input
                      value={publishBackendProxyUrl}
                      onChange={(e) => setPublishBackendProxyUrl(e.target.value)}
                      placeholder="z. B. https://api.extern.de oder 127.0.0.1:5001"
                      aria-label="Backend-Zieladresse"
                    />
                    <span className="text-xs text-on-surface-variant mt-0.5 block">Wohin Caddy Anfragen an den API-Pfad weiterleiten soll.</span>
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-on-surface-variant mb-1">
                Ziel-Node auswählen
              </label>
              <Dropdown
                value={selectedNodeId}
                onChange={(val) => setSelectedNodeId(val)}
                options={[
                  { value: '__auto__', label: 'Automatisch (Lokale Haupt-Node)' },
                  ...availableNodes.map((n) => ({
                    value: n.id,
                    label: `${n.name} (${n.status === 'online' ? 'Online' : n.status || 'Bereit'})`,
                  })),
                ]}
                aria-label="Ziel-Node auswählen"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-on-surface-variant mb-1">
                Release-Notiz (optional)
              </label>
              <Input
                value={releaseNotes}
                onChange={(e) => setReleaseNotes(e.target.value)}
                placeholder="z. B. Dark Mode und Startseite veröffentlicht"
                aria-label="Release-Notiz"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-on-surface-variant mb-1">
                  Erreichbar über
                </label>
                <Dropdown
                  value={publishDomainMode}
                  onChange={(val) => setPublishDomainMode(val as 'ip' | 'cloudflare' | 'external')}
                  options={[
                    { value: 'ip', label: 'IP-Adresse und Port' },
                    { value: 'cloudflare', label: 'Domain über Cloudflare' },
                    { value: 'external', label: 'Eigene Domain (mit Anleitung)' },
                  ]}
                  aria-label="Erreichbarkeit wählen"
                />
              </div>
              {publishDomainMode !== 'ip' && (
                <div>
                  <label className="block text-xs font-medium text-on-surface-variant mb-1">
                    Domain
                  </label>
                  <Input
                    value={publishDomain}
                    onChange={(e) => setPublishDomain(e.target.value)}
                    placeholder="app.beispiel.de"
                    aria-label="Domain"
                  />
                </div>
              )}
            </div>

            <div className="rounded-xl border border-primary/25 bg-primary/8 p-3 text-xs text-on-surface-variant space-y-1">
              <div className="font-semibold text-on-surface">Wie geht es weiter?</div>
              <p>
                <span className="font-medium text-on-surface">Mit Singra:</span> Singra testet zuerst, veröffentlicht
                dann auf die Node, prüft die Erreichbarkeit und führt dich durch die Domain-Einrichtung.
              </p>
              <p>
                <span className="font-medium text-on-surface">Direkt:</span> Der aktuelle Stand wird sofort ohne
                vorherige Tests übernommen. Eine Domain musst du danach selbst verbinden.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2.5 pt-4 border-t border-outline-variant/20">
              <Button type="button" variant="ghost" size="sm" onClick={() => setPublishModalOpen(false)}>
                Abbrechen
              </Button>
              <Button type="submit" variant="secondary" size="sm" disabled={publishing}>
                <span>{publishing ? 'Veröffentlicht…' : 'Direkt veröffentlichen'}</span>
              </Button>
              <Button type="button" size="sm" disabled={publishing} onClick={() => void handleGuidedPublish()}>
                <Rocket className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Mit Singra online schalten</span>
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Team & Teilen Modal */}
      <Dialog open={teamShareModalOpen} onOpenChange={setTeamShareModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              <span>Projekt im Team teilen</span>
            </DialogTitle>
            <DialogDescription>
              Ordne „{selectedProject?.name}“ einem Team zu, damit alle Teammitglieder gemeinsam auf Unterhaltungen, Dateien und die Vorschau zugreifen können.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveTeamShare} className="space-y-4 px-6 pb-6 pt-5">
            <div>
              <label className="block text-xs font-medium text-on-surface-variant mb-1">
                Zugriffsbereich
              </label>
              <Dropdown
                value={selectedTeamShareId}
                onChange={(val) => setSelectedTeamShareId(val)}
                options={[
                  { value: '__personal__', label: 'Nur für mich (Persönlich)' },
                  ...teams.map((t) => ({
                    value: String(t.id),
                    label: `Team: ${t.name} (${t.member_count} Mitglieder)`,
                  })),
                ]}
                aria-label="Team auswählen"
              />
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-outline-variant/20">
              <Button type="button" variant="ghost" onClick={() => setTeamShareModalOpen(false)}>
                Abbrechen
              </Button>
              <Button type="submit" disabled={savingProject}>
                Speichern
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Visuelle Sichtprüfung (Headless Screenshots & Responsive-Analyse) */}
      <SingraVisualInspectionModal
        open={visualModalOpen}
        onOpenChange={setVisualModalOpen}
        projectId={selectedProject?.id ?? ''}
        projectName={selectedProject?.name ?? 'Projekt'}
        inspectionResult={visualInspection}
        loading={visualLoading}
        onReinspect={() => void handleRunVisualInspection()}
        onFixWithSingra={(issues) => void handleFixVisualIssuesWithSingra(issues)}
      />
    </div>
  )
}
