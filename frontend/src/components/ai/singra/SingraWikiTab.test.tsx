import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import type { AiProject, AiProjectWikiOverview, AiProjectWikiPageDetail } from '@/api/ai'

const { projectsApiMock } = vi.hoisted(() => ({
  projectsApiMock: {
    getProjectWiki: vi.fn(),
    updateProjectWikiSettings: vi.fn(),
    getProjectWikiPage: vi.fn(),
    saveProjectWikiPage: vi.fn(),
    deleteProjectWikiPage: vi.fn(),
    searchProjectWiki: vi.fn(),
    generateProjectWiki: vi.fn(),
    syncProjectWikiWorkspace: vi.fn(),
    commitProjectWiki: vi.fn(),
    openProjectWikiDoc: vi.fn(),
    syncProjectWikiDoc: vi.fn(),
  },
}))

vi.mock('@/api/ai/projectsApi', () => ({
  projectsApi: projectsApiMock,
}))

vi.mock('@/components/ai/MermaidBlock', () => ({
  MermaidBlock: ({ chart }: { chart: string }) => (
    <pre data-testid="mermaid-block">{chart}</pre>
  ),
}))

vi.mock('@/docs/DocEditor', () => ({
  DocEditor: () => <div data-testid="mock-doc-editor" />,
}))

import { SingraWikiTab } from './SingraWikiTab'

const PROJECT: AiProject = {
  id: 'proj-1',
  user_id: 1,
  team_id: null,
  name: 'Weather App',
  description: 'Wetter',
  instructions: null,
  icon: 'folder',
  color: 'emerald',
  project_kind: 'coding',
  workspace_mode: 'sandbox',
  local_path: null,
  git_provider: 'github',
  git_repo_url: '',
  git_branch: 'main',
  git_credential_id: null,
  pinned: false,
  archived: false,
  wiki_enabled: false,
  wiki_auto_update: false,
  wiki_path: '.singra/wiki',
  wiki_status: 'idle',
  created_at: '2026-11-26T10:00:00Z',
  updated_at: '2026-11-26T10:00:00Z',
}

const ENABLED_OVERVIEW: AiProjectWikiOverview = {
  project_id: 'proj-1',
  wiki_enabled: true,
  wiki_auto_update: true,
  wiki_path: '.singra/wiki',
  wiki_status: 'idle',
  wiki_last_indexed_commit: null,
  wiki_last_updated_at: '2026-11-26T10:05:00Z',
  wiki_last_error: null,
  docs_collab_available: false,
  git_configured: false,
  page_count: 1,
  pages: [
    {
      id: 'page-1',
      slug: 'architecture',
      title: 'System Architecture',
      category: 'architecture',
      summary: 'High level overview of backend and frontend modules.',
      file_path: '.singra/wiki/architecture.md',
      doc_uid: null,
      source_files: ['backend/main.py', 'frontend/src/App.tsx'],
      sort_order: 100,
      updated_by: 'ai',
      updated_at: '2026-11-26T10:05:00Z',
    },
  ],
}

const PAGE_DETAIL: AiProjectWikiPageDetail = {
  ...ENABLED_OVERVIEW.pages[0],
  content_markdown: '# Architecture\n\n```mermaid\nflowchart TD\n  A-->B\n```\n',
}

describe('SingraWikiTab', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de')
    vi.clearAllMocks()
  })

  it('shows disabled opt-in view first and can trigger enable + generate', async () => {
    projectsApiMock.getProjectWiki
      .mockResolvedValueOnce({
        ...ENABLED_OVERVIEW,
        wiki_enabled: false,
        wiki_auto_update: false,
        pages: [],
      })
      .mockResolvedValue({
        ...ENABLED_OVERVIEW,
        wiki_status: 'generating',
        pages: [],
      })
    projectsApiMock.updateProjectWikiSettings.mockResolvedValue({
      ...ENABLED_OVERVIEW,
      pages: [],
    })
    projectsApiMock.generateProjectWiki.mockResolvedValue({
      started: true,
      wiki_status: 'generating',
    })

    render(<SingraWikiTab selectedProject={PROJECT} onOpenSourceFile={vi.fn()} />)

    await screen.findByText(i18n.t('ai.projects.wiki.disabled.title'))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('ai.projects.wiki.actions.enableAndGenerate') }))

    await waitFor(() => {
      expect(projectsApiMock.updateProjectWikiSettings).toHaveBeenCalledWith('proj-1', { wiki_enabled: true })
      expect(projectsApiMock.generateProjectWiki).toHaveBeenCalledWith('proj-1', { mode: 'generate' })
    })
  })

  it('renders Knowledge Cards, opens a page with Mermaid & linked sources, and runs semantic search', async () => {
    projectsApiMock.getProjectWiki.mockResolvedValue(ENABLED_OVERVIEW)
    projectsApiMock.getProjectWikiPage.mockResolvedValue(PAGE_DETAIL)
    projectsApiMock.searchProjectWiki.mockResolvedValue([
      {
        slug: 'architecture',
        title: 'System Architecture',
        category: 'architecture',
        heading: 'Architecture',
        content: 'Flowchart connecting A and B.',
        score: 0.91,
      },
    ])

    const onOpenSourceFile = vi.fn()
    render(<SingraWikiTab selectedProject={PROJECT} onOpenSourceFile={onOpenSourceFile} />)

    const cardMatches = await screen.findAllByText('System Architecture')
    fireEvent.click(cardMatches[cardMatches.length - 1])

    await waitFor(() => {
      expect(projectsApiMock.getProjectWikiPage).toHaveBeenCalledWith('proj-1', 'architecture')
    })

    expect(await screen.findByTestId('mermaid-block')).toHaveTextContent('flowchart TD')
    const sourceBtn = screen.getByRole('button', { name: 'backend/main.py' })
    fireEvent.click(sourceBtn)
    expect(onOpenSourceFile).toHaveBeenCalledWith('backend/main.py')

    const searchInput = screen.getByPlaceholderText(i18n.t('ai.projects.wiki.searchPlaceholder'))
    fireEvent.change(searchInput, { target: { value: 'architecture flow' } })
    fireEvent.submit(searchInput.closest('form')!)

    await waitFor(() => {
      expect(projectsApiMock.searchProjectWiki).toHaveBeenCalledWith('proj-1', 'architecture flow', 6)
    })
    expect(await screen.findByText('Flowchart connecting A and B.')).toBeInTheDocument()
  })
})
