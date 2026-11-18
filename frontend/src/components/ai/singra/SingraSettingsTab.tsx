import { useEffect, useState, type FormEvent } from 'react'
import { FolderGit2, GitCommit, Plus, RefreshCw, Save } from 'lucide-react'
import type { AiProject, AiProjectGitStatus, AiProjectWrite } from '@/api/ai'
import { Badge, Button, Dropdown, Input, PasswordInput, Switch, Textarea } from '@maunting/ui'
import { GIT_PROVIDER_OPTIONS } from './singraProjectTypes'

export interface SingraSettingsTabProps {
  selectedProject: AiProject
  projectAutonomy: boolean
  hasProjectAutonomyOverride: boolean
  globalAutonomy: boolean
  savingAutonomy: boolean
  gitStatus: AiProjectGitStatus | null
  gitBusy: boolean
  commitMessage: string
  setCommitMessage: (val: string) => void
  pushOnCommit: boolean
  setPushOnCommit: (val: boolean) => void
  onUpdateProject: (patch: AiProjectWrite) => void
  onToggleAutonomy: (enabled: boolean) => void
  onResetAutonomyToGlobal: () => void
  onOpenCreateRepo: (projectName: string) => void
  onGitSync: () => void
  onGitCommit: (e: FormEvent) => void
}

