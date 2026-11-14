import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { ChevronDown, ChevronUp, Folder, FolderGit2, GitBranch } from 'lucide-react'
import type { AiProjectWrite } from '@/api/ai'
import type { Team } from '@/api/teams'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Dropdown,
  Input,
  Switch,
  Textarea,
} from '@maunting/ui'
import { PROJECT_KIND_OPTIONS, type ProjectCreateMode } from './singraProjectTypes'

export interface SingraCreateProjectModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  createMode: ProjectCreateMode
  setCreateMode: (mode: ProjectCreateMode) => void
  createRepoPrivate: boolean
  setCreateRepoPrivate: (priv: boolean) => void
  showAdvancedCreate: boolean
  setShowAdvancedCreate: Dispatch<SetStateAction<boolean>>
  draft: AiProjectWrite & { name: string }
  setDraft: Dispatch<SetStateAction<AiProjectWrite & { name: string }>>
  teams: Team[]
  savingProject: boolean
  onSubmit: (e: FormEvent) => void
}

export function SingraCreateProjectModal({
  open,
  onOpenChange,
  createMode,
  setCreateMode,
  createRepoPrivate,
  setCreateRepoPrivate,
  showAdvancedCreate,
  setShowAdvancedCreate,
  draft,
  setDraft,
  teams,
  savingProject,
  onSubmit,
}: SingraCreateProjectModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="space-y-1.5">
          <DialogTitle className="text-lg font-headline font-semibold text-on-surface">
            Neues Projekt anlegen
          </DialogTitle>
          <DialogDescription className="text-xs text-on-surface-variant">
            Schaffe einen aufgeräumten Arbeitsbereich für deine Unterhaltungen, Dateien und deinen Code.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4 px-6 pb-6 pt-5">
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
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={savingProject || !draft.name.trim()}>
              {savingProject ? 'Wird angelegt…' : 'Projekt erstellen'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
