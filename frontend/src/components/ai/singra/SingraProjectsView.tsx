import { useCallback, useEffect, useState } from 'react'
import {
  Code2,
  FileCode,
  FileText,
  Folder,
  FolderGit2,
  GitBranch,
  GitCommit,
  Layers,
  MessageSquare,
  Play,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Terminal,
  Trash2,
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

type ProjectTab = 'chats' | 'files' | 'terminal' | 'git' | 'settings'

interface SingraProjectsViewProps {
  onOpenProjectChat: (projectId: string, conversationId?: string) => void
}

const PROJECT_KIND_OPTIONS = [
  { value: 'coding', label: 'Software & Coding (mit Sandbox & Git)' },
  { value: 'docs', label: 'Dokumente & Wissensbasis' },
  { value: 'general', label: 'Allgemeines Projekt' },
]

const GIT_PROVIDER_OPTIONS = [
  { value: '__none__', label: 'Keine Git-Anbindung' },
  { value: 'github', label: 'GitHub Repository' },
  { value: 'gitlab', label: 'GitLab Repository' },
  { value: 'custom', label: 'Eigener Git-Server (HTTPS)' },
]

export function SingraProjectsView({ onOpenProjectChat }: SingraProjectsViewProps) {
  const [projects, setProjects] = useState<AiProject[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<ProjectTab>('chats')
  const [loading, setLoading] = useState(true)

  // Project-bound conversations
  const [projectChats, setProjectChats] = useState<AiConversationSummary[]>([])
  // Project files
  const [files, setFiles] = useState<AiProjectFile[]>([])
  const [activeFilePath, setActiveFilePath] = useState<string>('')
  const [fileContent, setFileContent] = useState<string>('')
  const [savingFile, setSavingFile] = useState(false)
  const [newFileModalOpen, setNewFileModalOpen] = useState(false)
  const [newFilePath, setNewFilePath] = useState('')

  // Sandbox Terminal
  const [commandInput, setCommandInput] = useState('')
  const [runningCmd, setRunningCmd] = useState(false)
  const [execHistory, setExecHistory] = useState<
    Array<{ command: string; result: AiProjectExecResult; timestamp: string }>
  >([])

  // Git state
  const [gitStatus, setGitStatus] = useState<AiProjectGitStatus | null>(null)
  const [gitBusy, setGitBusy] = useState(false)
  const [commitMessage, setCommitMessage] = useState('')
  const [pushOnCommit, setPushOnCommit] = useState(true)

  // Create / Edit Modal
  const [createOpen, setCreateOpen] = useState(false)
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

  const loadProjectDetails = useCallback(async (projectId: string) => {
    try {
      const [chats, fileList] = await Promise.all([
        aiApi.listConversations(projectId),
        aiApi.listProjectFiles(projectId),
      ])
      setProjectChats(chats)
      setFiles(fileList)
      if (fileList.length > 0) {
        setActiveFilePath((prev) => {
          const next = fileList.some((f) => f.path === prev) ? prev : fileList[0].path
          const target = fileList.find((f) => f.path === next) ?? fileList[0]
          setFileContent(target.content)
          return next
        })
      } else {
        setActiveFilePath('')
        setFileContent('')
      }
    } catch (err: unknown) {
      toast.error(
        err instanceof SanitizedApiError
          ? err.message
          : 'Projektdaten konnten nicht geladen werden.',
      )
    }
  }, [])

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
    if (activeTab === 'git' && selectedId) {
      void loadGitStatus()
    }
  }, [activeTab, selectedId, loadGitStatus])

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!draft.name.trim() || savingProject) return
    setSavingProject(true)
    try {
      const created = await aiApi.createProject({
        ...draft,
        name: draft.name.trim(),
        description: draft.description?.trim() || null,
        system_prompt: draft.system_prompt?.trim() || null,
        local_directory: draft.local_directory?.trim() || null,
        git_repo_url: draft.git_repo_url?.trim() || null,
        git_branch: draft.git_branch?.trim() || 'main',
        git_token: draft.git_token?.trim() || null,
      })
      setProjects((prev) => [created, ...prev])
      setSelectedId(created.id)
      setCreateOpen(false)
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
      toast.success('Projekt wurde angelegt.')
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

  const handleSaveFile = async (pathToSave: string, contentToSave: string) => {
    if (!selectedProject || !pathToSave.trim() || savingFile) return
    setSavingFile(true)
    try {
      const saved = await aiApi.saveProjectFile(selectedProject.id, {
        path: pathToSave.trim(),
        content: contentToSave,
      })
      setFiles((prev) => {
        const exists = prev.some((f) => f.path === saved.path)
        return exists
          ? prev.map((f) => (f.path === saved.path ? saved : f))
          : [...prev, saved].sort((a, b) => a.path.localeCompare(b.path))
      })
      setActiveFilePath(saved.path)
      setFileContent(saved.content)
      toast.success(`Datei „${saved.path}“ gespeichert.`)
    } catch (err: unknown) {
      toast.error(
        err instanceof SanitizedApiError
          ? err.message
          : 'Datei konnte nicht gespeichert werden.',
      )
    } finally {
      setSavingFile(false)
    }
  }

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
      if (activeFilePath === path) {
        setActiveFilePath(remaining[0]?.path ?? '')
        setFileContent(remaining[0]?.content ?? '')
      }
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
      toast.success('Repository erfolgreich mit Remote abgeglichen (Clone / Pull).')
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
          ? 'Änderungen committet und zum Remote-Repository gepusht.'
          : 'Änderungen lokal committet.',
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

  const handleStartNewProjectChat = async () => {
    if (!selectedProject) return
    try {
      const conv = await aiApi.createConversation({
        title: `${selectedProject.name} Chat`,
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
      {/* Left Column: Project Selector */}
      <div className="w-full lg:w-72 shrink-0 border-b lg:border-b-0 lg:border-r border-outline-variant/25 bg-surface-container-low/35 flex flex-col max-h-60 lg:max-h-none">
        <div className="flex items-center justify-between gap-2 px-4 py-3.5 border-b border-outline-variant/20">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" aria-hidden="true" />
            <h2 className="font-headline text-sm font-semibold text-on-surface">
              Projekte ({projects.length})
            </h2>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => setCreateOpen(true)}
            className="h-8 px-2.5 text-xs"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Neu
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
          {projects.length === 0 ? (
            <div className="p-4 text-center text-xs text-on-surface-variant">
              Erstelle ein Projekt für Code, Dokumente oder ein GitHub/GitLab-Repository.
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
                      : 'border-transparent bg-surface-container/40 text-on-surface-variant hover:bg-surface-container-high/50 hover:text-on-surface',
                  ].join(' ')}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm text-on-surface truncate">
                      {proj.name}
                    </span>
                    <span className="shrink-0 rounded-md bg-surface-container-high px-1.5 py-0.5 text-label-sm font-medium uppercase tracking-wider text-on-surface-variant">
                      {proj.project_kind === 'coding'
                        ? 'Code'
                        : proj.project_kind === 'docs'
                          ? 'Docs'
                          : 'Projekt'}
                    </span>
                  </div>
                  {proj.description && (
                    <p className="mt-1 line-clamp-1 text-xs text-on-surface-variant">
                      {proj.description}
                    </p>
                  )}
                  <div className="mt-2 flex items-center gap-3 text-label-sm text-on-surface-variant/80">
                    <span>{proj.file_count} Dateien</span>
                    {proj.sandbox_enabled && <span>• Sandbox</span>}
                    {proj.git_provider && <span>• {proj.git_provider}</span>}
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* Right Column: Project Workspace */}
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
        {!selectedProject ? (
          <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary mb-4">
              <Code2 className="h-6 w-6" aria-hidden="true" />
            </div>
            <h3 className="font-headline text-lg font-semibold text-on-surface">
              Singra Projekte & Coding-Sandbox
            </h3>
            <p className="mt-2 max-w-md text-sm text-on-surface-variant">
              Binde Dateien, Systemanweisungen, eine isolierte Linux-Sandbox oder ein GitHub- bzw. GitLab-Repository an ein Projekt an und arbeite gemeinsam mit Singra daran.
            </p>
            <Button type="button" className="mt-5" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Erstes Projekt anlegen
            </Button>
          </div>
        ) : (
          <>
            {/* Project Top Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant/25 bg-surface-container-low/40 px-4 py-3 shrink-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="font-headline text-base font-semibold text-on-surface truncate">
                    {selectedProject.name}
                  </h2>
                  {selectedProject.git_repo_url && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-label-sm font-medium text-primary">
                      <GitBranch className="h-3 w-3" aria-hidden="true" />
                      {selectedProject.git_branch}
                    </span>
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
                  onClick={() => void handleStartNewProjectChat()}
                >
                  <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                  Im Chat öffnen
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={() => void handleDeleteProject(selectedProject)}
                  aria-label="Projekt löschen"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </div>
            </div>

            {/* Project Sub-Navigation Tabs */}
            <div className="flex items-center gap-1 border-b border-outline-variant/20 bg-surface-container-low/20 px-4 py-1.5 overflow-x-auto shrink-0">
              {(
                [
                  { id: 'chats', label: `Chats (${projectChats.length})`, icon: MessageSquare },
                  { id: 'files', label: `Dateien (${files.length})`, icon: FileCode },
                  { id: 'terminal', label: 'Sandbox & Terminal', icon: Terminal },
                  { id: 'git', label: 'Git (GitHub / GitLab)', icon: FolderGit2 },
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
                      'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors shrink-0',
                      active
                        ? 'bg-primary/15 text-primary border border-primary/30'
                        : 'text-on-surface-variant hover:bg-surface-container-high/50 hover:text-on-surface border border-transparent',
                    ].join(' ')}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{tab.label}</span>
                  </button>
                )
              })}
            </div>

            {/* Tab Content */}
            <div className="flex-1 min-h-0 overflow-y-auto p-4">
              {activeTab === 'chats' && (
                <div className="max-w-3xl space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-on-surface">
                        Projekt-Unterhaltungen
                      </h3>
                      <p className="text-xs text-on-surface-variant">
                        Jeder Chat in diesem Projekt kennt automatisch die Projektanweisungen, Dateien, die Server-Sandbox und das Git-Repository.
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void handleStartNewProjectChat()}
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      Neuer Projekt-Chat
                    </Button>
                  </div>

                  {projectChats.length === 0 ? (
                    <div className="rounded-xl border border-outline-variant/30 bg-surface-container-low/30 p-6 text-center text-sm text-on-surface-variant">
                      Noch keine Unterhaltung in diesem Projekt. Starte einen neuen Projekt-Chat, um mit Singra an Dateien oder Code zu arbeiten.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {projectChats.map((chat) => (
                        <div
                          key={chat.id}
                          className="flex items-center justify-between rounded-xl border border-outline-variant/30 bg-surface-container-low/40 px-4 py-3 hover:border-primary/40 transition-colors"
                        >
                          <button
                            type="button"
                            onClick={() => onOpenProjectChat(selectedProject.id, chat.id)}
                            className="flex min-w-0 flex-1 items-center gap-3 text-left"
                          >
                            <MessageSquare className="h-4 w-4 shrink-0 text-primary" />
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
                <div className="flex h-full min-h-[420px] flex-col md:flex-row gap-4">
                  {/* File Tree */}
                  <div className="w-full md:w-64 shrink-0 rounded-xl border border-outline-variant/30 bg-surface-container-low/35 p-3 flex flex-col">
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-outline-variant/20">
                      <span className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                        Dateibaum
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() => {
                          setNewFilePath('')
                          setNewFileModalOpen(true)
                        }}
                      >
                        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                        Datei
                      </Button>
                    </div>
                    <div className="flex-1 overflow-y-auto space-y-1">
                      {files.length === 0 ? (
                        <p className="p-2 text-xs text-on-surface-variant">
                          Noch keine Dateien im Projekt.
                        </p>
                      ) : (
                        files.map((f) => (
                          <div
                            key={f.id}
                            className={[
                              'flex items-center justify-between gap-1 rounded-lg px-2.5 py-1.5 text-xs transition-colors',
                              activeFilePath === f.path
                                ? 'bg-primary/15 text-on-surface font-medium'
                                : 'text-on-surface-variant hover:bg-surface-container-high/50 hover:text-on-surface',
                            ].join(' ')}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setActiveFilePath(f.path)
                                setFileContent(f.content)
                              }}
                              className="flex min-w-0 flex-1 items-center gap-2 text-left"
                            >
                              <FileText className="h-3.5 w-3.5 shrink-0 text-primary/80" />
                              <span className="truncate font-mono">{f.path}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteFile(f.path)}
                              className="p-1 text-on-surface-variant hover:text-status-destructive"
                              aria-label={`Datei ${f.path} löschen`}
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* File Editor */}
                  <div className="flex flex-1 flex-col rounded-xl border border-outline-variant/30 bg-surface-container-low/35 p-3">
                    {activeFilePath ? (
                      <>
                        <div className="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-outline-variant/20">
                          <span className="font-mono text-xs font-medium text-on-surface">
                            {activeFilePath}
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            disabled={savingFile}
                            onClick={() => void handleSaveFile(activeFilePath, fileContent)}
                          >
                            <Save className="h-3.5 w-3.5" aria-hidden="true" />
                            {savingFile ? 'Speichert…' : 'Speichern'}
                          </Button>
                        </div>
                        <textarea
                          value={fileContent}
                          onChange={(e) => setFileContent(e.target.value)}
                          className="msm-input flex-1 min-h-[320px] w-full font-mono text-xs leading-relaxed resize-y"
                          aria-label={`Dateiinhalt von ${activeFilePath}`}
                        />
                      </>
                    ) : (
                      <div className="flex flex-1 flex-col items-center justify-center p-6 text-center text-xs text-on-surface-variant">
                        Wähle links eine Datei aus oder lege eine neue Datei (z. B. `README.md` oder `main.py`) an.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'terminal' && (
                <div className="max-w-4xl space-y-4">
                  <div className="rounded-xl border border-outline-variant/30 bg-surface-container-low/40 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-semibold text-on-surface">
                          Sandbox & Befehlsausführung
                        </h3>
                        <p className="text-xs text-on-surface-variant mt-0.5">
                          Arbeitsverzeichnis:{' '}
                          <code className="rounded bg-surface-container-high px-1.5 py-0.5 font-mono text-xs text-on-surface">
                            {selectedProject.local_directory ||
                              selectedProject.sandbox_path ||
                              'Wird beim ersten Befehl initialisiert'}
                          </code>
                        </p>
                      </div>
                    </div>

                    <form onSubmit={handleRunCommand} className="mt-3 flex gap-2">
                      <Input
                        value={commandInput}
                        onChange={(e) => setCommandInput(e.target.value)}
                        placeholder="Befehl ausführen, z. B. pytest, npm test, git status, ls -la …"
                        className="flex-1 font-mono text-xs"
                        disabled={runningCmd}
                        aria-label="Sandbox-Befehl"
                      />
                      <Button
                        type="submit"
                        disabled={runningCmd || !commandInput.trim()}
                      >
                        <Play className="h-4 w-4" aria-hidden="true" />
                        {runningCmd ? 'Läuft…' : 'Ausführen'}
                      </Button>
                    </form>
                  </div>

                  <div className="space-y-3">
                    {execHistory.map((item, idx) => (
                      <div
                        key={idx}
                        className="rounded-xl border border-outline-variant/30 bg-[#0b0e0d] p-3.5 font-mono text-xs"
                      >
                        <div className="flex items-center justify-between border-b border-outline-variant/20 pb-2 text-on-surface-variant">
                          <span className="text-primary font-semibold">$ {item.command}</span>
                          <span>
                            Exit {item.result.exit_code} • {item.result.duration_ms} ms •{' '}
                            {item.timestamp}
                          </span>
                        </div>
                        {item.result.stdout && (
                          <pre className="mt-2 whitespace-pre-wrap break-words text-on-surface">
                            {item.result.stdout}
                          </pre>
                        )}
                        {item.result.stderr && (
                          <pre className="mt-2 whitespace-pre-wrap break-words text-status-warning">
                            {item.result.stderr}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === 'git' && (
                <div className="max-w-3xl space-y-4">
                  <div className="rounded-xl border border-outline-variant/30 bg-surface-container-low/40 p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-semibold text-on-surface">
                          GitHub / GitLab Synchronisierung
                        </h3>
                        <p className="text-xs text-on-surface-variant">
                          {selectedProject.git_repo_url
                            ? `${selectedProject.git_repo_url} (Branch: ${selectedProject.git_branch})`
                            : 'Hinterlege in den Projekteinstellungen eine GitHub- oder GitLab-Repository-URL.'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={gitBusy}
                          onClick={() => void loadGitStatus()}
                        >
                          <RefreshCw
                            className={`h-3.5 w-3.5 ${gitBusy ? 'animate-spin' : ''}`}
                          />
                          Status prüfen
                        </Button>
                        {selectedProject.git_repo_url && (
                          <Button
                            type="button"
                            size="sm"
                            disabled={gitBusy}
                            onClick={() => void handleGitSync()}
                          >
                            <GitBranch className="h-3.5 w-3.5" />
                            Clone / Pull
                          </Button>
                        )}
                      </div>
                    </div>

                    {gitStatus && (
                      <div className="rounded-lg border border-outline-variant/25 bg-surface-container/50 p-3 text-xs space-y-1.5">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="font-medium text-on-surface">
                            Status:{' '}
                            {gitStatus.initialized ? 'Initialisiert' : 'Noch nicht geklont'}
                          </span>
                          {gitStatus.branch && <span>Branch: {gitStatus.branch}</span>}
                          {gitStatus.last_commit && (
                            <span className="font-mono text-on-surface-variant">
                              Letzter Commit: {gitStatus.last_commit}
                            </span>
                          )}
                        </div>
                        {gitStatus.changed_files.length > 0 ? (
                          <div className="mt-2">
                            <div className="font-medium text-on-surface mb-1">
                              Geänderte Dateien ({gitStatus.changed_files.length}):
                            </div>
                            <ul className="font-mono text-label-sm text-on-surface-variant space-y-0.5 max-h-36 overflow-y-auto">
                              {gitStatus.changed_files.map((line, i) => (
                                <li key={i}>{line}</li>
                              ))}
                            </ul>
                          </div>
                        ) : (
                          gitStatus.initialized && (
                            <p className="text-status-success">
                              Working Tree ist sauber (keine offenen Änderungen).
                            </p>
                          )
                        )}
                      </div>
                    )}
                  </div>

                  <form
                    onSubmit={handleGitCommit}
                    className="rounded-xl border border-outline-variant/30 bg-surface-container-low/40 p-4 space-y-3"
                  >
                    <h4 className="text-sm font-semibold text-on-surface">
                      Commit & Push
                    </h4>
                    <Input
                      value={commitMessage}
                      onChange={(e) => setCommitMessage(e.target.value)}
                      placeholder="Commit-Nachricht eingeben …"
                      aria-label="Commit-Nachricht"
                    />
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-2 text-xs text-on-surface">
                        <Switch
                          checked={pushOnCommit}
                          onCheckedChange={setPushOnCommit}
                          aria-label="Nach Commit direkt pushen"
                        />
                        <span>Nach dem Commit direkt zum Remote-Branch pushen</span>
                      </label>
                      <Button
                        type="submit"
                        size="sm"
                        disabled={gitBusy || !commitMessage.trim()}
                      >
                        <GitCommit className="h-3.5 w-3.5" />
                        Commit ausführen
                      </Button>
                    </div>
                  </form>
                </div>
              )}

              {activeTab === 'settings' && (
                <div className="max-w-2xl space-y-4 rounded-xl border border-outline-variant/30 bg-surface-container-low/40 p-5">
                  <h3 className="text-sm font-semibold text-on-surface">
                    Projekteinstellungen & Anweisungen
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-1">
                        Projektname
                      </label>
                      <Input
                        defaultValue={selectedProject.name}
                        onBlur={(e) => {
                          if (e.target.value.trim() && e.target.value !== selectedProject.name) {
                            void handleUpdateProject({ name: e.target.value.trim() })
                          }
                        }}
                        aria-label="Projektname"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-1">
                        System-Prompt / Projektanweisungen für Singra
                      </label>
                      <Textarea
                        defaultValue={selectedProject.system_prompt ?? ''}
                        rows={4}
                        placeholder="z. B. Programmiersprache, Architektur-Regeln, Stilvorgaben oder Kontext dieses Projekts …"
                        onBlur={(e) => {
                          if (e.target.value !== (selectedProject.system_prompt ?? '')) {
                            void handleUpdateProject({ system_prompt: e.target.value })
                          }
                        }}
                        aria-label="Projektanweisungen"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-1">
                        Lokaler Projektordner (optional, für Smart-System Desktop)
                      </label>
                      <div className="flex items-center gap-2">
                        <Folder className="h-4 w-4 text-on-surface-variant shrink-0" />
                        <Input
                          defaultValue={selectedProject.local_directory ?? ''}
                          placeholder="z. B. E:\Projekte\mein-repo oder /home/user/projekt"
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
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-1">
                          Git-Anbieter
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
                        <label className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-1">
                          Git-Branch
                        </label>
                        <Input
                          defaultValue={selectedProject.git_branch}
                          onBlur={(e) => {
                            if (e.target.value.trim() && e.target.value !== selectedProject.git_branch) {
                              void handleUpdateProject({ git_branch: e.target.value.trim() })
                            }
                          }}
                          aria-label="Git-Branch"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-1">
                        Repository-URL (GitHub / GitLab HTTPS)
                      </label>
                      <Input
                        defaultValue={selectedProject.git_repo_url ?? ''}
                        placeholder="https://github.com/organisation/repository.git"
                        onBlur={(e) => {
                          if (e.target.value !== (selectedProject.git_repo_url ?? '')) {
                            void handleUpdateProject({
                              git_repo_url: e.target.value.trim() || null,
                            })
                          }
                        }}
                        aria-label="Repository-URL"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-1">
                        Git Personal Access Token (DIS-verschlüsselt)
                      </label>
                      <Input
                        type="password"
                        placeholder={
                          selectedProject.git_token_configured
                            ? 'Token hinterlegt (zum Ersetzen neu eingeben)'
                            : 'ghp_… oder glpat-…'
                        }
                        onBlur={(e) => {
                          if (e.target.value.trim()) {
                            void handleUpdateProject({ git_token: e.target.value.trim() })
                            e.target.value = ''
                          }
                        }}
                        aria-label="Git Personal Access Token"
                      />
                    </div>
                    <div className="flex items-center justify-between rounded-xl border border-outline-variant/30 bg-surface-container p-3.5 mt-2">
                      <div>
                        <div className="text-xs font-semibold text-on-surface">
                          Autonome Ausführung für dieses Projekt
                        </div>
                        <p className="text-xs text-on-surface-variant mt-0.5">
                          Erlaubt Singra, Dateien, Ordner und Befehle in diesem Projekt ohne Einzelrückfrage zu bearbeiten.
                        </p>
                      </div>
                      <Switch
                        checked={projectAutonomy}
                        disabled={savingAutonomy}
                        onCheckedChange={handleToggleAutonomy}
                        aria-label="Autonome Ausführung für dieses Projekt"
                      />
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
            <DialogTitle>Neue Projektdatei anlegen</DialogTitle>
            <DialogDescription>
              Gib einen relativen Dateipfad innerhalb des Projekts an (z. B. `src/main.py` oder `README.md`).
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
              aria-label="Relativer Dateipfad"
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

      {/* Create Project Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Neues Singra-Projekt erstellen</DialogTitle>
            <DialogDescription>
              Projekte bündeln Unterhaltungen, Dateien, eine isolierte Coding-Sandbox sowie optional ein GitHub- oder GitLab-Repository.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateProject} className="space-y-3.5 mt-2">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-1">
                Name des Projekts
              </label>
              <Input
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="z. B. Backend-Service oder Server-Handbuch"
                required
                aria-label="Name des Projekts"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-1">
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
                <label className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-1">
                  Bereich (Persönlich / Team)
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
              <label className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-1">
                Kurzbeschreibung
              </label>
              <Input
                value={draft.description ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                placeholder="Worum geht es in diesem Projekt?"
                aria-label="Kurzbeschreibung"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-1">
                Projektanweisungen (System-Prompt)
              </label>
              <Textarea
                value={draft.system_prompt ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, system_prompt: e.target.value }))}
                rows={3}
                placeholder="Besondere Vorgaben, Architektur oder Regeln für Singra in diesem Projekt …"
                aria-label="Projektanweisungen"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-1">
                  Git-Anbindung (optional)
                </label>
                <Dropdown
                  value={draft.git_provider ?? '__none__'}
                  onChange={(val) =>
                    setDraft((d) => ({
                      ...d,
                      git_provider:
                        val === '__none__'
                          ? null
                          : (val as 'github' | 'gitlab' | 'custom'),
                    }))
                  }
                  options={GIT_PROVIDER_OPTIONS}
                  aria-label="Git-Anbindung"
                />
              </div>
              {draft.git_provider && (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-1">
                    Branch
                  </label>
                  <Input
                    value={draft.git_branch ?? 'main'}
                    onChange={(e) => setDraft((d) => ({ ...d, git_branch: e.target.value }))}
                    placeholder="main"
                    aria-label="Branch"
                  />
                </div>
              )}
            </div>
            {draft.git_provider && (
              <>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-1">
                    Repository-URL
                  </label>
                  <Input
                    value={draft.git_repo_url ?? ''}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, git_repo_url: e.target.value }))
                    }
                    placeholder="https://github.com/name/projekt.git"
                    aria-label="Repository-URL"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-1">
                    Personal Access Token (optional, für private Repos & Push)
                  </label>
                  <Input
                    type="password"
                    value={draft.git_token ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, git_token: e.target.value }))}
                    placeholder="ghp_… oder glpat-…"
                    aria-label="Personal Access Token"
                  />
                </div>
              </>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setCreateOpen(false)}
              >
                Abbrechen
              </Button>
              <Button type="submit" disabled={savingProject || !draft.name.trim()}>
                {savingProject ? 'Erstellt…' : 'Projekt erstellen'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
