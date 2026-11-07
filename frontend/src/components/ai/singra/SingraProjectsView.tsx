import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileTree } from '@/components/server/FileTree'
import { FileEditorWorkspace } from '@/components/server/FileEditorWorkspace'
import { detectLineEnding } from '@/components/server/fileHelpers'
import type { EditorTab, FileEntry, SearchResult } from '@/components/server/fileWorkspaceTypes'
import {
  ChevronDown,
  ChevronUp,
  Code2,
  ExternalLink,
  Eye,
  FileCode,
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
  Search,
  Settings2,
  Smartphone,
  Sparkles,
  Tablet,
  Terminal,
  Trash2,
  Unlock,
  X,
} from 'lucide-react'
import {
  aiApi,
  type AiConversationSummary,
  type AiProject,
  type AiProjectExecResult,
  type AiProjectFile,
  type AiProjectGitStatus,
  type AiProjectWrite,
} from '@/api/ai'
import { SanitizedApiError } from '@/api/client'
import { still } from '@/lib/still'
import { teamsApi, type Team } from '@/api/teams'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Dropdown,
  Input,
  Spinner,
  Switch,
  Textarea,
} from '@maunting/ui'
import { confirm } from '@/stores/confirmStore'
import { toast } from '@/stores/toastStore'

type ProjectTab = 'chats' | 'files' | 'preview' | 'settings'
type ProjectCreateMode = 'empty' | 'create_repo' | 'clone_repo'

