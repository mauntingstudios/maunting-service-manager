import { describe, expect, it } from 'vitest'

import type { AiWorkerInfo } from '@/api/ai'
import { gruppiereWorker } from './SingraToolsView'

describe('gruppiereWorker', () => {
  it('gruppiert und sortiert Worker sauber nach Projekt, Chat, Aufgabe und Sonstige', () => {
    const workers: AiWorkerInfo[] = [
      {
        conversation_id: 'w-sonst',
        title: 'Ohne Zuordnung',
        status: 'running',
        created_at: '2026-11-18T10:00:00Z',
      },
      {
        conversation_id: 'w-aufgabe',
        title: 'Nacht-Check',
        status: 'running',
        created_at: '2026-11-18T10:01:00Z',
        task_id: 'task-1',
        task_title: 'Tägliche Sicherung',
      },
      {
        conversation_id: 'w-chat',
        title: 'Logs auswerten',
        status: 'waiting_confirmation',
        created_at: '2026-11-18T10:02:00Z',
        parent_conversation_id: 'conv-1',
        parent_conversation_title: 'Server-Analyse',
      },
      {
        conversation_id: 'w-proj-alt',
        title: 'Linting',
        status: 'running',
        created_at: '2026-11-18T09:00:00Z',
        project_id: 'proj-1',
        project_name: 'Alpha-App',
      },
      {
        conversation_id: 'w-proj-neu',
        title: 'Build prüfen',
        status: 'running',
        created_at: '2026-11-18T11:00:00Z',
        project_id: 'proj-1',
        project_name: 'Alpha-App',
      },
    ]

    const gruppen = gruppiereWorker(workers)
    expect(gruppen.map((g) => g.kategorie)).toEqual(['projekt', 'chat', 'aufgabe', 'sonstige'])
    expect(gruppen[0].titel).toBe('Alpha-App')
    expect(gruppen[0].workers.map((w) => w.conversation_id)).toEqual(['w-proj-neu', 'w-proj-alt'])
    expect(gruppen[1].titel).toBe('Server-Analyse')
    expect(gruppen[2].titel).toBe('Tägliche Sicherung')
    expect(gruppen[3].titel).toBe('Weitere Aufträge')
  })
})
