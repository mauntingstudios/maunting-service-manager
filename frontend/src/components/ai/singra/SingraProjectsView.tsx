import { useCallback, useEffect, useMemo, useState } from 'react'
import { detectLineEnding, parentPath, pathSegments } from '@/components/server/fileHelpers'
import type { EditorTab, SearchResult } from '@/components/server/fileWorkspaceTypes'
import {
  ArrowLeft,
  BookOpen,
  Database,
  Eye,
  FileCode,
  FileText,
  FolderGit2,
  Globe,
  MessageSquare,
  Pause,
  Play,
  Plus,
  Rocket,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react'
import {
  aiApi,
  type AiConversationSummary,
  type AiProject,
  type AiProjectDevStatus,
  type AiProjectEnvironmentState,
  type AiProjectExecResult,
  type AiProjectFile,
  type AiProjectGitStatus,
  type AiProjectPublishOptions,
  type AiProjectQuotaSummary,
  type AiProjectWrite,
} from '@/api/ai'
import { useHasPermission } from '@/hooks/useHasPermission'
import { api, SanitizedApiError } from '@/api/client'
import { still } from '@/lib/still'
import { SingraVisualInspectionModal } from './SingraVisualInspectionModal'
import { SingraDeploymentPanel } from './SingraDeploymentPanel'
import { SingraTestResults } from './SingraTestResults'
import { PostgresStudio } from '@/components/postgres/PostgresStudio'
import { teamsApi, type Team } from '@/api/teams'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Kurzinfo,
  Spinner,
} from '@maunting/ui'
import { confirm } from '@/stores/confirmStore'
import { toast } from '@/stores/toastStore'
import {
  buildProjectTreeNodes,
  type ProjectCreateMode,
  type ProjectTab,
  type SingraProjectsViewProps,
} from './singraProjectTypes'
import { SingraProjectList } from './SingraProjectList'
import { SingraFilesTab } from './SingraFilesTab'
import { SingraPreviewTab } from './SingraPreviewTab'
import { useSingraPreview } from './useSingraPreview'
import { SingraSettingsTab } from './SingraSettingsTab'
import { SingraWikiTab } from './SingraWikiTab'
import { SingraProjectModals } from './SingraProjectModals'
import { SingraCreateProjectModal } from './SingraCreateProjectModal'
import { SingraPublishModal } from './SingraPublishModal'