interface SingraProjectsViewProps {
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

export function SingraProjectsView({ onOpenProjectChat }: SingraProjectsViewProps) {
  const [projects, setProjects] = useState<AiProject[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
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

  // Live-Preview & Inspector state
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop')
  const [inspectMode, setInspectMode] = useState(false)
  const [previewUrl, setPreviewUrl] = useState('http://localhost:5173')
  const [previewMode, setPreviewMode] = useState<'bundle' | 'url'>('bundle')
  const [inspectElement, setInspectElement] = useState<string | null>(null)
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null)

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
      const [projRows, teamRows] = await Promise.all([
        aiApi.listProjects(),
        teamsApi.list().catch(() => [] as Team[]),
      ])
      setProjects(projRows)
      setTeams(teamRows.filter((t) => !t.is_personal))
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

  const openFileInEditor = useCallback(
    (path: string, fileListSource?: AiProjectFile[]) => {
      const list = fileListSource ?? files
      const target = list.find((f) => f.path === path)
      if (!target) return
      const modifiedTs = target.updated_at
        ? Math.floor(new Date(target.updated_at).getTime() / 1000)
        : 0
      setEditorTabs((prev) => {
        const exists = prev.some((t) => t.path === path)
        if (exists) return prev
        const nextTab: EditorTab = {
          path: target.path,
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
      setActiveFilePath(path)
    },
    [files],
  )

  const loadProjectDetails = useCallback(
    async (projectId: string) => {
      try {
        const [chats, fileList, rules] = await Promise.all([
          aiApi.listConversations(projectId),
          aiApi.listProjectFiles(projectId),
          aiApi.getProjectAgentsRules(projectId).catch(() => ({
            found: false,
            filename: null,
            content: null,
            lines_count: 0,
            size_bytes: 0,
          })),
        ])
        setProjectChats(chats)
        setFiles(fileList)
        setAgentsRules(rules)

        const { allDirs: dirs } = buildProjectTreeNodes(fileList)
        setExpandedDirs(new Set(['', ...dirs.filter((d) => !d.includes('/'))]))

        if (fileList.length > 0) {
          const preferred =
            fileList.find((f) => f.path.toLowerCase() === 'readme.md') ??
            fileList.find((f) => f.path.toLowerCase() === 'index.html') ??
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

  // Automatischer srcDoc-Bundle für HTML/CSS/JS-Projekte direkt im Browser
  const previewSrcDoc = useMemo(() => {
    if (previewMode !== 'bundle') return null
    const htmlFile =
      files.find((f) => f.path.toLowerCase() === 'index.html') ||
      files.find((f) => f.path.toLowerCase().endsWith('.html'))
    if (!htmlFile) return null

    let doc =
      htmlFile.content ||
      '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body></body></html>'

    files
      .filter((f) => f.path.toLowerCase().endsWith('.css'))
      .forEach((css) => {
        const baseName = css.path.split('/').pop() || css.path
        const linkRegex = new RegExp(
          `<link[^>]+href=["'][^"']*${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`,
          'gi',
        )
        if (linkRegex.test(doc)) {
          doc = doc.replace(linkRegex, `<style>/* ${css.path} */\n${css.content}</style>`)
        } else {
          doc = doc.replace('</head>', `<style>/* ${css.path} */\n${css.content}</style></head>`)
        }
      })

    files
      .filter((f) => f.path.toLowerCase().endsWith('.js') && !f.path.toLowerCase().endsWith('.json'))
      .forEach((js) => {
        const baseName = js.path.split('/').pop() || js.path
        const scriptRegex = new RegExp(
          `<script[^>]+src=["'][^"']*${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>\\s*</script>`,
          'gi',
        )
        if (scriptRegex.test(doc)) {
          doc = doc.replace(scriptRegex, `<script>/* ${js.path} */\n${js.content}</script>`)
        } else {
          doc = doc.replace('</body>', `<script>/* ${js.path} */\n${js.content}</script></body>`)
        }
      })

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
  }, [files, previewMode])

  useEffect(() => {
    const handleMsg = (ev: MessageEvent) => {
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

  if (loading) {
    return (
      <div className="flex h-full flex-1 items-center justify-center">
        <Spinner size="lg" className="text-primary" />
      </div>
    )
  }

  return (
    <div className="flex h-full w-full min-h-0 flex-1 flex-col lg:flex-row overflow-hidden bg-surface">
      {/* Left Column: Calm Project List */}
      <div className="w-full lg:w-68 shrink-0 border-b lg:border-b-0 lg:border-r border-outline-variant/20 bg-surface-container-low/30 flex flex-col max-h-52 lg:max-h-none">
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-outline-variant/15">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" aria-hidden="true" />
            <h2 className="font-headline text-sm font-semibold text-on-surface">
              Projekte
            </h2>
            <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-label-sm font-medium text-on-surface-variant">
              {projects.length}
            </span>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => setCreateOpen(true)}
            className="h-8 px-3 text-xs rounded-full"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Neu
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-2.5 space-y-1">
          {projects.length === 0 ? (
            <div className="p-4 text-center text-xs text-on-surface-variant leading-relaxed">
              Noch kein Projekt vorhanden. Lege einen eigenen Arbeitsbereich für Code, Ideen oder Dokumente an.
            </div>
          ) : (
            projects.map((proj) => {
              const active = proj.id === selectedId
              return (
                <button
                  key={proj.id}
                  type="button"
                  onClick={() => setSelectedId(proj.id)}
                  className={[
                    'w-full rounded-xl p-3 text-left transition-all border',
                    active
                      ? 'border-primary/35 bg-primary/12 text-on-surface shadow-sm'
                      : 'border-transparent bg-surface-container/30 text-on-surface-variant hover:bg-surface-container-high/45 hover:text-on-surface',
                  ].join(' ')}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm text-on-surface truncate">
                      {proj.name}
                    </span>
                    {proj.git_repo_url && (
                      <GitBranch className="h-3.5 w-3.5 shrink-0 text-primary/80" aria-hidden="true" />
                    )}
                  </div>
                  {proj.description && (
                    <p className="mt-0.5 line-clamp-1 text-xs text-on-surface-variant">
                      {proj.description}
                    </p>
                  )}
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* Right Column: Cozy Project Workspace */}
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
        {!selectedProject ? (
          <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary mb-4">
              <Code2 className="h-6 w-6" aria-hidden="true" />
            </div>
            <h3 className="font-headline text-lg font-semibold text-on-surface">
              Dein Projekt-Arbeitsbereich
            </h3>
            <p className="mt-2 max-w-md text-sm text-on-surface-variant leading-relaxed">
              Arbeite gemeinsam mit Singra an eigenen Anwendungen, Skripten oder Dokumenten. Du kannst leer starten, direkt ein neues GitHub-Repository anlegen oder bestehenden Code klonen.
            </p>
            <Button type="button" className="mt-5 rounded-full px-5" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Neues Projekt starten
            </Button>
          </div>
        ) : (
          <>
            {/* Calm Project Top Bar (No Dev/Prod technical clutter) */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant/20 bg-surface-container-low/35 px-4 py-3 shrink-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="font-headline text-base font-semibold text-on-surface truncate">
                    {selectedProject.name}
                  </h2>
                  {selectedProject.git_repo_url ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-label-sm font-medium text-primary">
                      <GitBranch className="h-3 w-3" aria-hidden="true" />
                      {selectedProject.git_branch || 'main'}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setNewRepoName(selectedProject.name)
                        setCreateRepoOpen(true)
                      }}
                      className="inline-flex items-center gap-1 rounded-full border border-outline-variant/35 bg-surface-container-high/50 px-2.5 py-0.5 text-label-sm font-medium text-on-surface-variant hover:text-primary hover:border-primary/40 transition-colors"
                    >
                      <FolderGit2 className="h-3 w-3" aria-hidden="true" />
                      <span>Mit GitHub verknüpfen</span>
                    </button>
                  )}
                  {agentsRules?.found && (
                    <button
                      type="button"
                      onClick={() => setShowAgentsModal(true)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-label-sm font-medium text-primary hover:bg-primary/20 transition-colors"
                      title="Projektregeln ansehen"
                    >
                      <FileText className="h-3 w-3" aria-hidden="true" />
                      <span>{agentsRules.filename}</span>
                      <Eye className="h-2.5 w-2.5 opacity-70" />
                    </button>
                  )}
                </div>
                {selectedProject.description && (
                  <p className="text-xs text-on-surface-variant truncate mt-0.5">
                    {selectedProject.description}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="rounded-full px-3.5"
                  onClick={() => void handleStartNewProjectChat()}
                >
                  <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                  Neuer Chat
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0 rounded-full text-on-surface-variant hover:text-status-destructive"
                  onClick={() => void handleDeleteProject(selectedProject)}
                  aria-label="Projekt löschen"
                  title="Projekt löschen"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>

            {/* 4 Clean Workspace Tabs */}
            <div className="flex items-center gap-1.5 border-b border-outline-variant/20 bg-surface-container-low/15 px-4 py-1.5 overflow-x-auto no-scrollbar shrink-0">
              {(
                [
                  { id: 'chats', label: `Unterhaltungen (${projectChats.length})`, icon: MessageSquare },
                  { id: 'files', label: `Dateien & Code (${files.length})`, icon: FileCode },
                  { id: 'preview', label: 'Vorschau', icon: Globe },
                  { id: 'settings', label: 'Git & Einstellungen', icon: Settings2 },
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
                  <div className="flex flex-1 min-h-0 flex-col md:flex-row gap-3 overflow-hidden">
                    {/* Left: Hierarchical Server FileTree */}
                    <div className="w-full md:w-68 shrink-0 rounded-2xl border border-outline-variant/25 bg-surface-container-low/35 flex flex-col max-h-60 md:max-h-none overflow-hidden">
                      <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-outline-variant/20">
                        <span className="text-xs font-semibold text-on-surface">
                          Projektdateien
                        </span>
                        <div className="flex items-center gap-1">
                          {activeFilePath && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-on-surface-variant hover:text-status-destructive"
                              onClick={() => void handleDeleteFile(activeFilePath)}
                              title={`„${activeFilePath}“ löschen`}
                              aria-label={`Datei ${activeFilePath} löschen`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="h-7 px-2.5 text-xs rounded-lg"
                            onClick={() => {
                              setNewFilePath('')
                              setNewFileModalOpen(true)
                            }}
                          >
                            <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" />
                            Neu
                          </Button>
                        </div>
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
                            if (!entry.is_dir) {
                              e.preventDefault()
                              const fullPath = parent ? `${parent}/${entry.name}` : entry.name
                              openFileInEditor(fullPath)
                            }
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
                          <span>Konsole / Terminal</span>
                          {terminalOpen ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronUp className="h-3.5 w-3.5" />
                          )}
                        </button>
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
                    </div>

                    {/* Right: Shared Multi-Tab FileEditorWorkspace */}
                    <div className="flex flex-1 min-h-[380px] flex-col rounded-2xl border border-outline-variant/25 bg-surface-container-low/35 overflow-hidden">
                      <FileEditorWorkspace
                        tabs={editorTabs}
                        activePath={activeFilePath}
                        canWrite={true}
                        tabListLabel="Geöffnete Projektdateien"
                        horizontalScrollHint="Horizontal scrollen"
                        ortLabel={selectedProject.name}
                        onActivate={(path) => setActiveFilePath(path)}
                        onChange={handleEditorChange}
                        onSave={(path) => void handleSaveFile(path)}
                        onClose={handleEditorCloseTab}
                        onReload={handleEditorReloadTab}
                      />
                    </div>
                  </div>

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
                          placeholder="Befehl eingeben (z. B. npm test, pytest, git status)…"
                          className="flex-1 font-mono text-xs h-8"
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
                          {runningCmd ? 'Läuft…' : 'Starten'}
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
                                <span>
                                  Code {item.result.exit_code} • {item.timestamp}
                                </span>
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
                    <div className="flex items-center gap-2 flex-1 max-w-lg">
                      <div className="flex items-center rounded-lg border border-outline-variant/30 bg-surface-container-high/40 p-0.5 shrink-0 text-xs">
                        <button
                          type="button"
                          onClick={() => setPreviewMode('bundle')}
                          className={[
                            'px-2.5 py-1 rounded-md transition-colors font-medium',
                            previewMode === 'bundle'
                              ? 'bg-primary/20 text-primary'
                              : 'text-on-surface-variant hover:text-on-surface',
                          ].join(' ')}
                        >
                          Projektdateien
                        </button>
                        <button
                          type="button"
                          onClick={() => setPreviewMode('url')}
                          className={[
                            'px-2.5 py-1 rounded-md transition-colors font-medium',
                            previewMode === 'url'
                              ? 'bg-primary/20 text-primary'
                              : 'text-on-surface-variant hover:text-on-surface',
                          ].join(' ')}
                        >
                          Lokale Adresse
                        </button>
                      </div>

                      {previewMode === 'url' ? (
                        <div className="flex items-center gap-1.5 flex-1">
                          <Globe className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
                          <Input
                            value={previewUrl}
                            onChange={(e) => setPreviewUrl(e.target.value)}
                            placeholder="http://localhost:5173"
                            className="h-8 text-xs font-mono"
                            aria-label="Vorschau-Adresse"
                          />
                        </div>
                      ) : (
                        <span className="text-xs text-on-surface-variant truncate font-mono">
                          {files.some((f) => f.path.toLowerCase().endsWith('.html'))
                            ? files.find((f) => f.path.toLowerCase() === 'index.html')?.path ||
                              files.find((f) => f.path.toLowerCase().endsWith('.html'))?.path
                            : 'Keine HTML-Datei im Projekt'}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex items-center rounded-lg border border-outline-variant/30 bg-surface-container-high/40 p-0.5">
                        <button
                          type="button"
                          onClick={() => setPreviewDevice('desktop')}
                          className={[
                            'p-1.5 rounded-md transition-colors',
                            previewDevice === 'desktop'
                              ? 'bg-primary/20 text-primary'
                              : 'text-on-surface-variant hover:text-on-surface',
                          ].join(' ')}
                          title="Desktop"
                        >
                          <Laptop className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setPreviewDevice('tablet')}
                          className={[
                            'p-1.5 rounded-md transition-colors',
                            previewDevice === 'tablet'
                              ? 'bg-primary/20 text-primary'
                              : 'text-on-surface-variant hover:text-on-surface',
                          ].join(' ')}
                          title="Tablet"
                        >
                          <Tablet className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setPreviewDevice('mobile')}
                          className={[
                            'p-1.5 rounded-md transition-colors',
                            previewDevice === 'mobile'
                              ? 'bg-primary/20 text-primary'
                              : 'text-on-surface-variant hover:text-on-surface',
                          ].join(' ')}
                          title="Smartphone"
                        >
                          <Smartphone className="h-3.5 w-3.5" />
                        </button>
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

                      {previewMode === 'url' && (
                        <a
                          href={previewUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-outline-variant/30 bg-surface-container-high/50 text-on-surface-variant hover:text-on-surface transition-colors"
                          title="Im neuen Tab öffnen"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  </div>

                  {inspectElement && (
                    <div className="flex items-center justify-between gap-2 border-b border-primary/20 bg-primary/10 px-4 py-2 text-xs text-on-surface">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-primary">Ausgewählt:</span>
                        <code className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-primary text-xs">
                          {inspectElement}
                        </code>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          className="h-6 px-2.5 text-xs"
                          onClick={() => {
                            void handleStartNewProjectChat(`Anpassung für ${inspectElement}`)
                          }}
                        >
                          Mit Singra anpassen
                        </Button>
                        <button
                          type="button"
                          onClick={() => setInspectElement(null)}
                          className="text-on-surface-variant hover:text-on-surface"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-1 items-center justify-center bg-black/35 p-4 overflow-auto min-h-[380px]">
                    <div
                      className={[
                        'h-full min-h-[420px] transition-all rounded-xl overflow-hidden border border-outline-variant/30 shadow-2xl bg-surface flex flex-col',
                        previewDevice === 'desktop'
                          ? 'w-full'
                          : previewDevice === 'tablet'
                            ? 'w-[768px]'
                            : 'w-[375px]',
                      ].join(' ')}
                    >
                      {previewMode === 'bundle' && !previewSrcDoc ? (
                        <div className="flex flex-1 flex-col items-center justify-center p-8 text-center text-on-surface-variant">
                          <Globe className="h-10 w-10 text-primary/40 mb-3" />
                          <p className="text-sm font-medium text-on-surface">
                            Noch keine Vorschau verfügbar
                          </p>
                          <p className="text-xs text-on-surface-variant max-w-sm mt-1">
                            Sobald eine HTML-Datei (z. B. <code>index.html</code>) im Projekt liegt, wird sie hier direkt dargestellt.
                          </p>
                        </div>
                      ) : (
                        <iframe
                          ref={previewIframeRef}
                          key={previewMode === 'bundle' ? 'bundle-preview' : previewUrl}
                          src={previewMode === 'url' ? previewUrl : undefined}
                          srcDoc={previewMode === 'bundle' ? (previewSrcDoc ?? undefined) : undefined}
                          title="Projekt-Vorschau"
                          className="w-full flex-1 border-0 min-h-[400px] bg-white"
                          sandbox="allow-scripts allow-forms allow-modals"
                        />
                      )}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'settings' && (
                <div className="max-w-3xl w-full mx-auto space-y-5 py-1">
                  {/* Card 1: GitHub / GitLab Connection & Direct Repo Creation */}
                  <div className="rounded-2xl border border-outline-variant/25 bg-surface-container-low/40 p-5 space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-on-surface flex items-center gap-2">
                          <FolderGit2 className="h-4 w-4 text-primary" />
                          <span>GitHub & GitLab Anbindung</span>
                        </h3>
                        <p className="text-xs text-on-surface-variant mt-0.5">
                          {selectedProject.git_repo_url
                            ? `Verknüpft mit ${selectedProject.git_repo_url} (${selectedProject.git_branch || 'main'})`
                            : 'Verknüpfe ein bestehendes Repository oder erstelle mit einem Klick ein neues Repository auf GitHub.'}
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
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={gitBusy}
                          onClick={() => void loadGitStatus()}
                        >
                          <RefreshCw className={`h-3.5 w-3.5 ${gitBusy ? 'animate-spin' : ''}`} />
                          Status
                        </Button>
                        {selectedProject.git_repo_url && (
                          <Button
                            type="button"
                            size="sm"
                            disabled={gitBusy}
                            onClick={() => void handleGitSync()}
                          >
                            <GitBranch className="h-3.5 w-3.5" />
                            Abgleichen (Pull)
                          </Button>
                        )}
                      </div>
                    </div>

                    {gitStatus && (
                      <div className="rounded-xl border border-outline-variant/20 bg-surface-container/50 p-3.5 text-xs space-y-1.5">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="font-medium text-on-surface">
                            {gitStatus.initialized ? 'Git bereit' : 'Noch nicht initialisiert'}
                          </span>
                          {gitStatus.branch && (
                            <span className="rounded-md bg-primary/15 px-2 py-0.5 text-primary font-medium">
                              {gitStatus.branch}
                            </span>
                          )}
                          {gitStatus.last_commit && (
                            <span className="font-mono text-on-surface-variant truncate">
                              Letzter Stand: {gitStatus.last_commit}
                            </span>
                          )}
                        </div>
                        {(gitStatus.changed_files?.length ?? 0) > 0 ? (
                          <div className="pt-1">
                            <div className="font-medium text-on-surface mb-1">
                              Offene Änderungen ({gitStatus.changed_files?.length ?? 0}):
                            </div>
                            <ul className="font-mono text-label-sm text-on-surface-variant space-y-0.5 max-h-32 overflow-y-auto">
                              {gitStatus.changed_files?.map((line, i) => (
                                <li key={i}>{line}</li>
                              ))}
                            </ul>
                          </div>
                        ) : (
                          gitStatus.initialized && (
                            <p className="text-status-success">
                              Alle Dateien sind auf dem aktuellen Stand.
                            </p>
                          )
                        )}
                      </div>
                    )}

                    {/* Quick Commit & Push */}
                    <form
                      onSubmit={handleGitCommit}
                      className="rounded-xl border border-outline-variant/20 bg-surface-container/30 p-3.5 space-y-3"
                    >
                      <div className="text-xs font-semibold text-on-surface">
                        Stand sichern & übertragen (Commit & Push)
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <Input
                          value={commitMessage}
                          onChange={(e) => setCommitMessage(e.target.value)}
                          placeholder="Kurze Beschreibung der Änderung…"
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
                        <span>Direkt zum verknüpften Repository hochladen (Push)</span>
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
                          Branch
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
                          Repository-Adresse (HTTPS)
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
                          Zugangstoken (optional, falls nicht global im Schlüsselbund hinterlegt)
                        </label>
                        <Input
                          type="password"
                          placeholder={
                            selectedProject.git_token_configured
                              ? 'Token ist hinterlegt (zum Ändern neu eingeben)'
                              : 'ghp_… oder glpat-…'
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

                  {/* Card 2: Project Instructions & General Settings */}
                  <div className="rounded-2xl border border-outline-variant/25 bg-surface-container-low/40 p-5 space-y-4">
                    <h3 className="text-sm font-semibold text-on-surface">
                      Projektname & Anweisungen für Singra
                    </h3>
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
                          placeholder="Welche Ziele, Stilvorgaben oder technischen Rahmenbedingungen gelten für dieses Projekt?"
                          onBlur={(e) => {
                            if (e.target.value !== (selectedProject.system_prompt ?? '')) {
                              void handleUpdateProject({ system_prompt: e.target.value })
                            }
                          }}
                          aria-label="Projektanweisungen"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-on-surface-variant mb-1">
                          Lokaler Ordner auf deinem Gerät (optional)
                        </label>
                        <div className="flex items-center gap-2">
                          <Folder className="h-4 w-4 text-on-surface-variant shrink-0" />
                          <Input
                            defaultValue={selectedProject.local_directory ?? ''}
                            placeholder="z. B. E:\Projekte\mein-projekt"
                            onBlur={(e) => {
                              if (e.target.value !== (selectedProject.local_directory ?? '')) {
                                void handleUpdateProject({
                                  local_directory: e.target.value.trim() || null,
                                })
                              }
                            }}
                            aria-label="Lokaler Projektordner"
                          />
                        </div>
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
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* New File Dialog */}
      <Dialog open={newFileModalOpen} onOpenChange={setNewFileModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Neue Datei anlegen</DialogTitle>
            <DialogDescription>
              Gib den Namen oder Pfad der Datei an (z. B. <code>src/app.ts</code> oder <code>README.md</code>). Unterordner werden automatisch erstellt.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!newFilePath.trim()) return
              setNewFileModalOpen(false)
              void handleSaveFile(newFilePath.trim(), '')
            }}
            className="space-y-4 mt-2"
          >
            <Input
              value={newFilePath}
              onChange={(e) => setNewFilePath(e.target.value)}
              placeholder="src/index.ts"
              autoFocus
              aria-label="Dateipfad"
            />
            <div className="flex justify-end gap-2">
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
          <form onSubmit={handleCreateRemoteRepoForExisting} className="space-y-4 mt-2">
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
                Personal Access Token (optional, falls bereits im Schlüsselbund gespeichert)
              </label>
              <Input
                type="password"
                value={newRepoToken}
                onChange={(e) => setNewRepoToken(e.target.value)}
                placeholder="Berechtigtes Token im Schlüsselbund verwenden oder hier eingeben…"
                aria-label="Personal Access Token"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
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
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto p-6">
          <DialogHeader className="space-y-1.5">
            <DialogTitle className="text-lg font-headline font-semibold text-on-surface">
              Neues Projekt anlegen
            </DialogTitle>
            <DialogDescription className="text-xs text-on-surface-variant">
              Schaffe einen aufgeräumten Arbeitsbereich für deine Unterhaltungen, Dateien und deinen Code.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateProject} className="space-y-4 pt-2">
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
                    Token (nur nötig, falls noch keines im Schlüsselbund liegt)
                  </label>
                  <Input
                    type="password"
                    value={draft.git_token ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, git_token: e.target.value }))}
                    placeholder="ghp_… (leer lassen für gespeichertes Token)"
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
                    Repository-URL
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
                      Branch
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
                      Token (optional)
                    </label>
                    <Input
                      type="password"
                      value={draft.git_token ?? ''}
                      onChange={(e) => setDraft((d) => ({ ...d, git_token: e.target.value }))}
                      placeholder="ghp_…"
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
              <span>{agentsRules?.filename ?? 'AGENTS.md'}</span>
            </DialogTitle>
            <DialogDescription>
              Diese Datei aus deinem Projekt wird bei Unterhaltungen automatisch berücksichtigt.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 rounded-xl border border-outline-variant/30 bg-surface-container-lowest/80 p-4 font-mono text-xs leading-relaxed text-on-surface overflow-x-auto whitespace-pre-wrap max-h-[60vh] select-text">
            {agentsRules?.content || 'Kein Inhalt.'}
          </div>
          <div className="flex justify-end pt-2">
            <Button type="button" onClick={() => setShowAgentsModal(false)}>
              Schließen
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