export function SingraSettingsTab({
  selectedProject,
  projectAutonomy,
  hasProjectAutonomyOverride,
  globalAutonomy,
  savingAutonomy,
  gitStatus,
  gitBusy,
  commitMessage,
  setCommitMessage,
  pushOnCommit,
  setPushOnCommit,
  onUpdateProject,
  onToggleAutonomy,
  onResetAutonomyToGlobal,
  onOpenCreateRepo,
  onGitSync,
  onGitCommit,
}: SingraSettingsTabProps) {
  const [projectName, setProjectName] = useState(selectedProject.name)
  const [systemPrompt, setSystemPrompt] = useState(selectedProject.system_prompt ?? '')
  const [gitBranch, setGitBranch] = useState(selectedProject.git_branch ?? '')
  const [gitRepoUrl, setGitRepoUrl] = useState(selectedProject.git_repo_url ?? '')
  const [gitToken, setGitToken] = useState('')

  useEffect(() => {
    setProjectName(selectedProject.name)
    setSystemPrompt(selectedProject.system_prompt ?? '')
    setGitBranch(selectedProject.git_branch ?? '')
    setGitRepoUrl(selectedProject.git_repo_url ?? '')
    setGitToken('')
  }, [
    selectedProject.id,
    selectedProject.name,
    selectedProject.system_prompt,
    selectedProject.git_branch,
    selectedProject.git_repo_url,
  ])

  const generalDirty =
    projectName.trim() !== selectedProject.name ||
    systemPrompt !== (selectedProject.system_prompt ?? '')

  const gitConfigDirty =
    gitBranch.trim() !== (selectedProject.git_branch ?? '') ||
    gitRepoUrl.trim() !== (selectedProject.git_repo_url ?? '') ||
    Boolean(gitToken.trim())

  const handleSaveGeneral = (e: FormEvent) => {
    e.preventDefault()
    if (!projectName.trim() || !generalDirty) return
    const patch: AiProjectWrite = {}
    if (projectName.trim() !== selectedProject.name) {
      patch.name = projectName.trim()
    }
    if (systemPrompt !== (selectedProject.system_prompt ?? '')) {
      patch.system_prompt = systemPrompt
    }
    onUpdateProject(patch)
  }

  const handleSaveGitConfig = (e: FormEvent) => {
    e.preventDefault()
    if (!gitConfigDirty) return
    const patch: AiProjectWrite = {}
    if (gitBranch.trim() && gitBranch.trim() !== (selectedProject.git_branch ?? '')) {
      patch.git_branch = gitBranch.trim()
    }
    if (gitRepoUrl.trim() !== (selectedProject.git_repo_url ?? '')) {
      patch.git_repo_url = gitRepoUrl.trim() || null
    }
    if (gitToken.trim()) {
      patch.git_token = gitToken.trim()
      setGitToken('')
    }
    if (Object.keys(patch).length > 0) {
      onUpdateProject(patch)
    }
  }

  return (
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
        <form onSubmit={handleSaveGeneral} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-on-surface-variant mb-1">
              Projektname
            </label>
            <Input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              aria-label="Projektname"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-on-surface-variant mb-1">
              Arbeitsanweisungen für dieses Projekt
            </label>
            <Textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={4}
              placeholder="Welche Ziele, Stilvorgaben oder Wünsche gelten für dieses Projekt?"
              aria-label="Projektanweisungen"
            />
          </div>
          <div className="flex justify-end">
            <Button
              type="submit"
              size="sm"
              disabled={!projectName.trim() || !generalDirty}
            >
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
              Einstellungen speichern
            </Button>
          </div>
        </form>
        <div className="rounded-xl border border-outline-variant/25 bg-surface-container/60 p-3.5 space-y-2">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-on-surface">
                  Selbstständiges Arbeiten im Projekt erlauben
                </span>
                {hasProjectAutonomyOverride ? (
                  <Badge variant="default" className="text-xs">
                    Projektspezifisch
                  </Badge>
                ) : (
                  <Badge variant={globalAutonomy ? 'success' : 'default'} className="text-xs">
                    {globalAutonomy ? 'Global aktiv (Tools)' : 'Global inaktiv (Tools)'}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-on-surface-variant">
                Singra darf Dateien in diesem Projekt direkt anlegen und bearbeiten, ohne jede Änderung einzeln abzufragen.
              </p>
            </div>
            <Switch
              checked={projectAutonomy}
              disabled={savingAutonomy}
              onCheckedChange={onToggleAutonomy}
              aria-label="Selbstständiges Arbeiten im Projekt erlauben"
            />
          </div>
          <div className="flex items-center justify-between text-xs text-on-surface-variant border-t border-outline-variant/15 pt-2">
            <span>
              {hasProjectAutonomyOverride
                ? 'Dieses Projekt nutzt eine eigene Freigabe und überschreibt die globale KI-Einstellung unter „Tools“.'
                : `Erbt aktuell die globale Einstellung aus dem Menü „Tools“ (dort: ${globalAutonomy ? 'aktiv' : 'inaktiv'}).`}
            </span>
            {hasProjectAutonomyOverride && (
              <button
                type="button"
                disabled={savingAutonomy}
                onClick={onResetAutonomyToGlobal}
                className="text-primary hover:underline text-xs shrink-0 ml-2"
              >
                Auf globale Einstellung zurücksetzen
              </button>
            )}
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
                onClick={() => onOpenCreateRepo(selectedProject.name)}
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
                onClick={onGitSync}
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
          onSubmit={onGitCommit}
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
        <form onSubmit={handleSaveGitConfig} className="space-y-3 pt-2 border-t border-outline-variant/15">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-on-surface-variant mb-1">
                Anbieter
              </label>
              <Dropdown
                value={selectedProject.git_provider ?? '__none__'}
                onChange={(val) =>
                  onUpdateProject({
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
                value={gitBranch}
                onChange={(e) => setGitBranch(e.target.value)}
                aria-label="Git-Branch"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-on-surface-variant mb-1">
                Repository-Adresse
              </label>
              <Input
                value={gitRepoUrl}
                onChange={(e) => setGitRepoUrl(e.target.value)}
                placeholder="https://github.com/nutzer/projekt.git"
                aria-label="Repository-Adresse"
              />
            </div>
            <div className="sm:col-span-2">
              <PasswordInput
                label="Zugangsschlüssel (optional, falls nicht global im Schlüsselbund hinterlegt)"
                value={gitToken}
                onChange={(e) => setGitToken(e.target.value)}
                placeholder={
                  selectedProject.git_token_configured
                    ? 'Schlüssel ist hinterlegt (zum Ändern neu eingeben)'
                    : 'Nur nötig bei eigenem Zugangsschlüssel…'
                }
                aria-label="Git Zugangstoken"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" size="sm" variant="secondary" disabled={!gitConfigDirty}>
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
              Repository-Einstellungen speichern
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
