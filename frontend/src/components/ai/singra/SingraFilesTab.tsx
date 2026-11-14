import type { Dispatch, FormEvent, SetStateAction } from 'react'
import {
  ChevronDown,
  ChevronUp,
  FileCode,
  FilePlus2,
  Folder,
  FolderPlus,
  Play,
  Plus,
  RefreshCw,
  Search,
  Terminal,
  Trash2,
  X,
} from 'lucide-react'
import type { AiProject, AiProjectExecResult, AiProjectFile } from '@/api/ai'
import { FileEditorWorkspace } from '@/components/server/FileEditorWorkspace'
import { FileTree } from '@/components/server/FileTree'
import { parentPath } from '@/components/server/fileHelpers'
import type { EditorTab, FileEntry, SearchResult } from '@/components/server/fileWorkspaceTypes'
import { ActionMenu, Button, Input, Kontextmenue, Kurzinfo, Pfadleiste } from '@maunting/ui'

interface ContextMenuState {
  x: number
  y: number
  path: string
  isDir: boolean
}

export interface SingraFilesTabProps {
  selectedProject: AiProject
  files: AiProjectFile[]
  treeNodes: Record<string, FileEntry[]>
  allDirs: string[]
  breadcrumbTeile: { key: string; label: string }[]
  expandedDirs: Set<string>
  setExpandedDirs: Dispatch<SetStateAction<Set<string>>>
  editorTabs: EditorTab[]
  activeFilePath: string | null
  setActiveFilePath: (path: string | null) => void
  fileSearchQuery: string
  setFileSearchQuery: (q: string) => void
  searchResults: SearchResult[] | null
  contextMenu: ContextMenuState | null
  setContextMenu: (state: ContextMenuState | null) => void
  setNewFilePath: (path: string) => void
  setNewFileModalOpen: (open: boolean) => void
  terminalOpen: boolean
  setTerminalOpen: Dispatch<SetStateAction<boolean>>
  commandInput: string
  setCommandInput: (val: string) => void
  runningCmd: boolean
  execHistory: Array<{ command: string; result: AiProjectExecResult; timestamp: string }>
  onReloadProject: (projectId: string) => void
  onToggleDir: (dirPath: string) => void
  onOpenFile: (path: string) => void
  onEditorChange: (path: string, content: string) => void
  onSaveFile: (path: string) => void
  onCloseTab: (path: string) => void
  onReloadTab: (path: string) => void
  onDeleteFile: (path: string) => void
  onRunCommand: (e: FormEvent) => void
}

export function SingraFilesTab({
  selectedProject,
  files,
  treeNodes,
  allDirs,
  breadcrumbTeile,
  expandedDirs,
  setExpandedDirs,
  editorTabs,
  activeFilePath,
  setActiveFilePath,
  fileSearchQuery,
  setFileSearchQuery,
  searchResults,
  contextMenu,
  setContextMenu,
  setNewFilePath,
  setNewFileModalOpen,
  terminalOpen,
  setTerminalOpen,
  commandInput,
  setCommandInput,
  runningCmd,
  execHistory,
  onReloadProject,
  onToggleDir,
  onOpenFile,
  onEditorChange,
  onSaveFile,
  onCloseTab,
  onReloadTab,
  onDeleteFile,
  onRunCommand,
}: SingraFilesTabProps) {
  return (
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
                  setNewFilePath(
                    currentDir ? `${currentDir}/neuer-ordner/README.md` : 'neuer-ordner/README.md',
                  )
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
              onClick={() => onReloadProject(selectedProject.id)}
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
              onToggle={onToggleDir}
              onOpenFile={onOpenFile}
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
            onChange={onEditorChange}
            onSave={onSaveFile}
            onClose={onCloseTab}
            onReload={onReloadTab}
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
                      onToggleDir(contextMenu.path)
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
                      onOpenFile(contextMenu.path)
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
                      onDeleteFile(targetPath)
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

          <form onSubmit={onRunCommand} className="flex gap-2 mb-2">
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
  )
}
