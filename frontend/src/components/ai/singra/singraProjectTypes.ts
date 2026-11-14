import type { AiProjectFile } from '@/api/ai'
import type { FileEntry } from '@/components/server/fileWorkspaceTypes'

export type ProjectTab = 'chats' | 'files' | 'preview' | 'database' | 'tests' | 'settings'
export type ProjectCreateMode = 'empty' | 'create_repo' | 'clone_repo'

export interface SingraProjectsViewProps {
  initialProjectId?: string | null
  onOpenProjectChat: (projectId: string, conversationId?: string) => void
}

export const PROJECT_KIND_OPTIONS = [
  { value: 'coding', label: 'Code & Entwicklung' },
  { value: 'docs', label: 'Dokumente & Wissen' },
  { value: 'general', label: 'Allgemeines Projekt' },
]

export const GIT_PROVIDER_OPTIONS = [
  { value: '__none__', label: 'Keine Git-Anbindung' },
  { value: 'github', label: 'GitHub' },
  { value: 'gitlab', label: 'GitLab' },
  { value: 'custom', label: 'Eigener Git-Server (HTTPS)' },
]

/**
 * Baut aus der flachen Projektdatei-Liste eine hierarchische Verzeichnisstruktur
 * für die gemeinsame `FileTree`-Komponente.
 */
export function buildProjectTreeNodes(files: AiProjectFile[]): {
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