export function SingraProjectsView({
  initialProjectId,
  onOpenProjectChat,
}: SingraProjectsViewProps) {
  const canStartDevPreview = useHasPermission('ai.projects.preview')
  const canUseWiki = useHasPermission('ai.projects.wiki')
  const [projects, setProjects] = useState<AiProject[]>([])
  const [projectQuota, setProjectQuota] = useState<AiProjectQuotaSummary | null>(null)
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
  const [selectedTargetServerId, setSelectedTargetServerId] = useState<string>('')
  const [releaseNotes, setReleaseNotes] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [publishDomainMode, setPublishDomainMode] = useState<'ip' | 'cloudflare' | 'external'>('ip')
  const [publishDomain, setPublishDomain] = useState('')
  const [publishMode, setPublishMode] = useState<'fullstack_split' | 'frontend' | 'backend'>('fullstack_split')
  const [publishEnableDb, setPublishEnableDb] = useState(true)
  const [publishApiPath, setPublishApiPath] = useState('/api/*')
  const [publishBackendProxyUrl, setPublishBackendProxyUrl] = useState('')
  const [publishOptions, setPublishOptions] = useState<AiProjectPublishOptions | null>(null)
  const [publishBindIp, setPublishBindIp] = useState<string>('')
  const [publishCfZoneId, setPublishCfZoneId] = useState<string>('')
  const [publishCfSubdomain, setPublishCfSubdomain] = useState<string>('')
  const [publishMergeToMain, setPublishMergeToMain] = useState<boolean>(false)

  // Singra Dev-Sandbox, Tests & Deployment Engine state
  const [devStatus, setDevStatus] = useState<AiProjectDevStatus | null>(null)
  const [devStatusLoading, setDevStatusLoading] = useState(false)
  const [activeDeploymentId, setActiveDeploymentId] = useState<string | null>(null)
  const [showDeploymentPanel, setShowDeploymentPanel] = useState(false)
  const [latestTestPassed, setLatestTestPassed] = useState<boolean | null>(null)

  const isLocalAccess = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  const resolvedDevWebUrl = useMemo(() => {
    if (!devStatus?.dev_web_url) return null
    try {
      const u = new URL(devStatus.dev_web_url)
      if ((u.hostname === '127.0.0.1' || u.hostname === 'localhost') && typeof window !== 'undefined' && !isLocalAccess) {
        u.hostname = window.location.hostname
      }
      return u.toString()
    } catch {
      return devStatus.dev_web_url
    }
  }, [devStatus?.dev_web_url, isLocalAccess])

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
  const [hasProjectAutonomyOverride, setHasProjectAutonomyOverride] = useState(false)
  const [globalAutonomy, setGlobalAutonomy] = useState(false)
  const [savingAutonomy, setSavingAutonomy] = useState(false)

  const selectedProject = projects.find((p) => p.id === selectedId) ?? null

  const handleStartNewProjectChat = (_initialTitle?: string) => {
    if (!selectedProject) return
    onOpenProjectChat(selectedProject.id, undefined)
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

  const {
    previewDevice,
    setPreviewDevice,
    inspectMode,
    setInspectMode,
    previewEnv,
    setPreviewEnv,
    devPreviewMode,
    setDevPreviewMode,
    inspectElement,
    setInspectElement,
    inspectTargetChatId,
    setInspectTargetChatId,
    previewIframeRef,
    previewError,
    previewErrorDismissed,
    setPreviewErrorDismissed,
    fixTargetChatId,
    setFixTargetChatId,
    visualModalOpen,
    setVisualModalOpen,
    visualInspection,
    visualLoading,
    devConsoleOpen,
    setDevConsoleOpen,
    consoleLogs,
    setConsoleLogs,
    consoleFilter,
    setConsoleFilter,
    previewSrcDoc,
    handleApplyElementWithSingra,
    handleFixPreviewWithSingra,
    handleRunVisualInspection,
    handleFixVisualIssuesWithSingra,
  } = useSingraPreview({
    selectedProject,
    files,
    productionFiles,
    projectChats,
    envState,
    sendTaskToProjectChat,
    onOpenProjectChat,
    onStartNewProjectChat: handleStartNewProjectChat,
  })

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
      setHasProjectAutonomyOverride(false)
      setGlobalAutonomy(false)
      return
    }
    let active = true
    aiApi
      .listAutonomyGrants()
      .then((grants) => {
        if (!active) return
        const globalGrant = grants.find((x) => x.server_id === null && !x.project_id)
        const isGlobalOn = Boolean(globalGrant?.enabled)
        setGlobalAutonomy(isGlobalOn)

        const projectGrant = grants.find((x) => x.project_id === selectedId)
        if (projectGrant) {
          setHasProjectAutonomyOverride(true)
          setProjectAutonomy(Boolean(projectGrant.enabled))
        } else {
          setHasProjectAutonomyOverride(false)
          setProjectAutonomy(isGlobalOn)
        }
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
      setHasProjectAutonomyOverride(true)
      toast.success(
        enabled
          ? 'Autonomie für dieses Projekt aktiviert (überschreibt die globale Einstellung).'
          : 'Autonomie für dieses Projekt deaktiviert (Singra fragt vor Änderungen nach).',
      )
    } catch {
      toast.error('Autonomie-Einstellung konnte nicht gespeichert werden.')
    } finally {
      setSavingAutonomy(false)
    }
  }

  const handleResetAutonomyToGlobal = async () => {
    if (!selectedId || savingAutonomy) return
    setSavingAutonomy(true)
    try {
      await aiApi.deleteAutonomyGrant({ project_id: selectedId })
      setHasProjectAutonomyOverride(false)
      setProjectAutonomy(globalAutonomy)
      toast.success('Projektspezifische Autonomie entfernt. Es gilt wieder die globale Einstellung aus Tools.')
    } catch {
      toast.error('Zurücksetzen fehlgeschlagen.')
    } finally {
      setSavingAutonomy(false)
    }
  }

  const refreshQuota = useCallback(async () => {
    try {
      const q = await aiApi.getProjectQuota()
      setProjectQuota(q)
    } catch (err: unknown) {
      still(err, 'singra.projects.quota')
    }
  }, [])

  const loadProjects = useCallback(async () => {
    setLoading(true)
    try {
      const [projRows, teamRows, nodeRows, quotaData] = await Promise.all([
        aiApi.listProjects(),
        teamsApi.list().catch((err: unknown) => {
          still(err, 'singra.projects.teams')
          return [] as Team[]
        }),
        api<Array<{ id: string; name: string; status?: string }>>('/nodes').catch((err: unknown) => {
          still(err, 'singra.projects.nodes')
          return []
        }),
        aiApi.getProjectQuota().catch((err: unknown) => {
          still(err, 'singra.projects.quota')
          return null
        }),
      ])
      setProjects(projRows)
      setProjectQuota(quotaData)
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
        void loadDevStatus(projectId)
        void checkLatestTestStatus(projectId)
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

  const loadDevStatus = useCallback(async (projectId: string) => {
    try {
      const res = await aiApi.getDevEnvironmentStatus(projectId)
      setDevStatus(res)
    } catch (err) {
      still(err, 'SingraProjectsView.loadDevStatus')
    }
  }, [])

  const checkLatestTestStatus = useCallback(async (projectId: string) => {
    try {
      const runs = await aiApi.getProjectTestRuns(projectId)
      if (runs.length > 0) {
        setLatestTestPassed(runs[0].status === 'passed')
      } else {
        setLatestTestPassed(null)
      }
    } catch {
      setLatestTestPassed(null)
    }
  }, [])

  const handleStartDevSandbox = async () => {
    if (!selectedProject || devStatusLoading) return
    setDevStatusLoading(true)
    try {
      await aiApi.startDevEnvironment(selectedProject.id)
      toast.success('Dev-Sandbox gestartet. Frontend und Backend aktiv.')
      await loadDevStatus(selectedProject.id)
    } catch (err: unknown) {
      toast.error(
        err instanceof SanitizedApiError
          ? err.message
          : 'Start der Dev-Sandbox fehlgeschlagen.',
      )
    } finally {
      setDevStatusLoading(false)
    }
  }

  const handleStopDevSandbox = async () => {
    if (!selectedProject || devStatusLoading) return
    setDevStatusLoading(true)
    try {
      await aiApi.stopDevEnvironment(selectedProject.id)
      toast.success('Dev-Sandbox pausiert.')
      await loadDevStatus(selectedProject.id)
    } catch (err: unknown) {
      toast.error(
        err instanceof SanitizedApiError
          ? err.message
          : 'Pausieren der Dev-Sandbox fehlgeschlagen.',
      )
    } finally {
      setDevStatusLoading(false)
    }
  }

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

  useEffect(() => {
    if (publishModalOpen && selectedId) {
      aiApi
        .getPublishOptions(selectedId, selectedNodeId === '__auto__' ? undefined : selectedNodeId)
        .then((opts) => {
          setPublishOptions(opts)
          if (opts.target_servers && opts.target_servers.length > 0 && !selectedTargetServerId) {
            setSelectedTargetServerId(String(opts.target_servers[0].id))
          }
          if (!publishBindIp && opts.default_ip) {
            setPublishBindIp(opts.default_ip)
          }
          if (opts.cloudflare_zones.length > 0 && !publishCfZoneId) {
            setPublishCfZoneId(opts.cloudflare_zones[0].id)
          }
        })
        .catch((err: unknown) => {
          still(err, 'singra.projects.publishOptions')
        })
    }
  }, [publishModalOpen, selectedId, selectedNodeId, publishBindIp, publishCfZoneId, selectedTargetServerId])

  useEffect(() => {
    if (publishDomainMode === 'cloudflare' && publishOptions?.cloudflare_zones) {
      const zone = publishOptions.cloudflare_zones.find((z) => z.id === publishCfZoneId)
      if (zone) {
        const sub = publishCfSubdomain.trim()
        setPublishDomain(sub ? `${sub}.${zone.name}` : zone.name)
      }
    }
  }, [publishDomainMode, publishCfSubdomain, publishCfZoneId, publishOptions])

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
      message: `Möchtest du das Projekt „${proj.name}“ mitsamt seinen Projektdateien, der Dev-Sandbox und den zugehörigen Projekt-Chats wirklich löschen?`,
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
      toast.success('Projekt und zugehörige Chats gelöscht.')
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
        bind_ip: publishBindIp.trim() || null,
        merge_to_main: publishMergeToMain,
        target_server_id: selectedTargetServerId ? Number(selectedTargetServerId) : null,
      })
      if (res.environment) {
        setEnvState(res.environment)
      }
      if (res.deployment_id) {
        setActiveDeploymentId(res.deployment_id)
        setShowDeploymentPanel(true)
      }
      const prodFiles = await aiApi
        .listProjectProductionFiles(selectedProject.id)
        .catch((err: unknown) => {
          still(err, 'singra.projects.productionFiles')
          return []
        })
      setProductionFiles(prodFiles)
      setPreviewEnv('production')
      setPublishModalOpen(false)
      setReleaseNotes('')
      toast.success(
        res.mode === 'rented_server'
          ? 'Projekt auf deinen gewählten Server übertragen und Neustart ausgelöst.'
          : `Bereitstellung gestartet (Phase: ${res.phase || 'Snapshot'}). Phasen-Fortschritt wird überwacht.`,
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
        <SingraProjectList
          projects={projects}
          quota={projectQuota}
          onSelectProject={(projectId) => {
            setSelectedId(projectId)
            setProjectOpen(true)
            void refreshQuota()
          }}
          onOpenCreate={() => setCreateOpen(true)}
        />
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
                    className="grid h-10 w-10 sm:h-9 sm:w-9 shrink-0 place-items-center rounded-full border border-outline-variant/30 bg-surface-container-high/85 text-on-surface-variant hover:border-status-destructive/40 hover:bg-status-destructive/15 hover:text-status-destructive backdrop-blur-md shadow-sm transition-colors active:scale-95"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </Kurzinfo>
              </div>
            </div>

            {/* Workspace Tabs: Mobile Responsive Grid, Desktop Pills */}
            <div className={`grid gap-1 border-b border-outline-variant/20 bg-surface-container-low/30 p-1 sm:hidden shrink-0 ${canUseWiki ? 'grid-cols-7' : 'grid-cols-6'}`}>
              {(
                [
                  { id: 'chats', label: 'Unterhaltungen', mobileLabel: 'Chats', icon: MessageSquare },
                  { id: 'files', label: 'Dateien', mobileLabel: 'Dateien', icon: FileCode },
                  { id: 'preview', label: 'Vorschau', mobileLabel: 'Vorschau', icon: Globe },
                  { id: 'database', label: 'Datenbank', mobileLabel: 'DB', icon: Database },
                  ...(canUseWiki ? [{ id: 'wiki' as const, label: 'Wiki', mobileLabel: 'Wiki', icon: BookOpen }] : []),
                  { id: 'tests', label: 'Tests & Gate', mobileLabel: 'Tests', icon: ShieldCheck },
                  { id: 'settings', label: 'Einstellungen', mobileLabel: 'Optionen', icon: Settings2 },
                ] satisfies ReadonlyArray<{ id: ProjectTab; label: string; mobileLabel: string; icon: typeof MessageSquare }>
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

            <div className="hidden sm:flex items-center gap-1.5 border-b border-outline-variant/20 bg-surface-container-low/15 px-4 py-1.5 overflow-x-auto msm-ohne-rollbalken shrink-0">
              {(
                [
                  { id: 'chats', label: 'Unterhaltungen', icon: MessageSquare },
                  { id: 'files', label: 'Dateien', icon: FileCode },
                  { id: 'preview', label: 'Vorschau', icon: Globe },
                  { id: 'database', label: 'Datenbank', icon: Database },
                  ...(canUseWiki ? [{ id: 'wiki' as const, label: 'Wiki', icon: BookOpen }] : []),
                  { id: 'tests', label: 'Tests & Gate', icon: ShieldCheck },
                  { id: 'settings', label: 'Einstellungen', icon: Settings2 },
                ] satisfies ReadonlyArray<{ id: ProjectTab; label: string; icon: typeof MessageSquare }>
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
                <SingraFilesTab
                  selectedProject={selectedProject}
                  files={files}
                  treeNodes={treeNodes}
                  allDirs={allDirs}
                  breadcrumbTeile={breadcrumbTeile}
                  expandedDirs={expandedDirs}
                  setExpandedDirs={setExpandedDirs}
                  editorTabs={editorTabs}
                  activeFilePath={activeFilePath}
                  setActiveFilePath={setActiveFilePath}
                  fileSearchQuery={fileSearchQuery}
                  setFileSearchQuery={setFileSearchQuery}
                  searchResults={searchResults}
                  contextMenu={contextMenu}
                  setContextMenu={setContextMenu}
                  setNewFilePath={setNewFilePath}
                  setNewFileModalOpen={setNewFileModalOpen}
                  terminalOpen={terminalOpen}
                  setTerminalOpen={setTerminalOpen}
                  commandInput={commandInput}
                  setCommandInput={setCommandInput}
                  runningCmd={runningCmd}
                  execHistory={execHistory}
                  onReloadProject={(projectId) => void loadProjectDetails(projectId)}
                  onToggleDir={handleToggleDir}
                  onOpenFile={(path) => openFileInEditor(path)}
                  onEditorChange={handleEditorChange}
                  onSaveFile={(path) => void handleSaveFile(path)}
                  onCloseTab={handleEditorCloseTab}
                  onReloadTab={handleEditorReloadTab}
                  onDeleteFile={(path) => void handleDeleteFile(path)}
                  onRunCommand={handleRunCommand}
                />
              )}

              {activeTab === 'wiki' && canUseWiki && (
                <SingraWikiTab
                  selectedProject={selectedProject}
                  onOpenSourceFile={(filePath) => {
                    void openFileInEditor(filePath)
                    setActiveTab('files')
                  }}
                />
              )}

              {activeTab === 'preview' && (
                <SingraPreviewTab
                  selectedProject={selectedProject}
                  files={files}
                  productionFiles={productionFiles}
                  projectChats={projectChats}
                  envState={envState}
                  devStatus={devStatus}
                  devStatusLoading={devStatusLoading}
                  resolvedDevWebUrl={resolvedDevWebUrl}
                  previewEnv={previewEnv}
                  setPreviewEnv={setPreviewEnv}
                  devPreviewMode={devPreviewMode}
                  setDevPreviewMode={setDevPreviewMode}
                  previewDevice={previewDevice}
                  setPreviewDevice={setPreviewDevice}
                  inspectMode={inspectMode}
                  setInspectMode={setInspectMode}
                  inspectElement={inspectElement}
                  setInspectElement={setInspectElement}
                  inspectTargetChatId={inspectTargetChatId}
                  setInspectTargetChatId={setInspectTargetChatId}
                  fixTargetChatId={fixTargetChatId}
                  setFixTargetChatId={setFixTargetChatId}
                  previewIframeRef={previewIframeRef}
                  previewSrcDoc={previewSrcDoc}
                  previewError={previewError}
                  previewErrorDismissed={previewErrorDismissed}
                  setPreviewErrorDismissed={setPreviewErrorDismissed}
                  visualLoading={visualLoading}
                  devConsoleOpen={devConsoleOpen}
                  setDevConsoleOpen={setDevConsoleOpen}
                  consoleLogs={consoleLogs}
                  setConsoleLogs={setConsoleLogs}
                  consoleFilter={consoleFilter}
                  setConsoleFilter={setConsoleFilter}
                  onOpenPublishModal={() => setPublishModalOpen(true)}
                  onRunVisualInspection={() => void handleRunVisualInspection()}
                  onApplyElementWithSingra={(selector) => void handleApplyElementWithSingra(selector)}
                  onFixPreviewWithSingra={() => void handleFixPreviewWithSingra()}
                  onStartDevSandbox={() => void handleStartDevSandbox()}
                  onStopDevSandbox={() => void handleStopDevSandbox()}
                  canStartDevPreview={canStartDevPreview}
                  onOpenProjectChat={onOpenProjectChat}
                />
              )}

              {activeTab === 'database' && (
                <div className="flex-1 min-h-0 flex flex-col p-1">
                  {devStatus && devStatus.status !== 'running' && (
                    <div className="mb-3 flex items-center justify-between rounded-xl border border-status-warning/30 bg-status-warning/10 p-3 text-xs">
                      <div className="flex items-center gap-2">
                        <Pause className="h-4 w-4 text-status-warning shrink-0" />
                        <div>
                          <span className="font-semibold text-on-surface">Dev-Sandbox ist pausiert</span>
                          <span className="text-on-surface-variant ml-1.5">
                            {devStatus.status === 'paused_idle'
                              ? `(Auto-Pause nach ${Math.round(devStatus.idle_minutes ?? 60)} Min. Inaktivität)`
                              : '(Gestoppt)'}
                          </span>
                        </div>
                      </div>
                      {canStartDevPreview && (
                        <Button
                          type="button"
                          size="sm"
                          className="h-7 text-xs px-3 gap-1 rounded-full"
                          onClick={handleStartDevSandbox}
                          disabled={devStatusLoading}
                        >
                          {devStatusLoading ? <Spinner className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 shrink-0" />}
                          <span>Dev-Sandbox starten</span>
                        </Button>
                      )}
                    </div>
                  )}
                  {envState?.dev?.dev_has_db && envState.dev.dev_server_id && envState.dev.dev_database_id ? (
                    <div className="flex-1 min-h-0 flex flex-col">
                      <PostgresStudio
                        ziel={{
                          art: 'server',
                          serverId: envState.dev.dev_server_id,
                          databaseId: envState.dev.dev_database_id,
                        }}
                        databaseName={envState.dev.dev_database_name ?? undefined}
                      />
                    </div>
                  ) : (
                    <div className="max-w-md mx-auto my-auto p-6 rounded-2xl border border-outline-variant/30 bg-surface-container-low text-center space-y-4">
                      <Database className="h-10 w-10 text-primary mx-auto opacity-75" />
                      <div>
                        <h3 className="text-base font-semibold text-on-surface">PostgreSQL Dev-Datenbank</h3>
                        <p className="text-xs text-on-surface-variant mt-1">
                          Dieses Projekt besitzt aktuell noch keine aktive Dev-Datenbank. Sobald SQL-Dateien oder Tabellenschemata vorliegen, kann eine isolierte Entwicklungsdatenbank angelegt werden.
                        </p>
                      </div>
                      <Button
                        type="button"
                        className="rounded-full px-5 text-xs"
                        onClick={async () => {
                          if (!selectedProject) return
                          try {
                            const res = await aiApi.ensureDevDatabase(selectedProject.id)
                            if (res.ok) {
                              toast.success(`Dev-Datenbank „${res.dev_database_name}“ erfolgreich eingerichtet.`)
                              const env = await aiApi.getProjectEnvironment(selectedProject.id)
                              setEnvState(env)
                            } else {
                              toast.warning(res.message || 'Konnte keine Dev-Datenbank anlegen.')
                            }
                          } catch (err: unknown) {
                            toast.error(err instanceof Error ? err.message : 'Fehler beim Anlegen der Dev-Datenbank.')
                          }
                        }}
                      >
                        <Database className="h-3.5 w-3.5 mr-1.5" />
                        Dev-Datenbank einrichten
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'tests' && selectedProject && (
                <div className="flex-1 min-h-0 overflow-y-auto max-w-4xl w-full mx-auto p-1">
                  <SingraTestResults
                    projectId={selectedProject.id}
                    onTestCompleted={(passed) => setLatestTestPassed(passed)}
                  />
                </div>
              )}

              {activeTab === 'settings' && (
                <SingraSettingsTab
                  selectedProject={selectedProject}
                  projectAutonomy={projectAutonomy}
                  hasProjectAutonomyOverride={hasProjectAutonomyOverride}
                  globalAutonomy={globalAutonomy}
                  savingAutonomy={savingAutonomy}
                  gitStatus={gitStatus}
                  gitBusy={gitBusy}
                  commitMessage={commitMessage}
                  setCommitMessage={setCommitMessage}
                  pushOnCommit={pushOnCommit}
                  setPushOnCommit={setPushOnCommit}
                  onUpdateProject={(patch) => void handleUpdateProject(patch)}
                  onToggleAutonomy={(enabled) => void handleToggleAutonomy(enabled)}
                  onResetAutonomyToGlobal={() => void handleResetAutonomyToGlobal()}
                  onOpenCreateRepo={(projectName) => {
                    setNewRepoName(projectName)
                    setCreateRepoOpen(true)
                  }}
                  onGitSync={() => void handleGitSync()}
                  onGitCommit={handleGitCommit}
                />
              )}
            </div>
          </>
        </div>
      )}

      <SingraProjectModals
        selectedProject={selectedProject}
        teams={teams}
        newFileModalOpen={newFileModalOpen}
        setNewFileModalOpen={setNewFileModalOpen}
        newFilePath={newFilePath}
        setNewFilePath={setNewFilePath}
        onSaveNewFile={(path, content) => void handleSaveFile(path, content)}
        createRepoOpen={createRepoOpen}
        setCreateRepoOpen={setCreateRepoOpen}
        newRepoName={newRepoName}
        setNewRepoName={setNewRepoName}
        newRepoPrivate={newRepoPrivate}
        setNewRepoPrivate={setNewRepoPrivate}
        newRepoProvider={newRepoProvider}
        setNewRepoProvider={setNewRepoProvider}
        newRepoToken={newRepoToken}
        setNewRepoToken={setNewRepoToken}
        gitBusy={gitBusy}
        onCreateRemoteRepo={handleCreateRemoteRepoForExisting}
        showAgentsModal={showAgentsModal}
        setShowAgentsModal={setShowAgentsModal}
        agentsRules={agentsRules}
        teamShareModalOpen={teamShareModalOpen}
        setTeamShareModalOpen={setTeamShareModalOpen}
        selectedTeamShareId={selectedTeamShareId}
        setSelectedTeamShareId={setSelectedTeamShareId}
        savingProject={savingProject}
        onSaveTeamShare={handleSaveTeamShare}
      />

      <SingraCreateProjectModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        createMode={createMode}
        setCreateMode={setCreateMode}
        createRepoPrivate={createRepoPrivate}
        setCreateRepoPrivate={setCreateRepoPrivate}
        showAdvancedCreate={showAdvancedCreate}
        setShowAdvancedCreate={setShowAdvancedCreate}
        draft={draft}
        setDraft={setDraft}
        teams={teams}
        savingProject={savingProject}
        onSubmit={handleCreateProject}
      />

      <SingraPublishModal
        open={publishModalOpen}
        onOpenChange={setPublishModalOpen}
        selectedProject={selectedProject}
        envState={envState}
        publishMode={publishMode}
        setPublishMode={setPublishMode}
        publishEnableDb={publishEnableDb}
        setPublishEnableDb={setPublishEnableDb}
        publishApiPath={publishApiPath}
        setPublishApiPath={setPublishApiPath}
        publishBackendProxyUrl={publishBackendProxyUrl}
        setPublishBackendProxyUrl={setPublishBackendProxyUrl}
        selectedNodeId={selectedNodeId}
        setSelectedNodeId={setSelectedNodeId}
        availableNodes={availableNodes}
        selectedTargetServerId={selectedTargetServerId}
        setSelectedTargetServerId={setSelectedTargetServerId}
        publishBindIp={publishBindIp}
        setPublishBindIp={setPublishBindIp}
        publishOptions={publishOptions}
        releaseNotes={releaseNotes}
        setReleaseNotes={setReleaseNotes}
        publishDomainMode={publishDomainMode}
        setPublishDomainMode={setPublishDomainMode}
        publishCfZoneId={publishCfZoneId}
        setPublishCfZoneId={setPublishCfZoneId}
        publishCfSubdomain={publishCfSubdomain}
        setPublishCfSubdomain={setPublishCfSubdomain}
        publishDomain={publishDomain}
        setPublishDomain={setPublishDomain}
        publishMergeToMain={publishMergeToMain}
        setPublishMergeToMain={setPublishMergeToMain}
        latestTestPassed={latestTestPassed}
        setLatestTestPassed={setLatestTestPassed}
        publishing={publishing}
        onSubmitDirect={handlePublishToProduction}
        onGuidedPublish={() => void handleGuidedPublish()}
      />

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

      {/* 14-Phasen Bereitstellungs-Panel (Live-Status & Diagnose) */}
      <Dialog open={showDeploymentPanel} onOpenChange={setShowDeploymentPanel}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Rocket className="h-5 w-5 text-primary" />
              <span>Bereitstellungs-Status: „{selectedProject?.name}“</span>
            </DialogTitle>
            <DialogDescription>
              Verfolgt die 14 Phasen von Quellcode-Erfassung und Tests bis zur produktiven Freigabe.
            </DialogDescription>
          </DialogHeader>
          {selectedProject && (
            <div className="p-4">
              <SingraDeploymentPanel
                projectId={selectedProject.id}
                activeDeploymentId={activeDeploymentId}
                onClose={() => setShowDeploymentPanel(false)}
                onRetry={() => {
                  setShowDeploymentPanel(false)
                  setPublishModalOpen(true)
                }}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
