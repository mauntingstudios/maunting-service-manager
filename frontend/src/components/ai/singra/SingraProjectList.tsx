import { ChevronRight, Code2, Folder, GitBranch, Layers, Plus } from 'lucide-react'
import type { AiProject } from '@/api/ai'
import { Button } from '@maunting/ui'

interface SingraProjectListProps {
  projects: AiProject[]
  onSelectProject: (projectId: string) => void
  onOpenCreate: () => void
}

export function SingraProjectList({
  projects,
  onSelectProject,
  onOpenCreate,
}: SingraProjectListProps) {
  return (
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
            onClick={onOpenCreate}
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
            <Button type="button" className="mt-5 rounded-full px-5" onClick={onOpenCreate}>
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
                onClick={() => onSelectProject(proj.id)}
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
  )
}
