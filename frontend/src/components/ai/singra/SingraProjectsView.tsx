import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import {
  EDITOR_BASIC_SETUP,
  EDITOR_THEME,
  languageExtension,
} from '@/components/server/FileEditorWorkspace'
import {
  Code2,
  ExternalLink,
  Eye,
  FileCode,
  FileText,
  Folder,
  FolderCode,
  FolderGit2,
  GitBranch,
  GitCommit,
  Globe,
  Laptop,
  Layers,
  MessageSquare,
  MousePointer,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  Save,
  Settings2,
  Smartphone,
  Tablet,
  Terminal,
  Trash2,
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

type ProjectTab = 'chats' | 'files' | 'preview' | 'terminal' | 'git' | 'settings'

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

  // Agents rules state
  const [agentsRules, setAgentsRules] = useState<{
    found: boolean
    filename: string | null
    content: string | null
    lines_count: number
    size_bytes: number
  } | null>(null)
  const [showAgentsModal, setShowAgentsModal] = useState(false)

  // Live-Preview & Split-View state
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

  // Git state
  const [gitStatus, setGitStatus] = useState<AiProjectGitStatus | null>(null)
  const [gitBusy, setGitBusy] = useState(false)
  const [commitMessage, setCommitMessage] = useState('')
  const [pushOnCommit, setPushOnCommit] = useState(true)

  // Create / Edit Modal
  const [createOpen, setCreateOpen] = useState(false)
  const [createTab, setCreateTab] = useState<'general' | 'git' | 'rules'>('general')
  const [cloneImmediately, setCloneImmediately] = useState(false)
  const [useWorktree, setUseWorktree] = useState(true)
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

      if (cloneImmediately && draft.git_repo_url?.trim()) {
        toast.info('Projekt angelegt. Klone Repository im Hintergrund…')
        try {
          const syncStatus = await aiApi.syncProjectGit(created.id, {
            repo_url: draft.git_repo_url.trim(),
            branch: draft.git_branch?.trim() || 'main',
            provider: draft.git_provider,
            token: draft.git_token?.trim() || null,
          })
          setGitStatus(syncStatus)
          await loadProjectDetails(created.id)
          toast.success('Repository erfolgreich geklont und mit Projekt synchronisiert.')
        } catch {
          toast.warning('Projekt wurde erstellt, aber der automatische Git-Clone schlug fehl. Prüfe URL und Token unter Git.')
        }
      } else {
        toast.success('Projekt wurde angelegt.')
      }

      setCreateTab('general')
      setCloneImmediately(false)
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

  const activeFileExtension = useMemo(() => {
    return activeFilePath ? languageExtension(activeFilePath) : null
  }, [activeFilePath])

  // Automatischer srcDoc-Bundle für HTML/CSS/JS-Projekte direkt im Browser
  const previewSrcDoc = useMemo(() => {
    if (previewMode !== 'bundle') return null
    const htmlFile =
      files.find((f) => f.path.toLowerCase() === 'index.html') ||
      files.find((f) => f.path.toLowerCase().endsWith('.html'))
    if (!htmlFile) return null

    let doc = htmlFile.content || '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body></body></html>'

    // Ersetze verlinkte CSS-Dateien inline
    files
      .filter((f) => f.path.toLowerCase().endsWith('.css'))
      .forEach((css) => {
        const baseName = css.path.split('/').pop() || css.path
        const linkRegex = new RegExp(`<link[^>]+href=["'][^"']*${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`, 'gi')
        if (linkRegex.test(doc)) {
          doc = doc.replace(linkRegex, `<style>/* ${css.path} */\n${css.content}</style>`)
        } else {
          doc = doc.replace('</head>', `<style>/* ${css.path} */\n${css.content}</style></head>`)
        }
      })

    // Ersetze verlinkte JS-Dateien inline
    files
      .filter((f) => f.path.toLowerCase().endsWith('.js') && !f.path.toLowerCase().endsWith('.json'))
      .forEach((js) => {
        const baseName = js.path.split('/').pop() || js.path
        const scriptRegex = new RegExp(`<script[^>]+src=["'][^"']*${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>\\s*</script>`, 'gi')
        if (scriptRegex.test(doc)) {
          doc = doc.replace(scriptRegex, `<script>/* ${js.path} */\n${js.content}</script>`)
        } else {
          doc = doc.replace('</body>', `<script>/* ${js.path} */\n${js.content}</script></body>`)
        }
      })

    // Inspektor-Bridge und Link-Schutz injizieren
    const bridgeScript = `
<script>
(function() {
  // Verhindere Navigationen außerhalb der Sandbox
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
        console.warn('Navigation im Vorschau-Frame abgefangen:', href);
      }
    }
  }, true);

  // Inspektor
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
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        if (activeTab === 'files' && activeFilePath && !savingFile) {
          e.preventDefault()
          void handleSaveFile(activeFilePath, fileContent)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeTab, activeFilePath, fileContent, savingFile])

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
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="font-headline text-base font-semibold text-on-surface truncate">
                    {selectedProject.name}
                  </h2>
                  {selectedProject.git_repo_url && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-label-sm font-medium text-primary">
                      <GitBranch className="h-3 w-3" aria-hidden="true" />
                      {selectedProject.git_branch}
                    </span>
                  )}
                  {/* AGENTS.md Status Badge */}
                  {agentsRules?.found && (
                    <button
                      type="button"
                      onClick={() => setShowAgentsModal(true)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-primary/35 bg-primary/15 px-2.5 py-0.5 text-label-sm font-medium text-primary hover:bg-primary/25 transition-colors"
                      title="Projektregeln ansehen"
                    >
                      <FileText className="h-3 w-3" aria-hidden="true" />
                      <span>{agentsRules.filename} aktiv ({agentsRules.lines_count} Zeilen)</span>
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

              {/* Dual-Target Widget: Dev & Prod */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-2 rounded-xl border border-outline-variant/25 bg-surface-container/60 px-3 py-1.5 text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-status-success animate-pulse" />
                    <span className="font-semibold text-on-surface">Dev:</span>
                    <span className="text-on-surface-variant">Sandbox aktiv</span>
                  </div>
                  <span className="text-outline-variant/60">|</span>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-status-warning" />
                    <span className="font-semibold text-on-surface">Prod:</span>
                    <span className="text-on-surface-variant">Bereit</span>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-6 px-2 text-xs gap-1 ml-1"
                    onClick={() => {
                      toast.info('Go-Live Vorbereitung: Singra generiert das MSM-Blueprint und Cloudflare DNS-Routing.')
                    }}
                  >
                    <Rocket className="h-3 w-3 text-primary" />
                    Go-Live
                  </Button>
                </div>

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
                  { id: 'preview', label: 'Vorschau & Inspektor', icon: Globe },
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
                        <div className="flex-1 min-h-[360px] overflow-hidden rounded-lg border border-outline-variant/30 bg-[#071013]">
                          <CodeMirror
                            value={fileContent}
                            height="100%"
                            minHeight="360px"
                            theme={EDITOR_THEME}
                            basicSetup={EDITOR_BASIC_SETUP}
                            extensions={activeFileExtension ? [activeFileExtension] : []}
                            onChange={(val) => setFileContent(val)}
                            aria-label={`Dateiinhalt von ${activeFilePath}`}
                          />
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-1 flex-col items-center justify-center p-6 text-center text-xs text-on-surface-variant">
                        Wähle links eine Datei aus oder lege eine neue Datei (z. B. `README.md` oder `main.py`) an.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'preview' && (
                <div className="flex h-full min-h-[500px] flex-col rounded-xl border border-outline-variant/30 bg-surface-container-low/35 overflow-hidden">
                  {/* Top Bar: Mode Switcher, URL, Device Switcher, Inspector Toggle, Open In Browser */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant/20 bg-surface-container-low/60 px-4 py-2.5">
                    <div className="flex items-center gap-2 flex-1 max-w-lg">
                      {/* Quelle: Live-Bundle (Dateien) vs. URL (Dev-Server) */}
                      <div className="flex items-center rounded-lg border border-outline-variant/30 bg-surface-container-high/40 p-0.5 shrink-0 text-xs">
                        <button
                          type="button"
                          onClick={() => setPreviewMode('bundle')}
                          className={[
                            'px-2 py-1 rounded-md transition-colors font-medium',
                            previewMode === 'bundle'
                              ? 'bg-primary/20 text-primary'
                              : 'text-on-surface-variant hover:text-on-surface',
                          ].join(' ')}
                          title="Rendert die Projektdateien (HTML/CSS/JS) direkt"
                        >
                          Projektdateien
                        </button>
                        <button
                          type="button"
                          onClick={() => setPreviewMode('url')}
                          className={[
                            'px-2 py-1 rounded-md transition-colors font-medium',
                            previewMode === 'url'
                              ? 'bg-primary/20 text-primary'
                              : 'text-on-surface-variant hover:text-on-surface',
                          ].join(' ')}
                          title="Verbindet mit einem laufenden Dev-Server (z. B. Vite/Next/Flask)"
                        >
                          Server-URL
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
                            aria-label="Vorschau-URL"
                          />
                        </div>
                      ) : (
                        <span className="text-xs text-on-surface-variant truncate font-mono">
                          {files.some((f) => f.path.toLowerCase().endsWith('.html'))
                            ? `Live-Rendering: ${files.find((f) => f.path.toLowerCase() === 'index.html')?.path || files.find((f) => f.path.toLowerCase().endsWith('.html'))?.path}`
                            : 'Keine HTML-Datei gefunden'}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Device Mode Switcher */}
                      <div className="flex items-center rounded-lg border border-outline-variant/30 bg-surface-container-high/40 p-0.5">
                        <button
                          type="button"
                          onClick={() => setPreviewDevice('desktop')}
                          className={[
                            'p-1.5 rounded-md transition-colors',
                            previewDevice === 'desktop' ? 'bg-primary/20 text-primary' : 'text-on-surface-variant hover:text-on-surface',
                          ].join(' ')}
                          title="Desktop (100%)"
                        >
                          <Laptop className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setPreviewDevice('tablet')}
                          className={[
                            'p-1.5 rounded-md transition-colors',
                            previewDevice === 'tablet' ? 'bg-primary/20 text-primary' : 'text-on-surface-variant hover:text-on-surface',
                          ].join(' ')}
                          title="Tablet (768px)"
                        >
                          <Tablet className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setPreviewDevice('mobile')}
                          className={[
                            'p-1.5 rounded-md transition-colors',
                            previewDevice === 'mobile' ? 'bg-primary/20 text-primary' : 'text-on-surface-variant hover:text-on-surface',
                          ].join(' ')}
                          title="Smartphone (375px)"
                        >
                          <Smartphone className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {/* Element Inspector Button */}
                      <Button
                        type="button"
                        size="sm"
                        variant={inspectMode ? 'primary' : 'secondary'}
                        className="h-8 text-xs gap-1.5"
                        onClick={() => {
                          const next = !inspectMode
                          setInspectMode(next)
                          if (next) {
                            toast.info('Klick-Inspektor aktiv: Fahre über ein Element und klicke darauf.')
                          } else {
                            setInspectElement(null)
                          }
                        }}
                      >
                        <MousePointer className="h-3.5 w-3.5" aria-hidden="true" />
                        {inspectMode ? 'Inspektor aktiv' : 'Element inspizieren'}
                      </Button>

                      {/* Open in external tab (nur bei URL sinnvoll) */}
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

                  {/* Inspector Pin Alert */}
                  {inspectElement && (
                    <div className="flex items-center justify-between gap-2 border-b border-primary/20 bg-primary/10 px-4 py-2 text-xs text-on-surface">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-primary">Angepinntes Element:</span>
                        <code className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-primary text-xs">
                          {inspectElement}
                        </code>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          className="h-6 px-2 text-xs"
                          onClick={() => {
                            void handleStartNewProjectChat(`Änderungswunsch für Element: ${inspectElement}`)
                          }}
                        >
                          Im Chat besprechen
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

                  {/* Iframe stage */}
                  <div className="flex flex-1 items-center justify-center bg-black/40 p-4 overflow-auto min-h-[380px]">
                    <div
                      className={[
                        'h-full min-h-[420px] transition-all rounded-lg overflow-hidden border border-outline-variant/30 shadow-2xl bg-surface flex flex-col',
                        previewDevice === 'desktop' ? 'w-full' : previewDevice === 'tablet' ? 'w-[768px]' : 'w-[375px]',
                      ].join(' ')}
                    >
                      {previewMode === 'bundle' && !previewSrcDoc ? (
                        <div className="flex flex-1 flex-col items-center justify-center p-8 text-center text-on-surface-variant">
                          <Globe className="h-10 w-10 text-primary/40 mb-3" />
                          <p className="text-sm font-medium text-on-surface">Keine HTML-Datei vorhanden</p>
                          <p className="text-xs text-on-surface-variant max-w-sm mt-1">
                            Sobald eine <code>index.html</code> (oder andere HTML-Datei) im Projekt existiert, wird sie hier automatisch mit verlinktem CSS und JS gerendert.
                          </p>
                        </div>
                      ) : (
                        <iframe
                          ref={previewIframeRef}
                          key={previewMode === 'bundle' ? 'bundle-preview' : previewUrl}
                          src={previewMode === 'url' ? previewUrl : undefined}
                          srcDoc={previewMode === 'bundle' ? (previewSrcDoc ?? undefined) : undefined}
                          title="Projekt Live-Vorschau"
                          className="w-full flex-1 border-0 min-h-[400px] bg-white"
                          sandbox="allow-scripts allow-forms allow-modals"
                        />
                      )}
                    </div>
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

      {/* Create Project Dialog: Generous 3-Tab Layout */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-6 sm:p-8">
          <DialogHeader className="space-y-2 pb-2">
            <DialogTitle className="text-xl font-headline font-bold text-on-surface">
              Neues Singra-Projekt erstellen
            </DialogTitle>
            <DialogDescription className="text-xs sm:text-sm text-on-surface-variant leading-relaxed">
              Bündele Unterhaltungen, Dateien, eine isolierte Coding-Sandbox sowie optional ein GitHub- oder GitLab-Repository mit automatischer AGENTS.md-Regelbindung.
            </DialogDescription>
          </DialogHeader>

          {/* 3 Step Tabs */}
          <div className="flex items-center gap-1.5 border-b border-outline-variant/20 pt-2 pb-3 mb-2" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={createTab === 'general'}
              onClick={() => setCreateTab('general')}
              className={[
                'inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors',
                createTab === 'general'
                  ? 'bg-primary/20 text-primary border border-primary/35'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/40 border border-transparent',
              ].join(' ')}
            >
              <FolderCode className="h-3.5 w-3.5" />
              <span>1. Allgemein</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={createTab === 'git'}
              onClick={() => setCreateTab('git')}
              className={[
                'inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors',
                createTab === 'git'
                  ? 'bg-primary/20 text-primary border border-primary/35'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/40 border border-transparent',
              ].join(' ')}
            >
              <GitBranch className="h-3.5 w-3.5" />
              <span>2. Quellcode & Git</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={createTab === 'rules'}
              onClick={() => setCreateTab('rules')}
              className={[
                'inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors',
                createTab === 'rules'
                  ? 'bg-primary/20 text-primary border border-primary/35'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/40 border border-transparent',
              ].join(' ')}
            >
              <FileText className="h-3.5 w-3.5" />
              <span>3. Anweisungen & AGENTS.md</span>
            </button>
          </div>

          <form onSubmit={handleCreateProject} className="space-y-5 pt-1">
            {/* Tab 1: Allgemein */}
            {createTab === 'general' && (
              <div className="space-y-4 px-1 py-1">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-1.5">
                    Name des Projekts *
                  </label>
                  <Input
                    value={draft.name}
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                    placeholder="z. B. Backend-Service oder Web-Portal"
                    required
                    autoFocus
                    aria-label="Name des Projekts"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-1.5">
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
                    <label className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-1.5">
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
                  <label className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-1.5">
                    Kurzbeschreibung
                  </label>
                  <Input
                    value={draft.description ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                    placeholder="Worum geht es in diesem Projekt?"
                    aria-label="Kurzbeschreibung"
                  />
                </div>
              </div>
            )}

            {/* Tab 2: Quellcode & Git */}
            {createTab === 'git' && (
              <div className="space-y-4 px-1 py-1">
                <div className="rounded-xl border border-outline-variant/30 bg-surface-container-low/40 p-4 sm:p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-semibold text-on-surface">Repository-Modus</div>
                      <div className="text-xs text-on-surface-variant">
                        Soll das Projekt leer beginnen oder aus einem Git-Repository geklont werden?
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-on-surface-variant">
                        {cloneImmediately ? 'Aus Git klonen' : 'Neues leeres Projekt'}
                      </span>
                      <Switch
                        checked={cloneImmediately}
                        onCheckedChange={(checked) => {
                          setCloneImmediately(checked)
                          if (checked && !draft.git_provider) {
                            setDraft((d) => ({ ...d, git_provider: 'github' }))
                          }
                        }}
                        aria-label="Repository beim Anlegen klonen"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-1.5">
                        Git-Anbieter
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
                        aria-label="Git-Anbieter"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-1.5">
                        Branch
                      </label>
                      <Input
                        value={draft.git_branch ?? 'main'}
                        onChange={(e) => setDraft((d) => ({ ...d, git_branch: e.target.value }))}
                        placeholder="main"
                        aria-label="Branch"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-1.5">
                      Repository-URL
                    </label>
                    <Input
                      value={draft.git_repo_url ?? ''}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, git_repo_url: e.target.value }))
                      }
                      placeholder="https://github.com/nutzer/projekt.git"
                      aria-label="Repository-URL"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-1.5">
                      Personal Access Token (optional für private Repos)
                    </label>
                    <Input
                      type="password"
                      value={draft.git_token ?? ''}
                      onChange={(e) => setDraft((d) => ({ ...d, git_token: e.target.value }))}
                      placeholder="ghp_… oder glpat-…"
                      aria-label="Personal Access Token"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-outline-variant/20">
                    <div>
                      <div className="text-xs font-medium text-on-surface">Isolierte Git-Worktrees nutzen</div>
                      <div className="text-xs text-on-surface-variant">
                        Empfohlen: Autonome KI-Tasks arbeiten in einem separaten Worktree, ohne deinen Arbeitszweig zu stören.
                      </div>
                    </div>
                    <Switch
                      checked={useWorktree}
                      onCheckedChange={setUseWorktree}
                      aria-label="Isolierte Git-Worktrees aktivieren"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Tab 3: Anweisungen & AGENTS.md */}
            {createTab === 'rules' && (
              <div className="space-y-4 px-1 py-1">
                <div className="rounded-xl border border-primary/25 bg-primary/10 p-4 sm:p-5 text-xs space-y-2">
                  <div className="flex items-center gap-2 font-semibold text-primary">
                    <FileText className="h-4 w-4" aria-hidden="true" />
                    <span>Automatische AGENTS.md Erkennung</span>
                  </div>
                  <p className="text-on-surface leading-relaxed">
                    Liegt im geklonten oder angelegten Repository eine Datei namens <code className="rounded bg-black/30 px-1 py-0.5 font-mono text-primary">AGENTS.md</code>, <code className="rounded bg-black/30 px-1 py-0.5 font-mono text-primary">GEMINI.md</code> oder <code className="rounded bg-black/30 px-1 py-0.5 font-mono text-primary">CLAUDE.md</code>, liest Singra diese automatisch ein und bindet sie als bindende Projektregeln in jede Unterhaltung ein.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-1.5">
                    Zusätzliche Projektanweisungen (System-Prompt)
                  </label>
                  <Textarea
                    value={draft.system_prompt ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, system_prompt: e.target.value }))}
                    rows={4}
                    placeholder="Besondere Vorgaben, Architektur oder Regeln für Singra in diesem Projekt …"
                    aria-label="Projektanweisungen"
                  />
                  <p className="mt-1 text-xs text-on-surface-variant">
                    Kann leer bleiben, falls bereits eine AGENTS.md im Projekt vorhanden ist oder später angelegt wird.
                  </p>
                </div>
              </div>
            )}

            {/* Dialog Footer Actions */}
            <div className="flex items-center justify-between gap-3 pt-4 mt-2 border-t border-outline-variant/20 px-1">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setCreateOpen(false)}
              >
                Abbrechen
              </Button>

              <div className="flex items-center gap-2">
                {createTab !== 'general' && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      if (createTab === 'rules') setCreateTab('git')
                      else if (createTab === 'git') setCreateTab('general')
                    }}
                  >
                    Zurück
                  </Button>
                )}

                {createTab !== 'rules' ? (
                  <Button
                    type="button"
                    onClick={() => {
                      if (createTab === 'general') setCreateTab('git')
                      else if (createTab === 'git') setCreateTab('rules')
                    }}
                  >
                    Weiter
                  </Button>
                ) : (
                  <Button type="submit" disabled={savingProject || !draft.name.trim()}>
                    {savingProject ? 'Erstellt…' : 'Projekt erstellen'}
                  </Button>
                )}
              </div>
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
              <span>{agentsRules?.filename ?? 'AGENTS.md'} (Projektregeln)</span>
            </DialogTitle>
            <DialogDescription>
              Diese Regeln werden automatisch in den System-Prompt jeder Unterhaltung innerhalb dieses Projekts injiziert.
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
