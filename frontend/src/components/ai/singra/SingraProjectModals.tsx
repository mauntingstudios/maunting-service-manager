import type { FormEvent } from 'react'
import { FileText, Lock, Unlock, Users } from 'lucide-react'
import type { AiProject } from '@/api/ai'
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
} from '@maunting/ui'

export interface SingraProjectModalsProps {
  selectedProject: AiProject | null
  teams: Team[]
  newFileModalOpen: boolean
  setNewFileModalOpen: (open: boolean) => void
  newFilePath: string
  setNewFilePath: (path: string) => void
  onSaveNewFile: (path: string, content: string) => void
  createRepoOpen: boolean
  setCreateRepoOpen: (open: boolean) => void
  newRepoName: string
  setNewRepoName: (name: string) => void
  newRepoPrivate: boolean
  setNewRepoPrivate: (priv: boolean) => void
  newRepoProvider: 'github' | 'gitlab'
  setNewRepoProvider: (provider: 'github' | 'gitlab') => void
  newRepoToken: string
  setNewRepoToken: (token: string) => void
  gitBusy: boolean
  onCreateRemoteRepo: (e: FormEvent) => void
  showAgentsModal: boolean
  setShowAgentsModal: (open: boolean) => void
  agentsRules: {
    found: boolean
    filename: string | null
    content: string | null
    lines_count: number
    size_bytes: number
  } | null
  teamShareModalOpen: boolean
  setTeamShareModalOpen: (open: boolean) => void
  selectedTeamShareId: string
  setSelectedTeamShareId: (id: string) => void
  savingProject: boolean
  onSaveTeamShare: (e: FormEvent) => void
}

export function SingraProjectModals({
  selectedProject,
  teams,
  newFileModalOpen,
  setNewFileModalOpen,
  newFilePath,
  setNewFilePath,
  onSaveNewFile,
  createRepoOpen,
  setCreateRepoOpen,
  newRepoName,
  setNewRepoName,
  newRepoPrivate,
  setNewRepoPrivate,
  newRepoProvider,
  setNewRepoProvider,
  newRepoToken,
  setNewRepoToken,
  gitBusy,
  onCreateRemoteRepo,
  showAgentsModal,
  setShowAgentsModal,
  agentsRules,
  teamShareModalOpen,
  setTeamShareModalOpen,
  selectedTeamShareId,
  setSelectedTeamShareId,
  savingProject,
  onSaveTeamShare,
}: SingraProjectModalsProps) {
  return (
    <>
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
              onSaveNewFile(newFilePath.trim(), '')
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
          <form onSubmit={onCreateRemoteRepo} className="space-y-4 px-6 pb-6 pt-5">
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
          <form onSubmit={onSaveTeamShare} className="space-y-4 px-6 pb-6 pt-5">
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
    </>
  )
}
